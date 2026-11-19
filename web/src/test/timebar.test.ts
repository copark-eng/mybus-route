import { describe, expect, it } from "vitest";
import { type Segment, clip, describeSegments, layout, segLabel, toSegments } from "../lib/timebar";
import { makeResult } from "./fixtures";

const sum = (segs: Segment[]) => segs.reduce((a, s) => a + s.durSec, 0);

describe("toSegments", () => {
  it("직행: 도보 → 대기 → 탑승 → 도보, 합계 = arriveSec", () => {
    // Arrange
    const r = makeResult({ plan: { walkStartSec: 120, walkEndSec: 30 }, legs: [{ board: 600, alight: 1100 }] });
    // Act
    const segs = toSegments(r);
    // Assert
    expect(segs.map((s) => [s.kind, s.startSec, s.durSec])).toEqual([
      ["walk", 0, 120],
      ["wait", 120, 480],
      ["ride", 600, 500],
      ["walk", 1100, 30],
    ]);
    expect(sum(segs)).toBe(r.arriveSec);
  });

  it("환승: 환승 도보·환승 대기 구분, 합계 = arriveSec", () => {
    const r = makeResult({
      plan: { walkTransferSec: 60 },
      legs: [{ board: 100, alight: 400 }, { board: 900, alight: 1300 }],
    });
    const segs = toSegments(r);
    expect(segs.map((s) => s.kind)).toEqual(["wait", "ride", "transferWalk", "transferWait", "ride"]);
    expect(segs.map((s) => s.legIndex)).toEqual([0, 0, undefined, 1, 1]);
    expect(sum(segs)).toBe(1300);
    expect(sum(segs)).toBe(r.arriveSec);
  });

  it("길이 0 세그먼트(도보 0, 대기 0)는 버린다", () => {
    const r = makeResult({ legs: [{ board: 0, alight: 500 }] });
    expect(toSegments(r).map((s) => s.kind)).toEqual(["ride"]);
  });

  it("estimated: 대기는 boardEstimated, 탑승은 rideEstimated, 도보는 항상 false", () => {
    const r = makeResult({
      plan: { walkStartSec: 60 },
      legs: [{ board: 300, alight: 900, boardEst: true, rideEst: false }],
    });
    const segs = toSegments(r);
    expect(segs.map((s) => [s.kind, s.estimated])).toEqual([
      ["walk", false],
      ["wait", true],
      ["ride", false],
    ]);
  });

  it("탑승 세그먼트에 노선 이름·종류", () => {
    const r = makeResult({ legs: [{ board: 60, alight: 600 }] });
    const ride = toSegments(r).find((s) => s.kind === "ride")!;
    expect(ride).toMatchObject({ routeName: "10", routeType: "일반형시내버스", legIndex: 0 });
  });

  it("boardSec / arriveSec 가 null 이면 빈 배열(막대 대신 '-')", () => {
    expect(toSegments(makeResult({ legs: [{ board: null, alight: 500 }] }))).toEqual([]);
    expect(toSegments(makeResult({ legs: [{ board: 10, alight: 500 }], arriveSec: null }))).toEqual([]);
  });
});

describe("clip (흐른 시간만큼 앞에서 잘라냄)", () => {
  const segs = toSegments(makeResult({ plan: { walkStartSec: 120, walkEndSec: 30 }, legs: [{ board: 600, alight: 1100 }] }));

  it("elapsed ≤ 0 이면 그대로", () => {
    expect(clip(segs, 0)).toBe(segs);
    expect(clip(segs, -5)).toBe(segs);
  });

  it("앞 세그먼트를 지우고 걸친 세그먼트는 줄인다", () => {
    const out = clip(segs, 300);
    expect(out.map((s) => [s.kind, s.startSec, s.durSec])).toEqual([
      ["wait", 300, 300],
      ["ride", 600, 500],
      ["walk", 1100, 30],
    ]);
    expect(sum(out)).toBe(1130 - 300);
  });

  it("세그먼트 경계에 정확히 걸리면 그 세그먼트는 사라진다", () => {
    expect(clip(segs, 120)[0].kind).toBe("wait");
  });

  it("다 지나면 빈 배열", () => {
    expect(clip(segs, 1130)).toEqual([]);
    expect(clip(segs, 99999)).toEqual([]);
  });

  it("원본을 바꾸지 않는다", () => {
    const before = JSON.stringify(segs);
    clip(segs, 700);
    expect(JSON.stringify(segs)).toBe(before);
  });
});

describe("layout (폭 %)", () => {
  const seg = (durSec: number): Segment => ({ kind: "ride", startSec: 0, durSec, estimated: false });

  it("합은 100", () => {
    const w = layout([seg(120), seg(480), seg(500), seg(30)]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
  });

  it("최소 폭 4% 보장, 늘어난 만큼 큰 세그먼트에서 뺀다", () => {
    const w = layout([seg(10), seg(1000)]);
    expect(w[0]).toBeCloseTo(4, 9);
    expect(w[1]).toBeCloseTo(96, 9);
  });

  it("정확히 4% 인 세그먼트는 그대로", () => {
    const w = layout([seg(4), seg(96)]);
    expect(w[0]).toBeCloseTo(4, 9);
  });

  it("세그먼트가 많으면 최소 폭은 1/n 으로 줄어든다(합 100 유지)", () => {
    const w = layout(Array.from({ length: 30 }, (_, i) => seg(i === 0 ? 10000 : 1)));
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    for (const x of w.slice(1)) expect(x).toBeCloseTo(100 / 30, 9);
  });

  it("같은 길이는 같은 폭", () => {
    for (const x of layout([seg(5), seg(5), seg(5)])) expect(x).toBeCloseTo(100 / 3, 9);
  });

  it("빈 배열·합 0 은 0", () => {
    expect(layout([])).toEqual([]);
    expect(layout([seg(0), seg(0)])).toEqual([0, 0]);
  });

  it("세그먼트 하나는 100%", () => {
    expect(layout([seg(42)])).toEqual([100]);
  });
});

describe("segLabel / describeSegments", () => {
  const s = (kind: Segment["kind"], durSec: number, routeName?: string): Segment => ({ kind, startSec: 0, durSec, estimated: false, routeName });

  it.each([
    [s("walk", 120), "도보 2분"],
    [s("wait", 300), "대기 5분"],
    [s("transferWalk", 60), "환승 1분"],
    [s("transferWait", 90), "대기 2분"],
    [s("ride", 1080, "32"), "32 18분"],
    [s("walk", 20), "도보 1분"], // 1분 미만도 1분
  ])("%o → %s", (seg, label) => {
    expect(segLabel(seg)).toBe(label);
  });

  it("스크린리더 설명 끝에 도착 시각", () => {
    expect(describeSegments([s("walk", 180), s("ride", 600, "10")], "08:42")).toBe("도보 3분, 10 10분, 08:42 도착");
  });
});
