import { describe, expect, it } from "vitest";
import type { BusLocation } from "../lib/api";
import { BUS_SPEED_MPS, pointAlong, progressOf, segmentLength, updateTracks } from "../lib/busProgress";
import { buildDb } from "../lib/data";

const bus = (plateNo: string, stationSeq: number, stateCd: number): BusLocation =>
  ({ plateNo, stationSeq, stationId: "x", stateCd, lowPlate: 0, crowded: null, remainSeat: null });

describe("updateTracks", () => {
  it("같은 정류장·같은 상태면 처음 본 시각을 유지하고, 바뀌면 새로 기록한다", () => {
    let t = updateTracks(new Map(), [bus("A", 5, 2)], 1000);
    expect(t.get("A")).toEqual({ seq: 5, state: 2, since: 1000 });
    t = updateTracks(t, [bus("A", 5, 2)], 11_000);
    expect(t.get("A")!.since).toBe(1000);
    t = updateTracks(t, [bus("A", 6, 1)], 21_000);
    expect(t.get("A")).toEqual({ seq: 6, state: 1, since: 21_000 });
  });

  it("사라진 버스는 지운다", () => {
    const t = updateTracks(updateTracks(new Map(), [bus("A", 1, 1), bus("B", 2, 1)], 0), [bus("B", 2, 1)], 10);
    expect([...t.keys()]).toEqual(["B"]);
  });
});

describe("progressOf", () => {
  it("정류장 도착(1)이면 0", () => {
    expect(progressOf({ seq: 1, state: 1, since: 0 }, 500, 60_000)).toBe(0);
  });
  it("출발(2)은 0.05 에서 시작해 속도 × 시간 ÷ 거리만큼 나아간다", () => {
    expect(progressOf({ seq: 1, state: 2, since: 0 }, 600, 0)).toBeCloseTo(0.05);
    // 600m 구간, 50초 → 300m(6m/s) → 0.05 + 0.5
    expect(progressOf({ seq: 1, state: 2, since: 0 }, 600, 50_000)).toBeCloseTo(0.05 + (50 * BUS_SPEED_MPS) / 600);
  });
  it("교차로 통과(0)는 0.35 에서 시작한다 (구간 중간쯤)", () => {
    expect(progressOf({ seq: 1, state: 0, since: 0 }, 600, 0)).toBeCloseTo(0.35);
  });
  it("도착 신호 전에는 다음 정류장에 붙이지 않는다 (최대 0.92)", () => {
    expect(progressOf({ seq: 1, state: 2, since: 0 }, 100, 600_000)).toBe(0.92);
  });
});

describe("segmentLength / pointAlong (형상 없을 때 직선)", () => {
  const db = buildDb(
    { v: 2, rows: [["1", "1", "A", 127.0, 37.0, 1], ["2", "2", "B", 127.01, 37.0, 1]] },
    { v: 2, rows: [["R", "1", "마을버스", 5, 10, "", "", 1, [0, 1]]] },
  );
  const r = db.routes.get("R")!;
  it("두 정류장 직선 거리 (위도 37도에서 경도 0.01도 ≈ 888m)", () => {
    expect(segmentLength(db, r, null, 0)).toBeGreaterThan(870);
    expect(segmentLength(db, r, null, 0)).toBeLessThan(900);
  });
  it("진행률 0.5 면 두 정류장 가운데", () => {
    const p = pointAlong(db, r, null, 0, 0.5)!;
    expect(p[1]).toBeCloseTo(127.005, 6);
  });
});
