import { describe, expect, it } from "vitest";
import { metersPerPixel, offsetRight } from "../lib/offset";

const M_PER_DEG = 111_319.49; // 위도 1도 ≈ m

describe("offsetRight (ADR-037)", () => {
  it("북쪽으로 가면 동쪽(오른쪽)으로 옮긴다", () => {
    const out = offsetRight([[37.4, 127.1], [37.401, 127.1]], 5);
    for (const [, ln] of out) expect(ln).toBeGreaterThan(127.1);
    const eastM = (out[0][1] - 127.1) * M_PER_DEG * Math.cos((37.4 * Math.PI) / 180);
    expect(eastM).toBeCloseTo(5, 1);
  });

  it("동쪽으로 가면 남쪽(오른쪽)으로 옮긴다", () => {
    const out = offsetRight([[37.4, 127.1], [37.4, 127.101]], 5);
    expect(out[0][0]).toBeLessThan(37.4);
    expect((37.4 - out[0][0]) * M_PER_DEG).toBeCloseTo(5, 1);
  });

  it("같은 길을 되돌아오면 가는 선과 오는 선이 서로 반대편에 놓인다", () => {
    const go = offsetRight([[37.4, 127.1], [37.401, 127.1]], 4);
    const back = offsetRight([[37.401, 127.1], [37.4, 127.1]], 4);
    expect(go[0][1]).toBeGreaterThan(127.1);
    expect(back[0][1]).toBeLessThan(127.1);
  });

  it("직각으로 꺾이는 곳은 두 선에서 모두 같은 거리만큼 떨어진다", () => {
    // 북쪽으로 갔다가 동쪽으로 → 꺾이는 점은 남동쪽으로 √2 배
    const out = offsetRight([[37.4, 127.1], [37.401, 127.1], [37.401, 127.101]], 4);
    const c = out[1];
    const kx = M_PER_DEG * Math.cos((37.4 * Math.PI) / 180);
    expect((c[1] - 127.1) * kx).toBeCloseTo(4, 0);
    expect((37.401 - c[0]) * M_PER_DEG).toBeCloseTo(4, 0);
  });

  it("점이 하나뿐이거나 0m 면 그대로", () => {
    const one: [number, number][] = [[37.4, 127.1]];
    expect(offsetRight(one, 4)).toBe(one);
    const two: [number, number][] = [[37.4, 127.1], [37.401, 127.1]];
    expect(offsetRight(two, 0)).toBe(two);
  });

  it("줌이 1 오르면 1px 의 거리는 절반", () => {
    expect(metersPerPixel(37.4, 16) / metersPerPixel(37.4, 17)).toBeCloseTo(2, 6);
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543, -1);
  });
});
