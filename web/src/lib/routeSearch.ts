/** 버스 번호로 노선 찾기 (ADR-038). 같은 번호가 여러 시에 있어 운행지역·기점→회차점으로 구분해 보여 준다 */
import type { BusDb, Route } from "./data";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
/** "1550-1" 을 "15501" 로 쳐도 찾는다 */
const loose = (s: string) => norm(s).replace(/-/g, "");

export interface RouteHit { route: Route; from: string; to: string }

/**
 * 정확히 일치 → 앞부분 일치 → 중간 일치 순. 같은 순위면 번호가 짧은 것 → 번호 → 운행지역 → id.
 */
export function searchRoutes(db: BusDb, q: string, limit = 30): RouteHit[] {
  const k = norm(q);
  const kl = loose(q);
  if (!k) return [];
  const scored: { r: Route; s: number }[] = [];
  for (const r of db.routes.values()) {
    const n = norm(r.name);
    const nl = loose(r.name);
    const s = n === k || nl === kl ? 0 : n.startsWith(k) || nl.startsWith(kl) ? 1 : n.includes(k) || nl.includes(kl) ? 2 : -1;
    if (s >= 0) scored.push({ r, s });
  }
  scored.sort((a, b) =>
    a.s - b.s ||
    a.r.name.length - b.r.name.length ||
    a.r.name.localeCompare(b.r.name, "ko", { numeric: true }) ||
    (a.r.region ?? "").localeCompare(b.r.region ?? "", "ko") ||
    a.r.id.localeCompare(b.r.id),
  );
  const name = (id: string | undefined) => (id ? db.stations.get(id)?.name ?? "" : "");
  return scored.slice(0, limit).map(({ r }) => ({ route: r, from: name(r.stops[0]), to: name(r.stops[r.turn] ?? r.stops[r.stops.length - 1]) }));
}
