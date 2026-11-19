import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheGet, cachePut, clearMemCache, json } from "../src/http";

const ctx = () => ({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as unknown as ExecutionContext;

let edge: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
beforeEach(() => {
  clearMemCache();
  edge = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
  vi.stubGlobal("caches", { default: edge });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("json", () => {
  it("JSON 본문 + 기본 헤더(nosniff), 추가 헤더 병합", async () => {
    const r = json({ a: 1 }, 418, { "Cache-Control": "no-store" });
    expect(r.status).toBe(418);
    expect(r.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.json()).toEqual({ a: 1 });
  });
});

describe("cachePut / cacheGet (메모리 → caches.default)", () => {
  it("저장한 응답을 상태·본문·헤더 그대로 돌려준다", async () => {
    const res = json({ ok: true }, 502, { "Cache-Control": "public, max-age=60" });
    await cachePut("k", res, 60, ctx());
    const hit = await cacheGet("k");
    expect(hit?.status).toBe(502);
    expect(hit?.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await hit?.json()).toEqual({ ok: true });
    expect(edge.match).not.toHaveBeenCalled(); // 메모리에서 끝남
  });

  it("원래 응답 본문은 소비하지 않는다", async () => {
    const res = json([1, 2]);
    await cachePut("k", res, 20, ctx());
    expect(await res.json()).toEqual([1, 2]);
  });

  it("caches.default 에 max-age=ttl 로 저장(waitUntil)", async () => {
    const c = ctx();
    await cachePut("arrivals/1", json([]), 20, c);
    expect(c.waitUntil).toHaveBeenCalledTimes(1);
    const [req, stored] = edge.put.mock.calls[0] as [Request, Response];
    expect(req.url).toBe("https://cache.mybus-route/arrivals/1");
    expect(stored.headers.get("Cache-Control")).toBe("public, max-age=20");
  });

  it("TTL 경계: 만료 1ms 전은 적중, 만료 시각부터는 메모리에서 빠진다", async () => {
    await cachePut("k", json(1), 20, ctx());
    vi.setSystemTime(Date.now() + 20_000 - 1);
    expect(await cacheGet("k")).not.toBeNull();
    vi.setSystemTime(Date.now() + 1);
    expect(await cacheGet("k")).toBeNull();
    expect(edge.match).toHaveBeenCalledTimes(1); // 메모리 미스 → 2단 조회
  });

  it("메모리에 없으면 caches.default 결과를 쓴다", async () => {
    edge.match.mockResolvedValueOnce(json({ from: "edge" }));
    const hit = await cacheGet("x");
    expect(await hit?.json()).toEqual({ from: "edge" });
  });

  it("caches.default 가 예외를 던지면 null (상위 API 를 부르게)", async () => {
    edge.match.mockRejectedValueOnce(new Error("boom"));
    expect(await cacheGet("x")).toBeNull();
  });

  it("caches.default.put 실패는 삼킨다", async () => {
    edge.put.mockRejectedValueOnce(new Error("quota"));
    const c = ctx();
    await cachePut("k", json(1), 20, c);
    const p = (c.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0] as Promise<unknown>;
    await expect(p).resolves.toBeUndefined();
  });

  it("최대 300개: 가득 차면 가장 오래된 것부터 지운다", async () => {
    for (let i = 0; i < 300; i++) await cachePut(`k${i}`, json(i), 600, ctx());
    await cachePut("new", json("n"), 600, ctx());
    expect(await cacheGet("k0")).toBeNull();
    expect(await (await cacheGet("k1"))!.json()).toBe(1);
    expect(await (await cacheGet("new"))!.json()).toBe("n");
  });

  it("가득 찼을 때 만료된 항목이 있으면 그것부터 지운다", async () => {
    await cachePut("short", json("s"), 1, ctx()); // 1초 TTL
    for (let i = 0; i < 299; i++) await cachePut(`k${i}`, json(i), 600, ctx());
    vi.setSystemTime(Date.now() + 2_000);
    await cachePut("new", json("n"), 600, ctx());
    expect(await (await cacheGet("k0"))!.json()).toBe(0); // 오래됐지만 살아 있는 항목은 유지
    expect(await cacheGet("new")).not.toBeNull();
  });

  it("같은 키를 다시 넣으면 최신 순서로 옮겨져 먼저 지워지지 않는다", async () => {
    for (let i = 0; i < 300; i++) await cachePut(`k${i}`, json(i), 600, ctx());
    await cachePut("k0", json("again"), 600, ctx()); // 300개 그대로, k0 가 가장 최근
    await cachePut("new", json("n"), 600, ctx()); // k1 이 빠져야 함
    expect(await (await cacheGet("k0"))!.json()).toBe("again");
    expect(await cacheGet("k1")).toBeNull();
  });
});
