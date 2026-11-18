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

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${config.apiBase}${path}?${query}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

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
