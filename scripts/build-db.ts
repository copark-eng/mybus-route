/**
 * 정류장·노선 DB 수집 (ADR-027: 경기도 버스기반정보 파일, ADR-016: 매주 갱신)
 *
 *   node scripts/build-db.ts
 *
 * 1. data.go.kr 경기도_버스기반정보 조회(getBaseInfoItemv2)로 오늘자 파일 주소를 받는다 (API 호출 1번)
 * 2. 정류소·노선·노선-정류소 파일을 내려받는다 (레코드 구분 "^", 필드 구분 "|", UTF-8)
 * 3. 웹이 바로 쓸 수 있는 압축 JSON(v2)으로 만든다 → web/public/data/stations.json, routes.json
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, "scripts", ".cache", "baseinfo");
const OUT = path.join(ROOT, "web", "public", "data");
const BASEINFO_URL = "https://apis.data.go.kr/6410000/baseinfoservice/v2/getBaseInfoItemv2";

/** 출발지·도착지·환승으로 고를 수 있는 지역 = 경기도 31개 시군 (ADR-027). 그 밖(서울·인천 등)은 노선 경로로만 쓴다 */
const GYEONGGI = new Set([
  "수원", "성남", "고양", "용인", "부천", "안산", "안양", "남양주", "화성", "평택", "의정부", "시흥", "파주", "김포",
  "광명", "광주", "군포", "하남", "오산", "이천", "안성", "의왕", "양주", "구리", "포천", "동두천", "과천", "여주",
  "양평", "가평", "연천",
]);
const isGyeonggi = (region: string) => GYEONGGI.has(region) || [...GYEONGGI].some((g) => region.startsWith(g + "시"));

/** 노선유형코드 → 이름 (GBIS 기반정보 명세) */
const ROUTE_TYPES: Record<string, string> = {
  "11": "직행좌석형시내버스", "12": "좌석형시내버스", "13": "일반형시내버스", "14": "광역급행형시내버스",
  "15": "따복형시내버스", "16": "경기순환버스", "21": "직행좌석형농어촌버스", "22": "좌석형농어촌버스",
  "23": "일반형농어촌버스", "30": "마을버스", "41": "고속형시외버스", "42": "좌석형시외버스", "43": "일반형시외버스",
  "51": "리무진공항버스", "52": "좌석형공항버스", "53": "일반형공항버스",
};

function loadKey(): string {
  if (process.env.BUS_API_KEY) return process.env.BUS_API_KEY;
  const vars = fs.readFileSync(path.join(ROOT, "worker", ".dev.vars"), "utf8");
  const m = vars.match(/^BUS_API_KEY=(.*)$/m);
  if (!m?.[1]) throw new Error("BUS_API_KEY 가 없습니다 (환경변수 또는 worker/.dev.vars)");
  return m[1].trim();
}

type Rec = Record<string, string>;

/** "^" 로 레코드, "|" 로 필드를 나눈 파일 → 객체 배열 (첫 레코드가 헤더) */
export function parseBaseInfo(text: string): Rec[] {
  const rows = text.replace(/^﻿/, "").split("^").map((r) => r.replace(/[\r\n]+$/g, "")).filter((r) => r.trim());
  const head = rows.shift()?.split("|") ?? [];
  return rows.map((r) => {
    const cols = r.split("|");
    const o: Rec = {};
    head.forEach((h, i) => { o[h.trim()] = (cols[i] ?? "").trim(); });
    return o;
  });
}

async function fileUrls(): Promise<{ version: string; station: string; route: string; routeStation: string }> {
  const u = new URL(BASEINFO_URL);
  u.searchParams.set("serviceKey", decodeURIComponent(loadKey()));
  u.searchParams.set("format", "json");
  const res = await fetch(u);
  const text = await res.text();
  if (!res.ok) throw new Error(`기반정보 조회 ${res.status}: ${text.slice(0, 200)}`);
  const item = JSON.parse(text)?.response?.msgBody?.baseInfoItem;
  if (!item?.stationDownloadUrl) throw new Error(`기반정보 응답에 파일 주소가 없습니다: ${text.slice(0, 200)}`);
  return {
    version: String(item.stationVersion),
    station: item.stationDownloadUrl,
    route: item.routeDownloadUrl,
    routeStation: item.routeStationDownloadUrl,
  };
}

/** 같은 버전 파일은 다시 받지 않는다 */
async function download(url: string, name: string): Promise<string> {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} 다운로드 실패 ${res.status}`);
  const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
  fs.writeFileSync(file, text);
  return text;
}

const num = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const urls = await fileUrls();
  console.log(`기반정보 버전 ${urls.version}`);
  const [stText, rtText, rsText] = await Promise.all([
    download(urls.station, `station${urls.version}.txt`),
    download(urls.route, `route${urls.version}.txt`),
    download(urls.routeStation, `routestation${urls.version}.txt`),
  ]);
  const stationRows = parseBaseInfo(stText);
  const routeRows = parseBaseInfo(rtText);
  const routeStationRows = parseBaseInfo(rsText);

  // 노선별 정류장 순서 (상행 → 하행, staOrder 순)
  const seqByRoute = new Map<string, { order: number; stationId: string }[]>();
  for (const r of routeStationRows) {
    const list = seqByRoute.get(r.routeId) ?? [];
    list.push({ order: Number(r.staOrder), stationId: r.stationId });
    seqByRoute.set(r.routeId, list);
  }

  // 노선에 쓰이는 정류장만 내보낸다
  const used = new Set(routeStationRows.map((r) => r.stationId));
  const stationList = stationRows
    .filter((s) => used.has(s.stationId) && num(s.x) !== null && num(s.y) !== null)
    .sort((a, b) => a.stationId.localeCompare(b.stationId));
  const index = new Map(stationList.map((s, i) => [s.stationId, i]));

  // stations.json v2: 열 이름 + 행 배열 (객체 키 반복을 없애 크기를 줄인다)
  const stationsOut = {
    v: 2,
    updatedAt: new Date().toISOString(),
    version: urls.version,
    region: "경기도",
    cols: ["id", "no", "name", "x", "y", "sel"],
    rows: stationList.map((s) => [
      s.stationId,
      s.mobileNo,
      s.stationName,
      round6(Number(s.x)),
      round6(Number(s.y)),
      isGyeonggi(s.regionName) && s.mobileNo ? 1 : 0,
    ]),
  };

  // routes.json v2: 정류장은 stations.rows 의 인덱스로
  const routeOut: unknown[] = [];
  let skipped = 0;
  for (const r of routeRows.sort((a, b) => a.routeName.localeCompare(b.routeName, "ko", { numeric: true }))) {
    const seq = (seqByRoute.get(r.routeId) ?? []).sort((a, b) => a.order - b.order);
    const stops = seq.map((s) => index.get(s.stationId)).filter((i): i is number => i !== undefined);
    if (stops.length < 2) { skipped++; continue; }
    const turn = num(r.turnSeq);
    routeOut.push([
      r.routeId,
      r.routeName,
      ROUTE_TYPES[r.routeTypeCd] ?? "기타",
      num(r.peekAlloc),
      num(r.npeekAlloc),
      r.upFirstTime,
      r.upLastTime,
      turn !== null ? turn - 1 : -1,
      stops,
    ]);
  }
  const routesOut = {
    v: 2,
    updatedAt: stationsOut.updatedAt,
    version: urls.version,
    cols: ["id", "name", "type", "peek", "npeek", "first", "last", "turn", "stops"],
    rows: routeOut,
  };

  // 비정상적으로 작으면 기존 파일을 지킨다 (ADR-016)
  const prev = path.join(OUT, "stations.json");
  if (fs.existsSync(prev)) {
    const old = JSON.parse(fs.readFileSync(prev, "utf8"));
    const oldCount = old.rows?.length ?? old.stations?.length ?? 0;
    if (oldCount > 0 && stationsOut.rows.length < oldCount * 0.8) {
      throw new Error(`정류장 수가 ${oldCount} → ${stationsOut.rows.length} 로 20% 넘게 줄었습니다. 기존 파일을 유지합니다.`);
    }
  }

  fs.writeFileSync(path.join(OUT, "stations.json"), JSON.stringify(stationsOut));
  fs.writeFileSync(path.join(OUT, "routes.json"), JSON.stringify(routesOut));
  const sel = stationsOut.rows.filter((r) => r[5] === 1).length;
  const kb = (f: string) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
  console.log(
    `노선 ${routeOut.length}개 (정류장 2곳 미만 ${skipped}개 제외), 정류장 ${stationsOut.rows.length}곳 (경기도 선택 가능 ${sel}곳)\n` +
      `stations.json ${kb("stations.json")}KB, routes.json ${kb("routes.json")}KB`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
