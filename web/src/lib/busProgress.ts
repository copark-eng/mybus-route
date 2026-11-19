/**
 * 정류장 사이 버스 위치 추정 (ADR-031)
 *
 * 버스위치 API 는 "몇 번째 정류장 + 도착/출발/교차로 통과" 만 준다. 화면에서 버스가 정류장 사이 어디쯤인지
 * 보여 주기 위해, 차량번호별로 그 상태를 처음 본 시각을 기억해 두고
 *   진행률 = 시작값 + 지난 시간 × 평균 속도 ÷ 다음 정류장까지 도로 거리
 * 로 대략 계산한다. 10초마다 실제 위치가 다시 오면 그 값으로 바로잡는다.
 */
import type { BusLocation } from "./api";
import { type BusDb, type Route, distanceM } from "./data";
import type { LatLng, Shape } from "./shapes";

/** 정류장 사이 평균 속도 (m/s) — 경로 탐색과 같은 값 (router CONFIG.busSpeedMps) */
export const BUS_SPEED_MPS = 6;
const MAX_PROGRESS = 0.92; // 다음 정류장 도착 신호가 오기 전에는 정류장에 붙이지 않는다

export interface Track { seq: number; state: number | null; since: number }

/** 차량별로 (정류장 순번, 상태)가 바뀐 시각을 갱신한다. 같으면 처음 본 시각을 그대로 둔다 */
export function updateTracks(prev: Map<string, Track>, buses: BusLocation[], now: number): Map<string, Track> {
  const next = new Map<string, Track>();
  buses.forEach((b, n) => {
    const key = b.plateNo ?? `#${n}`;
    const old = prev.get(key);
    next.set(key, old && old.seq === b.stationSeq && old.state === b.stateCd ? old : { seq: b.stationSeq, state: b.stateCd, since: now });
  });
  return next;
}

/** 정류장 i → i+1 도로 거리 (m). 형상이 없으면 직선 */
export function segmentLength(db: BusDb, route: Route, shape: Shape | null, i: number): number {
  if (i >= route.stops.length - 1) return 0;
  if (shape && shape.stopAt.length === route.stops.length) {
    const a = shape.stopAt[i], b = shape.stopAt[i + 1];
    if (b > a) {
      let d = 0;
      for (let k = a; k < b; k++) d += distanceM(shape.pts[k][0], shape.pts[k][1], shape.pts[k + 1][0], shape.pts[k + 1][1]);
      return d;
    }
  }
  const s1 = db.stations.get(route.stops[i]);
  const s2 = db.stations.get(route.stops[i + 1]);
  return s1 && s2 ? distanceM(s1.y, s1.x, s2.y, s2.x) : 0;
}

/**
 * 진행률 0~1 (0 = 정류장 i, 1 = 정류장 i+1).
 * 도착(1)은 0. 출발(2)은 0.05 에서, 교차로 통과(0)는 0.35 에서 시작해 시간이 지날수록 다음 정류장 쪽으로.
 */
export function progressOf(track: Track, segLenM: number, now: number): number {
  if (track.state === 1) return 0;
  const start = track.state === 2 ? 0.05 : 0.35;
  if (segLenM <= 0) return start;
  const moved = (Math.max(0, now - track.since) / 1000) * BUS_SPEED_MPS;
  return Math.min(MAX_PROGRESS, start + moved / segLenM);
}

/** 정류장 i 와 i+1 사이, 도로 거리 기준 frac 지점의 좌표 */
export function pointAlong(db: BusDb, route: Route, shape: Shape | null, i: number, frac: number): LatLng | null {
  const s1 = db.stations.get(route.stops[i]);
  if (!s1) return null;
  if (frac <= 0 || i >= route.stops.length - 1) return [s1.y, s1.x];
  if (shape && shape.stopAt.length === route.stops.length) {
    const a = shape.stopAt[i], b = shape.stopAt[i + 1];
    if (b > a) {
      const total = segmentLength(db, route, shape, i);
      let target = total * frac;
      for (let k = a; k < b; k++) {
        const p = shape.pts[k], q = shape.pts[k + 1];
        const d = distanceM(p[0], p[1], q[0], q[1]);
        if (target <= d) {
          const t = d ? target / d : 0;
          return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        }
        target -= d;
      }
      return shape.pts[b];
    }
  }
  const s2 = db.stations.get(route.stops[i + 1]);
  return s2 ? [s1.y + (s2.y - s1.y) * frac, s1.x + (s2.x - s1.x) * frac] : [s1.y, s1.x];
}
