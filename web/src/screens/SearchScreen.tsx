import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Nav, SearchView } from "../App";
import { ArrivalBoard } from "../components/features/ArrivalBoard";
import { NaverMap } from "../components/features/NaverMap";
import type { PlaceInputHandle } from "../components/features/PlaceInput";
import { RefreshStatus } from "../components/features/RefreshStatus";
import { RouteOptionCard } from "../components/features/RouteOptionCard";
import { SearchForm, type SearchMode } from "../components/features/SearchForm";
import { RouteWeather } from "../components/features/WeatherLine";
import { Button, IconButton, Segmented } from "../components/ui";
import { useDb, useStore } from "../context";
import { useArrivalsRefresh } from "../hooks/useArrivalsRefresh";
import { useCountdown } from "../hooks/useCountdown";
import { useLiveOptions } from "../hooks/useLiveOptions";
import { useVisible } from "../hooks/useVisible";
import { fetchArrivals, type StationArrivals } from "../lib/api";
import type { Station } from "../lib/data";
import { type Place, samePlace } from "../lib/places";
import { compareBy, type SortMode } from "../lib/fare";
import { findPlans, type OptionResult } from "../lib/router";
import { isMine, myLocationPlace } from "../lib/places";
import {
  deviceKind, getMyLocation, LOCATION_ERROR_TEXT, type LocationError, locationPermission, PERMISSION_STEPS,
} from "../hooks/useMyLocation";

/** 이보다 빨리 거절되면 허용 팝업이 뜨지 않은 것으로 본다 */
const INSTANT_DENY_MS = 700;
/** 경로 검색 결과 자동 갱신 주기 (ADR-040). 남은 시간은 화면에서 1초마다 줄어드니 60초로도 충분하다 */
const SEARCH_REFRESH_MS = 60_000;
/** 경로 결과 정렬 (ADR-041). 고른 정렬은 이 기기에 기억한다 */
const SORT_KEY = "mybus.sort";
function loadSort(): SortMode {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v === "best" || v === "fast" || v === "cheap") return v;
  } catch { /* 저장소를 못 쓰면 기본값 */ }
  return "best";
}

/** 검색 화면: 입력 + 지도 + 결과 카드 + 출발 정류장 도착판. 상세로 갈 때는 숨겨서 상태를 유지한다 */
export function SearchScreen({ init, nav, active }: { init: SearchView; nav: Nav; active: boolean }) {
  const db = useDb();
  const store = useStore();
  const visible = useVisible();
  const live = active && visible;
  const now = useCountdown(active);
  const [from, setFrom] = useState<Place | null>(init.from ?? null);
  const [to, setTo] = useState<Place | null>(init.to ?? null);
  const [mode, setMode] = useState<SearchMode>("transfer");
  const [hover, setHover] = useState<number | null>(null);
  const fromRef = useRef<PlaceInputHandle>(null);
  const toRef = useRef<PlaceInputHandle>(null);
  const title = useRef<HTMLHeadingElement>(null);

  // 진입 시 포커스: 홈의 "어디로 갈까요?" → 출발 입력, 그 외 → 화면 제목
  useEffect(() => {
    if (init.focus) fromRef.current?.focus();
    else title.current?.focus({ preventScroll: true });
  }, [init]);

  // 출발·도착이 모두 정해지면 바로 후보를 찾는다 (정적 계산 — 1초 틱과 무관)
  const plans = useMemo(
    () => (from && to ? findPlans(db, from, to, mode === "transfer") : []),
    [db, from, to, mode],
  );
  const { savePair } = store;
  useEffect(() => {
    if (from && to) savePair(from, to);
    // savePair 는 version 마다 새 함수라 의존성에서 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // 정렬을 바꿔도 다시 조회하지 않게 후보를 전부(최대 12) 받아 두고, 화면에서 정렬해 8개만 보여 준다 (ADR-041)
  const [sort, setSortState] = useState<SortMode>(loadSort);
  const rank = useCallback((a: OptionResult, b: OptionResult) => compareBy(sort, a, b), [sort]);
  const opts = useLiveOptions(plans, live, 12, SEARCH_REFRESH_MS, rank);
  const setSort = (m: SortMode) => { setSortState(m); try { localStorage.setItem(SORT_KEY, m); } catch { /* 저장 못 해도 동작 */ } };
  useEffect(() => setHover(null), [plans]);

  // ---- 출발 정류장 도착판 (FR-4.5) ----
  const boardStation: Station | undefined = useMemo(() => {
    if (!from) return undefined;
    return from.kind === "station" ? db.stations.get(from.stationId) : db.grid.near(from.lat, from.lng, 500)[0]?.station;
  }, [db, from]);
  const [board, setBoard] = useState<{ station: Station; arrivals: StationArrivals } | null>(null);
  const boardTask = useCallback(async () => {
    if (!boardStation) { setBoard(null); return; }
    try {
      const arrivals = await fetchArrivals(boardStation.id, 10_000);
      setBoard({ station: boardStation, arrivals });
    } catch {
      setBoard(null);
    }
  }, [boardStation]);
  useEffect(() => { if (!boardStation) setBoard(null); }, [boardStation]);
  // 경로 결과와 같은 주기로 (ADR-040). 같은 정류장이면 메모리 캐시로 한 번만 부른다
  const boardRefresh = useArrivalsRefresh(boardTask, live && !!boardStation, SEARCH_REFRESH_MS);

  const refreshAll = () => { opts.refresh(); void boardRefresh.runNow(); };

  // ---- 내 위치 (ADR-030, ADR-035): 버튼을 누를 때 한 번만 받는다. 움직여도 자동으로 따라가지 않는다 ----
  //      (계속 따라가면 위치가 바뀔 때마다 경로·도착정보를 다시 조회해 호출이 늘어난다)
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  /** 권한이 막혀 있을 때 기기별 허용 방법을 보여 준다 */
  const [locHelp, setLocHelp] = useState(false);
  const useMyLocationAsFrom = async () => {
    setLocating(true);
    setLocError(null);
    setLocHelp(false);
    const asked = Date.now();
    try {
      // 누른 즉시 요청한다: 아직 안 물어본 상태면 브라우저가 허용 팝업을 띄운다 (iPhone 은 탭 직후에만 띄움)
      const loc = await getMyLocation();
      setFrom(myLocationPlace(loc.lat, loc.lng));
    } catch (e) {
      const err = e as LocationError;
      if (err === "denied") {
        // 1) 팝업에서 '허용 안 함'을 누른 것인지 2) 팝업 없이 바로 거절된 것인지 구분한다.
        //    사람이 팝업을 읽고 누르는 데는 1초 가까이 걸린다. 그보다 빨리 거절되면 팝업이 뜨지 않은 것이다
        //    (iPhone: 설정 → 위치 서비스 → Safari 웹 사이트가 '안 함'이면 사이트 설정이 '묻기'여도 바로 거절)
        const instant = Date.now() - asked < INSTANT_DENY_MS;
        const state = await locationPermission();
        if (state === "prompt" && !instant) {
          setLocError("위치 사용을 허용하지 않았습니다. 다시 누르면 다시 물어봅니다.");
        } else {
          setLocError(instant && state !== "denied"
            ? "브라우저가 묻지 않고 바로 거절했습니다. 기기 설정에서 브라우저의 위치 사용이 꺼져 있을 수 있습니다."
            : LOCATION_ERROR_TEXT.denied);
          setLocHelp(true);
        }
      } else {
        setLocError(LOCATION_ERROR_TEXT[err] ?? "현재 위치를 찾을 수 없습니다");
      }
    } finally {
      setLocating(false);
    }
  };

  const setPlace = (role: "from" | "to", p: Place | null) => (role === "from" ? setFrom(p) : setTo(p));
  const onPickMap = useCallback((p: Place, role: "from" | "to") => {
    (role === "from" ? setFrom : setTo)((old) => (old && samePlace(old, p) ? old : p));
  }, []);

  const shown = useMemo(() => [...opts.results].sort(rank).slice(0, 8), [opts.results, rank]);
  const pathResult = shown[hover ?? 0] ?? null;

  let message: string | null = null;
  if (!from || !to) message = "출발지와 도착지를 골라 주세요";
  else if (plans.length === 0) message = mode === "direct"
    ? "직행 버스가 없습니다. ‘환승 포함’으로 찾아보세요."
    : "1회 환승으로 갈 수 있는 경로를 찾지 못했습니다.";
  else if (!opts.done) message = "실시간 정보를 확인하는 중…";
  // 일일 한도 초과 같은 구체적인 이유가 있으면 그대로 보여 준다 (ADR-032)
  else if (opts.error && shown.length === 0) message = opts.error;
  else if (shown.length === 0) message = "지금 운행 중인 버스로 갈 수 있는 경로가 없습니다.";

  return (
    <main className="screen split search" hidden={!active} data-testid="screen-search">
      <div className="split-top">
        <header className="topbar">
          <IconButton label="뒤로" icon="←" onClick={nav.back} data-testid="back" />
          <h1 ref={title} tabIndex={-1} className="sr-only">경로 검색</h1>
        </header>
        <SearchForm
          from={from}
          to={to}
          mode={mode}
          onFrom={(p) => setPlace("from", p)}
          onTo={(p) => setPlace("to", p)}
          onSwap={() => { setFrom(to); setTo(from); }}
          onMode={setMode}
          fromRef={fromRef}
          toRef={toRef}
        />
        <div className="my-location-row">
          <button
            type="button"
            className={`chip-btn${isMine(from) ? " is-on" : ""}`}
            onClick={useMyLocationAsFrom}
            disabled={locating}
            data-testid="my-location"
          >
            📍 {locating ? "위치 찾는 중…" : isMine(from) ? "내 위치 다시 찾기" : "내 위치에서 출발"}
          </button>
          {isMine(from) && (
            <span className="muted small" data-testid="my-location-status">움직였다면 다시 눌러 주세요</span>
          )}
        </div>
        {locError && <p className="msg small" role="alert" data-testid="my-location-error">{locError}</p>}
        {locHelp && (
          <section className="card loc-help" aria-label="위치 권한 허용 방법" data-testid="my-location-help">
            <ol>
              {PERMISSION_STEPS[deviceKind()].map((s) => <li key={s}>{s}</li>)}
            </ol>
            <div className="loc-help-actions">
              <Button variant="primary" onClick={useMyLocationAsFrom} data-testid="my-location-retry">다시 시도</Button>
              <Button onClick={() => { setLocHelp(false); setLocError(null); }}>닫기</Button>
            </div>
          </section>
        )}
        {/* 출발지·도착지 날씨 (ADR-026). 아직 고르지 않았으면 기본 위치 */}
        <RouteWeather from={from} to={to} />
      </div>

      <div className="split-map">
        <NaverMap from={from} to={to} path={pathResult} onPick={onPickMap} className="map-search" />
      </div>

      <div className="split-body sheet">
        {plans.length > 0 && (
          <RefreshStatus lastUpdated={opts.lastUpdated} loading={opts.loading} now={now} error={opts.error} onRefresh={refreshAll} paused={opts.paused} intervalMs={SEARCH_REFRESH_MS} />
        )}
        {message && (
          <div className="msg" data-testid="search-message">
            <p>{message}</p>
            {opts.error && shown.length === 0 && plans.length > 0 && !opts.error.includes("한도") && (
              <Button variant="primary" onClick={opts.refresh}>다시 시도</Button>
            )}
          </div>
        )}
        {shown.length > 0 && (
          <Segmented
            label="정렬"
            testId="sort-toggle"
            className="sort-toggle"
            value={sort}
            onChange={setSort}
            options={[
              { value: "best", label: "추천" },
              { value: "fast", label: "빠른 순" },
              { value: "cheap", label: "요금 적은 순" },
            ]}
          />
        )}
        {shown.length > 0 && sort === "best" && (
          <p className="muted small sort-note">빠른 시간과 요금을 함께 봅니다. 1,000원 더 비싼 버스는 10분 이상 빨라야 앞에 둡니다.</p>
        )}
        {shown.length > 0 && (
          <ul className="option-list" data-testid="route-options">
            {shown.map((r, i) => (
              <RouteOptionCard
                key={r.plan.legs.map((l) => `${l.route.id}:${l.fromIndex}-${l.toIndex}`).join("|")}
                result={r}
                now={now}
                favorite={store.isFavorite(r.plan)}
                onHover={(on) => setHover(on ? i : null)}
                onOpen={() => from && to && nav.navigate({ name: "detail", kind: "result", from, to, plan: r.plan, initial: r })}
              />
            ))}
          </ul>
        )}
        {board && boardStation && board.station.id === boardStation.id && (
          <ArrivalBoard station={board.station} arrivals={board.arrivals} now={now} />
        )}
      </div>
    </main>
  );
}
