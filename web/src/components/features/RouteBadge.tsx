import type { MouseEvent } from "react";
import { useOpenRoute } from "../../context";
import { routeColorVar } from "../../lib/routeType";

/**
 * 노선 번호 배지 — 노선 종류 색 바탕 + 흰 글자.
 * routeId 를 주면 눌러서 노선 정보 화면을 연다 (ADR-028). 버튼 안에 넣을 때는 routeId 를 주지 않는다(버튼 중첩 금지).
 */
export function RouteBadge({ name, type, size = "md", routeId, stationId }: {
  name: string;
  type?: string;
  size?: "sm" | "md";
  routeId?: string;
  stationId?: string;
}) {
  const open = useOpenRoute();
  const style = { background: routeColorVar(type) };
  if (routeId && open) {
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      open(routeId, stationId);
    };
    return (
      <button
        type="button"
        className={`route-badge route-badge-${size} route-badge-link`}
        style={style}
        title={`${name}번 노선 정보 보기`}
        aria-label={`${name}번 노선 정보`}
        onClick={onClick}
        data-testid="route-badge-link"
      >
        {name}
      </button>
    );
  }
  return (
    <span className={`route-badge route-badge-${size}`} style={style} title={type}>
      {name}
    </span>
  );
}
