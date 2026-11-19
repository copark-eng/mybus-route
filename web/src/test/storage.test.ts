import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "../lib/places";
import type { RoutePlan } from "../lib/router";
import {
  addFavorite,
  favoriteKey,
  favoriteToPlan,
  getFavorites,
  getPairs,
  isFavorite,
  removeFavorite,
  removePair,
  renameFavorite,
  savePair,
} from "../lib/storage";
import { ST, makeDb, route, stationPlaceOf, standardDb } from "./fixtures";

const KEY = "mybus-route:v1";

/** Map 기반 localStorage 대역 */
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

let ls: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  ls = fakeStorage();
  vi.stubGlobal("localStorage", ls);
});
afterEach(() => vi.unstubAllGlobals());

const pt = (lat: number, lng: number, label = "지도 위치"): Place => ({ kind: "point", label, lat, lng });

describe("최근 검색 (pairs)", () => {
  it("저장하면 최신이 맨 앞", () => {
    savePair(stationPlaceOf(ST.A), stationPlaceOf(ST.C));
    savePair(stationPlaceOf(ST.B), stationPlaceOf(ST.D));
    expect(getPairs().map((p) => p.from.label)).toEqual(["백현마을 (01003)", "판교역 (01001)"]);
  });

  it("같은 출발·도착 쌍은 하나로 합치고 앞으로 옮긴다", () => {
    savePair(stationPlaceOf(ST.A), stationPlaceOf(ST.C));
    savePair(stationPlaceOf(ST.B), stationPlaceOf(ST.D));
    savePair({ ...stationPlaceOf(ST.A), label: "라벨이 달라도 같은 정류장" }, stationPlaceOf(ST.C));
    const pairs = getPairs();
    expect(pairs).toHaveLength(2);
    expect(pairs[0].from.label).toBe("라벨이 달라도 같은 정류장");
  });

  it("위치(point)는 좌표 소수 5자리까지 같으면 같은 곳", () => {
    savePair(pt(37.123451, 127.1), stationPlaceOf(ST.C));
    savePair(pt(37.123449, 127.1), stationPlaceOf(ST.C)); // toFixed(5) 둘 다 37.12345
    expect(getPairs()).toHaveLength(1);
    savePair(pt(37.12346, 127.1), stationPlaceOf(ST.C));
    expect(getPairs()).toHaveLength(2);
  });

  it("방향이 다르면 다른 쌍", () => {
    savePair(stationPlaceOf(ST.A), stationPlaceOf(ST.C));
    savePair(stationPlaceOf(ST.C), stationPlaceOf(ST.A));
    expect(getPairs()).toHaveLength(2);
  });

  it("최대 8개, 오래된 것부터 버린다", () => {
    for (let i = 0; i < 10; i++) savePair(pt(37 + i / 100, 127), stationPlaceOf(ST.C));
    const pairs = getPairs();
    expect(pairs).toHaveLength(8);
    expect(pairs[0].from.lat).toBeCloseTo(37.09);
    expect(pairs.at(-1)!.from.lat).toBeCloseTo(37.02);
  });

  it("인덱스로 삭제", () => {
    savePair(stationPlaceOf(ST.A), stationPlaceOf(ST.C));
    savePair(stationPlaceOf(ST.B), stationPlaceOf(ST.D));
    removePair(0);
    expect(getPairs().map((p) => p.from.label)).toEqual(["판교역 (01001)"]);
    removePair(5); // 범위 밖은 무시
    expect(getPairs()).toHaveLength(1);
  });
});

describe("저장소 오류 내성 (ADR-007)", () => {
  it("깨진 JSON·다른 버전이면 빈 값으로 시작", () => {
    ls.setItem(KEY, "{not json");
    expect(getPairs()).toEqual([]);
    ls.setItem(KEY, JSON.stringify({ version: 2, pairs: [1], favorites: [] }));
    expect(getFavorites()).toEqual([]);
  });

  it("localStorage 가 예외를 던져도 조용히 동작", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
    });
    expect(() => savePair(stationPlaceOf(ST.A), stationPlaceOf(ST.C))).not.toThrow();
    expect(getPairs()).toEqual([]);
  });
});

describe("즐겨찾기", () => {
  const { db, R1, R2, R3 } = standardDb();
  const directPlan: RoutePlan = { legs: [{ route: R1, fromIndex: 0, toIndex: 2 }], walkStartSec: 0, walkTransferSec: 0, walkEndSec: 0 };
  const transferPlan: RoutePlan = {
    legs: [{ route: R2, fromIndex: 0, toIndex: 1 }, { route: R3, fromIndex: 0, toIndex: 1 }],
    walkStartSec: 30,
    walkTransferSec: 60,
    walkEndSec: 90,
  };

  it("추가: 기본 이름은 짧은 라벨, 정류장 id·노선 이름 사본 저장, 최신이 앞", () => {
    const f1 = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    const f2 = addFavorite(pt(37.4, 127.1, "성남시 분당구 판교역로 166"), stationPlaceOf(ST.D), transferPlan);
    expect(f1.name).toBe("판교역 → 서현역");
    expect(f2.name).toBe("판교역로 166 → 정자동주민센터");
    expect(f2.legs).toEqual([
      { routeId: R2.id, routeName: "20", fromIndex: 0, toIndex: 1, fromStationId: ST.A.id, toStationId: ST.T1.id },
      { routeId: R3.id, routeName: "30", fromIndex: 0, toIndex: 1, fromStationId: ST.T2.id, toStationId: ST.D.id },
    ]);
    expect(f2).toMatchObject({ walkStartSec: 30, walkTransferSec: 60, walkEndSec: 90 });
    expect(getFavorites().map((f) => f.id)).toEqual([f2.id, f1.id]);
    expect(f1.id).not.toBe(f2.id);
  });

  it("이름 변경·없는 id 는 무시", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    renameFavorite(f.id, "출근");
    renameFavorite("nope", "x");
    expect(getFavorites()[0].name).toBe("출근");
  });

  it("삭제", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    const g = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.D), transferPlan);
    removeFavorite(f.id);
    expect(getFavorites().map((x) => x.id)).toEqual([g.id]);
  });

  it("isFavorite / favoriteKey: 노선+인덱스 조합으로 판단", () => {
    expect(isFavorite(directPlan)).toBe(false);
    addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    expect(isFavorite(directPlan)).toBe(true);
    expect(isFavorite({ ...directPlan, walkStartSec: 999 })).toBe(true); // 도보는 키에 안 들어감
    expect(isFavorite(transferPlan)).toBe(false);
    expect(favoriteKey(transferPlan)).toBe(`${R2.id}:0-1|${R3.id}:0-1`);
  });

  it("favoriteToPlan: DB 그대로면 같은 plan", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.D), transferPlan);
    const p = favoriteToPlan(db, f)!;
    expect(p.legs.map((l) => [l.route.id, l.fromIndex, l.toIndex])).toEqual([[R2.id, 0, 1], [R3.id, 0, 1]]);
    expect(p).toMatchObject({ walkStartSec: 30, walkTransferSec: 60, walkEndSec: 90 });
  });

  it("favoriteToPlan: 노선 정류장 순서가 밀리면 정류장 id 로 다시 찾는다", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    // 앞에 정류장 2개가 새로 생김 → 인덱스 +2
    const shifted = route(R1.id, "10", R1.type, [ST.X, ST.D, ST.A, ST.B, ST.C]);
    const p = favoriteToPlan(makeDb([shifted]), f)!;
    expect(p.legs[0]).toMatchObject({ route: shifted, fromIndex: 2, toIndex: 4 });
  });

  it("favoriteToPlan: 왕복 노선이면 하차 정류장은 승차 뒤에서 찾는다", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    // C 가 앞쪽에도 있는 순환 노선 (C, X, A, B, C)
    const loop = route(R1.id, "10", R1.type, [ST.C, ST.X, ST.A, ST.B, ST.C]);
    const p = favoriteToPlan(makeDb([loop]), f)!;
    expect(p.legs[0]).toMatchObject({ fromIndex: 2, toIndex: 4 });
  });

  it("favoriteToPlan: 노선이 없어지면 null", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.D), transferPlan);
    expect(favoriteToPlan(makeDb([R2]), f)).toBeNull();
  });

  it("favoriteToPlan: 정류장이 노선에서 빠지면 null", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    expect(favoriteToPlan(makeDb([route(R1.id, "10", R1.type, [ST.A, ST.B])]), f)).toBeNull();
    expect(favoriteToPlan(makeDb([route(R1.id, "10", R1.type, [ST.B, ST.C])]), f)).toBeNull();
  });

  it("favoriteToPlan: 방향이 뒤집히면(하차가 승차보다 앞) null", () => {
    const f = addFavorite(stationPlaceOf(ST.A), stationPlaceOf(ST.C), directPlan);
    expect(favoriteToPlan(makeDb([route(R1.id, "10", R1.type, [ST.C, ST.B, ST.A])]), f)).toBeNull();
  });
});
