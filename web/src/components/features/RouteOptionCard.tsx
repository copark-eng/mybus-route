import { Fragment } from "react";
import { remaining } from "../../hooks/useCountdown";
import { fmtWon } from "../../lib/fare";
import type { OptionResult } from "../../lib/router";
import { fmtClock, fmtMin, fmtWait } from "../../lib/util";
import { Badge } from "../ui";
import { RouteBadge } from "./RouteBadge";
import { TimeBar } from "./TimeBar";

/** 검색 결과 카드: 도착 시각 + 노선 + 시간 막대 + 첫 승차 안내 */
export function RouteOptionCard({ result: r, now, onOpen, onHover, favorite }: {
  result: OptionResult;
  now: number;
  onOpen(): void;
  onHover?(on: boolean): void;
  favorite?: boolean;
}) {
  const arrive = remaining(r.arriveSec, r.evaluatedAt, now);
  const first = r.legs[0];
  const board = remaining(first.boardSec, r.evaluatedAt, now);
  const walk = r.plan.walkStartSec + r.plan.walkTransferSec + r.plan.walkEndSec;
  return (
    <li>
      <button
        type="button"
        className="card option-card"
        onClick={onOpen}
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
        onFocus={() => onHover?.(true)}
        onBlur={() => onHover?.(false)}
        data-testid="route-option"
      >
        <span className="option-top">
          <span className="option-time">
            <b className="num">{r.arriveSec === null ? "-" : fmtClock(r.evaluatedAt + r.arriveSec * 1000)}</b> 도착
            {arrive !== null && <span className="muted"> · {fmtMin(arrive)}</span>}
          </span>
          {r.estimated && <Badge tone="est">추정 포함</Badge>}
          {favorite && <span className="fav-star" aria-label="즐겨찾기됨">★</span>}
        </span>
        <span className="option-routes">
          {r.legs.map((l, n) => (
            <Fragment key={n}>
              {n > 0 && <span className="arrow" aria-hidden="true">→</span>}
              <RouteBadge name={l.route.name} type={l.route.type} />
            </Fragment>
          ))}
          <span className="muted small">
            {r.legs.length > 1 ? "환승 1회" : "직행"}
            {walk > 0 ? ` · 도보 ${fmtMin(walk)}` : ""}
          </span>
          <span className={`option-fare small${r.fare.premium ? " is-premium" : ""}`} data-testid="option-fare">
            {r.fare.won === null ? "요금 별도" : `약 ${fmtWon(r.fare.won)}`}
          </span>
        </span>
        <TimeBar result={r} now={now} size="md" />
        <span className="option-sub small muted">
          {first.from.name}에서 {board === null ? "-" : board >= 60 ? `${fmtWait(board)} 후 승차` : "곧 승차"}
        </span>
        {r.note && <span className="option-note small">{r.note}</span>}
      </button>
    </li>
  );
}
