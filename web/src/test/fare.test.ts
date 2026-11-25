import { describe, expect, it } from "vitest";
import { baseFare, compareBy, estimateFare, type Fare } from "../lib/fare";
import { makeDb, route } from "./fixtures";
import type { Station } from "../lib/data";

// 위도 0.009° ≈ 1km 간격으로 정류장을 한 줄로 놓는다
const line = (n: number): Station[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(300000000 + i), no: String(i), name: `S${i}`, x: 127, y: 37 + i * 0.009, sel: 1 as const }));
const ST = line(60);
const db = makeDb([], ST);
const r = (type: string, n = 60) => route(type, type, type, ST.slice(0, n));

describe("baseFare (ADR-041, 2025-10-25 성인 카드)", () => {
  it.each([
    ["일반형시내버스", 1650, 10],
    ["일반형농어촌버스", 1650, 10],
    ["마을버스", 1550, 10],
    ["좌석형시내버스", 2650, 30],
    ["직행좌석형시내버스", 3200, 30],
    ["직행좌석형농어촌버스", 3200, 30],
    ["광역급행형시내버스", 3200, 30],
    ["기타", 1650, 10],
  ])("%s → %i원, 기본 %ikm", (type, won, freeKm) => {
    expect(baseFare(r(type))).toEqual({ won, freeKm });
  });

  it("공항·시외버스는 통합환승 밖 → 모름", () => {
    expect(baseFare(r("리무진공항버스"))).toBeNull();
    expect(baseFare(r("일반형시외버스"))).toBeNull();
  });
});

describe("estimateFare", () => {
  it("일반버스 10km 이내는 기본요금", () => {
    expect(estimateFare(db, [{ route: r("일반형시내버스"), fromIndex: 0, toIndex: 9 }])).toEqual({ won: 1650, premium: false });
  });

  it("일반버스 10km 넘으면 5km마다 100원", () => {
    // 약 12km → +100, 약 21km → +300
    expect(estimateFare(db, [{ route: r("일반형시내버스"), fromIndex: 0, toIndex: 12 }]).won).toBe(1750);
    expect(estimateFare(db, [{ route: r("일반형시내버스"), fromIndex: 0, toIndex: 21 }]).won).toBe(1950);
  });

  it("광역버스는 30km까지 기본, 비싼 버스로 표시", () => {
    expect(estimateFare(db, [{ route: r("광역급행형시내버스"), fromIndex: 0, toIndex: 25 }])).toEqual({ won: 3200, premium: true });
    expect(estimateFare(db, [{ route: r("광역급행형시내버스"), fromIndex: 0, toIndex: 36 }]).won).toBe(3400);
  });

  it("환승: 더 비싼 버스 기본요금 + 전체 거리 기준 추가 (통합환승)", () => {
    const f = estimateFare(db, [
      { route: r("마을버스"), fromIndex: 0, toIndex: 3 },
      { route: r("직행좌석형시내버스"), fromIndex: 3, toIndex: 20 },
    ]);
    expect(f).toEqual({ won: 3200, premium: true });
    const g = estimateFare(db, [
      { route: r("마을버스"), fromIndex: 0, toIndex: 3 },
      { route: r("일반형시내버스"), fromIndex: 3, toIndex: 8 },
    ]);
    expect(g).toEqual({ won: 1650, premium: false });
  });

  it("공항버스가 끼면 요금 별도(null)", () => {
    expect(estimateFare(db, [{ route: r("일반형공항버스"), fromIndex: 0, toIndex: 3 }]).won).toBeNull();
  });
});

describe("compareBy", () => {
  const opt = (min: number, won: number | null, note?: string) => ({ arriveSec: min * 60, note, fare: { won, premium: (won ?? 0) > 3000 } as Fare });
  const cheapSlow = opt(40, 1650);
  const expFast = opt(32, 3200); // 8분 빠르고 1,550원 비쌈
  const expVeryFast = opt(20, 3200); // 20분 빠름
  const sort = (mode: "best" | "fast" | "cheap", list: ReturnType<typeof opt>[]) => [...list].sort((a, b) => compareBy(mode, a, b));

  it("빠른 순: 도착이 이른 순", () => {
    expect(sort("fast", [cheapSlow, expFast])).toEqual([expFast, cheapSlow]);
  });

  it("요금 적은 순: 싼 순, 같으면 빠른 순", () => {
    expect(sort("cheap", [expVeryFast, cheapSlow, expFast])).toEqual([cheapSlow, expVeryFast, expFast]);
  });

  it("추천: 1,550원 더 비싸면 15.5분 넘게 빨라야 앞", () => {
    expect(sort("best", [expFast, cheapSlow])).toEqual([cheapSlow, expFast]); // 8분 빠름 → 싼 쪽 먼저
    expect(sort("best", [cheapSlow, expVeryFast])).toEqual([expVeryFast, cheapSlow]); // 20분 빠름 → 광역 먼저
  });

  it("실시간 정보 없는 경로는 어느 정렬이든 뒤, 요금 모름은 비싼 쪽", () => {
    const noLive = opt(10, 1000, "첫 버스 실시간 정보 없음");
    const unknown = opt(30, null);
    expect(sort("cheap", [noLive, unknown, cheapSlow])).toEqual([cheapSlow, unknown, noLive]);
  });
});
