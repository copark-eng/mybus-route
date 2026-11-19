import { describe, expect, it } from "vitest";
import { config } from "../lib/config";
import { sameWeatherGrid, toGrid } from "../lib/weather";

describe("toGrid (웹 복사본, worker 와 같은 식)", () => {
  it("서울시청 → (60, 127) 기상청 기준값", () => {
    expect(toGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("기본 위치 성남시청은 성남 격자(62~63, 123~124)에 들어간다", () => {
    const { nx, ny } = toGrid(config.weatherDefault.lat, config.weatherDefault.lng);
    expect(nx).toBeGreaterThanOrEqual(62);
    expect(nx).toBeLessThanOrEqual(63);
    expect(ny).toBeGreaterThanOrEqual(123);
    expect(ny).toBeLessThanOrEqual(124);
  });
});

describe("sameWeatherGrid", () => {
  it("가까운 두 정류장(약 200m)은 같은 격자", () => {
    expect(sameWeatherGrid({ lat: 37.3947, lng: 127.1112 }, { lat: 37.3955, lng: 127.1104 })).toBe(true);
  });

  it("성남과 수원(약 20km)은 다른 격자", () => {
    expect(sameWeatherGrid({ lat: 37.42, lng: 127.1267 }, { lat: 37.2636, lng: 127.0286 })).toBe(false);
  });
});
