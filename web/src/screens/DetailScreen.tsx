import { useEffect, useMemo, useRef } from "react";
import type { DetailView, Nav } from "../App";
import { BusMap } from "../components/features/BusMap";
import { RefreshStatus } from "../components/features/RefreshStatus";
import { StepList } from "../components/features/StepList";
import { TimeBar } from "../components/features/TimeBar";
import { fmtWon } from "../lib/fare";
import { RouteWeather } from "../components/features/WeatherLine";
import { Badge, Button, EmptyState, IconButton } from "../components/ui";
import { useDb, useStore } from "../context";
import { remaining, useCountdown } from "../hooks/useCountdown";
import { useLiveOptions } from "../hooks/useLiveOptions";
import { useVisible } from "../hooks/useVisible";
import type { Place } from "../lib/places";
import type { RoutePlan } from "../lib/router";
import { favoriteToPlan } from "../lib/storage";
import { fmtClock, fmtDepart, fmtMin, shortLabel } from "../lib/util";

/** 상세 화면: 큰 시간 막대 + 단계 타임라인 + 지도 경로 + 즐겨찾기 토글 */
export function DetailScreen({ view, nav }: { view: DetailView; nav: Nav }) {
  const db = useDb();
  const store = useStore();
  const visible = useVisible();
  const now = useCountdown();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus({ preventScroll: true }), []);

  const fav = view.kind === "favorite" ? store.favorites.find((f) => f.id === view.favoriteId) : undefined;
  const favLegKey = fav?.legs.map((l) => `${l.routeId}:${l.fromIndex}-${l.toIndex}`).join("|");
  const favPlan = useMemo(
    () => (fav ? favoriteToPlan(db, fav) : null),
    // 이름만 바뀐 경우에는 다시 만들지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, fav?.id, favLegKey],
  );

  const from: Place | undefined = view.kind === "favorite" ? fav?.from : view.from;
  const to: Place | undefined = view.kind === "favorite" ? fav?.to : view.to;
  const plan: RoutePlan | null = view.kind === "favorite" ? favPlan : view.plan;
  const plans = useMemo(() => (plan ? [plan] : []), [plan]);
  const live = useLiveOptions(plans, visible);

  // 첫 평가 전에는 검색 결과에서 넘겨받은 값을 보여 준다
  const result = live.results[0] ?? (!live.done && view.kind === "result" ? view.initial : undefined) ?? null;

  const savedFav = plan ? store.findFavorite(plan) : undefined;
  const isFav = view.kind === "favorite" ? !!fav : !!savedFav;
  const toggleFav = () => {
    if (view.kind === "favorite") {
      if (fav) store.removeFavorite(fav.id);
      nav.back();
    } else if (savedFav) {
      store.removeFavorite(savedFav.id);
    } else if (from && to && plan) {
      store.addFavorite(from, to, plan);
    }
  };

  const heading = fav?.name ?? (from && to ? `${shortLabel(from.label)} → ${shortLabel(to.label)}` : "경로");

  const header = (
    <header className="topbar">
      <IconButton label="뒤로" icon="←" onClick={nav.back} data-testid="back" />
      <h1 ref={title} tabIndex={-1} className="topbar-title">{heading}</h1>
      {(plan || fav) && (
        <IconButton
          label={isFav ? "즐겨찾기에서 빼기" : "즐겨찾기에 추가"}
          icon={isFav ? "★" : "☆"}
          onClick={toggleFav}
          className={isFav ? "fav-on" : ""}
          data-testid="favorite-toggle"
          aria-pressed={isFav}
        />
      )}
    </header>
  );

  if (view.kind === "favorite" && !fav) {
    return (
      <main className="screen detail" data-testid="screen-detail">
        {header}
        <EmptyState title="즐겨찾기를 찾을 수 없습니다" action={<Button variant="primary" onClick={() => nav.navigate({ name: "home" })}>홈으로</Button>} />
      </main>
    );
  }
  if (!plan || !from || !to) {
    return (
      <main className="screen detail" data-testid="screen-detail">
        {header}
        <EmptyState
          title="노선 정보가 바뀌었습니다. 다시 검색해서 저장해 주세요."
          testId="detail-changed"
          action={from && to ? <Button variant="primary" onClick={() => nav.navigate({ name: "search", from, to, auto: true })}>다시 검색</Button> : undefined}
        />
      </main>
    );
  }

  const board = result ? remaining(result.legs[0].boardSec, result.evaluatedAt, now) : null;
  const leftArrive = result ? remaining(result.arriveSec, result.evaluatedAt, now) : null;

  return (
    <main className="screen split detail" data-testid="screen-detail">
      <div className="split-top">
        {header}
        {result ? (
          <>
            <section className="summary" data-testid="detail-summary">
              <div className="summary-main">
                <span className="display num">{result.arriveSec === null ? "-" : `${fmtClock(result.evaluatedAt + result.arriveSec * 1000)} 도착`}</span>
                {leftArrive !== null && <span className="muted">{fmtMin(leftArrive)} 소요</span>}
                {result.estimated && <Badge tone="est">추정</Badge>}
              </div>
              <p className="summary-sub">
                {result.legs[0].from.name}에서 <b className="num">{board === null ? "-" : fmtDepart(board)}</b>
              </p>
              <p className="small muted" data-testid="detail-fare">
                요금 {result.fare.won === null ? "별도 (공항·시외버스)" : `약 ${fmtWon(result.fare.won)}`} · 성인 교통카드, 환승 할인 반영
              </p>
              {result.note && <p className="small muted">{result.note}</p>}
            </section>
            <RouteWeather from={from} to={to} />
            <TimeBar result={result} now={now} size="lg" showLabels />
            <StepList result={result} now={now} from={from} to={to} />
          </>
        ) : (
          <div className="msg" data-testid="detail-message">
            <p>{!live.done ? "실시간 정보를 확인하는 중…" : live.error ? "실시간 정보를 가져오지 못했습니다" : "지금 운행 중인 버스로 갈 수 있는 경로가 없습니다."}</p>
            {live.done && live.error && <Button variant="primary" onClick={live.refresh}>다시 시도</Button>}
          </div>
        )}
      </div>
      <div className="split-map">
        <BusMap from={from} to={to} path={result} className="map-detail" />
      </div>
      <div className="split-body">
        <RefreshStatus lastUpdated={live.lastUpdated} loading={live.loading} now={now} error={live.error} onRefresh={live.refresh} paused={live.paused} />
      </div>
    </main>
  );
}
