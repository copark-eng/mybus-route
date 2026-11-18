import { config } from "./config";

/** 노선 하나의 도착 예정 정보 (다음 버스 최대 2대). */
export interface RouteArrival {
  routeId: string;
  routeName: string;
  arrivals: { seconds: number; stopsLeft: number | null; plateNo: string | null }[];
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${config.apiBase}${path}?${query}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** 정류장의 실시간 도착 정보 (Worker 프록시 경유, ADR-004). */
export function fetchArrivals(stationId: string): Promise<RouteArrival[]> {
  return getJson<RouteArrival[]>("/arrivals", { stationId });
}
