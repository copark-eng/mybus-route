import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { clearMemCache } from "../src/http";

const env: Env = { BUS_API_KEY: "TEST%2BKEY", NCP_KEY_ID: "id", NCP_KEY: "secret" };
const ctx = () => ({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as unknown as ExecutionContext;
const call = (path: string) => worker.fetch(new Request(`https://x.test${path}`), env, ctx());
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearMemCache();
  upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  vi.stubGlobal("caches", { default: { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } });
});
afterEach(() => vi.unstubAllGlobals());

const sample = {
  response: {
    msgHeader: { resultCode: 0 },
    msgBody: {
      busLocationList: [
        { plateNo: "경기70아8067", stationSeq: 40, stationId: 206000080, stateCd: 1, lowPlate: 1, crowded: 2, remainSeatCnt: -1 },
        { plateNo: "경기70아7084", stationSeq: 5, stationId: 206000222, stateCd: 2, lowPlate: 0, crowded: "", remainSeatCnt: 12 },
      ],
    },
  },
};

describe("/api/bus-locations", () => {
  it.each(["", "abc", "12345", "241222005;x"])("routeId=%s → 400, 상위 호출 없음", async (id) => {
    const r = await call(`/api/bus-locations?routeId=${encodeURIComponent(id)}`);
    expect(r.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("정상: stationSeq 순으로 정렬하고 필드를 정리한다 (빈자리 -1 → null, 빈 혼잡도 → null)", async () => {
    upstream.mockResolvedValue(ok(sample));
    const r = await call("/api/bus-locations?routeId=241222005");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.map((b: { stationSeq: number }) => b.stationSeq)).toEqual([5, 40]);
    expect(body[0]).toEqual({ plateNo: "경기70아7084", stationSeq: 5, stationId: "206000222", stateCd: 2, lowPlate: 0, crowded: null, remainSeat: 12 });
    expect(body[1].remainSeat).toBeNull();
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=8");
    const u = new URL(String(upstream.mock.calls[0][0]));
    expect(u.searchParams.get("routeId")).toBe("241222005");
    expect(u.searchParams.get("serviceKey")).toBe("TEST+KEY"); // Encoding 키 디코딩
  });

  it("버스 1대일 때 객체로 와도 배열로 돌려준다", async () => {
    upstream.mockResolvedValue(ok({ response: { msgHeader: { resultCode: 0 }, msgBody: { busLocationList: sample.response.msgBody.busLocationList[0] } } }));
    const body = await (await call("/api/bus-locations?routeId=241222005")).json();
    expect(body).toHaveLength(1);
  });

  it("운행 중인 버스가 없으면(resultCode 4) 빈 배열", async () => {
    upstream.mockResolvedValue(ok({ response: { msgHeader: { resultCode: 4 }, msgBody: null } }));
    expect(await (await call("/api/bus-locations?routeId=241222005")).json()).toEqual([]);
  });

  it("8초 캐시: 두 번째 요청은 상위를 다시 부르지 않는다", async () => {
    upstream.mockImplementation(async () => ok(sample));
    await call("/api/bus-locations?routeId=241222005");
    await call("/api/bus-locations?routeId=241222005");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("활용신청 전(등록되지 않은 키) → 502 + 안내 문구", async () => {
    upstream.mockResolvedValue(new Response('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}}', { status: 403 }));
    const r = await call("/api/bus-locations?routeId=241222005");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("활용신청");
  });

  it("상위 응답이 늦으면(타임아웃) 504", async () => {
    upstream.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const r = await call("/api/bus-locations?routeId=241222005");
    expect(r.status).toBe(504);
  });
});
