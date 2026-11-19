import { describe, expect, it } from "vitest";
import { SpatialGrid, distanceM, walkSeconds } from "../lib/data";
import { ST } from "./fixtures";

describe("distanceM", () => {
  it("같은 좌표는 0m", () => {
    expect(distanceM(37.5665, 126.978, 37.5665, 126.978)).toBe(0);
  });

  it("위도 0.001도 ≈ 111m", () => {
    // Arrange / Act
    const d = distanceM(37.4, 127.1, 37.401, 127.1);
    // Assert
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("대칭이다", () => {
    const a = distanceM(37.4, 127.1, 37.45, 127.14);
    const b = distanceM(37.45, 127.14, 37.4, 127.1);
    expect(a).toBeCloseTo(b, 6);
  });

  it("경도 차는 위도가 높을수록 짧다 (cos 보정)", () => {
    const equator = distanceM(0, 127, 0, 127.01);
    const seongnam = distanceM(37.4, 127, 37.4, 127.01);
    expect(seongnam).toBeLessThan(equator);
    expect(seongnam / equator).toBeCloseTo(Math.cos((37.4 * Math.PI) / 180), 3);
  });
});

describe("walkSeconds (ADR-012: ×1.3 ÷ 1.2m/s, 최소 60초, 15m 미만은 0)", () => {
  it.each([
    [0, 0],
    [14.9, 0],
    [15, 60], // 경계: 15m 부터 도보로 친다, 계산값 16초 → 최소 60초
    [55, 60], // 59.6초 → 60
    [56, 61], // 60.7초 → 61
    [200, 217],
    [500, 542],
  ])("%dm → %d초", (dist, sec) => {
    expect(walkSeconds(dist)).toBe(sec);
  });
});

describe("SpatialGrid", () => {
  const stations = Object.values(ST).filter((s) => s.sel);
  const grid = new SpatialGrid(stations);

  it("near: 반경 안 정류장을 가까운 순으로", () => {
    // Act
    const res = grid.near(ST.A.y, ST.A.x, 200);
    // Assert
    expect(res.map((r) => r.station.id)).toEqual([ST.A.id, ST.A2.id]);
    expect(res[0].dist).toBe(0);
    expect(res[1].dist).toBeGreaterThan(30);
    expect(res[1].dist).toBeLessThan(40);
  });

  it("near: 반경 경계 — 정확히 거리와 같으면 포함, 1m 모자라면 제외", () => {
    const d = distanceM(ST.A.y, ST.A.x, ST.B.y, ST.B.x); // ~1112m
    expect(grid.near(ST.A.y, ST.A.x, d).some((r) => r.station.id === ST.B.id)).toBe(true);
    expect(grid.near(ST.A.y, ST.A.x, d - 1).some((r) => r.station.id === ST.B.id)).toBe(false);
  });

  it("near: 큰 반경(여러 칸)에서도 찾는다", () => {
    const res = grid.near(ST.A.y, ST.A.x, 4000); // T1 은 A 에서 ~3.8km
    expect(res.map((r) => r.station.id)).toContain(ST.T1.id);
    // 정렬 확인
    for (let i = 1; i < res.length; i++) expect(res[i].dist).toBeGreaterThanOrEqual(res[i - 1].dist);
  });

  it("near: 아무것도 없는 곳은 빈 배열", () => {
    expect(grid.near(35.0, 129.0, 500)).toEqual([]);
  });

  it("inBounds: 영역 안만, 경계 포함", () => {
    const res = grid.inBounds(37.4, 127.1, 37.42, 127.1);
    expect(res.map((s) => s.id).sort()).toEqual([ST.A.id, ST.A2.id, ST.B.id, ST.C.id].sort());
  });

  it("inBounds: limit 개수에서 멈춘다", () => {
    expect(grid.inBounds(37.3, 127.0, 37.6, 127.3, 2)).toHaveLength(2);
  });

  it("inBounds: sel 아닌 정류장은 색인에 없다 (생성자에 넣은 것만)", () => {
    expect(grid.inBounds(37.49, 127.19, 37.51, 127.21)).toEqual([]);
  });
});
