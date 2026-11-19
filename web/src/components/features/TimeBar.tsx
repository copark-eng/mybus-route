import { useMemo } from "react";
import type { OptionResult } from "../../lib/router";
import { routeColorVar } from "../../lib/routeType";
import { clip, describeSegments, layout, segLabel, toSegments } from "../../lib/timebar";
import { fmtClock, fmtMin } from "../../lib/util";

/** 시간 막대 (ADR-023): 도보·대기·탑승·환승을 남은 시간 비율로. 추정 구간은 빗금 */
export function TimeBar({ result, now, size, showLabels = false }: {
  result: OptionResult;
  now: number;
  size: "mini" | "md" | "lg";
  showLabels?: boolean;
}) {
  const all = useMemo(() => toSegments(result), [result]);
  if (all.length === 0 || result.arriveSec === null) return <div className="timebar-none">-</div>;

  const elapsed = Math.max(0, (now - result.evaluatedAt) / 1000);
  const segs = clip(all, elapsed);
  const widths = layout(segs);
  const arriveMs = result.evaluatedAt + result.arriveSec * 1000;
  const leftSec = Math.max(0, result.arriveSec - elapsed);
  const clock = fmtClock(arriveMs);

  return (
    <div className={`timebar timebar-${size}`} data-testid="timebar">
      {showLabels && (
        <div className="timebar-top">
          <b>{clock} 도착</b> <span>({fmtMin(leftSec)})</span>
        </div>
      )}
      <div className="timebar-track" role="img" aria-label={describeSegments(segs, clock)}>
        {segs.map((s, i) => {
          const color = s.routeType !== undefined ? routeColorVar(s.routeType) : undefined;
          return (
            <span
              key={`${s.kind}-${s.legIndex ?? "w"}-${i}`}
              className={`seg-${s.kind}${s.estimated ? " seg-est" : ""}`}
              style={{ width: `${widths[i]}%`, ["--c" as string]: color }}
              data-kind={s.kind}
            />
          );
        })}
      </div>
      {showLabels && (
        <div className="timebar-labels" aria-hidden="true">
          {segs.map((s, i) => (
            <span key={i} style={{ width: `${widths[i]}%` }}>{widths[i] >= 14 ? segLabel(s) : ""}</span>
          ))}
        </div>
      )}
    </div>
  );
}
