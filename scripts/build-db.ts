/**
 * 정류장·노선 DB 수집 (ADR-006, ADR-010, ADR-016)
 *
 *   node scripts/build-db.ts
 *
 * 성남시 정류장에서 시작해 "정류장 → 경유 노선 → 노선의 정류장 순서"를 따라가며 모은다.
 * API 응답은 scripts/.cache 에 저장하므로 일일 호출 한도에 걸려 중단돼도 다시 실행하면 이어서 진행한다.
 * 결과: web/public/data/stations.json, web/public/data/routes.json
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, "scripts", ".cache");
const OUT = path.join(ROOT, "web", "public", "data");
const BASE = "https://apis.data.go.kr/6410000";
const REGION = "성남"; // ADR-010
const SEEDS = ["206000004", "206000080", "206000531"]; // 판교·서현·백현
const CONCURRENCY = 4;

function loadKey(): string {
  if (process.env.BUS_API_KEY) return process.env.BUS_API_KEY;
  const vars = fs.readFileSync(path.join(ROOT, "worker", ".dev.vars"), "utf8");
  const m = vars.match(/^BUS_API_KEY=(.*)$/m);
  if (!m?.[1]) throw new Error("BUS_API_KEY 가 없습니다 (환경변수 또는 worker/.dev.vars)");
  return m[1].trim();
}
const KEY = decodeURIComponent(loadKey());

class LimitError extends Error {}
let apiCalls = 0;

async function api(kind: string, endpoint: string, params: Record<string, string>): Promise<any> {
  const file = path.join(CACHE, `${kind}-${Object.values(params).join("_")}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));

  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("serviceKey", KEY);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 1; ; attempt++) {
    await throttle();
    apiCalls++;
    const res = await fetch(url);
    const text = await res.text();
    // 초당 호출 제한: 잠시 쉬었다가 다시 시도한다.
    if (/PER_SECOND/i.test(text)) {
      if (attempt < 8) { await sleep(500 * attempt); continue; }
      throw new Error(`${endpoint}: 초당 호출 제한이 계속됩니다`);
    }
    // 일일 호출 제한: 중단하고 다음 날 이어서 수집한다.
    if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/i.test(text)) throw new LimitError(text.slice(0, 200));
    if (!res.ok) {
      if (attempt < 3) { await sleep(1000 * attempt); continue; }
      throw new Error(`${endpoint} ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = JSON.parse(text);
    const code = Number(body?.response?.msgHeader?.resultCode ?? 0);
    if (code !== 0 && code !== 4) {
      if (attempt < 3) { await sleep(1000 * attempt); continue; }
      throw new Error(`${endpoint} resultCode ${code}: ${body?.response?.msgHeader?.resultMessage}`);
    }
    const msgBody = body?.response?.msgBody ?? {};
    fs.writeFileSync(file, JSON.stringify(msgBody));
    return msgBody;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 모든 API 호출 사이에 최소 간격을 둔다 (data.go.kr 초당 호출 제한). */
const MIN_INTERVAL_MS = 150;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await sleep(wait);
}
const list = (v: unknown): any[] => (!v ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

// ---------- 수집 ----------

interface StationRec { id: string; no: string; name: string; x: number; y: number; region: string }
interface RouteRec {
  id: string; name: string; type: string; region: string;
  peek: number | null; npeek: number | null; first: string; last: string;
  turn: number; stops: string[];
}

const stations = new Map<string, StationRec>();
const routes = new Map<string, RouteRec>();
const queuedStations = new Set<string>();
const queuedRoutes = new Set<string>();
const stationQueue: string[] = [...SEEDS];
SEEDS.forEach((s) => queuedStations.add(s));

async function processStation(stationId: string) {
  const body = await api("via", "busstationservice/v2/getBusStationViaRouteListv2", { stationId });
  for (const r of list(body.busRouteList)) {
    const id = str(r.routeId);
    if (id && !queuedRoutes.has(id)) {
      queuedRoutes.add(id);
      await processRoute(id, { name: str(r.routeName), type: str(r.routeTypeName), region: str(r.regionName) });
    }
  }
}

/** fallback: 서울 노선 등은 경기도 노선정보 API 가 비어 있어 경유노선 목록의 이름·종류를 쓴다. */
async function processRoute(routeId: string, fallback: { name: string; type: string; region: string }) {
  const [stBody, infoBody] = await Promise.all([
    api("route-stations", "busrouteservice/v2/getBusRouteStationListv2", { routeId }),
    api("route-info", "busrouteservice/v2/getBusRouteInfoItemv2", { routeId }),
  ]);
  const info = infoBody.busRouteInfoItem ?? {};
  const seq = list(stBody.busRouteStationList).sort((a, b) => Number(a.stationSeq) - Number(b.stationSeq));
  const stops: string[] = [];
  let turn = -1;
  for (const s of seq) {
    const id = str(s.stationId);
    stops.push(id);
    if (str(s.turnYn) === "Y" && turn < 0) turn = stops.length - 1;
    if (!stations.has(id)) {
      stations.set(id, {
        id,
        no: str(s.mobileNo),
        name: str(s.stationName),
        x: Number(s.x),
        y: Number(s.y),
        region: str(s.regionName),
      });
    }
    if (str(s.regionName) === REGION && str(s.mobileNo) && !queuedStations.has(id)) {
      queuedStations.add(id);
      stationQueue.push(id);
    }
  }
  routes.set(routeId, {
    id: routeId,
    name: str(info.routeName) || fallback.name,
    type: str(info.routeTypeName) || fallback.type,
    region: str(info.regionName) || fallback.region,
    peek: Number(info.peekAlloc) || null,
    npeek: Number(info.nPeekAlloc) || null,
    first: str(info.upFirstTime),
    last: str(info.upLastTime),
    turn: turn >= 0 ? turn : Number(seq.find((s) => s.turnSeq)?.turnSeq ?? 0) - 1,
    stops,
  });
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  let done = 0;
  let stopped: string | null = null;

  const worker = async () => {
    while (stationQueue.length && !stopped) {
      const id = stationQueue.shift()!;
      try {
        await processStation(id);
      } catch (e) {
        if (e instanceof LimitError) { stopped = "일일 호출 한도 초과"; break; }
        console.warn(`정류장 ${id} 처리 실패: ${(e as Error).message}`);
      }
      if (++done % 100 === 0) {
        console.log(`정류장 ${done}곳 처리, 대기 ${stationQueue.length}, 노선 ${routes.size}, API 호출 ${apiCalls}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // ---------- 출력 ----------
  // 한도에 걸려 중단돼도 지금까지 모은 것으로 파일을 만든다 (partial 표시). 다시 실행하면 이어서 채운다.
  // 노선에 쓰이는 모든 정류장(성남 밖 포함)을 저장하고, 성남 정류장은 sel=1 로 표시(선택·검색 대상).
  const routeOut = [...routes.values()]
    .filter((r) => r.stops.length >= 2)
    .sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  const usedStations = new Set(routeOut.flatMap((r) => r.stops));
  const stationOut = [...stations.values()]
    .filter((s) => usedStations.has(s.id))
    .map((s) => ({
      id: s.id,
      no: s.no,
      name: s.name,
      x: Math.round(s.x * 1e6) / 1e6,
      y: Math.round(s.y * 1e6) / 1e6,
      ...(s.region === REGION && s.no ? { sel: 1 } : {}),
    }));

  const updatedAt = new Date().toISOString();
  const partial = stopped ? { partial: true, pendingStations: stationQueue.length } : {};
  fs.writeFileSync(path.join(OUT, "stations.json"), JSON.stringify({ updatedAt, region: REGION, ...partial, stations: stationOut }));
  fs.writeFileSync(path.join(OUT, "routes.json"), JSON.stringify({ updatedAt, ...partial, routes: routeOut }));

  const sel = stationOut.filter((s) => "sel" in s).length;
  console.log(`\n노선 ${routeOut.length}개, 정류장 ${stationOut.length}곳 (성남 선택 가능 ${sel}곳), 이번 API 호출 ${apiCalls}회`);
  if (stopped) {
    console.error(`일부만 수집됨: ${stopped}. 남은 정류장 ${stationQueue.length}곳 — 내일 다시 실행하면 이어서 수집합니다.`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
