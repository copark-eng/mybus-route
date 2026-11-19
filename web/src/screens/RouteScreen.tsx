import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Nav, RouteView } from "../App";
import { NaverMap } from "../components/features/NaverMap";
import { RefreshStatus } from "../components/features/RefreshStatus";
import { RouteBadge } from "../components/features/RouteBadge";
import { EmptyState, IconButton } from "../components/ui";
import { useDb } from "../context";
import { useArrivalsRefresh } from "../hooks/useArrivalsRefresh";
import { useCountdown } from "../hooks/useCountdown";
import { useVisible } from "../hooks/useVisible";
import { type BusLocation, fetchBusLocations } from "../lib/api";
import { pointAlong, progressOf, segmentLength, type Track, updateTracks } from "../lib/busProgress";
import type { Route } from "../lib/data";
import { loadShape, type Shape } from "../lib/shapes";

/** 버스 위치 갱신 주기 (ADR-031) */
const REFRESH_MS = 30_000;

/** 화면에 그릴 버스 하나: 정류장 index 와 다음 정류장까지 진행률 */
interface BusView { bus: BusLocation; index: number; progress: number; key: string }

/**
 * 노선 정보 화면 (ADR-028, ADR-031): 기점·종점, 운행시간, 배차, 운수회사, 운행 중 버스 수 +
 * 상행(기점→종점)·하행(종점→기점)을 좌우로 나란히 놓은 노선도, 정류장 사이에서 움직이는 버스.
 */
export function RouteScreen({ view, nav }: { view: RouteView; nav: Nav }) {
  const db = useDb();
  const route = db.routes.get(view.routeId);
  const visible = useVisible();
  const now = useCountdown();
  const [buses, setBuses] = useState<BusLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tracks = useRef(new Map<string, Track>());

  const task = useCallback(async () => {
    try {
      const list = await fetchBusLocations(view.routeId);
      tracks.current = updateTracks(tracks.current, list, Date.now());
      setBuses(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [view.routeId]);
  const refresh = useArrivalsRefresh(task, !!route && visible, REFRESH_MS);

  // 노선 형상(도로 선): 지도 선, 정류장 사이 거리, 버스 위치에 쓴다 (ADR-029)
  const [shape, setShape] = useState<Shape | null>(null);
  useEffect(() => {
    let alive = true;
    loadShape(view.routeId).then((s) => { if (alive) setShape(s); });
    return () => { alive = false; };
  }, [view.routeId]);

  // 정류장 사이 거리는 노선·형상이 정해지면 한 번만 계산
  const segLens = useMemo(
    () => (route ? route.stops.map((_, i) => segmentLength(db, route, shape, i)) : []),
    [db, route, shape],
  );

  // 1초마다 진행률을 다시 계산해 버스가 조금씩 다음 정류장 쪽으로 움직이게 한다
  const views: BusView[] = useMemo(() => {
    if (!buses) return [];
    return buses.map((bus, n) => {
      const key = bus.plateNo ?? `#${n}`;
      const index = bus.stationSeq - 1;
      const t = tracks.current.get(key) ?? { seq: bus.stationSeq, state: bus.stateCd, since: now };
      return { bus, index, key, progress: progressOf(t, segLens[index] ?? 0, now) };
    });
  }, [buses, segLens, now]);

  const busMarkers = useMemo(() => {
    if (!route) return [];
    return views.flatMap((v) => {
      const p = pointAlong(db, route, shape, v.index, v.progress);
      return p ? [{ lat: p[0], lng: p[1], label: `${route.name}번 ${v.bus.plateNo ?? ""}` }] : [];
    });
  }, [db, route, shape, views]);
  const mark = view.stationId ? db.stations.get(view.stationId) : undefined;
  const markPlace = mark ? { kind: "station" as const, stationId: mark.id, label: mark.name, lat: mark.y, lng: mark.x } : null;

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
      <RefreshStatus lastUpdated={refresh.lastRun} loading={refresh.running} now={now} error={error} onRefresh={() => void refresh.runNow()} intervalMs={REFRESH_MS} />
      {error && <p className="msg small" data-testid="route-error">버스 위치를 불러오지 못했습니다: {error}</p>}
      <NaverMap from={markPlace} to={null} line={route} buses={busMarkers} className="map-route" />
      <p className="muted small route-note">
        버스 위치는 30초마다 갱신하고, 정류장 사이에서는 도로 거리와 평균 속도로 대략 어디쯤인지 보여 줍니다.
      </p>
      <RouteLine route={route} views={views} segLens={segLens} highlight={view.stationId} />
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

const CROWD = ["", "여유", "보통", "혼잡", "매우혼잡"];

function busExtra(bus: BusLocation): string {
  return [
    bus.lowPlate === 1 ? "저상" : bus.lowPlate === 2 ? "2층" : null,
    bus.crowded ? CROWD[bus.crowded] : null,
    bus.remainSeat !== null ? `빈자리 ${bus.remainSeat}` : null,
  ].filter(Boolean).join(" · ");
}

const plate = (b: BusLocation) => b.plateNo?.replace(/^경기/, "") ?? "버스";

/** 정류장에 도착해 있는 버스 */
function BusAtStop({ bus }: { bus: BusLocation }) {
  const extra = busExtra(bus);
  return (
    <span className="bus-chip" data-testid="bus-chip">
      <span aria-hidden>🚌</span>
      <span className="num">{plate(bus)}</span>
      <span className="muted">도착{extra && ` · ${extra}`}</span>
    </span>
  );
}

/** 정류장 사이를 달리는 버스: 세로 레일 위 진행률 위치에 놓는다 */
function BusInTransit({ v, segLen }: { v: BusView; segLen: number }) {
  const left = Math.max(0, Math.round(segLen * (1 - v.progress)));
  const extra = busExtra(v.bus);
  return (
    <span
      className="bus-transit"
      style={{ top: `${Math.round(v.progress * 100)}%` }}
      data-testid="bus-transit"
      title={`${plate(v.bus)} · 다음 정류장까지 약 ${left}m`}
    >
      <span className="bus-transit-icon" aria-hidden>🚌</span>
      <span className="bus-transit-text">
        <span className="num">{plate(v.bus)}</span>
        <span className="muted"> · 다음까지 약 {left >= 1000 ? `${(left / 1000).toFixed(1)}km` : `${left}m`}{extra && ` · ${extra}`}</span>
      </span>
    </span>
  );
}

function RouteLine({ route, views, segLens, highlight }: {
  route: Route;
  views: BusView[];
  segLens: number[];
  highlight?: string;
}) {
  const db = useDb();
  const { turn, last } = endpoints(route);
  const at = useMemo(() => {
    const atStop = new Map<number, BusView[]>();
    const between = new Map<number, BusView[]>();
    for (const v of views) {
      const m = v.progress > 0 && v.index < last ? between : atStop;
      m.set(v.index, [...(m.get(v.index) ?? []), v]);
    }
    return { atStop, between };
  }, [views, last]);

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

  const column = (from: number, to: number, title: string, key: string) => (
    <section className="route-col" aria-label={title} key={key} data-testid={`route-col-${key}`}>
      <h2 className="route-col-title">{title}</h2>
      <ol className="route-line">
        {route.stops.slice(from, to + 1).flatMap((id, k) => {
          const i = from + k;
          const st = db.stations.get(id);
          const here = at.atStop.get(i) ?? [];
          const moving = i < to ? at.between.get(i) ?? [] : [];
          const isMark = i === highlightIndex;
          const items = [
            <li
              key={`s${i}`}
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
                {here.map((v) => <BusAtStop key={v.key} bus={v.bus} />)}
              </span>
            </li>,
          ];
          // 정류장 사이 칸: 달리는 버스가 있을 때만 높게 그린다
          if (i < to) {
            items.push(
              <li key={`g${i}`} className={`gap${moving.length ? " has-transit" : ""}`} aria-hidden={!moving.length}>
                <span className="gap-rail" />
                {moving.map((v) => <BusInTransit key={v.key} v={v} segLen={segLens[i] ?? 0} />)}
              </li>,
            );
          }
          return items;
        })}
      </ol>
    </section>
  );

  return (
    <div className="route-lines" data-testid="route-line">
      {column(0, turn, `${name(0)} → ${name(turn)}`, "up")}
      {turn < last && column(turn + 1, last, `${name(turn)} → ${name(last)}`, "down")}
    </div>
  );
}
