import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Nav, RouteView } from "../App";
import { RefreshStatus } from "../components/features/RefreshStatus";
import { RouteBadge } from "../components/features/RouteBadge";
import { EmptyState, IconButton } from "../components/ui";
import { useDb } from "../context";
import { useArrivalsRefresh } from "../hooks/useArrivalsRefresh";
import { useCountdown } from "../hooks/useCountdown";
import { useVisible } from "../hooks/useVisible";
import { type BusLocation, fetchBusLocations } from "../lib/api";
import type { Route } from "../lib/data";

const REFRESH_MS = 15_000;

/**
 * 노선 정보 화면 (ADR-028): 기점·종점, 운행시간, 배차, 운수회사, 운행 중 버스 수 +
 * 상행(기점→종점)·하행(종점→기점) 정류장 목록 위에 지금 버스가 있는 곳을 표시한다.
 */
export function RouteScreen({ view, nav }: { view: RouteView; nav: Nav }) {
  const db = useDb();
  const route = db.routes.get(view.routeId);
  const visible = useVisible();
  const now = useCountdown();
  const [buses, setBuses] = useState<BusLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const task = useCallback(async () => {
    try {
      const list = await fetchBusLocations(view.routeId);
      setBuses(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [view.routeId]);
  const refresh = useArrivalsRefresh(task, !!route && visible, REFRESH_MS);

  if (!route) {
    return (
      <main className="screen" data-testid="screen-route">
        <header className="topbar">
          <IconButton label="뒤로" icon="←" onClick={nav.back} data-testid="back" />
          <h1 className="topbar-title">노선 정보</h1>
        </header>
        <EmptyState title="노선 정보를 찾을 수 없습니다" />
      </main>
    );
  }

  return (
    <main className="screen route-screen" data-testid="screen-route">
      <header className="topbar">
        <IconButton label="뒤로" icon="←" onClick={nav.back} data-testid="back" />
        <h1 className="topbar-title">{route.name}번 노선</h1>
      </header>
      <RouteInfo route={route} buses={buses} failed={!!error && buses === null} />
      <RefreshStatus lastUpdated={refresh.lastRun} loading={refresh.running} now={now} error={error} onRefresh={() => void refresh.runNow()} />
      {error && <p className="msg small" data-testid="route-error">버스 위치를 불러오지 못했습니다: {error}</p>}
      <RouteLine route={route} buses={buses ?? []} highlight={view.stationId} />
    </main>
  );
}

/** 기점·종점 인덱스: turn 이 없으면 마지막 정류장을 종점으로 본다 */
function endpoints(route: Route) {
  const last = route.stops.length - 1;
  const turn = route.turn >= 0 && route.turn <= last ? route.turn : last;
  return { turn, last };
}

function RouteInfo({ route, buses, failed }: { route: Route; buses: BusLocation[] | null; failed: boolean }) {
  const db = useDb();
  const { turn } = endpoints(route);
  const start = db.stations.get(route.stops[0]);
  const end = db.stations.get(route.stops[turn]);
  const up = buses?.filter((b) => b.stationSeq - 1 <= turn).length ?? 0;
  const down = (buses?.length ?? 0) - up;
  const range = (a?: string, b?: string) => (a && b ? `${a} ~ ${b}` : "정보 없음");
  const alloc = [route.peek && `출퇴근 ${route.peek}분`, route.npeek && `평시 ${route.npeek}분`].filter(Boolean).join(" · ");

  return (
    <section className="card route-info" data-testid="route-info">
      <div className="route-info-head">
        <RouteBadge name={route.name} type={route.type} />
        <span className="muted small">{route.type}</span>
      </div>
      <p className="route-ends">
        <b>{start?.name ?? "기점"}</b>
        <span className="muted" aria-hidden> ↔ </span>
        <b>{end?.name ?? "종점"}</b>
      </p>
      <dl className="route-facts">
        <dt>기점 출발</dt><dd className="num">{range(route.first, route.last)}</dd>
        <dt>종점 출발</dt><dd className="num">{range(route.downFirst, route.downLast)}</dd>
        <dt>배차 간격</dt><dd>{alloc || "정보 없음"}</dd>
        <dt>운행 중</dt>
        <dd data-testid="route-running">
          {buses === null ? <span className="muted">{failed ? "정보 없음" : "확인 중…"}</span> : (
            <><b className="num">{buses.length}대</b> <span className="muted small">(기점→종점 {up} · 종점→기점 {down})</span></>
          )}
        </dd>
        {route.company && (
          <>
            <dt>운수회사</dt>
            <dd>{route.company}{route.tel && <> · <a href={`tel:${route.tel}`}>{route.tel}</a></>}</dd>
          </>
        )}
        {route.region && (<><dt>운행 지역</dt><dd>{route.region.split(",").join(", ")}</dd></>)}
      </dl>
      <p className="muted small">총 보유 대수는 공개 데이터에 없어, 지금 운행 중인 버스 수를 보여 줍니다.</p>
    </section>
  );
}

const STATE = ["교차로 통과", "정류장 도착", "정류장 출발"];
const CROWD = ["", "여유", "보통", "혼잡", "매우혼잡"];

function BusChip({ bus }: { bus: BusLocation }) {
  const extra = [
    bus.lowPlate === 1 ? "저상" : bus.lowPlate === 2 ? "2층" : null,
    bus.crowded ? CROWD[bus.crowded] : null,
    bus.remainSeat !== null ? `빈자리 ${bus.remainSeat}` : null,
  ].filter(Boolean);
  return (
    <span className="bus-chip" data-testid="bus-chip">
      <span aria-hidden>🚌</span>
      <span className="num">{bus.plateNo?.replace(/^경기/, "") ?? "버스"}</span>
      {bus.stateCd !== null && <span className="muted">{STATE[bus.stateCd] ?? ""}</span>}
      {extra.length > 0 && <span className="muted">· {extra.join(" · ")}</span>}
    </span>
  );
}

function RouteLine({ route, buses, highlight }: { route: Route; buses: BusLocation[]; highlight?: string }) {
  const db = useDb();
  const { turn, last } = endpoints(route);
  const busesAt = useMemo(() => {
    const m = new Map<number, BusLocation[]>();
    for (const b of buses) {
      const i = b.stationSeq - 1;
      m.set(i, [...(m.get(i) ?? []), b]);
    }
    return m;
  }, [buses]);
  const mark = useRef<HTMLLIElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!scrolled.current && mark.current) {
      mark.current.scrollIntoView({ block: "center" });
      scrolled.current = true;
    }
  });

  const name = (i: number) => db.stations.get(route.stops[i])?.name ?? "";
  // 강조할 정류장: 같은 정류장이 왕복으로 두 번 나오면 첫 번째
  const highlightIndex = highlight ? route.stops.indexOf(highlight) : -1;

  const section = (from: number, to: number, title: string, key: string) => (
    <section className="section" aria-label={title} key={key}>
      <h2 className="section-title">{title}</h2>
      <ol className="route-line">
        {route.stops.slice(from, to + 1).map((id, k) => {
          const i = from + k;
          const st = db.stations.get(id);
          const here = busesAt.get(i) ?? [];
          const isMark = i === highlightIndex;
          return (
            <li
              key={`${i}-${id}`}
              ref={isMark ? mark : undefined}
              className={`stop${here.length ? " has-bus" : ""}${isMark ? " is-mark" : ""}${!st?.no ? " is-virtual" : ""}`}
              data-testid="route-stop"
            >
              <span className="stop-dot-line" aria-hidden />
              <span className="stop-body">
                <span className="stop-name">
                  {st?.name ?? id}
                  {st?.no && <span className="muted small"> {st.no}</span>}
                  {i === turn && <span className="tag">회차</span>}
                  {isMark && <span className="tag tag-mark">내 정류장</span>}
                </span>
                {here.map((b, n) => <BusChip key={`${b.plateNo ?? n}`} bus={b} />)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );

  return (
    <div className="route-lines" data-testid="route-line">
      {section(0, turn, `${name(0)} → ${name(turn)}`, "up")}
      {turn < last && section(turn + 1, last, `${name(turn)} → ${name(last)}`, "down")}
    </div>
  );
}
