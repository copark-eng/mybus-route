import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceKind, locationPermission, PERMISSION_STEPS } from "../hooks/useMyLocation";

afterEach(() => vi.unstubAllGlobals());

describe("deviceKind", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "ios"],
    ["Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36", "android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.9.0", "inapp"],
    ["Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 NAVER(inapp; search; 1000; 12.0.0)", "inapp"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", "desktop"],
  ])("%s → %s", (ua, kind) => {
    expect(deviceKind(ua)).toBe(kind);
  });

  it("기기마다 허용 방법 안내가 있다", () => {
    for (const k of ["ios", "android", "inapp", "desktop"] as const) expect(PERMISSION_STEPS[k].length).toBeGreaterThan(1);
  });
});

describe("locationPermission", () => {
  it("Permissions API 결과를 그대로 돌려준다", async () => {
    vi.stubGlobal("navigator", { permissions: { query: vi.fn(async () => ({ state: "denied" })) } });
    expect(await locationPermission()).toBe("denied");
  });
  it("Permissions API 가 없거나 실패하면 unknown", async () => {
    vi.stubGlobal("navigator", {});
    expect(await locationPermission()).toBe("unknown");
    vi.stubGlobal("navigator", { permissions: { query: vi.fn(async () => { throw new Error("x"); }) } });
    expect(await locationPermission()).toBe("unknown");
  });
});
