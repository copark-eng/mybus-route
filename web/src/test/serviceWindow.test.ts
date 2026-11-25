/** 막차가 지난 노선을 "추정"으로 보여 주지 않기 (ADR-045) */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({ fetchArrivals: vi.fn(), peekArrivals: vi.fn(() => null) }));

import { fetchArrivals, type RouteArrival } from "../lib/api";
import { estimateRide, evaluate, minuteIn, serviceWindow, type RoutePlan } from "../lib/router";
import { ST, makeDb, route } from "./fixtures";

const mocked = vi.mocked(fetchArrivals);
/** 정류장 id → 도착정보 (빈 배열이면 "노선은 있으나 예측 없음") */
const serve = (table: Record<string, RouteArrival[]>) =>
  mocked.mockImplementation(async (stationId: string) => ({ stationId, fetchedAt: Date.now(), routes: table[stationId] ?? [] }));
const empty = (routeId: string, staOrder: number): RouteArrival => ({ routeId, routeName: "x", staOrder, arrivals: [] });

// A(0) → B(1) → C(2) 회차 → D(3)  (상행 0~2, 하행 3)
const R = route("200000009", "32", "일반형시내버스", [ST.A, ST.B, ST.C, ST.D], {
  turn: 2, first: "05:50", last: "23:20", downFirst: "06:00", downLast: "23:15", npeek: 15, peek: 10,
});
const db = makeDb([R]);
const plan = (from: number, to: number): RoutePlan => ({ legs: [{ route: R, fromIndex: from, toIndex: to }], walkStartSec: 0, walkTransferSec: 0, walkEndSec: 0 });
const setKst = (h: number, m: number) => vi.setSystemTime(new Date(2026, 10, 26, h, m, 0));

describe("serviceWindow", () => {
  it("상행은 기점 첫차·막차 + 기점부터 걸리는 시간", () => {
    const w = serviceWindow(db, R, 1)!;
    const ride = estimateRide(db, R, 0, 1) / 60;
    expect(w.first).toBeCloseTo(5 * 60 + 50 + ride, 5);
    expect(w.last).toBeCloseTo(23 * 60 + 20 + ride, 5);
  });

  it("회차 뒤(하행)는 종점 첫차·막차 + 회차 정류장부터 걸리는 시간", () => {
    const w = serviceWindow(db, R, 3)!;
    const ride = estimateRide(db, R, 2, 3) / 60;
    expect(w.last).toBeCloseTo(23 * 60 + 15 + ride, 5);
  });

  it("막차가 자정을 넘으면 1440 을 더하고, 시간 정보가 없으면 null", () => {
    const late = route("r", "1", "일반", [ST.A, ST.B], { first: "05:00", last: "00:30" });
    expect(serviceWindow(makeDb([late]), late, 0)!.last).toBe(24 * 60 + 30);
    expect(serviceWindow(db, route("r", "1", "일반", [ST.A, ST.B], { first: "", last: "" }), 0)).toBeNull();
  });

  it("minuteIn: 첫차보다 1시간 넘게 이르면 전날 밤으로 본다", () => {
    const w = { first: 330, last: 1400 };
    expect(minuteIn(w, new Date(2026, 10, 26, 0, 7))).toBe(24 * 60 + 7); // 00:07 → 전날 밤 24:07
    expect(minuteIn(w, new Date(2026, 10, 26, 4, 40))).toBe(280); // 04:40 → 첫차 전
  });
});

describe("evaluate: 실시간 예측이 비었을 때 (ADR-045)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); mocked.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it("자정 넘어 막차가 지났으면 추정하지 않고 결과에서 뺀다 (00:07, 막차 23:20)", async () => {
    setKst(0, 7);
    serve({ [ST.A.id]: [empty(R.id, 1)], [ST.C.id]: [empty(R.id, 3)] });
    expect(await evaluate(db, [plan(0, 2)])).toEqual([]);
  });

  it("막차 직후 10분 안은 아직 올 수 있다고 보고 추정한다", async () => {
    setKst(23, 25);
    serve({ [ST.A.id]: [empty(R.id, 1)] });
    const [r] = await evaluate(db, [plan(0, 2)]);
    expect(r.legs[0].boardEstimated).toBe(true);
  });

  it("하행은 종점 막차 기준: 23:14 는 아직, 23:40 은 종료", async () => {
    setKst(23, 14);
    serve({ [ST.C.id]: [] });
    expect(await evaluate(db, [plan(2, 3)])).toHaveLength(1);
    setKst(23, 40);
    expect(await evaluate(db, [plan(2, 3)])).toEqual([]);
  });

  it("첫차 전이면 배차 절반이 아니라 첫차가 정류장에 오는 시각으로 추정한다 (05:30, 첫차 05:50)", async () => {
    setKst(5, 30);
    serve({ [ST.A.id]: [empty(R.id, 1)] });
    const [r] = await evaluate(db, [plan(0, 2)]);
    expect(r.legs[0].boardSec).toBe(20 * 60);
    expect(r.legs[0].boardEstimated).toBe(true);
  });

  it("낮에는 예측이 비어도 배차 절반으로 추정한다 (기존 동작)", async () => {
    setKst(14, 0);
    serve({ [ST.A.id]: [empty(R.id, 1)] });
    const [r] = await evaluate(db, [plan(0, 2)]);
    expect(r.legs[0].boardSec).toBe(15 * 60 / 2);
  });
});
