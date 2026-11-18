/** 출발지·도착지 (정류장 또는 주소·지도 위치) 와 자동완성 (FR-1, ADR-013, ADR-019) */
import type { BusDb, Station } from "./data";

export type Place =
  | { kind: "station"; stationId: string; label: string; lat: number; lng: number }
  | { kind: "point"; label: string; lat: number; lng: number };

export function stationPlace(s: Station): Place {
  return { kind: "station", stationId: s.id, label: `${s.name} (${s.no})`, lat: s.y, lng: s.x };
}

export const samePlace = (a: Place, b: Place) =>
  a.kind === b.kind && (a.kind === "station" ? a.stationId === (b as any).stationId : a.lat === b.lat && a.lng === b.lng);

// ---------- 정류장 이름 검색 ----------

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}
const norm = (s: string) => s.replace(/[\s.·,()\-]/g, "").toLowerCase();
const isChosungOnly = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);

interface IndexedStation { station: Station; n: string; c: string }
let index: IndexedStation[] | null = null;

export function searchStations(db: BusDb, query: string, limit = 8): Station[] {
  const q = norm(query);
  if (!q) return [];
  index ??= db.selectable.map((station) => ({ station, n: norm(station.name), c: chosung(norm(station.name)) }));
  const scored: { s: Station; score: number }[] = [];
  const digits = /^\d{2,5}$/.test(q);
  for (const it of index) {
    let score = -1;
    if (digits && it.station.no.includes(q)) score = it.station.no === q.padStart(5, "0") ? 0 : 1;
    else if (it.n.startsWith(q)) score = 2;
    else if (it.n.includes(q)) score = 3;
    else if (isChosungOnly(q) && it.c.includes(q)) score = 4;
    if (score >= 0) scored.push({ s: it.station, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name, "ko"));
  return scored.slice(0, limit).map((x) => x.s);
}

/** "○○ 방면" — 같은 이름의 정류장(길 건너편)을 구분하기 위한 다음 정류장 이름 (FR-1.4) */
export function directionHint(db: BusDb, s: Station): string {
  const counts = new Map<string, number>();
  for (const ref of db.stopRefs.get(s.id) ?? []) {
    const next = db.stations.get(ref.route.stops[ref.index + 1] ?? "");
    if (next && next.name !== s.name) counts.set(next.name, (counts.get(next.name) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? `${best[0]} 방면` : "";
}

/** 입력이 주소처럼 보이면 Geocoding 을 부른다 (ADR-019: 숫자나 로/길/동/읍/면/리 포함) */
export const looksLikeAddress = (q: string) => /\d/.test(q) || /(로|길|동|읍|면|리|구|시)(\s|$)/.test(q);
