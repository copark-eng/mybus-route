import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Nav, SearchView } from "../App";
import { ArrivalBoard } from "../components/features/ArrivalBoard";
import { NaverMap } from "../components/features/NaverMap";
import type { PlaceInputHandle } from "../components/features/PlaceInput";
import { RefreshStatus } from "../components/features/RefreshStatus";
import { RouteOptionCard } from "../components/features/RouteOptionCard";
import { SearchForm, type SearchMode } from "../components/features/SearchForm";
import { RouteWeather } from "../components/features/WeatherLine";
import { Button, IconButton } from "../components/ui";
import { useDb, useStore } from "../context";
import { useArrivalsRefresh } from "../hooks/useArrivalsRefresh";
import { useCountdown } from "../hooks/useCountdown";
import { useLiveOptions } from "../hooks/useLiveOptions";
import { useVisible } from "../hooks/useVisible";
import { fetchArrivals, type StationArrivals } from "../lib/api";
import type { Station } from "../lib/data";
import { type Place, samePlace } from "../lib/places";
import { findPlans } from "../lib/router";
import { distanceM } from "../lib/data";
import { isMine, myLocationPlace } from "../lib/places";
import { getMyLocation, LOCATION_ERROR_TEXT, type LocationError, useMyLocation } from "../hooks/useMyLocation";

/** 내 위치가 이만큼 바뀌면 출발지를 옮기고 경로를 다시 찾는다 */
const MOVE_THRESHOLD_M = 30;

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

  const opts = useLiveOptions(plans, live);
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
  const boardRefresh = useArrivalsRefresh(boardTask, live && !!boardStation);

  const refreshAll = () => { opts.refresh(); void boardRefresh.runNow(); };

  // ---- 내 위치 (ADR-030): 출발(또는 도착)이 내 위치면 화면이 보이는 동안 계속 따라간다 ----
  const tracking = isMine(from) || isMine(to);
  const my = useMyLocation(tracking && live);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  useEffect(() => {
    if (my.error) setLocError(LOCATION_ERROR_TEXT[my.error]);
  }, [my.error]);
  useEffect(() => {
    const loc = my.location;
    if (!loc) return;
    // 30m 넘게 움직였을 때만 바꾼다 (바꿀 때마다 경로를 다시 계산하므로)
    const follow = (p: Place | null) =>
      p && isMine(p) && distanceM(p.lat, p.lng, loc.lat, loc.lng) > MOVE_THRESHOLD_M ? myLocationPlace(loc.lat, loc.lng) : p;
    setFrom(follow);
    setTo(follow);
  }, [my.location]);
  const useMyLocationAsFrom = async () => {
    setLocating(true);
    setLocError(null);
    try {
      const loc = await getMyLocation();
      setFrom(myLocationPlace(loc.lat, loc.lng));
    } catch (e) {
      setLocError(LOCATION_ERROR_TEXT[(e as LocationError)] ?? "현재 위치를 찾을 수 없습니다");
    } finally {
      setLocating(false);
    }
  };

  const setPlace = (role: "from" | "to", p: Place | null) => (role === "from" ? setFrom(p) : setTo(p));
  const onPickMap = useCallback((p: Place, role: "from" | "to") => {
    (role === "from" ? setFrom : setTo)((old) => (old && samePlace(old, p) ? old : p));
  }, []);

  const shown = opts.results;
  const pathResult = shown[hover ?? 0] ?? null;

  let message: string | null = null;
  if (!from || !to) message = "출발지와 도착지를 골라 주세요";
  else if (plans.length === 0) message = mode === "direct"
    ? "직행 버스가 없습니다. ‘환승 포함’으로 찾아보세요."
    : "1회 환승으로 갈 수 있는 경로를 찾지 못했습니다.";
  else if (!opts.done) message = "실시간 정보를 확인하는 중…";
  else if (opts.error && shown.length === 0) message = "실시간 정보를 가져오지 못했습니다";
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
            📍 {locating ? "위치 찾는 중…" : isMine(from) ? "내 위치에서 출발 (실시간)" : "내 위치에서 출발"}
          </button>
          {tracking && my.location && (
            <span className="muted small" data-testid="my-location-status">
              {my.location.accuracy > 100 ? `정확도 약 ${Math.round(my.location.accuracy)}m` : "위치 따라가는 중"}
            </span>
          )}
        </div>
        {locError && <p className="msg small" role="alert" data-testid="my-location-error">{locError}</p>}
        {/* 출발지·도착지 날씨 (ADR-026). 아직 고르지 않았으면 기본 위치 */}
        <RouteWeather from={from} to={to} />
      </div>

      <div className="split-map">
        <NaverMap from={from} to={to} path={pathResult} onPick={onPickMap} className="map-search" />
      </div>

      <div className="split-body sheet">
        {plans.length > 0 && (
          <RefreshStatus lastUpdated={opts.lastUpdated} loading={opts.loading} now={now} error={opts.error} onRefresh={refreshAll} />
        )}
        {message && (
          <div className="msg" data-testid="search-message">
            <p>{message}</p>
            {opts.error && shown.length === 0 && plans.length > 0 && (
              <Button variant="primary" onClick={opts.refresh}>다시 시도</Button>
            )}
          </div>
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
