import type { SavedPair } from "../../lib/storage";
import { shortLabel } from "../../lib/util";

/** 최근 검색 칩 (FR-3). 칩 → 바로 검색, × → 삭제 */
export function RecentPairs({ pairs, onPick, onRemove }: {
  pairs: SavedPair[];
  onPick(i: number): void;
  onRemove(i: number): void;
}) {
  if (pairs.length === 0) return null;
  return (
    <section className="section" aria-labelledby="recent-title" data-testid="recent-pairs">
      <h2 id="recent-title" className="section-title">최근 검색</h2>
      <ul className="chips">
        {pairs.slice(0, 8).map((p, i) => {
          const label = `${shortLabel(p.from.label)} → ${shortLabel(p.to.label)}`;
          return (
            <li key={`${p.at}-${i}`} className="chip">
              <button type="button" className="chip-main" onClick={() => onPick(i)} data-testid="recent-pair">
                {label}
              </button>
              <button type="button" className="chip-x" aria-label={`${label} 삭제`} onClick={() => onRemove(i)} data-testid="recent-pair-remove">
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
