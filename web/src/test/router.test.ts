import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({ fetchArrivals: vi.fn(), peekArrivals: vi.fn(() => null) }));

import { fetchArrivals, peekArrivals, type RouteArrival } from "../lib/api";
import { compareOptions, estimateRide, evaluate, findPlans, headwayMin, isRunning, type RoutePlan } from "../lib/router";
import type { Place } from "../lib/places";
import { ST, makeDb, makeResult, route, standardDb, stationPlaceOf } from "./fixtures";

const mockedFetch = vi.mocked(fetchArrivals);
const mockedPeek = vi.mocked(peekArrivals);

/** 정류장 id → 도착정보. fetchedAgoMs 만큼 이전에 받은 것으로 둔다 */
function serve(table: Record<string, RouteArrival[]>, fetchedAgoMs = 0) {
  mockedFetch.mockImplementation(async (stationId: string) => ({
    stationId,
    fetchedAt: Date.now() - fetchedAgoMs,
    routes: table[stationId] ?? [],
  }));
}

const arr = (routeId: string, staOrder: number | null, list: [number, string | null][]): RouteArrival => ({
  routeId,
  routeName: "x",
  staOrder,
  arrivals: list.map(([seconds, plateNo]) => ({ seconds, stopsLeft: 1, plateNo })),
});

// ---------------------------------------------------------------- findPlans

describe("findPlans", () => {
  it("직행: 같은 노선으로 갈 수 있으면 직행 후보 하나", () => {
    const { db, R1 } = standardDb();
    const plans = findPlans(db, stationPlaceOf(ST.A), stationPlaceOf(ST.C), true);
    expect(plans).toHaveLength(1);
    expect(plans[0].legs).toHaveLength(1);
    expect(plans[0].legs[0]).toMatchObject({ route: R1, fromIndex: 0, toIndex: 2 });
    expect(plans[0]).toMatchObject({ walkStartSec: 0, walkTransferSec: 0, walkEndSec: 0 });
  });

  it("역방향(C→A)은 직행 후보가 없다", () => {
    const { db } = standardDb();
    expect(findPlans(db, stationPlaceOf(ST.C), stationPlaceOf(ST.A), false)).toEqual([]);
  });

  it("환승: 200m 안 다른 정류장으로 걸어서 갈아탄다 (ADR-012)", () => {
    const { db, R2, R3 } = standardDb();
    const plans = findPlans(db, stationPlaceOf(ST.A), stationPlaceOf(ST.D), true);
    expect(plans).toHaveLength(1);
    const [p] = plans;
    expect(p.legs.map((l) => l.route.id)).toEqual([R2.id, R3.id]);
    expect(p.legs[0]).toMatchObject({ fromIndex: 0, toIndex: 1 });
    expect(p.legs[1]).toMatchObject({ fromIndex: 0, toIndex: 1 });
    expect(p.walkTransferSec).toBe(60); // T1↔T2 ~55m → 최소 60초
  });

  it("직행만 모드에서는 환승 후보를 만들지 않는다", () => {
    const { db } = standardDb();
    expect(findPlans(db, stationPlaceOf(ST.A), stationPlaceOf(ST.D), false)).toEqual([]);
  });

  it("환승 정류장이 성남(sel) 아니면 환승하지 않는다 (ADR-010)", () => {
    const T1 = { ...ST.T1, sel: undefined };
    const stations = Object.values(ST).map((s) => (s.id === T1.id ? T1 : s));
    const R2 = route("200000002", "20", "마을버스", [ST.A, T1]);
    const R3 = route("200000003", "30", "직행좌석형시내버스", [ST.T2, ST.D]);
    const db = makeDb([R2, R3], stations);
    expect(findPlans(db, stationPlaceOf(ST.A), stationPlaceOf(ST.D), true)).toEqual([]);
  });

  it("주소(point) 출발: 500m 안 정류장 + 걷는 시간 포함", () => {
    const { db } = standardDb();
    const from: Place = { kind: "point", label: "어딘가", lat: 37.399, lng: 127.1 }; // A 에서 ~111m 남쪽
    const plans = findPlans(db, from, stationPlaceOf(ST.C), false);
    expect(plans).toHaveLength(1);
    expect(plans[0].walkStartSec).toBe(120); // 111m × 1.3 ÷ 1.2 ≈ 120초
  });

  it("직행이 있는 노선은 환승 후보 첫/둘째 구간에 다시 쓰지 않는다", () => {
    const { db, R1 } = standardDb();
    const plans = findPlans(db, stationPlaceOf(ST.A), stationPlaceOf(ST.C), true);
    expect(plans.filter((p) => p.legs.length === 2)).toEqual([]);
    expect(plans[0].legs[0].route).toBe(R1);
  });
});

// ---------------------------------------------------------------- isRunning / headwayMin

describe("isRunning", () => {
  const at = (h: number, m: number) => new Date(2026, 10, 19, h, m);

  it("시간 정보가 없으면 운행 중으로 본다", () => {
    expect(isRunning(route("r", "1", "일반", [], { first: "", last: "" }), at(3, 0))).toBe(true);
    expect(isRunning(route("r", "1", "일반", [], { first: "5시", last: "23:00" }), at(3, 0))).toBe(true);
  });

  it("평범한 낮 노선: 첫차-10분 ~ 막차+90분", () => {
    const r = route("r", "1", "일반", [], { first: "06:00", last: "22:00" });
    expect(isRunning(r, at(12, 0))).toBe(true);
    expect(isRunning(r, at(5, 50))).toBe(true); // 첫차 10분 전 (경계)
    expect(isRunning(r, at(5, 49))).toBe(false);
    expect(isRunning(r, at(23, 30))).toBe(true); // 막차+90분 (경계)
    expect(isRunning(r, at(23, 31))).toBe(false);
    expect(isRunning(r, at(3, 0))).toBe(false);
  });

  it("막차가 자정을 넘는 노선 (05:00 ~ 00:30)", () => {
    const r = route("r", "1", "일반", [], { first: "05:00", last: "00:30" });
    expect(isRunning(r, at(23, 59))).toBe(true);
    expect(isRunning(r, at(0, 10))).toBe(true);
    expect(isRunning(r, at(2, 0))).toBe(true); // 00:30 + 90분 = 02:00
    expect(isRunning(r, at(2, 1))).toBe(false);
    expect(isRunning(r, at(4, 0))).toBe(false);
  });

  it("막차+90분이 자정을 넘는 노선 (06:00 ~ 23:30) 은 00:59 까지", () => {
    const r = route("r", "1", "일반", [], { first: "06:00", last: "23:30" });
    expect(isRunning(r, at(0, 30))).toBe(true);
    expect(isRunning(r, at(1, 1))).toBe(false);
  });

  it("첫차 10분 전 여유는 자정 넘김 처리보다 우선한다 (04:55, 첫차 05:00)", () => {
    const r = route("r", "1", "일반", [], { first: "05:00", last: "00:30" });
    expect(isRunning(r, at(4, 55))).toBe(true);
    expect(isRunning(r, at(4, 49))).toBe(false);
  });

  it("하루 1회 노선(P9801 형: 첫차 = 막차)", () => {
    const r = route("r", "P9801", "직행좌석", [], { first: "07:00", last: "07:00" });
    expect(isRunning(r, at(6, 50))).toBe(true);
    expect(isRunning(r, at(7, 30))).toBe(true);
    expect(isRunning(r, at(8, 30))).toBe(true);
    expect(isRunning(r, at(8, 31))).toBe(false);
    expect(isRunning(r, at(6, 45))).toBe(false);
    expect(isRunning(r, at(19, 0))).toBe(false);
  });
});

describe("headwayMin", () => {
  const at = (h: number) => new Date(2026, 10, 19, h, 0);
  it("출퇴근(7–9, 17–19시)은 peek, 그 외 npeek", () => {
    const r = route("r", "1", "일반", [], { peek: 8, npeek: 15 });
    expect(headwayMin(r, at(7))).toBe(8);
    expect(headwayMin(r, at(18))).toBe(8);
    expect(headwayMin(r, at(9))).toBe(15);
    expect(headwayMin(r, at(12))).toBe(15);
  });
  it("한쪽이 없으면 다른 쪽, 둘 다 없으면 15분", () => {
    expect(headwayMin(route("r", "1", "일반", [], { peek: null, npeek: 12 }), at(8))).toBe(12);
    expect(headwayMin(route("r", "1", "일반", [], { peek: 9, npeek: null }), at(12))).toBe(9);
    expect(headwayMin(route("r", "1", "일반", [], { peek: null, npeek: null }), at(12))).toBe(15);
  });
});

// ---------------------------------------------------------------- evaluate

describe("evaluate (fetchArrivals mock)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 12, 0, 0)); // 평시 → npeek 20분
    mockedFetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const direct = (r: ReturnType<typeof standardDb>["R1"], walkStartSec = 0, walkEndSec = 0): RoutePlan => ({
    legs: [{ route: r, fromIndex: 0, toIndex: 2 }],
    walkStartSec,
    walkTransferSec: 0,
    walkEndSec,
  });

  it("걸어서 정류장에 닿은 뒤 탈 수 있는 첫 버스를 고른다", async () => {
    const { db, R1 } = standardDb();
    serve({
      [ST.A.id]: [arr(R1.id, 1, [[60, "P1"], [600, "P2"]])],
      [ST.C.id]: [arr(R1.id, 3, [[1100, "P2"]])],
    });
    const [r] = await evaluate(db, [direct(R1, 120, 30)]);
    expect(r.legs[0]).toMatchObject({ boardSec: 600, waitSec: 480, boardEstimated: false, upcoming: [60, 600] });
    // 같은 차량(P2)이 하차 정류장 예측에 있으므로 차량 추적
    expect(r.legs[0]).toMatchObject({ alightSec: 1100, rideSec: 500, rideEstimated: false });
    expect(r.arriveSec).toBe(1130);
    expect(r.estimated).toBe(false);
    expect(r.note).toBeUndefined();
  });

  it("하차 정류장에 같은 차량이 없으면 탑승 시간을 추정한다", async () => {
    const { db, R1 } = standardDb();
    serve({
      [ST.A.id]: [arr(R1.id, 1, [[300, "P1"]])],
      [ST.C.id]: [arr(R1.id, 3, [[900, "P9"]])],
    });
    const [r] = await evaluate(db, [direct(R1)]);
    expect(r.legs[0].rideEstimated).toBe(true);
    expect(r.legs[0].alightSec).toBe(300 + estimateRide(db, R1, 0, 2));
    expect(r.estimated).toBe(true);
  });

  it("하차 정류장 예측이 승차보다 이르면(같은 번호판이라도) 쓰지 않는다", async () => {
    const { db, R1 } = standardDb();
    serve({
      [ST.A.id]: [arr(R1.id, 1, [[300, "P1"]])],
      [ST.C.id]: [arr(R1.id, 3, [[300, "P1"]])],
    });
    const [r] = await evaluate(db, [direct(R1)]);
    expect(r.legs[0].rideEstimated).toBe(true);
  });

  it("번호판이 없으면 차량 추적을 하지 않는다", async () => {
    const { db, R1 } = standardDb();
    serve({
      [ST.A.id]: [arr(R1.id, 1, [[300, null]])],
      [ST.C.id]: [arr(R1.id, 3, [[900, null]])],
    });
    const [r] = await evaluate(db, [direct(R1)]);
    expect(r.legs[0].rideEstimated).toBe(true);
  });

  it("받은 뒤 흐른 시간만큼 예측에서 뺀다", async () => {
    const { db, R1 } = standardDb();
    serve({ [ST.A.id]: [arr(R1.id, 1, [[630, "P1"]])] }, 30_000);
    const [r] = await evaluate(db, [direct(R1)]);
    expect(r.legs[0].boardSec).toBe(600);
  });

  it("왕복 노선: staOrder = index+1 인 항목을 고른다", async () => {
    const { db, R1 } = standardDb();
    serve({ [ST.A.id]: [arr(R1.id, 5, [[100, "Z"]]), arr(R1.id, 1, [[400, "P1"]])] });
    const [r] = await evaluate(db, [direct(R1)]);
    expect(r.legs[0].boardSec).toBe(400);
  });

  it("같은 노선 항목이 여럿인데 staOrder 가 맞지 않으면 예측 없음으로 본다", async () => {
    const { db, R1 } = standardDb();
    serve({ [ST.A.id]: [arr(R1.id, 5, [[100, "Z"]]), arr(R1.id, 7, [[400, "P1"]])] });
    const [r] = await evaluate(db, [direct(R1)]);
    expect(r.legs[0].upcoming).toEqual([]);
    expect(r.legs[0].boardEstimated).toBe(true);
  });

  it("예측이 없고 운행 시간이면 배차 절반을 기다린다고 추정 + note", async () => {
    const { db, R1 } = standardDb();
    serve({});
    const [r] = await evaluate(db, [direct(R1, 120)]);
    expect(r.legs[0].boardSec).toBe(120 + (20 * 60) / 2);
    expect(r.legs[0].boardEstimated).toBe(true);
    expect(r.note).toMatch(/실시간 정보 없음/);
    expect(r.notRunning).toBe(false);
  });

  it("예측이 모두 도착 전에 지나가면 마지막 예측 + 배차 간격으로 추정", async () => {
    const { db, R1 } = standardDb();
    serve({ [ST.A.id]: [arr(R1.id, 1, [[60, "P1"], [200, "P2"]])] });
    const [r] = await evaluate(db, [direct(R1, 300)]);
    expect(r.legs[0].boardSec).toBe(200 + 1200);
    expect(r.legs[0].boardEstimated).toBe(true);
    expect(r.note).toBeUndefined(); // 실시간 정보 자체는 있음
  });

  it("예측도 없고 운행 시간도 아니면(notRunning) 결과에서 뺀다", async () => {
    const night = route("200000001", "10", "일반형시내버스", [ST.A, ST.B, ST.C], { first: "05:00", last: "06:00" });
    const db2 = makeDb([night]);
    serve({});
    expect(await evaluate(db2, [direct(night)])).toEqual([]);
  });

  it("도착정보 조회가 모두 실패하면 오류를 던진다 (화면에서 오류로 알림)", async () => {
    const { db, R1 } = standardDb();
    mockedFetch.mockRejectedValue(new Error("API 502"));
    await expect(evaluate(db, [direct(R1)])).rejects.toThrow("API 502");
  });

  it("일부 정류장만 실패하면 예외 없이 그 구간을 '예측 없음'으로 계산한다", async () => {
    const { db, R1 } = standardDb();
    // 승차 정류장(A)만 실패, 하차 정류장은 성공
    mockedFetch.mockImplementation(async (id: string) => {
      if (id === ST.A.id) throw new Error("API 502");
      return { stationId: id, fetchedAt: Date.now(), routes: [] };
    });
    const [r] = await evaluate(db, [direct(R1)]);
    expect(r.legs[0].boardEstimated).toBe(true);
  });

  it("같은 정류장은 한 번만 조회한다 (승차·하차 정류장 중복 제거)", async () => {
    const { db, R1, R2 } = standardDb();
    serve({});
    const plans: RoutePlan[] = [
      direct(R1),
      { legs: [{ route: R2, fromIndex: 0, toIndex: 1 }], walkStartSec: 0, walkTransferSec: 0, walkEndSec: 0 },
    ];
    await evaluate(db, plans);
    const ids = mockedFetch.mock.calls.map((c) => c[0]).sort();
    expect(ids).toEqual([ST.A.id, ST.C.id, ST.T1.id].sort());
  });

  it("자동 갱신(reuseAlightMs): 최근에 받은 하차 정류장은 다시 부르지 않고 그 값으로 차량을 추적한다 (ADR-040)", async () => {
    const { db, R1 } = standardDb();
    serve({ [ST.A.id]: [arr(R1.id, 1, [[60, "P1"]])] });
    // 하차 정류장 C 는 40초 전에 받아 둔 값: 그때 P1 이 1140초 뒤 도착 → 지금은 1100초
    mockedPeek.mockImplementation((id: string) =>
      id === ST.C.id ? { stationId: id, fetchedAt: Date.now() - 40_000, routes: [arr(R1.id, 3, [[1140, "P1"]])] } : null,
    );
    const [r] = await evaluate(db, [direct(R1)], { reuseAlightMs: 180_000 });
    expect(mockedFetch.mock.calls.map((c) => c[0])).toEqual([ST.A.id]);
    expect(mockedPeek).toHaveBeenCalledWith(ST.C.id, 180_000);
    expect(r.legs[0]).toMatchObject({ boardSec: 60, alightSec: 1100, rideEstimated: false });
    mockedPeek.mockReset();
    mockedPeek.mockReturnValue(null);
  });

  it("자동 갱신이라도 받아 둔 하차 정류장 값이 없으면(또는 오래됐으면) 새로 부른다", async () => {
    const { db, R1 } = standardDb();
    serve({});
    await evaluate(db, [direct(R1)], { reuseAlightMs: 180_000 });
    expect(mockedFetch.mock.calls.map((c) => c[0]).sort()).toEqual([ST.A.id, ST.C.id].sort());
  });

  it("환승: 환승 도보 후 탈 수 있는 첫 버스, 대기 시간 계산", async () => {
    const { db, R2, R3 } = standardDb();
    serve({
      [ST.A.id]: [arr(R2.id, 1, [[100, "P1"]])],
      [ST.T1.id]: [arr(R2.id, 2, [[400, "P1"]])],
      [ST.T2.id]: [arr(R3.id, 1, [[450, "Q1"], [900, "Q2"]])],
    });
    const plan: RoutePlan = {
      legs: [{ route: R2, fromIndex: 0, toIndex: 1 }, { route: R3, fromIndex: 0, toIndex: 1 }],
      walkStartSec: 0,
      walkTransferSec: 60,
      walkEndSec: 0,
    };
    const [r] = await evaluate(db, [plan]);
    expect(r.legs[0]).toMatchObject({ boardSec: 100, alightSec: 400, rideEstimated: false });
    // 400 + 60 = 460 에 도착 → 450 버스는 놓치고 900 버스
    expect(r.legs[1]).toMatchObject({ boardSec: 900, waitSec: 440, boardEstimated: false, rideEstimated: true });
    expect(r.arriveSec).toBe(900 + estimateRide(db, R3, 0, 1));
  });

  it("결과는 compareOptions 순서(도착 빠른 순)로 정렬된다", async () => {
    const { db, R1, R2 } = standardDb();
    serve({
      [ST.A.id]: [arr(R1.id, 1, [[900, "P1"]]), arr(R2.id, 1, [[100, "Q1"]])],
    });
    const slow = direct(R1);
    const fast: RoutePlan = { legs: [{ route: R2, fromIndex: 0, toIndex: 1 }], walkStartSec: 0, walkTransferSec: 0, walkEndSec: 0 };
    const res = await evaluate(db, [slow, fast]);
    expect(res.map((r) => r.plan)).toEqual([fast, slow]);
  });

  it("빈 plans → 빈 결과, 조회 없음", async () => {
    const { db } = standardDb();
    serve({});
    expect(await evaluate(db, [])).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- compareOptions

describe("compareOptions (ADR-009)", () => {
  const opt = (arrive: number | null, legs = 1, walk = 0, note?: string) => {
    const r = makeResult({
      legs: Array.from({ length: legs }, () => ({ board: 0, alight: 10 })),
      arriveSec: arrive,
      plan: { walkStartSec: walk },
    });
    return note ? { ...r, note } : r;
  };

  it("도착이 빠른 순", () => {
    expect([opt(900), opt(600)].sort(compareOptions).map((r) => r.arriveSec)).toEqual([600, 900]);
  });

  it("도착이 같으면 환승이 적은 순", () => {
    const sorted = [opt(600, 2), opt(600, 1)].sort(compareOptions);
    expect(sorted.map((r) => r.legs.length)).toEqual([1, 2]);
  });

  it("환승 횟수도 같으면 걷는 시간이 짧은 순", () => {
    const sorted = [opt(600, 1, 300), opt(600, 1, 60)].sort(compareOptions);
    expect(sorted.map((r) => r.plan.walkStartSec)).toEqual([60, 300]);
  });

  it("환승 경로가 더 빠르면 직행보다 위", () => {
    const sorted = [opt(900, 1), opt(700, 2)].sort(compareOptions);
    expect(sorted[0].legs.length).toBe(2);
  });

  it("첫 버스 실시간 정보가 없는(note) 경로는 더 빨라도 뒤로", () => {
    const sorted = [opt(300, 1, 0, "첫 버스 실시간 정보 없음"), opt(900)].sort(compareOptions);
    expect(sorted.map((r) => r.arriveSec)).toEqual([900, 300]);
  });

  it("arriveSec null 은 맨 뒤", () => {
    const sorted = [opt(null), opt(5000)].sort(compareOptions);
    expect(sorted.map((r) => r.arriveSec)).toEqual([5000, null]);
  });
});
