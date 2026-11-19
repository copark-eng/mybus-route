import { routeColorVar } from "../../lib/routeType";

/** 노선 번호 배지 — 노선 종류 색 바탕 + 흰 글자 */
export function RouteBadge({ name, type, size = "md" }: { name: string; type?: string; size?: "sm" | "md" }) {
  return (
    <span className={`route-badge route-badge-${size}`} style={{ background: routeColorVar(type) }} title={type}>
      {name}
    </span>
  );
}
