/**
 * mybus-route Worker (ADR-004, ADR-020)
 * 정적 파일(web/dist)은 Workers Static Assets 가 응답하고, /api/* 만 이 코드가 처리한다.
 *
 *   GET /api/arrivals?stationId=206000004      경기도 버스도착정보 (30초 캐시, ADR-015·040)
 *   GET /api/geocode?query=성남시 분당구 ...      카카오 로컬 주소 검색 (ADR-013, ADR-044)
 *   GET /api/reverse-geocode?lng=127.1&lat=37.3  카카오 로컬 좌표→주소 → {address}
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
  /** 카카오 REST API 키 (주소 검색, ADR-044). 서버에서만 쓴다 */
  KAKAO_REST_KEY: string;
}

const UPSTREAM_TIMEOUT_MS = 6_000;

/**
 * data.go.kr 일일 호출 한도 초과 (resultCode 22, LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR).
 * 초당 제한(…_PER_SECOND_EXCEEDS_ERROR)과 구분한다. 한도는 자정에 풀리므로 10분 동안 다시 부르지 않는다.
 */
const DAILY_LIMIT_KEY = "arrivals/__daily_limit__";
const DAILY_LIMIT_TTL_SEC = 600;
export const isDailyLimit = (text: string) =>
  /LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR/.test(text) && !/PER_SECOND/.test(text);
const dailyLimitResponse = () =>
  json({ error: "오늘 실시간 조회 한도를 모두 썼습니다 (data.go.kr 일일 한도). 자정 이후 다시 됩니다.", code: "DAILY_LIMIT" }, 429, {
    "Cache-Control": `public, max-age=${DAILY_LIMIT_TTL_SEC}`,
  });
const ARRIVAL_URL ="https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2";
const GEOCODE_URL = "https://dapi.kakao.com/v2/local/search/address.json";
const REVERSE_GEOCODE_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";
/** 도착정보 공유 캐시 (ADR-040: 20 → 30초). 캐시 나이는 X-Data-Age 로 알려 화면이 남은 시간을 맞춘다 */
const ARRIVAL_TTL_SEC = 30;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405, { Allow: "GET" });
    const url = new URL(req.url);
    const started = Date.now();
    const res = await route(url, env, ctx);
    logUsage(req, url, res, started);
    return res;
  },
};

async function route(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
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
}

/**
 * 사용량 기록 (ADR-032): 어느 화면에서 어떤 API 를 얼마나 부르는지, 캐시로 막았는지.
 * Cloudflare Workers Logs(대시보드 → Workers → mybus-route → Logs)나 `npx wrangler tail` 로 본다.
 * 위치·주소 같은 개인 정보는 남기지 않는다 (정류장·노선 ID 와 화면 이름만).
 */
function logUsage(req: Request, url: URL, res: Response, started: number) {
  const id = url.searchParams.get("stationId") ?? url.searchParams.get("routeId") ?? undefined;
  console.log(JSON.stringify({
    api: url.pathname.replace("/api/", ""),
    id,
    screen: req.headers.get("X-Screen") ?? "unknown",
    status: res.status,
    cache: res.headers.get("X-Cache") ?? "MISS",
    ms: Date.now() - started,
  }));
}

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

  // 일일 한도를 이미 넘겼으면 data.go.kr 을 부르지 않는다 (한도 소진을 더 키우지 않게)
  const limited = await cacheGet(DAILY_LIMIT_KEY);
  if (limited) return limited;

  // 공유 캐시: 같은 정류장은 30초 동안 data.go.kr 을 다시 부르지 않는다 (메모리 → caches.default).
  const cacheKey = `arrivals/${stationId}`;
  const hit = await cacheGet(cacheKey);
  if (hit) return hit;

  const upstream = new URL(ARRIVAL_URL);
  // Encoding 키를 넣어도 이중 인코딩되지 않도록 먼저 디코딩한다 (텔레그램 봇에서 겪은 403).
  upstream.searchParams.set("serviceKey", decodeURIComponent(env.BUS_API_KEY.trim()));
  upstream.searchParams.set("stationId", stationId);
  upstream.searchParams.set("format", "json");

  // data.go.kr 초당 호출 제한(429)에 걸리면 잠시 뒤 다시 시도한다. 일일 한도(429, 코드 22)는 재시도하지 않는다.
  // 가끔 한 정류장 응답이 20초 가까이 걸리므로 6초에서 끊는다 (화면은 그 구간을 추정으로 계속).
  const call = () => fetch(upstream, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  let res: Response;
  let text = "";
  try {
    res = await call();
    text = await res.text();
    for (let attempt = 1; res.status === 429 && !isDailyLimit(text) && attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, 300 * attempt));
      res = await call();
      text = await res.text();
    }
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return json({ error: "data.go.kr 응답 지연" }, 504);
    }
    throw e;
  }
  if (isDailyLimit(text)) {
    const out = dailyLimitResponse();
    await cachePut(DAILY_LIMIT_KEY, out, DAILY_LIMIT_TTL_SEC, ctx);
    return out;
  }
  if (!res.ok) return json({ error: `data.go.kr ${res.status}` }, 502);
  const body = JSON.parse(text) as any;
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

  const out = json(data, 200, { "Cache-Control": `public, max-age=${ARRIVAL_TTL_SEC}`, "X-Fetched-At": String(Date.now()) });
  await cachePut(cacheKey, out, ARRIVAL_TTL_SEC, ctx);
  return out;
}

// ---------- 카카오 로컬 (주소 검색, ADR-044) ----------

function kakaoHeaders(env: Env): HeadersInit {
  return { Authorization: `KakaoAK ${(env.KAKAO_REST_KEY ?? "").trim()}` };
}

async function geocode(url: URL, env: Env): Promise<Response> {
  const query = (url.searchParams.get("query") ?? "").trim();
  if (query.length < 2) return json({ error: "query 는 2글자 이상" }, 400);
  if (query.length > 100) return json({ error: "query 는 100글자 이하" }, 400);
  const upstream = new URL(GEOCODE_URL);
  upstream.searchParams.set("query", query);
  upstream.searchParams.set("size", "10");
  const res = await fetch(upstream, { headers: kakaoHeaders(env), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) return json({ error: `geocode ${res.status}`, detail: await upstreamDetail(res) }, 502);
  const body = (await res.json()) as any;
  return json(
    toList(body?.documents).map((d) => ({
      roadAddress: str(d.road_address?.address_name),
      jibunAddress: str(d.address?.address_name) ?? str(d.address_name),
      lng: Number(d.x),
      lat: Number(d.y),
    })),
  );
}

async function reverseGeocode(url: URL, env: Env): Promise<Response> {
  // Number(null) = Number("") = 0 이 통과하지 않도록 빈 값을 먼저 걸러낸다
  const lng = toNum(url.searchParams.get("lng"));
  const lat = toNum(url.searchParams.get("lat"));
  if (lng === null || lat === null) return json({ error: "lng, lat 이 필요합니다" }, 400);
  const upstream = new URL(REVERSE_GEOCODE_URL);
  upstream.searchParams.set("x", String(lng));
  upstream.searchParams.set("y", String(lat));
  const res = await fetch(upstream, { headers: kakaoHeaders(env), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) return json({ error: `reverse-geocode ${res.status}`, detail: await upstreamDetail(res) }, 502);
  const body = (await res.json()) as any;
  return json({ address: shortAddress(toList(body?.documents)[0]) });
}

/**
 * 좌표→주소 결과를 한 줄로: 도로명이면 "분당구 판교역로 166 (건물명)", 없으면 지번 "분당구 백현동 532".
 * 시·도(경기)와 시(성남시)는 빼고 구·동부터 보여 준다 (화면 폭이 좁아서). 구가 없는 시는 시부터.
 */
export function shortAddress(doc: any): string | null {
  if (!doc) return null;
  const r = doc.road_address;
  const a = doc.address;
  const area = (x: any) => {
    const two = String(x?.region_2depth_name ?? "").trim(); // "성남시 분당구" 또는 "과천시"
    const parts = two.split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts.slice(1).join(" ") : parts[0] ?? "";
  };
  if (r?.road_name) {
    const no = [r.main_building_no, r.sub_building_no].filter((v: any) => v && v !== "0").join("-");
    const building = str(r.building_name);
    return [area(r), r.road_name, no].filter(Boolean).join(" ") + (building ? ` (${building})` : "");
  }
  if (a) {
    const no = [a.main_address_no, a.sub_address_no].filter((v: any) => v && v !== "0").join("-");
    return [area(a), a.region_3depth_name, no].filter(Boolean).join(" ") || str(a.address_name);
  }
  return null;
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
