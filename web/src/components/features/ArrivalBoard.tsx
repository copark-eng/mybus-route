import { useDb } from "../../context";
import type { StationArrivals } from "../../lib/api";
import type { Station } from "../../lib/data";
import { directionHint } from "../../lib/places";
import { fmtWait } from "../../lib/util";
import { RouteBadge } from "./RouteBadge";

/** 출발 정류장 실시간 도착판 (FR-4.5): 노선별 다음 2대 */
export function ArrivalBoard({ station, arrivals, now }: { station: Station; arrivals: StationArrivals; now: number }) {
  const db = useDb();
  const elapsed = (now - arrivals.fetchedAt) / 1000;
  const rows = arrivals.routes
    .map((r) => ({ r, secs: r.arrivals.map((a) => Math.max(0, Math.round(a.seconds - elapsed))) }))
    .sort((a, b) => (a.secs[0] ?? 1e9) - (b.secs[0] ?? 1e9) || a.r.routeName.localeCompare(b.r.routeName, "ko", { numeric: true }));
  const hint = directionHint(db, station);
  return (
    <section className="section board" aria-labelledby="board-title" data-testid="arrival-board">
      <h2 id="board-title" className="section-title">
        {station.name} 정류장 실시간 <small className="muted">{station.no}{hint ? ` · ${hint}` : ""}</small>
      </h2>
      {rows.length === 0 ? (
        <p className="muted small">도착 예정 버스가 없습니다</p>
      ) : (
        <ul className="board-list">
          {rows.map(({ r, secs }) => (
            <li key={`${r.routeId}-${r.staOrder}`}>
              <RouteBadge name={r.routeName} type={db.routes.get(r.routeId)?.type} size="sm" />
              <span className="num small">{secs.length ? secs.map((s) => fmtWait(s)).join(" · ") : <span className="muted">도착 정보 없음</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
