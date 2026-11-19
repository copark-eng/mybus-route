import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { clearMemCache } from "../src/http";

const env: Env = { BUS_API_KEY: "TEST%2BKEY", NCP_KEY_ID: "id", NCP_KEY: "secret" };
const ctx = () => ({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as unknown as ExecutionContext;
const call = (path: string, method = "GET") => worker.fetch(new Request(`https://x.test${path}`, { method }), env, ctx());

let upstream: ReturnType<typeof vi.fn>;
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  clearMemCache();
  upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  vi.stubGlobal("caches", { default: { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("공통 라우팅", () => {
  it("GET 외 메서드 → 405 + Allow: GET", async () => {
    const r = await call("/api/arrivals?stationId=206000004", "POST");
    expect(r.status).toBe(405);
    expect(r.headers.get("Allow")).toBe("GET");
    expect(await r.json()).toEqual({ error: "method not allowed" });
  });

  it("모르는 경로 → 404 {error}", async () => {
    const r = await call("/api/nope");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
  });

  it("상위 호출 예외 → 502 {error}", async () => {
    upstream.mockRejectedValue(new TypeError("network down"));
    const r = await call("/api/geocode?query=판교역로");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("network down");
  });
});

describe("/api/arrivals", () => {
  it.each(["", "abc", "12345", "1234567890123", "206000004;drop"])("stationId=%s → 400, 상위 호출 없음", async (id) => {
    const r = await call(`/api/arrivals?stationId=${encodeURIComponent(id)}`);
    expect(r.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("정상: 1건 객체도 배열로, predictTimeSec 우선·없으면 분×60, 키는 디코딩해서 전달", async () => {
    upstream.mockResolvedValue(
      ok({
        response: {
          msgHeader: { resultCode: 0 },
          msgBody: {
            busArrivalList: {
              routeId: 241224001, routeName: 2, staOrder: "15",
              predictTimeSec1: 240, predictTime1: 4, locationNo1: 2, plateNo1: "경기70바1234",
              predictTime2: 16, locationNo2: 8, plateNo2: "",
            },
          },
        },
      }),
    );
    const r = await call("/api/arrivals?stationId=206000004");
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=20");
    expect(await r.json()).toEqual([
      {
        routeId: "241224001",
        routeName: "2",
        staOrder: 15,
        arrivals: [
          { seconds: 240, stopsLeft: 2, plateNo: "경기70바1234" },
          { seconds: 960, stopsLeft: 8, plateNo: null },
        ],
      },
    ]);
    const u = new URL(String(upstream.mock.calls[0][0]));
    expect(u.searchParams.get("serviceKey")).toBe("TEST+KEY");
    expect(u.searchParams.get("stationId")).toBe("206000004");
  });

  it("20초 캐시: 같은 정류장 두 번째 요청은 상위 호출 없음", async () => {
    upstream.mockImplementation(async () => ok({ response: { msgHeader: { resultCode: 4 } } }));
    expect(await (await call("/api/arrivals?stationId=206000004")).json()).toEqual([]);
    expect(await (await call("/api/arrivals?stationId=206000004")).json()).toEqual([]);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("resultCode 0·4 외 → 502, 오류는 캐시하지 않는다", async () => {
    upstream.mockImplementation(async () => ok({ response: { msgHeader: { resultCode: 30, resultMessage: "SERVICE_KEY_IS_NOT_REGISTERED" } } }));
    const r = await call("/api/arrivals?stationId=206000004");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("data.go.kr 30: SERVICE_KEY_IS_NOT_REGISTERED");
    await call("/api/arrivals?stationId=206000004");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("HTTP 오류 → 502 data.go.kr <상태>", async () => {
    upstream.mockResolvedValue(new Response("x", { status: 500 }));
    const r = await call("/api/arrivals?stationId=206000004");
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "data.go.kr 500" });
  });

  it("429 이면 다시 시도한다", async () => {
    upstream
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(ok({ response: { msgHeader: { resultCode: 0 }, msgBody: { busArrivalList: [] } } }));
    const r = await call("/api/arrivals?stationId=206000005");
    expect(r.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe("/api/geocode, /api/reverse-geocode 입력 검증", () => {
  it.each(["", "a", "  a  "])("query=%j → 400", async (q) => {
    const r = await call(`/api/geocode?query=${encodeURIComponent(q)}`);
    expect(r.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("query 100자 초과 → 400, 100자는 통과", async () => {
    expect((await call(`/api/geocode?query=${"가".repeat(101)}`)).status).toBe(400);
    upstream.mockResolvedValue(ok({ addresses: [] }));
    expect((await call(`/api/geocode?query=${"가".repeat(100)}`)).status).toBe(200);
  });

  it("geocode 결과를 계약 형식으로 바꾸고 NCP 키는 헤더로만 보낸다", async () => {
    upstream.mockResolvedValue(ok({ addresses: [{ roadAddress: "경기도 성남시 분당구 판교역로 166", jibunAddress: "", x: "127.1", y: "37.39" }] }));
    const r = await call("/api/geocode?query=판교역로 166");
    expect(await r.json()).toEqual([{ roadAddress: "경기도 성남시 분당구 판교역로 166", jibunAddress: null, lng: 127.1, lat: 37.39 }]);
    const [url, init] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).not.toContain("secret");
    expect((init.headers as Record<string, string>)["x-ncp-apigw-api-key"]).toBe("secret");
  });

  it("geocode 상위 오류 → 502 + detail(앞 300자)", async () => {
    upstream.mockResolvedValue(new Response("x".repeat(500), { status: 401 }));
    const r = await call("/api/geocode?query=판교역로");
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.error).toBe("geocode 401");
    expect(body.detail).toHaveLength(300);
  });

  it.each(["", "?lng=&lat=", "?lng=127.1", "?lng=abc&lat=37.3", "?lng=127.1&lat=Infinity"])("reverse-geocode%s → 400", async (qs) => {
    const r = await call(`/api/reverse-geocode${qs}`);
    expect(r.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("reverse-geocode 정상 → NCP 응답 원본", async () => {
    upstream.mockResolvedValue(ok({ results: [{ name: "addr" }] }));
    const r = await call("/api/reverse-geocode?lng=127.1&lat=37.39");
    expect(await r.json()).toEqual({ results: [{ name: "addr" }] });
    expect(new URL(String(upstream.mock.calls[0][0])).searchParams.get("coords")).toBe("127.1,37.39");
  });
});

describe("/api/weather", () => {
  it.each(["?lat=abc", "?lng=x", "?lat=NaN&lng=127"])("숫자가 아님 %s → 400", async (qs) => {
    const r = await call(`/api/weather${qs}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "lat, lng 가 필요합니다" });
  });

  it.each(["?lat=50&lng=127", "?lat=37&lng=140", "?lat=32.9&lng=127"])("범위 밖 %s → 400", async (qs) => {
    const r = await call(`/api/weather${qs}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "lat, lng 범위를 벗어났습니다" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("빈 lat=&lng= 는 기본 좌표(성남시청, 62·124)", async () => {
    upstream.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await call("/api/weather?lat=&lng=");
    const u = new URL(String(upstream.mock.calls[0][0]));
    expect([u.searchParams.get("nx"), u.searchParams.get("ny")]).toEqual(["62", "124"]);
  });

  it("기상청 오류(미신청 401) → 502, 키는 본문에 없음, 60초 실패 캐시", async () => {
    upstream.mockImplementation(async () => new Response("Unauthorized", { status: 401 }));
    const r = await call("/api/weather");
    expect(r.status).toBe(502);
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=60");
    const text = await r.text();
    expect(text).toContain("401");
    expect(text).not.toMatch(/TEST/);
    const calls = upstream.mock.calls.length;
    const r2 = await call("/api/weather");
    expect(r2.status).toBe(502);
    expect(upstream.mock.calls.length).toBe(calls); // 캐시 적중
  });

  it("정상: 요약 200 + 10분 캐시, 같은 격자 재요청은 상위 호출 없음", async () => {
    const header = { resultCode: "00", resultMsg: "NORMAL_SERVICE" };
    upstream.mockImplementation(async (u: URL) => {
      const op = String(u).includes("getUltraSrtNcst") ? "ncst" : "fcst";
      const item = op === "ncst"
        ? [{ category: "T1H", obsrValue: "6.2" }, { category: "WSD", obsrValue: "1" }, { category: "PTY", obsrValue: "0" }]
        : [{ fcstDate: "29991231", fcstTime: "2300", category: "SKY", fcstValue: "1" }];
      return ok({ response: { header, body: { items: { item } } } });
    });
    const r = await call("/api/weather?lat=37.3826&lng=127.1189");
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=600");
    const body = await r.json();
    expect(body).toMatchObject({ temp: 6.2, feels: 6.2, sky: "맑음", precip: "없음", rainFrom: null, maxPop: 0, nx: 62, ny: 123 });
    expect(upstream).toHaveBeenCalledTimes(2);
    await call("/api/weather?lat=37.383&lng=127.119"); // 같은 격자
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("resultCode ≠ 00 → 502", async () => {
    upstream.mockImplementation(async () => ok({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } }));
    const r = await call("/api/weather?lat=37.45&lng=127.14");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("03: NO_DATA");
  });

  it("기상청이 JSON 대신 XML 을 주면 502", async () => {
    upstream.mockImplementation(async () => new Response("<OpenAPI_ServiceResponse/>", { status: 200 }));
    const r = await call("/api/weather?lat=37.30&lng=127.0");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/SyntaxError/);
  });
});

describe("/api/arrivals 일일 한도", () => {
  const limitBody = '{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR","returnReasonCode":"22"}}}';

  it("일일 한도면 재시도 없이 429 + DAILY_LIMIT, 이후 요청은 data.go.kr 을 부르지 않는다", async () => {
    upstream.mockImplementation(async () => new Response(limitBody, { status: 429 }));
    const r1 = await call("/api/arrivals?stationId=206000004");
    expect(r1.status).toBe(429);
    expect((await r1.json()).code).toBe("DAILY_LIMIT");
    expect(upstream).toHaveBeenCalledTimes(1);
    const r2 = await call("/api/arrivals?stationId=206000080"); // 다른 정류장도
    expect(r2.status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("초당 제한(PER_SECOND)은 일일 한도로 보지 않고 재시도한다", async () => {
    const perSec = '{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR"}}}';
    upstream
      .mockResolvedValueOnce(new Response(perSec, { status: 429 }))
      .mockResolvedValueOnce(ok({ response: { msgHeader: { resultCode: 4 }, msgBody: null } }));
    const r = await call("/api/arrivals?stationId=206000004");
    expect(r.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
