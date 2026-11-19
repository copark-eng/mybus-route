/**
 * 노선 형상(도로를 따라가는 선) 만들기 (ADR-029)
 *
 *   node scripts/build-shapes.ts          (build-db.ts 뒤에 실행)
 *
 * 경기도 버스기반정보의 노선 형상 파일(routeline…V2.txt, 약 100MB)을 노선별로 나누고,
 * 선을 단순화한 뒤(약 4m 허용) web/public/data/lines/<노선ID>.json 으로 쓴다.
 * 각 파일에는 정류장마다 형상의 몇 번째 점인지(s)도 넣어, 승차~하차 구간만 잘라 그릴 수 있게 한다.
 *
 * 파일 형식: { v:1, p:[y0,x0,dy1,dx1,...] (1e5 정수, 첫 점 이후는 차이), s:[정류장 i 의 점 번호] }
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, "scripts", ".cache", "baseinfo");
const OUT = path.join(ROOT, "web", "public", "data", "lines");
const BASEINFO_URL = "https://apis.data.go.kr/6410000/baseinfoservice/v2/getBaseInfoItemv2";
const TOLERANCE = 0.00004; // 도(°) 단위, 약 4m
const SCALE = 1e5;

function loadKey(): string {
  if (process.env.BUS_API_KEY) return process.env.BUS_API_KEY;
  const m = fs.readFileSync(path.join(ROOT, "worker", ".dev.vars"), "utf8").match(/^BUS_API_KEY=(.*)$/m);
  if (!m?.[1]) throw new Error("BUS_API_KEY 가 없습니다");
  return m[1].trim();
}

async function routelineText(): Promise<string> {
  const u = new URL(BASEINFO_URL);
  u.searchParams.set("serviceKey", decodeURIComponent(loadKey()));
  u.searchParams.set("format", "json");
  const item = (await (await fetch(u)).json())?.response?.msgBody?.baseInfoItem;
  if (!item?.routeLineDownloadUrl) throw new Error("기반정보 응답에 노선 형상 파일 주소가 없습니다");
  const file = path.join(CACHE, `routeline${item.routeLineVersion}.txt`);
  if (!fs.existsSync(file)) {
    console.log("노선 형상 파일 내려받는 중…");
    const res = await fetch(item.routeLineDownloadUrl);
    if (!res.ok) throw new Error(`형상 파일 다운로드 실패 ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file, "utf8");
}

type Pt = [number, number]; // [lat, lng]

/** Douglas–Peucker (반복형). 남길 점의 인덱스를 돌려준다 */
export function simplify(pts: Pt[], tol: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ay, ax] = pts[a];
    const [by, bx] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [py, px] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tol * tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => { if (k) out.push(i); });
  return out;
}

/** 정류장마다 형상의 가장 가까운 점 (앞으로만 찾아서 왕복 노선의 반대편에 붙지 않게) */
export function snapStops(shape: Pt[], stops: Pt[]): number[] {
  const res: number[] = [];
  let from = 0;
  for (let k = 0; k < stops.length; k++) {
    const [sy, sx] = stops[k];
    // 다음 정류장까지 남은 형상 비율만큼만 앞을 본다 (너무 멀리 건너뛰지 않게)
    const remainStops = stops.length - k;
    const windowEnd = Math.min(shape.length, from + Math.max(40, Math.ceil(((shape.length - from) / remainStops) * 4)));
    let best = from, bestD = Infinity;
    for (let i = from; i < windowEnd; i++) {
      const dy = shape[i][0] - sy, dx = (shape[i][1] - sx) * 0.8; // 경도 1도가 위도보다 짧은 것을 대략 반영
      const d = dy * dy + dx * dx;
      if (d < bestD) { bestD = d; best = i; }
    }
    res.push(best);
    from = best;
  }
  return res;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "public", "data", "routes.json"), "utf8"));
  const stations = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "public", "data", "stations.json"), "utf8"));
  if (routes.v !== 2) throw new Error("routes.json v2 가 필요합니다 (먼저 build-db.ts 실행)");

  const text = await routelineText();
  console.log("노선별로 나누는 중…");
  const byRoute = new Map<string, { seq: number; y: number; x: number }[]>();
  let start = text.indexOf("^") + 1; // 헤더 건너뛰기
  while (start > 0 && start < text.length) {
    const end = text.indexOf("^", start);
    const rec = text.slice(start, end < 0 ? undefined : end);
    start = end < 0 ? -1 : end + 1;
    const c = rec.split("|");
    if (c.length < 6) continue;
    const list = byRoute.get(c[0]) ?? [];
    list.push({ seq: Number(c[1]), x: Number(c[4]), y: Number(c[5]) });
    byRoute.set(c[0], list);
  }

  let written = 0, missing = 0, before = 0, after = 0;
  for (const row of routes.rows as [string, ...unknown[]][]) {
    const id = row[0];
    const stopIdx = row[8] as number[];
    const raw = byRoute.get(id);
    if (!raw || raw.length < 2) { missing++; continue; }
    raw.sort((a, b) => a.seq - b.seq);
    const shape: Pt[] = raw.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => [p.y, p.x]);
    const keepIdx = simplify(shape, TOLERANCE);
    const simple = keepIdx.map((i) => shape[i]);
    const stopPts: Pt[] = stopIdx.map((i) => [stations.rows[i][4], stations.rows[i][3]]);
    const s = snapStops(simple, stopPts);
    const p: number[] = [];
    let py = 0, px = 0;
    simple.forEach(([y, x], i) => {
      const iy = Math.round(y * SCALE), ix = Math.round(x * SCALE);
      if (i === 0) p.push(iy, ix); else p.push(iy - py, ix - px);
      py = iy; px = ix;
    });
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ v: 1, p, s }));
    written++;
    before += shape.length;
    after += simple.length;
  }
  const total = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(
    `형상 ${written}개 노선 (형상 없음 ${missing}), 점 ${before.toLocaleString()} → ${after.toLocaleString()}, 합계 ${Math.round(total / 1024)}KB`,
  );
}

// 테스트에서 simplify·snapStops 만 가져갈 때는 실행하지 않는다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
