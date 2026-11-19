import type { ReactNode } from "react";
import { remaining } from "../../hooks/useCountdown";
import type { Place } from "../../lib/places";
import type { OptionResult } from "../../lib/router";
import { routeColorVar } from "../../lib/routeType";
import { fmtClock, fmtMin, fmtWait } from "../../lib/util";
import { Badge } from "../ui";
import { RouteBadge } from "./RouteBadge";

interface Row { key: string; at: number | null; kind: "place" | "walk" | "board" | "ride" | "wait"; color?: string; body: ReactNode }

/** 상세 화면 단계 목록: 각 행 왼쪽에 시각(HH:MM) */
export function StepList({ result: r, now, from, to }: { result: OptionResult; now: number; from: Place; to: Place }) {
  const at = (sec: number | null) => (sec === null ? null : r.evaluatedAt + sec * 1000);
  const left = (sec: number | null) => remaining(sec, r.evaluatedAt, now);
  const rows: Row[] = [];
  const firstLeg = r.legs[0];

  rows.push({ key: "start", at: r.evaluatedAt, kind: "place", body: <><b>{from.label}</b><span className="muted small">출발</span></> });
  if (r.plan.walkStartSec > 0) {
    rows.push({ key: "walk0", at: null, kind: "walk", body: <span className="muted">도보 {fmtMin(r.plan.walkStartSec)} → {firstLeg.from.name}</span> });
  }

  r.legs.forEach((l, n) => {
    const color = routeColorVar(l.route.type);
    if (n === 1) {
      const prev = r.legs[0];
      rows.push({
        key: "xfer",
        at: at(prev.alightSec),
        kind: "place",
        body: (
          <>
            <b>{prev.to.name} 하차</b>
            <span className="muted small">
              환승{l.from.id !== prev.to.id ? ` · 도보 ${fmtMin(r.plan.walkTransferSec)} → ${l.from.name}` : ""}
              {l.waitSec !== null ? ` · 대기 ${fmtMin(l.waitSec)}` : ""}
            </span>
          </>
        ),
      });
    }
    const board = left(l.boardSec);
    rows.push({
      key: `board${n}`,
      at: at(l.boardSec),
      kind: "board",
      color,
      body: (
        <>
          <span className="step-line">
            <b>{l.from.name}</b> <span className="muted small">{l.from.no}</span>
          </span>
          <span className="step-line">
            <RouteBadge name={l.route.name} type={l.route.type} />
            <span className="muted small">{l.route.type}</span>
          </span>
          <span className="step-line">
            승차 <b className="num">{board === null ? "-" : board >= 60 ? `${fmtWait(board)} 후` : "곧 도착"}</b>
            {l.boardEstimated && <Badge tone="est">추정</Badge>}
          </span>
          <span className="muted small">
            실시간: {l.upcoming.length ? l.upcoming.map((s) => fmtWait(Math.max(0, Math.round(s - (now - r.evaluatedAt) / 1000)))).join(" · ") : "정보 없음"}
          </span>
        </>
      ),
    });
    rows.push({
      key: `ride${n}`,
      at: null,
      kind: "ride",
      color,
      body: (
        <span className="step-line small">
          {l.stops}정거장 · 약 {fmtMin(l.rideSec)}
          {l.rideEstimated ? <Badge tone="est">추정</Badge> : <Badge tone="live">차량 추적</Badge>}
        </span>
      ),
    });
  });

  const last = r.legs[r.legs.length - 1];
  rows.push({ key: "alight", at: at(last.alightSec), kind: "place", body: <b>{last.to.name} 하차</b> });
  if (r.plan.walkEndSec > 0) {
    rows.push({ key: "walk1", at: null, kind: "walk", body: <span className="muted">도보 {fmtMin(r.plan.walkEndSec)}</span> });
  }
  rows.push({ key: "end", at: at(r.arriveSec), kind: "place", body: <><b>{to.label}</b><span className="muted small">도착</span></> });

  return (
    <ol className="steps" data-testid="step-list">
      {rows.map((row) => (
        <li key={row.key} className={`step step-${row.kind}`} style={row.color ? { ["--c" as string]: row.color } : undefined}>
          <span className="step-time num">{row.at === null ? "" : fmtClock(row.at)}</span>
          <span className="step-rail" aria-hidden="true" />
          <span className="step-body">{row.body}</span>
        </li>
      ))}
    </ol>
  );
}
