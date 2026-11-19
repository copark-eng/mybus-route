import { config } from "./config";

/** 노선 하나의 도착 예정 정보 (다음 버스 최대 2대). */
export interface RouteArrival {
  routeId: string;
  routeName: string;
  staOrder: number | null;
  arrivals: { seconds: number; stopsLeft: number | null; plateNo: string | null }[];
}

export interface GeocodeResult {
  roadAddress: string | null;
  jibunAddress: string | null;
  lng: number;
  lat: number;
}

/** 한 요청이 늦어도 화면 전체가 기다리지 않도록 8초에서 끊는다 (Worker 는 6초에서 끊음) */
const REQUEST_TIMEOUT_MS = 8_000;

/** 사용량 기록용 화면 이름 (ADR-032): home / search / detail / fav / bus. 개인 정보는 담지 않는다 */
function screenHeader(): Record<string, string> {
  const h = typeof location === "undefined" ? "" : location.hash;
  const screen = h.startsWith("#search") ? "search" : h.startsWith("#route") ? "detail" : h.startsWith("#fav") ? "fav" : h.startsWith("#bus") ? "bus" : "home";
  return { "X-Screen": screen };
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${config.apiBase}${path}?${query}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: screenHeader() });
  if (!res.ok) {
    const text = await res.text();
    let body: { error?: string; code?: string } | null = null;
    try { body = JSON.parse(text); } catch { /* JSON 아님 */ }
    throw new ApiError(body?.error ?? `API ${res.status}: ${text.slice(0, 120)}`, res.status, body?.code);
  }
  return res.json() as Promise<T>;
}

/** Worker 오류. code 가 DAILY_LIMIT 이면 data.go.kr 일일 한도 초과 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}
export const isDailyLimitError = (e: unknown) => e instanceof ApiError && e.code === "DAILY_LIMIT";

/** 도착정보 묶음. fetchedAt 은 응답을 받은 시각(ms)으로, 남은 시간 계산의 기준이 된다. */
export interface StationArrivals {
  stationId: string;
  fetchedAt: number;
  routes: RouteArrival[];
}

/** 정류장의 실시간 도착 정보 (Worker 경유, ADR-004). 같은 검색 안에서는 메모리에 잠깐 보관한다. */
const memo = new Map<string, Promise<StationArrivals>>();
export function fetchArrivals(stationId: string, maxAgeMs = 15_000): Promise<StationArrivals> {
  const hit = memo.get(stationId);
  if (hit) {
    return hit.then((v) => (Date.now() - v.fetchedAt < maxAgeMs ? v : refetch()));
  }
  return refetch();

  function refetch() {
    const p = getJson<RouteArrival[]>("/arrivals", { stationId }).then((routes) => ({
      stationId,
      fetchedAt: Date.now(),
      routes,
    }));
    memo.set(stationId, p);
    p.catch(() => memo.delete(stationId));
    return p;
  }
}

export function geocode(query: string): Promise<GeocodeResult[]> {
  return getJson<GeocodeResult[]>("/geocode", { query });
}

/** 좌표 → 도로명(없으면 지번) 주소 한 줄. */
export async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
  const body = await getJson<any>("/reverse-geocode", { lng: String(lng), lat: String(lat) });
  const results: any[] = body?.results ?? [];
  const road = results.find((r) => r.name === "roadaddr");
  const addr = road ?? results.find((r) => r.name === "addr");
  if (!addr) return null;
  const reg = addr.region ?? {};
  const land = addr.land ?? {};
  const parts = [reg.area2?.name, reg.area3?.name];
  if (road) parts.splice(1, 1, land.name); // 도로명: 시군구 + 도로명
  const num = [land.number1, land.number2].filter(Boolean).join("-");
  const building = land.addition0?.value;
  return [...parts.filter(Boolean), num, building].filter(Boolean).join(" ");
}

/** 날씨 요약 (/api/weather, ADR-024). 필드는 02_api_spec.md 계약 그대로. */
export interface WeatherSummary {
  temp: number | null;
  feels: number | null;
  sky: "맑음" | "구름많음" | "흐림" | null;
  precip: string | null;
  rainFrom: { hour: number; pop: number; type: string } | null;
  maxPop: number;
  nx: number;
  ny: number;
  baseTime: string;
}

/**
 * 날씨 조회. 좌표는 소수 3자리로 반올림해 보낸다(같은 격자 → Worker 캐시 적중).
 * 실패(2xx 아님·JSON 파싱 실패)는 예외 — 호출 측에서 null 로 바꿔 날씨 줄을 숨긴다 (FR-6.2).
 */
export function fetchWeather(lat?: number, lng?: number): Promise<WeatherSummary> {
  const params: Record<string, string> = {};
  if (lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)) {
    params.lat = lat.toFixed(3);
    params.lng = lng.toFixed(3);
  }
  return getJson<WeatherSummary>("/weather", params);
}

/** 노선의 운행 중 버스 (/api/bus-locations, ADR-028). stationSeq 는 route.stops 인덱스 + 1 */
export interface BusLocation {
  plateNo: string | null;
  stationSeq: number;
  stationId: string;
  stateCd: number | null; // 0 교차로 통과, 1 정류소 도착, 2 정류소 출발
  lowPlate: number | null; // 1 저상, 2 2층
  crowded: number | null; // 1 여유 ~ 4 매우혼잡
  remainSeat: number | null;
}

/** 실패 시 예외의 message 에 Worker 의 error 문구가 담긴다 */
export async function fetchBusLocations(routeId: string): Promise<BusLocation[]> {
  const res = await fetch(`${config.apiBase}/bus-locations?routeId=${encodeURIComponent(routeId)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: screenHeader(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `API ${res.status}`);
  return body as BusLocation[];
}
