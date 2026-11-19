import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeather } from "../lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("날씨 요청에 좌표를 보내지 않는다 (ADR-033)", () => {
  it("위치는 기상청 격자 번호로만 바꿔 보낸다", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ temp: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await fetchWeather(37.3948, 127.1112);
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toMatch(/nx=\d+&ny=\d+/);
    expect(url).not.toMatch(/lat|lng|37\.39|127\.11/);
  });
});
