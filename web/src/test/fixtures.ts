/** 테스트용 작은 합성 BusDb (실제 data/*.json 을 쓰지 않는다) */
import { type BusDb, type Route, type Station, type StopRef, SpatialGrid } from "../lib/data";
import type { OptionResult, RoutePlan } from "../lib/router";

export const ST: Record<string, Station> = {
  A: { id: "100000001", no: "01001", name: "판교역", x: 127.1, y: 37.4, sel: 1 },
  A2: { id: "100000002", no: "01002", name: "판교역", x: 127.1, y: 37.4003, sel: 1 }, // 길 건너편 (~33m)
  B: { id: "100000003", no: "01003", name: "백현마을", x: 127.1, y: 37.41, sel: 1 },
  C: { id: "100000004", no: "01004", name: "서현역", x: 127.1, y: 37.42, sel: 1 },
  T1: { id: "100000005", no: "02001", name: "환승정류장", x: 127.12, y: 37.43, sel: 1 },
  T2: { id: "100000006", no: "02002", name: "환승건너편", x: 127.12, y: 37.4305, sel: 1 }, // T1 에서 ~55m
  D: { id: "100000007", no: "03001", name: "정자동주민센터", x: 127.14, y: 37.45, sel: 1 },
  X: { id: "100000008", no: "", name: "성남밖", x: 127.2, y: 37.5 }, // sel 없음
};

export function route(id: string, name: string, type: string, stops: Station[], extra: Partial<Route> = {}): Route {
  return { id, name, type, peek: 10, npeek: 20, first: "", last: "", turn: 0, stops: stops.map((s) => s.id), ...extra };
}

export function makeDb(routes: Route[], stations: Station[] = Object.values(ST)): BusDb {
  const stationMap = new Map(stations.map((s) => [s.id, s]));
  const routeMap = new Map(routes.map((r) => [r.id, r]));
  const stopRefs = new Map<string, StopRef[]>();
  for (const r of routes) {
    r.stops.forEach((id, index) => {
      const list = stopRefs.get(id) ?? [];
      list.push({ route: r, index });
      stopRefs.set(id, list);
    });
  }
  const selectable = stations.filter((s) => s.sel);
  return {
    updatedAt: "2026-11-19T00:00:00.000Z",
    partial: false,
    stations: stationMap,
    selectable,
    routes: routeMap,
    stopRefs,
    grid: new SpatialGrid(selectable),
  };
}

/** R1: A→B→C (직행), R2: A→T1, R3: T2→D (T1↔T2 도보 환승), RX: C→X (성남 밖) */
export function standardDb() {
  const R1 = route("200000001", "10", "일반형시내버스", [ST.A, ST.B, ST.C]);
  const R2 = route("200000002", "20", "마을버스", [ST.A, ST.T1]);
  const R3 = route("200000003", "30", "직행좌석형시내버스", [ST.T2, ST.D]);
  const RX = route("200000004", "99", "일반형시외버스", [ST.C, ST.X]);
  return { db: makeDb([R1, R2, R3, RX]), R1, R2, R3, RX };
}

export const stationPlaceOf = (s: Station) =>
  ({ kind: "station", stationId: s.id, label: `${s.name} (${s.no})`, lat: s.y, lng: s.x }) as const;

/** 시간 막대 테스트용 결과 만들기 */
export function makeResult(over: {
  plan?: Partial<RoutePlan>;
  legs: { board: number | null; alight: number | null; boardEst?: boolean; rideEst?: boolean; wait?: number | null; route?: Route }[];
  arriveSec?: number | null;
  evaluatedAt?: number;
}): OptionResult {
  const r0 = route("200000001", "10", "일반형시내버스", [ST.A, ST.B, ST.C]);
  const plan: RoutePlan = {
    legs: over.legs.map(() => ({ route: r0, fromIndex: 0, toIndex: 2 })),
    walkStartSec: 0,
    walkTransferSec: 0,
    walkEndSec: 0,
    ...over.plan,
  };
  const legs = over.legs.map((l) => ({
    route: l.route ?? r0,
    from: ST.A,
    to: ST.C,
    stops: 2,
    boardSec: l.board,
    boardEstimated: !!l.boardEst,
    waitSec: l.wait ?? null,
    rideSec: (l.alight ?? 0) - (l.board ?? 0),
    rideEstimated: !!l.rideEst,
    alightSec: l.alight,
    upcoming: [],
  }));
  const lastAlight = over.legs.at(-1)?.alight ?? null;
  return {
    plan,
    legs,
    arriveSec: over.arriveSec !== undefined ? over.arriveSec : lastAlight === null ? null : lastAlight + plan.walkEndSec,
    fare: { won: 1650, premium: false },
    estimated: legs.some((l) => l.boardEstimated || l.rideEstimated),
    notRunning: false,
    evaluatedAt: over.evaluatedAt ?? 1_000_000,
  };
}
