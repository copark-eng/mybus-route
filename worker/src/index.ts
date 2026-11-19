/**
 * mybus-route Worker (ADR-004, ADR-020)
 * 정적 파일(web/dist)은 Workers Static Assets 가 응답하고, /api/* 만 이 코드가 처리한다.
 *
 *   GET /api/arrivals?stationId=206000004      경기도 버스도착정보 (20초 캐시, ADR-015)
 *   GET /api/geocode?query=성남시 분당구 ...      NCP Geocoding (ADR-013, ADR-019)
 *   GET /api/reverse-geocode?lng=127.1&lat=37.3  NCP Reverse Geocoding
 *   GET /api/weather?lat=37.38&lng=127.12        기상청 단기예보 요약 (10분 캐시, 실패 60초, ADR-024)
 *   GET /api/bus-locations?routeId=241222005     노선의 운행 중 버스 위치 (15초 캐시, ADR-028)
 *
 * 성공 응답은 데이터 그대로, 오류는 {error, detail?} (02_api_spec.md). 캐시는 http.ts 참고.
 */
import { weather } from "./weather";
import { busLocations } from "./busLocations";
import { cacheGet, cachePut, json } from "./http";

export interface Env {
  BUS_API_KEY: string;
  NCP_KEY_ID: string;
  NCP_KEY: string;
}

const UPSTREAM_TIMEOUT_MS = 6_000;
const ARRIVAL_URL ="https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2";
const GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
const REVERSE_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const ARRIVAL_TTL_SEC = 20;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405, { Allow: "GET" });
    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case "/api/arrivals":
          return await arrivals(url, env, ctx);
        case "/api/geocode":
          return await geocode(url, env);
        case "/api/reverse-geocode":
          return await reverseGeocode(url, env);
        case "/api/weather":
          return await weather(url, env.BUS_API_KEY, ctx);
        case "/api/bus-locations":
          return await busLocations(url, env.BUS_API_KEY, ctx);
        default:
          return json({ error: "not found" }, 404);
      }
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
};

// ---------- 경기도 버스도착정보 ----------

interface RouteArrival {
  routeId: string;
  routeName: string;
  /** 이 정류장이 노선에서 몇 번째인지 (1부터). 같은 정류장을 왕복으로 두 번 지나는 노선을 구분할 때 쓴다. */
  staOrder: number | null;
  arrivals: { seconds: number; stopsLeft: number | null; plateNo: string | null }[];
}

async function arrivals(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const stationId = url.searchParams.get("stationId") ?? "";
  if (!/^\d{6,12}$/.test(stationId)) return json({ error: "stationId 가 올바르지 않습니다" }, 400);

  // 공유 캐시: 같은 정류장은 20초 동안 data.go.kr 을 다시 부르지 않는다 (메모리 → caches.default).
  const cacheKey = `arrivals/${stationId}`;
  const hit = await cacheGet(cacheKey);
  if (hit) return hit;

  const upstream = new URL(ARRIVAL_URL);
  // Encoding 키를 넣어도 이중 인코딩되지 않도록 먼저 디코딩한다 (텔레그램 봇에서 겪은 403).
  upstream.searchParams.set("serviceKey", decodeURIComponent(env.BUS_API_KEY.trim()));
  upstream.searchParams.set("stationId", stationId);
  upstream.searchParams.set("format", "json");

  // data.go.kr 초당 호출 제한(429)에 걸리면 잠시 뒤 다시 시도한다.
  // 가끔 한 정류장 응답이 20초 가까이 걸리므로 6초에서 끊는다 (화면은 그 구간을 추정으로 계속).
  const call = () => fetch(upstream, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  let res: Response;
  try {
    res = await call();
    for (let attempt = 1; res.status === 429 && attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, 300 * attempt));
      res = await call();
    }
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return json({ error: "data.go.kr 응답 지연" }, 504);
    }
    throw e;
  }
  if (!res.ok) return json({ error: `data.go.kr ${res.status}` }, 502);
  const body = (await res.json()) as any;
  const header = body?.response?.msgHeader ?? {};
  const code = Number(header.resultCode ?? 0);
  if (code !== 0 && code !== 4) return json({ error: `data.go.kr ${code}: ${header.resultMessage}` }, 502);

  const items = toList(body?.response?.msgBody?.busArrivalList);
  const data: RouteArrival[] = items.map((it) => ({
    routeId: String(it.routeId),
    routeName: String(it.routeName ?? ""),
    staOrder: toInt(it.staOrder),
    arrivals: [1, 2].flatMap((n) => {
      const sec = toInt(it[`predictTimeSec${n}`]) ?? mul60(toInt(it[`predictTime${n}`]));
      if (sec === null) return [];
      return [{ seconds: sec, stopsLeft: toInt(it[`locationNo${n}`]), plateNo: str(it[`plateNo${n}`]) }];
    }),
  }));

  const out = json(data, 200, { "Cache-Control": `public, max-age=${ARRIVAL_TTL_SEC}` });
  await cachePut(cacheKey, out, ARRIVAL_TTL_SEC, ctx);
  return out;
}

// ---------- NCP Geocoding ----------

function ncpHeaders(env: Env): HeadersInit {
  return { "x-ncp-apigw-api-key-id": env.NCP_KEY_ID, "x-ncp-apigw-api-key": env.NCP_KEY };
}

async function geocode(url: URL, env: Env): Promise<Response> {
  const query = (url.searchParams.get("query") ?? "").trim();
  if (query.length < 2) return json({ error: "query 는 2글자 이상" }, 400);
  if (query.length > 100) return json({ error: "query 는 100글자 이하" }, 400);
  const upstream = new URL(GEOCODE_URL);
  upstream.searchParams.set("query", query);
  const res = await fetch(upstream, { headers: ncpHeaders(env) });
  if (!res.ok) return json({ error: `geocode ${res.status}`, detail: await upstreamDetail(res) }, 502);
  const body = (await res.json()) as any;
  return json(
    toList(body?.addresses).map((a) => ({
      roadAddress: str(a.roadAddress),
      jibunAddress: str(a.jibunAddress),
      lng: Number(a.x),
      lat: Number(a.y),
    })),
  );
}

async function reverseGeocode(url: URL, env: Env): Promise<Response> {
  // Number(null) = Number("") = 0 이 통과하지 않도록 빈 값을 먼저 걸러낸다
  const lng = toNum(url.searchParams.get("lng"));
  const lat = toNum(url.searchParams.get("lat"));
  if (lng === null || lat === null) return json({ error: "lng, lat 이 필요합니다" }, 400);
  const upstream = new URL(REVERSE_GEOCODE_URL);
  upstream.searchParams.set("coords", `${lng},${lat}`);
  upstream.searchParams.set("orders", "roadaddr,addr");
  upstream.searchParams.set("output", "json");
  const res = await fetch(upstream, { headers: ncpHeaders(env) });
  if (!res.ok) return json({ error: `reverse-geocode ${res.status}`, detail: await upstreamDetail(res) }, 502);
  return json(await res.json());
}

// ---------- 유틸 ----------

/** 상위 API 오류 응답의 앞부분 (원인 파악용). 키 값은 응답에 포함되지 않는다. */
async function upstreamDetail(res: Response): Promise<string> {
  return (await res.text()).slice(0, 300);
}

/** 빈 값·숫자가 아닌 값은 null, 유한한 숫자만 돌려준다 */
function toNum(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** API 가 결과 1건이면 객체, 여러 건이면 배열로 주는 경우를 통일한다. */
function toList(v: unknown): any[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

function mul60(v: number | null): number | null {
  return v === null ? null : v * 60;
}

function str(v: unknown): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
}
