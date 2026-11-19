/** 시간 막대 세그먼트 모델 (ADR-023). 순수 함수만 둔다. */
import type { OptionResult } from "./router";

export type SegKind = "walk" | "wait" | "ride" | "transferWalk" | "transferWait";

export interface Segment {
  kind: SegKind;
  startSec: number;
  durSec: number;
  estimated: boolean;
  routeName?: string;
  routeType?: string;
  legIndex?: number;
}

/** 평가 결과 → 세그먼트 (기준점 0 = evaluatedAt). 시각 정보가 없으면 빈 배열 */
export function toSegments(r: OptionResult): Segment[] {
  if (r.arriveSec === null || r.legs.some((l) => l.boardSec === null || l.alightSec === null)) return [];
  const out: Segment[] = [];
  const push = (s: Segment) => { if (s.durSec > 0) out.push(s); };
  let t = 0;
  if (r.plan.walkStartSec > 0) {
    push({ kind: "walk", startSec: t, durSec: r.plan.walkStartSec, estimated: false });
    t += r.plan.walkStartSec;
  }
  r.legs.forEach((leg, n) => {
    if (n === 1 && r.plan.walkTransferSec > 0) {
      push({ kind: "transferWalk", startSec: t, durSec: r.plan.walkTransferSec, estimated: false });
      t += r.plan.walkTransferSec;
    }
    const base = { routeName: leg.route.name, routeType: leg.route.type, legIndex: n };
    const board = leg.boardSec!;
    push({ kind: n === 0 ? "wait" : "transferWait", startSec: t, durSec: board - t, estimated: leg.boardEstimated, ...base });
    push({ kind: "ride", startSec: board, durSec: leg.alightSec! - board, estimated: leg.rideEstimated, ...base });
    t = leg.alightSec!;
  });
  if (r.plan.walkEndSec > 0) push({ kind: "walk", startSec: t, durSec: r.plan.walkEndSec, estimated: false });
  return out;
}

/** 흐른 시간(초)만큼 앞에서 잘라낸 남은 세그먼트 */
export function clip(segs: Segment[], elapsedSec: number): Segment[] {
  if (elapsedSec <= 0) return segs;
  const out: Segment[] = [];
  for (const s of segs) {
    const end = s.startSec + s.durSec;
    if (end <= elapsedSec) continue;
    const start = Math.max(s.startSec, elapsedSec);
    out.push({ ...s, startSec: start, durSec: end - start });
  }
  return out;
}

/** 세그먼트 폭(%) — 합 100, 최소 폭 min(비율) 보장 */
export function layout(segs: Segment[], min = 0.04): number[] {
  const total = segs.reduce((a, s) => a + s.durSec, 0);
  if (total <= 0 || segs.length === 0) return segs.map(() => 0);
  const n = segs.length;
  const floor = Math.min(min, 1 / n);
  const w = segs.map((s) => s.durSec / total);
  const small = w.map((x) => x < floor);
  const deficit = w.reduce((a, x, i) => a + (small[i] ? floor - x : 0), 0);
  const surplus = w.reduce((a, x, i) => a + (small[i] ? 0 : x - floor), 0);
  const out = w.map((x, i) => (small[i] ? floor : surplus > 0 ? x - ((x - floor) / surplus) * deficit : x));
  return out.map((x) => x * 100);
}

const KIND_LABEL: Record<SegKind, string> = { walk: "도보", wait: "대기", ride: "", transferWalk: "환승", transferWait: "대기" };

export function segLabel(s: Segment): string {
  const min = `${Math.max(1, Math.round(s.durSec / 60))}분`;
  return s.kind === "ride" ? `${s.routeName} ${min}` : `${KIND_LABEL[s.kind]} ${min}`;
}

/** 스크린리더용 설명 */
export function describeSegments(segs: Segment[], arriveClock: string): string {
  return [...segs.map(segLabel), `${arriveClock} 도착`].join(", ");
}
