/**
 * mybus-route API 프록시 (ADR-004)
 *
 *   GET /arrivals?stationId=206000004      경기도 버스도착정보 (20초 캐시, ADR-015)
 *   GET /geocode?query=성남시 분당구 ...      NCP Geocoding (ADR-013, ADR-019)
 *   GET /reverse-geocode?lng=127.1&lat=37.3  NCP Reverse Geocoding
 */
export interface Env {
  BUS_API_KEY: string;
  NCP_KEY_ID: string;
  NCP_KEY: string;
  ALLOWED_ORIGINS: string;
}

const ARRIVAL_URL = "https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2";
const GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
const REVERSE_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const ARRIVAL_TTL_SEC = 20;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = req.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    const cors: Record<string, string> =
      origin && allowed.includes(origin)
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {};

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" },
      });
    }
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405, cors);

    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case "/arrivals":
          return withCors(await arrivals(url, env, ctx), cors);
        case "/geocode":
          return withCors(await geocode(url, env), cors);
        case "/reverse-geocode":
          return withCors(await reverseGeocode(url, env), cors);
        default:
          return json({ error: "not found" }, 404, cors);
      }
    } catch (e) {
      return json({ error: String(e) }, 502, cors);
    }
  },
};

// ---------- 경기도 버스도착정보 ----------

interface RouteArrival {
  routeId: string;
  routeName: string;
  arrivals: { seconds: number; stopsLeft: number | null; plateNo: string | null }[];
}

async function arrivals(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const stationId = url.searchParams.get("stationId") ?? "";
  if (!/^\d{6,12}$/.test(stationId)) return json({ error: "stationId 가 올바르지 않습니다" }, 400);

  // 공유 캐시: 같은 정류장은 20초 동안 data.go.kr 을 다시 부르지 않는다.
  const cacheKey = new Request(`https://cache.mybus-route/arrivals/${stationId}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = new URL(ARRIVAL_URL);
  // Encoding 키를 넣어도 이중 인코딩되지 않도록 먼저 디코딩한다 (텔레그램 봇에서 겪은 403).
  upstream.searchParams.set("serviceKey", decodeURIComponent(env.BUS_API_KEY.trim()));
  upstream.searchParams.set("stationId", stationId);
  upstream.searchParams.set("format", "json");

  const res = await fetch(upstream);
  if (!res.ok) return json({ error: `data.go.kr ${res.status}` }, 502);
  const body = (await res.json()) as any;
  const header = body?.response?.msgHeader ?? {};
  const code = Number(header.resultCode ?? 0);
  if (code !== 0 && code !== 4) return json({ error: `data.go.kr ${code}: ${header.resultMessage}` }, 502);

  const items = toList(body?.response?.msgBody?.busArrivalList);
  const data: RouteArrival[] = items.map((it) => ({
    routeId: String(it.routeId),
    routeName: String(it.routeName ?? ""),
    arrivals: [1, 2].flatMap((n) => {
      const sec = toInt(it[`predictTimeSec${n}`]) ?? mul60(toInt(it[`predictTime${n}`]));
      if (sec === null) return [];
      return [{ seconds: sec, stopsLeft: toInt(it[`locationNo${n}`]), plateNo: str(it[`plateNo${n}`]) }];
    }),
  }));

  const out = json(data, 200, { "Cache-Control": `public, max-age=${ARRIVAL_TTL_SEC}` });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// ---------- NCP Geocoding ----------

function ncpHeaders(env: Env): HeadersInit {
  return { "x-ncp-apigw-api-key-id": env.NCP_KEY_ID, "x-ncp-apigw-api-key": env.NCP_KEY };
}

async function geocode(url: URL, env: Env): Promise<Response> {
  const query = (url.searchParams.get("query") ?? "").trim();
  if (query.length < 2) return json({ error: "query 는 2글자 이상" }, 400);
  const upstream = new URL(GEOCODE_URL);
  upstream.searchParams.set("query", query);
  const res = await fetch(upstream, { headers: ncpHeaders(env) });
  if (!res.ok) return json({ error: `geocode ${res.status}` }, 502);
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
  const lng = Number(url.searchParams.get("lng"));
  const lat = Number(url.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return json({ error: "lng, lat 이 필요합니다" }, 400);
  const upstream = new URL(REVERSE_GEOCODE_URL);
  upstream.searchParams.set("coords", `${lng},${lat}`);
  upstream.searchParams.set("orders", "roadaddr,addr");
  upstream.searchParams.set("output", "json");
  const res = await fetch(upstream, { headers: ncpHeaders(env) });
  if (!res.ok) return json({ error: `reverse-geocode ${res.status}` }, 502);
  return json(await res.json());
}

// ---------- 유틸 ----------

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function withCors(res: Response, cors: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
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
