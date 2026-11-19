/**
 * 노선의 운행 중인 버스 위치 (ADR-028)
 *   GET /api/bus-locations?routeId=241222005
 * data.go.kr 경기도_버스위치정보 조회(getBusLocationListv2). 20초 캐시, 6초 타임아웃.
 */
import { cacheGet, cachePut, json } from "./http";

const URL_BASE = "https://apis.data.go.kr/6410000/buslocationservice/v2/getBusLocationListv2";
const TTL_SEC = 20; // 화면은 30초마다 갱신 (ADR-031), 도착정보 캐시와 같은 20초
const TIMEOUT_MS = 6_000;

export interface BusLocation {
  plateNo: string | null;
  /** 노선 정류장 순번 (1부터, 웹의 route.stops 인덱스 + 1) */
  stationSeq: number;
  stationId: string;
  /** 0 교차로 통과, 1 정류소 도착, 2 정류소 출발 */
  stateCd: number | null;
  /** 0 일반, 1 저상, 2 2층 … */
  lowPlate: number | null;
  /** 1 여유, 2 보통, 3 혼잡, 4 매우혼잡 (일반형 노선만) */
  crowded: number | null;
  /** 빈자리 수 (좌석형 노선만, 없으면 null) */
  remainSeat: number | null;
}

export async function busLocations(url: URL, serviceKey: string, ctx: ExecutionContext): Promise<Response> {
  const routeId = url.searchParams.get("routeId") ?? "";
  if (!/^\d{6,12}$/.test(routeId)) return json({ error: "routeId 가 올바르지 않습니다" }, 400);

  const cacheKey = `bus-locations/${routeId}`;
  const hit = await cacheGet(cacheKey);
  if (hit) return hit;

  const upstream = new URL(URL_BASE);
  upstream.searchParams.set("serviceKey", decodeURIComponent(serviceKey.trim()));
  upstream.searchParams.set("routeId", routeId);
  upstream.searchParams.set("format", "json");

  let res: Response;
  try {
    res = await fetch(upstream, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    for (let attempt = 1; res.status === 429 && attempt <= 2; attempt++) {
      await new Promise((r) => setTimeout(r, 300 * attempt));
      res = await fetch(upstream, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    }
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return json({ error: "data.go.kr 응답 지연" }, 504);
    }
    throw e;
  }
  const text = await res.text();
  if (!res.ok) {
    const notRegistered = /SERVICE_KEY_IS_NOT_REGISTERED/.test(text);
    return json({ error: notRegistered ? "버스위치정보 서비스 활용신청이 필요합니다" : `data.go.kr ${res.status}` }, 502);
  }
  const body = JSON.parse(text);
  const header = body?.response?.msgHeader ?? {};
  const code = Number(header.resultCode ?? 0);
  if (code !== 0 && code !== 4) return json({ error: `data.go.kr ${code}: ${header.resultMessage}` }, 502);

  const raw = body?.response?.msgBody?.busLocationList;
  const items: any[] = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  const data: BusLocation[] = items
    .map((it) => ({
      plateNo: str(it.plateNo),
      stationSeq: Number(it.stationSeq),
      stationId: String(it.stationId ?? ""),
      stateCd: int(it.stateCd),
      lowPlate: int(it.lowPlate),
      crowded: int(it.crowded),
      remainSeat: (() => { const n = int(it.remainSeatCnt); return n === null || n < 0 ? null : n; })(),
    }))
    .filter((b) => Number.isFinite(b.stationSeq) && b.stationSeq > 0)
    .sort((a, b) => a.stationSeq - b.stationSeq);

  const out = json(data, 200, { "Cache-Control": `public, max-age=${TTL_SEC}` });
  await cachePut(cacheKey, out, TTL_SEC, ctx);
  return out;
}

const str = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
};
const int = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
