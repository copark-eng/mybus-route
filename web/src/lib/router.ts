/**
 * 경로 탐색 (FR-4)
 *  1. 정적 후보: 정류장·노선 DB 만으로 직행 / 1회 환승(200m 도보) 후보를 찾는다 (ADR-011, ADR-012)
 *  2. 실시간 평가: 승차·환승·하차 정류장의 도착정보로 실제 도착 시각을 계산한다 (ADR-008)
 *  3. 최종 도착 시각 → 환승 횟수 → 도보 시간 순으로 정렬한다 (ADR-009)
 */
import { fetchArrivals, peekArrivals, type RouteArrival, type StationArrivals } from "./api";
import { estimateFare, type Fare } from "./fare";
import { type BusDb, type Route, type Station, stationDistance, walkSeconds } from "./data";
import type { Place } from "./places";

export const CONFIG = {
  originRadiusM: 500, // 주소·위치일 때 근처 정류장 반경 (ADR-013)
  stationRadiusM: 200, // 정류장을 골랐을 때 함께 볼 근처 정류장(길 건너편 등)
  transferRadiusM: 200, // ADR-012
  maxEndpointStops: 5,
  maxRideStops: 70,
  busSpeedMps: 6, // 정류장 사이 평균 주행 속도 (약 22km/h)
  dwellSec: 20, // 정류장마다 정차 시간
  maxDirect: 6, // data.go.kr 일일 한도를 아끼려고 줄임 (ADR-032)
  maxTransfer: 6, // 운행 시간이 아닌 후보가 빠질 수 있어 여유를 두되, 호출 수를 줄인다 (ADR-032)
};

// ---------- 정의 ----------

export interface LegPlan {
  route: Route;
  fromIndex: number;
  toIndex: number;
}

/** 고정된 경로 (즐겨찾기로 저장할 수 있는 단위, ADR-017) */
export interface RoutePlan {
  legs: LegPlan[]; // 1개 = 직행, 2개 = 환승
  walkStartSec: number;
  walkTransferSec: number;
  walkEndSec: number;
}

export interface LegResult {
  route: Route;
  from: Station;
  to: Station;
  stops: number;
  boardSec: number | null; // 지금부터 승차까지 (초)
  boardEstimated: boolean;
  waitSec: number | null; // 정류장에서 기다리는 시간
  rideSec: number;
  rideEstimated: boolean;
  alightSec: number | null;
  /** 이 정류장에서 이 노선의 실시간 예측 (다음 2대) */
  upcoming: number[];
}

export interface OptionResult {
  plan: RoutePlan;
  legs: LegResult[];
  arriveSec: number | null; // 지금부터 최종 도착까지 (초)
  /** 추정 요금 (성인 카드, ADR-041) */
  fare: Fare;
  estimated: boolean;
  /** 실시간 예측도 없고 운행 시간도 아닌 구간이 있음 → 결과에서 뺀다 */
  notRunning: boolean;
  evaluatedAt: number;
  note?: string;
}

// ---------- 1. 정적 후보 ----------

interface Endpoint { station: Station; walk: number }

function endpoints(db: BusDb, place: Place): Endpoint[] {
  const radius = place.kind === "station" ? CONFIG.stationRadiusM : CONFIG.originRadiusM;
  const near = db.grid.near(place.lat, place.lng, radius).slice(0, CONFIG.maxEndpointStops + 1);
  const out = near.map((n) => ({ station: n.station, walk: walkSeconds(n.dist) }));
  if (place.kind === "station") {
    const exact = db.stations.get(place.stationId);
    if (exact && !out.some((e) => e.station.id === exact.id)) out.unshift({ station: exact, walk: 0 });
  }
  return out.slice(0, CONFIG.maxEndpointStops);
}

/** 정류장 순서 i → j 구간의 예상 탑승 시간 (초) */
export function estimateRide(db: BusDb, route: Route, i: number, j: number): number {
  let dist = 0;
  for (let k = i; k < j; k++) {
    const a = db.stations.get(route.stops[k]);
    const b = db.stations.get(route.stops[k + 1]);
    if (a && b) dist += stationDistance(a, b);
  }
  return Math.round((dist * 1.2) / CONFIG.busSpeedMps + CONFIG.dwellSec * Math.max(0, j - i - 1));
}

/**
 * 운행 시간 안인지 (기점 첫차 ~ 막차 + 90분). 시간 정보가 없으면 운행 중으로 본다.
 * 실시간 예측이 없을 때만 쓴다: 출근·퇴근 전용 노선이 한밤중에 추천되지 않게 한다.
 */
export function isRunning(route: Route, at: Date): boolean {
  const toMin = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const first = toMin(route.first);
  let last = toMin(route.last);
  if (first === null || last === null) return true;
  if (last < first) last += 24 * 60; // 막차가 자정을 넘는 노선
  let now = at.getHours() * 60 + at.getMinutes();
  // 첫차 10분 전 여유 구간은 오늘로 본다 (`now < first` 로 비교하면 05:50(첫차 06:00)이 다음 날로 넘어가 false 가 됐다)
  if (now < first - 10) now += 24 * 60;
  return now >= first - 10 && now <= last + 90;
}

/** 지금 시각의 배차 간격 (분) */
export function headwayMin(route: Route, now = new Date()): number {
  const h = now.getHours();
  const peak = (h >= 7 && h < 9) || (h >= 17 && h < 19);
  return (peak ? route.peek ?? route.npeek : route.npeek ?? route.peek) ?? 15;
}

export function findPlans(db: BusDb, from: Place, to: Place, allowTransfer: boolean): RoutePlan[] {
  const origins = endpoints(db, from);
  const dests = endpoints(db, to);
  const destWalk = new Map(dests.map((d) => [d.station.id, d.walk]));

  // 직행: 노선마다 가장 빠른 (승차, 하차) 조합 하나
  const direct = new Map<string, { plan: RoutePlan; cost: number }>();
  for (const o of origins) {
    for (const ref of db.stopRefs.get(o.station.id) ?? []) {
      const { route, index: i } = ref;
      const end = Math.min(route.stops.length - 1, i + CONFIG.maxRideStops);
      for (let j = i + 1; j <= end; j++) {
        const dw = destWalk.get(route.stops[j]);
        if (dw === undefined) continue;
        const cost = o.walk + estimateRide(db, route, i, j) + dw + headwayMin(route) * 30;
        const prev = direct.get(route.id);
        if (!prev || cost < prev.cost) {
          direct.set(route.id, {
            plan: { legs: [{ route, fromIndex: i, toIndex: j }], walkStartSec: o.walk, walkTransferSec: 0, walkEndSec: dw },
            cost,
          });
        }
        break; // 이 승차 위치에서는 가장 먼저 만나는 하차 정류장이 최선
      }
    }
  }
  const directPlans = [...direct.values()].sort((a, b) => a.cost - b.cost).slice(0, CONFIG.maxDirect);
  if (!allowTransfer) return directPlans.map((d) => d.plan);

  // 환승: 첫 노선으로 갈 수 있는 정류장(T1)과, 두 번째 노선을 탈 수 있는 정류장(T2)을 200m 이내로 잇는다
  interface Reach { route: Route; i: number; j: number; walk: number; cost: number }
  const reachA = new Map<string, Reach[]>(); // T1 → 첫 노선 정보
  for (const o of origins) {
    for (const { route, index: i } of db.stopRefs.get(o.station.id) ?? []) {
      if (direct.has(route.id)) continue;
      const end = Math.min(route.stops.length - 1, i + CONFIG.maxRideStops);
      for (let j = i + 1; j <= end; j++) {
        const t1 = route.stops[j];
        const cost = o.walk + estimateRide(db, route, i, j);
        const list = reachA.get(t1) ?? [];
        const same = list.find((r) => r.route.id === route.id);
        if (same) { if (cost < same.cost) Object.assign(same, { i, j, walk: o.walk, cost }); }
        else list.push({ route, i, j, walk: o.walk, cost });
        reachA.set(t1, list);
      }
    }
  }
  const reachB = new Map<string, Reach[]>(); // T2 → 두 번째 노선 정보 (i=T2 위치, j=하차 위치)
  for (const d of dests) {
    for (const { route, index: l } of db.stopRefs.get(d.station.id) ?? []) {
      if (direct.has(route.id)) continue;
      const start = Math.max(0, l - CONFIG.maxRideStops);
      for (let k = start; k < l; k++) {
        const t2 = route.stops[k];
        const cost = estimateRide(db, route, k, l) + d.walk + headwayMin(route) * 30;
        const list = reachB.get(t2) ?? [];
        const same = list.find((r) => r.route.id === route.id);
        if (same) { if (cost < same.cost) Object.assign(same, { i: k, j: l, walk: d.walk, cost }); }
        else list.push({ route, i: k, j: l, walk: d.walk, cost });
        reachB.set(t2, list);
      }
    }
  }

  const transfer = new Map<string, { plan: RoutePlan; cost: number }>();
  for (const [t1Id, aList] of reachA) {
    const t1 = db.stations.get(t1Id);
    if (!t1?.sel) continue; // 환승은 경기도 정류장에서만 (ADR-027)
    for (const { station: t2, dist } of db.grid.near(t1.y, t1.x, CONFIG.transferRadiusM)) {
      const bList = reachB.get(t2.id);
      if (!bList) continue;
      const walkT = walkSeconds(dist);
      for (const a of aList) {
        for (const b of bList) {
          if (a.route.id === b.route.id) continue;
          const cost = a.cost + walkT + b.cost;
          const key = `${a.route.id}>${b.route.id}`;
          const prev = transfer.get(key);
          if (!prev || cost < prev.cost) {
            transfer.set(key, {
              plan: {
                legs: [
                  { route: a.route, fromIndex: a.i, toIndex: a.j },
                  { route: b.route, fromIndex: b.i, toIndex: b.j },
                ],
                walkStartSec: a.walk,
                walkTransferSec: walkT,
                walkEndSec: b.walk,
              },
              cost,
            });
          }
        }
      }
    }
  }
  const transferPlans = [...transfer.values()].sort((a, b) => a.cost - b.cost).slice(0, CONFIG.maxTransfer);
  return [...directPlans, ...transferPlans].map((x) => x.plan);
}

// ---------- 2. 실시간 평가 ----------

/** 정류장 도착정보에서 해당 노선(같은 방향)의 예측을 찾고, 받은 뒤 흐른 시간만큼 뺀다. */
function routePredictions(arr: StationArrivals | undefined, route: Route, index: number, now: number) {
  if (!arr) return null;
  const candidates = arr.routes.filter((r) => r.routeId === route.id);
  const match: RouteArrival | undefined =
    candidates.find((r) => r.staOrder === index + 1) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!match) return null;
  const elapsed = Math.round((now - arr.fetchedAt) / 1000);
  return match.arrivals.map((a) => ({ sec: Math.max(0, a.seconds - elapsed), plate: a.plateNo }));
}

/** 자동 갱신 때 하차 정류장 도착정보를 다시 쓰는 최대 나이 (ADR-040) */
export const ALIGHT_REUSE_MS = 180_000;

export async function evaluate(db: BusDb, plans: RoutePlan[], opts: { reuseAlightMs?: number } = {}): Promise<OptionResult[]> {
  // 승차·환승 정류장 + (차량 추적용) 하차 정류장의 도착정보를 한 번씩만 조회한다
  const board = new Set<string>();
  const alight = new Set<string>();
  for (const p of plans) {
    for (const leg of p.legs) {
      board.add(leg.route.stops[leg.fromIndex]);
      alight.add(leg.route.stops[leg.toIndex]);
    }
  }
  const fetched = new Map<string, StationArrivals>();
  const need = new Set(board);
  // 자동 갱신(ADR-040): 하차 정류장은 차량 번호로 탑승 시간을 맞추는 데만 쓰므로, 최근에 받은 값이 있으면 다시 부르지 않는다.
  // (남은 시간은 받은 시각 기준으로 빼서 계산하므로 조금 지난 값도 쓸 수 있다)
  for (const id of alight) {
    if (board.has(id)) continue;
    const old = opts.reuseAlightMs ? peekArrivals(id, opts.reuseAlightMs) : null;
    if (old) fetched.set(id, old);
    else need.add(id);
  }
  // data.go.kr 초당 호출 제한을 고려해 동시에 4개씩만 부른다
  const queue = [...need];
  let lastError: unknown = null;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        await fetchArrivals(id).then((a) => fetched.set(id!, a), (e) => { lastError = e; });
      }
    }),
  );
  // 하나도 못 받았으면 모든 경로가 "추정"으로 보이는 대신 오류로 알린다 (일부 실패는 추정으로 계속)
  if (need.size > 0 && fetched.size === 0 && lastError) throw lastError;
  const now = Date.now();
  return plans
    .map((p) => evaluatePlan(db, p, fetched, now))
    .filter((r) => !r.notRunning)
    .sort(compareOptions);
}

function evaluatePlan(db: BusDb, plan: RoutePlan, arrivals: Map<string, StationArrivals>, now: number): OptionResult {
  let t = plan.walkStartSec; // 지금부터 흐른 시간 (초)
  let estimated = false;
  let notRunning = false;
  const legs: LegResult[] = [];

  plan.legs.forEach((leg, n) => {
    if (n === 1) t += plan.walkTransferSec;
    const { route, fromIndex, toIndex } = leg;
    const from = db.stations.get(route.stops[fromIndex])!;
    const to = db.stations.get(route.stops[toIndex])!;
    const preds = routePredictions(arrivals.get(from.id), route, fromIndex, now) ?? [];
    const upcoming = preds.map((p) => p.sec);

    // 정류장에 도착한 뒤 탈 수 있는 첫 버스
    let board = preds.find((p) => p.sec >= t);
    let boardSec: number | null = board?.sec ?? null;
    let boardEstimated = false;
    if (boardSec === null) {
      boardEstimated = true;
      const hw = headwayMin(route) * 60;
      const last = preds.at(-1)?.sec;
      // 예측된 마지막 버스 이후는 배차 간격마다 온다고 보고, 예측이 없으면 평균 대기(배차의 절반)로 본다.
      boardSec = last !== undefined ? last + hw * Math.max(1, Math.ceil((t - last) / hw)) : t + hw / 2;
      if (preds.length === 0 && !isRunning(route, new Date(now + boardSec * 1000))) notRunning = true;
    }

    // 탑승 시간: 같은 차량이 하차 정류장 예측에 있으면 그 값을 쓴다
    let alightSec: number | null = null;
    let rideEstimated = true;
    if (board?.plate) {
      const down = routePredictions(arrivals.get(to.id), route, toIndex, now);
      const same = down?.find((p) => p.plate === board!.plate && p.sec > board!.sec);
      if (same) { alightSec = same.sec; rideEstimated = false; }
    }
    alightSec ??= boardSec + estimateRide(db, route, fromIndex, toIndex);
    if (boardEstimated || rideEstimated) estimated = true;

    legs.push({
      route, from, to,
      stops: toIndex - fromIndex,
      boardSec, boardEstimated,
      waitSec: boardSec - t,
      rideSec: alightSec - boardSec,
      rideEstimated,
      alightSec,
      upcoming,
    });
    t = alightSec;
  });

  const noRealtime = legs[0].upcoming.length === 0;
  return {
    plan,
    legs,
    arriveSec: t + plan.walkEndSec,
    fare: estimateFare(db, plan.legs),
    estimated,
    notRunning,
    evaluatedAt: now,
    note: noRealtime ? "첫 버스 실시간 정보 없음 (운행 종료이거나 아직 출발 전일 수 있음)" : undefined,
  };
}

export function compareOptions(a: OptionResult, b: OptionResult): number {
  // 실시간 정보가 없는 경로는 뒤로
  const na = a.note ? 1 : 0;
  const nb = b.note ? 1 : 0;
  if (na !== nb) return na - nb;
  const ta = a.arriveSec ?? Infinity;
  const tb = b.arriveSec ?? Infinity;
  if (ta !== tb) return ta - tb;
  if (a.legs.length !== b.legs.length) return a.legs.length - b.legs.length;
  const wa = a.plan.walkStartSec + a.plan.walkTransferSec + a.plan.walkEndSec;
  const wb = b.plan.walkStartSec + b.plan.walkTransferSec + b.plan.walkEndSec;
  return wa - wb;
}
