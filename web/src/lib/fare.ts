/**
 * 버스 요금 추정 (ADR-041). 성인·교통카드 기준, 경기도 2025-10-25 인상 요금.
 * - 수도권 통합환승: 갈아타면 기본요금이 더 비싼 버스 기준으로 차액만 더 낸다 → 기본요금 = 탄 버스 중 가장 비싼 것
 * - 거리 추가: 기본거리(일반·마을 10km, 좌석·직행·광역 30km)를 넘으면 5km마다 100원
 * 정류장 직선거리로 재므로 실제와 몇백 원 다를 수 있어 "약"으로 보여 준다.
 * 공항·시외버스는 통합환승 밖이라 요금을 모른다(null).
 */
import type { BusDb, Route } from "./data";
import { distanceM } from "./data";

/** 노선 종류 → 성인 카드 기본요금(원)과 기본거리(km). 위에서부터 먼저 일치하는 것 */
const FARES: [string, number, number][] = [
  ["광역급행", 3200, 30],
  ["직행좌석", 3200, 30],
  ["좌석", 2650, 30],
  ["마을", 1550, 10], // 시·군마다 1,350~1,650원 (성남 1,550원)
  ["일반", 1650, 10],
];

/** 비싼 버스(좌석·직행·광역)인지 */
export function isPremium(route: Route): boolean {
  return /좌석|광역/.test(route.type);
}

export function baseFare(route: Route): { won: number; freeKm: number } | null {
  if (/공항|시외/.test(route.type)) return null;
  for (const [word, won, freeKm] of FARES) if (route.type.includes(word)) return { won, freeKm };
  return { won: 1650, freeKm: 10 }; // "기타" 는 일반형으로 본다
}

export interface Fare {
  /** 추정 요금(원). 공항·시외버스가 끼면 null */
  won: number | null;
  /** 좌석·직행·광역 버스를 탄다 */
  premium: boolean;
}

export function estimateFare(db: BusDb, legs: { route: Route; fromIndex: number; toIndex: number }[]): Fare {
  const premium = legs.some((l) => isPremium(l.route));
  let base = 0;
  let freeKm = 10;
  let distM = 0;
  for (const l of legs) {
    const b = baseFare(l.route);
    if (!b) return { won: null, premium };
    base = Math.max(base, b.won);
    freeKm = Math.max(freeKm, b.freeKm);
    for (let i = l.fromIndex; i < l.toIndex; i++) {
      const a = db.stations.get(l.route.stops[i]);
      const c = db.stations.get(l.route.stops[i + 1]);
      if (a && c) distM += distanceM(a.y, a.x, c.y, c.x);
    }
  }
  const extraKm = distM / 1000 - freeKm;
  const extra = extraKm > 0 ? Math.ceil(extraKm / 5) * 100 : 0;
  return { won: base + extra, premium };
}

export const fmtWon = (won: number) => `${won.toLocaleString("ko-KR")}원`;

// ---------- 정렬 (ADR-041) ----------

export type SortMode = "best" | "fast" | "cheap";

/** 추천 정렬에서 요금 1원을 몇 초로 볼지: 100원 = 1분 → 1,000원 더 비싸면 10분 이상 빨라야 앞에 온다 */
export const SEC_PER_WON = 0.6;
/** 요금을 모르는 경로(공항·시외)는 비싼 쪽으로 본다 */
const UNKNOWN_FARE = 5000;

interface Sortable { arriveSec: number | null; note?: string; fare: Fare }

/** mode 에 따라 비교. 실시간 정보가 없는 경로는 어느 정렬이든 뒤로 */
export function compareBy(mode: SortMode, a: Sortable, b: Sortable): number {
  const na = a.note ? 1 : 0;
  const nb = b.note ? 1 : 0;
  if (na !== nb) return na - nb;
  const ta = a.arriveSec ?? Infinity;
  const tb = b.arriveSec ?? Infinity;
  const fa = a.fare.won ?? UNKNOWN_FARE;
  const fb = b.fare.won ?? UNKNOWN_FARE;
  if (mode === "fast") return ta - tb || fa - fb;
  if (mode === "cheap") return fa - fb || ta - tb;
  const sa = ta + fa * SEC_PER_WON;
  const sb = tb + fb * SEC_PER_WON;
  return sa - sb || ta - tb;
}
