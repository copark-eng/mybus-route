/**
 * 노선 형상 (ADR-029): 도로를 따라가는 선. web/public/data/lines/<노선ID>.json 을 필요할 때만 받는다.
 * 형상이 없거나 못 받으면 정류장 좌표를 직선으로 잇는다.
 */
import type { BusDb, Route } from "./data";

export type LatLng = [number, number];
export interface Shape { pts: LatLng[]; stopAt: number[] }

const cache = new Map<string, Promise<Shape | null>>();

/** p: [y0,x0,dy1,dx1,...] (1e5 정수) → 좌표 배열 */
export function decodeShape(json: { p: number[]; s: number[] }): Shape {
  const pts: LatLng[] = [];
  let y = 0, x = 0;
  for (let i = 0; i + 1 < json.p.length; i += 2) {
    y += json.p[i];
    x += json.p[i + 1];
    pts.push([y / 1e5, x / 1e5]);
  }
  return { pts, stopAt: json.s };
}

export function loadShape(routeId: string): Promise<Shape | null> {
  let p = cache.get(routeId);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/lines/${encodeURIComponent(routeId)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.p && j?.s ? decodeShape(j) : null))
      .catch(() => null);
    cache.set(routeId, p);
  }
  return p;
}

/** 정류장 순서 from~to 사이를 직선으로 (형상이 없을 때) */
export function straightSegment(db: BusDb, route: Route, from: number, to: number): LatLng[] {
  return route.stops
    .slice(from, to + 1)
    .map((id) => db.stations.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => [s.y, s.x]);
}

/**
 * 승차(from)~하차(to) 정류장 구간의 도로 선. 양 끝은 정류장 좌표로 맞춘다.
 * 형상의 정류장 위치가 뒤집혀 있으면(데이터 이상) 직선으로 대신한다.
 */
export async function routeSegment(db: BusDb, route: Route, from: number, to: number): Promise<LatLng[]> {
  const straight = straightSegment(db, route, from, to);
  const shape = await loadShape(route.id);
  if (!shape || shape.stopAt.length !== route.stops.length) return straight;
  const a = shape.stopAt[from];
  const b = shape.stopAt[to];
  if (a === undefined || b === undefined || b <= a) return straight;
  const mid = shape.pts.slice(a, b + 1);
  return [straight[0], ...mid, straight[straight.length - 1]];
}

/**
 * 버스 위치 좌표. 정류장 도착(stateCd 1)이면 정류장, 출발·교차로 통과(0·2)면
 * 그 정류장과 다음 정류장 사이 도로 위 중간쯤에 둔다 (형상이 없으면 두 정류장 사이 직선의 중간).
 */
export function busPoint(db: BusDb, route: Route, shape: Shape | null, stopIndex: number, stateCd: number | null): LatLng | null {
  const st = db.stations.get(route.stops[stopIndex]);
  if (!st) return null;
  const here: LatLng = [st.y, st.x];
  if (stateCd === 1 || stopIndex >= route.stops.length - 1) return here;
  const frac = stateCd === 2 ? 0.25 : 0.5; // 막 출발했으면 가깝게
  if (shape && shape.stopAt.length === route.stops.length) {
    const a = shape.stopAt[stopIndex];
    const b = shape.stopAt[stopIndex + 1];
    if (b > a) return shape.pts[Math.round(a + (b - a) * frac)] ?? here;
  }
  const next = db.stations.get(route.stops[stopIndex + 1]);
  return next ? [st.y + (next.y - st.y) * frac, st.x + (next.x - st.x) * frac] : here;
}

/** 노선 전체 선 (형상 없으면 정류장 직선) */
export async function wholeRoute(db: BusDb, route: Route): Promise<LatLng[]> {
  const shape = await loadShape(route.id);
  return shape?.pts.length ? shape.pts : straightSegment(db, route, 0, route.stops.length - 1);
}
