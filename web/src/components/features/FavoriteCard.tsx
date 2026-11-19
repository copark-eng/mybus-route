import { useEffect, useState } from "react";
import { useDb } from "../../context";
import type { FavCardState } from "../../hooks/useFavoriteBoard";
import { remaining } from "../../hooks/useCountdown";
import type { Favorite } from "../../lib/storage";
import { fmtClock, fmtDepart } from "../../lib/util";
import { Badge } from "../ui";
import { RouteBadge } from "./RouteBadge";
import { TimeBar } from "./TimeBar";

/** 홈 즐겨찾기 카드: 이름 + 노선 → "n분 후 출발 · HH:MM 도착" + 미니 시간 막대 */
export function FavoriteCard({ fav, state, now, editing, onOpen, onRename, onRemove }: {
  fav: Favorite;
  state: FavCardState;
  now: number;
  editing: boolean;
  onOpen(): void;
  onRename(name: string): void;
  onRemove(): void;
}) {
  const db = useDb();
  const [name, setName] = useState(fav.name);
  useEffect(() => setName(fav.name), [fav.name]);
  const commit = () => {
    const v = name.trim();
    if (v && v !== fav.name) onRename(v);
    else setName(fav.name);
  };

  const routes = (
    <span className="fav-routes">
      {fav.legs.map((l, i) => (
        <span key={i} className="fav-route">
          {i > 0 && <span className="arrow" aria-hidden="true">→</span>}
          <RouteBadge name={l.routeName} type={db.routes.get(l.routeId)?.type} size="sm" />
        </span>
      ))}
    </span>
  );

  if (editing) {
    return (
      <li className="card fav-card editing" data-testid="favorite-card">
        <div className="fav-edit">
          <input
            className="fav-name-input"
            value={name}
            aria-label="즐겨찾기 이름"
            data-testid="favorite-name-input"
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setName(fav.name); (e.target as HTMLInputElement).blur(); }
            }}
          />
          <button type="button" className="icon-btn danger" aria-label={`${fav.name} 삭제`} data-testid="favorite-remove" onClick={onRemove}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {routes}
      </li>
    );
  }

  return (
    <li className="fav-item">
      <button type="button" className="card fav-card" onClick={onOpen} data-testid="favorite-card">
        <span className="fav-head">
          <span className="fav-name">{fav.name}</span>
          {routes}
        </span>
        <FavBody state={state} now={now} />
      </button>
    </li>
  );
}

function FavBody({ state, now }: { state: FavCardState; now: number }) {
  switch (state.kind) {
    case "loading":
      return <span className="fav-body"><span className="skeleton" /><span className="skeleton skeleton-bar" /></span>;
    case "notRunning":
      return <span className="fav-body muted">지금 운행 정보 없음</span>;
    case "changed":
      return <span className="fav-body muted">노선 정보가 바뀌었습니다</span>;
    case "error":
      return <span className="fav-body danger">실시간 정보를 가져오지 못했습니다</span>;
    case "ok": {
      const r = state.result;
      const board = remaining(r.legs[0].boardSec, r.evaluatedAt, now);
      return (
        <span className="fav-body">
          <span className="fav-big" data-testid="favorite-eta">
            <b>{board === null ? "-" : fmtDepart(board)}</b>
            <span className="dot" aria-hidden="true">·</span>
            <b>{r.arriveSec === null ? "-" : `${fmtClock(r.evaluatedAt + r.arriveSec * 1000)} 도착`}</b>
            {r.estimated && <Badge tone="est">추정</Badge>}
          </span>
          <TimeBar result={r} now={now} size="mini" />
        </span>
      );
    }
  }
}
