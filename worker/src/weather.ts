/**
 * 기상청 단기예보 (ADR-024)
 *   GET /api/weather?lat=37.38&lng=127.12
 * 현재(초단기실황) + 오늘 남은 시간의 비·눈 예보(단기예보)를 한 번에 요약해 돌려준다.
 * 캐시: 격자 단위 성공 10분, 실패(502) 60초 (http.ts 의 메모리 + caches.default).
 */
import { cacheGet, cachePut, json } from "./http";

const BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
const TTL_SEC = 600;
const ERR_TTL_SEC = 60;
const DEFAULT_LAT = 37.4200; // 성남시청 (ADR-026)
const DEFAULT_LNG = 127.1267;
/** 한국 부근만 허용 (기상청 격자 범위 안) */
const LAT_RANGE = [33, 39] as const;
const LNG_RANGE = [124, 132] as const;

export interface WeatherSummary {
  temp: number | null; // 현재 기온 (℃)
  feels: number | null; // 체감온도 (℃, 바람 반영)
  sky: "맑음" | "구름많음" | "흐림" | null;
  precip: "없음" | "비" | "비/눈" | "눈" | "빗방울" | "빗방울눈날림" | "눈날림" | null; // 현재 강수 형태
  /** 오늘 남은 시간 중 처음 비·눈 예보가 있는 시각과 그때 확률 */
  rainFrom: { hour: number; pop: number; type: string } | null;
  maxPop: number; // 오늘 남은 시간 최대 강수확률
  nx: number;
  ny: number;
  baseTime: string;
}

export async function weather(url: URL, serviceKey: string, ctx: ExecutionContext): Promise<Response> {
  let nx: number, ny: number;
  const gx = url.searchParams.get("nx");
  const gy = url.searchParams.get("ny");
  if (gx !== null || gy !== null) {
    // 웹은 위치 대신 기상청 격자(약 5km)만 보낸다 (ADR-033, 개인위치정보 최소 전송)
    nx = Number(gx);
    ny = Number(gy);
    if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || nx > 149 || ny < 1 || ny > 253) {
      return json({ error: "nx, ny 범위를 벗어났습니다" }, 400);
    }
  } else {
    const lat = parseCoord(url.searchParams.get("lat"), DEFAULT_LAT);
    const lng = parseCoord(url.searchParams.get("lng"), DEFAULT_LNG);
    if (lat === null || lng === null) return json({ error: "lat, lng 가 필요합니다" }, 400);
    if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1] || lng < LNG_RANGE[0] || lng > LNG_RANGE[1]) {
      return json({ error: "lat, lng 범위를 벗어났습니다" }, 400);
    }
    ({ nx, ny } = toGrid(lat, lng));
  }

  const okKey = `weather/${nx}-${ny}`;
  const errKey = `weather-err/${nx}-${ny}`;
  const hit = (await cacheGet(okKey)) ?? (await cacheGet(errKey));
  if (hit) return hit;

  try {
    const key = decodeURIComponent((serviceKey ?? "").trim());
    const now = kstNow();
    const [ncst, fcst] = await Promise.all([
      call(key, "getUltraSrtNcst", ultraBase(now), nx, ny, 10),
      call(key, "getVilageFcst", vilageBase(now), nx, ny, 400),
    ]);
    const body = summarize(ncst.items, fcst.items, now, nx, ny, ncst.baseTime);
    const out = json(body, 200, { "Cache-Control": `public, max-age=${TTL_SEC}` });
    await cachePut(okKey, out, TTL_SEC, ctx);
    return out;
  } catch (e) {
    // 미신청·장애 시 요청마다 기상청을 2번씩 부르지 않도록 실패도 짧게 캐시한다.
    // 오류 문자열에 키는 들어가지 않는다 (요청 URL 을 문자열화하지 않음).
    const out = json({ error: String(e) }, 502, { "Cache-Control": `public, max-age=${ERR_TTL_SEC}` });
    await cachePut(errKey, out, ERR_TTL_SEC, ctx);
    return out;
  }
}

/** 쿼리 좌표: 없거나 빈 값이면 기본값, 숫자가 아니면 null */
export function parseCoord(v: string | null, fallback: number): number | null {
  if (v === null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 기상청 응답 항목 → 요약 (순수 함수, 테스트용 export)
 * @param now kstNow() 형식 (UTC 메서드가 KST 를 돌려주는 Date)
 */
export function summarize(ncstItems: any[], fcstItems: any[], now: Date, nx: number, ny: number, baseTime: string): WeatherSummary {
  const cur = new Map<string, string>(ncstItems.map((i: any) => [i.category, String(i.obsrValue)]));
  const temp = num(cur.get("T1H"));
  const wind = num(cur.get("WSD"));
  const pty = PTY[cur.get("PTY") ?? ""] ?? null;

  // 단기예보: 현재 시(포함) 이후의 시각별 값. 오늘 것은 rainFrom/maxPop 용, 전체는 sky fallback 용.
  const today = ymd(now);
  const nowKey = `${today}${String(now.getUTCHours()).padStart(2, "0")}`;
  const byTime = new Map<string, Record<string, string>>(); // "YYYYMMDDHH" → {카테고리: 값}
  for (const i of fcstItems) {
    const k = `${i.fcstDate}${String(i.fcstTime).slice(0, 2)}`;
    if (k < nowKey) continue;
    const rec = byTime.get(k) ?? {};
    rec[i.category] = String(i.fcstValue);
    byTime.set(k, rec);
  }
  const times = [...byTime.keys()].sort();
  const todayTimes = times.filter((k) => k.startsWith(today));

  // sky: 오늘 남은 가장 이른 시각, 오늘이 비면(23시 발표 이후 등) 내일 포함 가장 이른 SKY
  const skyCode = (todayTimes.length ? todayTimes : times).map((k) => byTime.get(k)!.SKY).find((v) => v !== undefined);

  let rainFrom: WeatherSummary["rainFrom"] = null;
  let maxPop = 0;
  for (const k of todayTimes) {
    const r = byTime.get(k)!;
    const pop = Number(r.POP ?? 0) || 0;
    maxPop = Math.max(maxPop, pop);
    const type = PTY[r.PTY ?? "0"];
    if (!rainFrom && type && type !== "없음") rainFrom = { hour: Number(k.slice(8, 10)), pop, type };
  }

  return {
    temp,
    feels: temp !== null && wind !== null ? windChill(temp, wind) : null,
    sky: SKY[skyCode ?? ""] ?? null,
    precip: pty,
    rainFrom,
    maxPop,
    nx,
    ny,
    baseTime,
  };
}

const SKY: Record<string, WeatherSummary["sky"]> = { "1": "맑음", "3": "구름많음", "4": "흐림" };
const PTY: Record<string, WeatherSummary["precip"]> = {
  "0": "없음", "1": "비", "2": "비/눈", "3": "눈", "4": "비", "5": "빗방울", "6": "빗방울눈날림", "7": "눈날림",
};

async function call(key: string, op: string, base: { date: string; time: string }, nx: number, ny: number, rows: number) {
  const u = new URL(`${BASE}/${op}`);
  u.searchParams.set("serviceKey", key);
  u.searchParams.set("dataType", "JSON");
  u.searchParams.set("numOfRows", String(rows));
  u.searchParams.set("pageNo", "1");
  u.searchParams.set("base_date", base.date);
  u.searchParams.set("base_time", base.time);
  u.searchParams.set("nx", String(nx));
  u.searchParams.set("ny", String(ny));
  const res = await fetch(u);
  const text = await res.text();
  if (!res.ok) throw new Error(`기상청 ${op} ${res.status}: ${text.slice(0, 120)}`);
  const body = JSON.parse(text);
  const code = body?.response?.header?.resultCode;
  if (code !== "00") throw new Error(`기상청 ${op} ${code}: ${body?.response?.header?.resultMsg}`);
  const items = body.response.body?.items?.item ?? [];
  return { items: Array.isArray(items) ? items : [items], baseTime: `${base.date} ${base.time}` };
}

// ---------- 시각 계산 (KST) ----------

/** UTC 메서드로 읽으면 한국 시각이 나오는 Date */
export function kstNow(ms = Date.now()): Date {
  return new Date(ms + 9 * 3600_000);
}
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;

/** 초단기실황: 매시 정각 발표, 10분 뒤부터 조회 가능 */
export function ultraBase(now: Date) {
  const d = new Date(now.getTime() - 40 * 60_000);
  return { date: ymd(d), time: hhmm(d.getUTCHours(), 0) };
}

/** 단기예보: 02·05·08·11·14·17·20·23시 발표, 10분 뒤부터 조회 가능 */
export function vilageBase(now: Date) {
  const d = new Date(now.getTime() - 15 * 60_000);
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  let h = slots.filter((s) => s <= d.getUTCHours()).pop();
  if (h === undefined) {
    d.setUTCDate(d.getUTCDate() - 1);
    h = 23;
  }
  return { date: ymd(d), time: hhmm(h, 0) };
}

// ---------- 격자 변환 (기상청 Lambert Conformal Conic) ----------

/** 위경도 → 기상청 격자. 검증값: 서울시청(37.5665, 126.9780) → (60, 127) */
export function toGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180;
  const re = RE / GRID;
  const slat1 = SLAT1 * D, slat2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

/** 체감온도 (기상청 겨울철 공식, 10℃ 이하·풍속 4.8km/h 이상에서만) */
export function windChill(t: number, wsMps: number): number {
  const v = wsMps * 3.6;
  if (t > 10 || v < 4.8) return t;
  return Math.round((13.12 + 0.6215 * t - 11.37 * v ** 0.16 + 0.3965 * t * v ** 0.16) * 10) / 10;
}

const num = (v: string | undefined) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
