import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDb } from "../lib/data";
import { busPoint, decodeShape, routeSegment, straightSegment } from "../lib/shapes";
import { simplify, snapStops } from "../../../scripts/build-shapes";

// 정류장 3곳(A·B·C)을 지나는 노선 하나
const stations = {
  v: 2,
  rows: [
    ["1", "00001", "A", 127.0, 37.0, 1],
    ["2", "00002", "B", 127.01, 37.0, 1],
    ["3", "00003", "C", 127.02, 37.0, 1],
  ],
};
const routes = { v: 2, rows: [["R1", "10", "일반형시내버스", 10, 15, "05:00", "23:00", 2, [0, 1, 2]]] };
const db = buildDb(stations, routes);
const route = db.routes.get("R1")!;

// 도로 형상: A → (위로 굽음) → B → C, 1e5 정수 차이 인코딩
const pts: [number, number][] = [[37.0, 127.0], [37.002, 127.005], [37.0, 127.01], [37.0, 127.015], [37.0, 127.02]];
const encode = (p: [number, number][]) => {
  const out: number[] = [];
  let py = 0, px = 0;
  p.forEach(([y, x], i) => {
    const iy = Math.round(y * 1e5), ix = Math.round(x * 1e5);
    out.push(i ? iy - py : iy, i ? ix - px : ix);
    py = iy; px = ix;
  });
  return out;
};

afterEach(() => vi.unstubAllGlobals());

describe("decodeShape", () => {
  it("1e5 정수 차이 인코딩을 좌표로 되돌린다", () => {
    const s = decodeShape({ p: encode(pts), s: [0, 2, 4] });
    expect(s.pts).toHaveLength(5);
    expect(s.pts[1][0]).toBeCloseTo(37.002, 5);
    expect(s.pts[4][1]).toBeCloseTo(127.02, 5);
  });
});

describe("routeSegment", () => {
  it("형상이 있으면 도로를 따라 굽은 점을 포함한다 (A→B 사이 37.002)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ v: 1, p: encode(pts), s: [0, 2, 4] }))));
    const seg = await routeSegment(db, route, 0, 1);
    expect(seg.some(([y]) => Math.abs(y - 37.002) < 1e-6)).toBe(true);
    expect(seg[0]).toEqual([37.0, 127.0]); // 양 끝은 정류장
    expect(seg[seg.length - 1]).toEqual([37.0, 127.01]);
  });

  it("형상 파일이 없으면 정류장 직선으로 대신한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const r2 = { ...route, id: "R-missing" };
    expect(await routeSegment(db, r2, 0, 2)).toEqual(straightSegment(db, r2, 0, 2));
  });
});

describe("busPoint", () => {
  const shape = decodeShape({ p: encode(pts), s: [0, 2, 4] });
  it("정류장 도착(1)이면 정류장 좌표", () => {
    expect(busPoint(db, route, shape, 0, 1)).toEqual([37.0, 127.0]);
  });
  it("교차로 통과(0)면 다음 정류장 사이 도로 위", () => {
    expect(busPoint(db, route, shape, 0, 0)).toEqual(shape.pts[1]);
  });
  it("형상이 없으면 두 정류장 직선의 중간", () => {
    const p = busPoint(db, route, null, 0, 0)!;
    expect(p[1]).toBeCloseTo(127.005, 6);
  });
});

describe("build-shapes: simplify / snapStops", () => {
  it("직선 위의 점은 빼고 굽은 점은 남긴다", () => {
    const line: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 3], [0, 4]];
    expect(simplify(line, 0.01)).toEqual([0, 2, 3, 4]);
  });
  it("정류장은 앞으로만 붙어 순서가 거꾸로 되지 않는다 (왕복 노선)", () => {
    // 갔다가 같은 길로 돌아오는 형상: 0..4 가고 5..8 돌아옴
    const shape: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]];
    const stops: [number, number][] = [[0, 0], [0, 2], [0, 4], [0, 2], [0, 0]];
    const s = snapStops(shape, stops);
    expect(s).toEqual([0, 2, 4, 6, 8]);
  });
});
