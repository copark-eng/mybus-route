/** 노선 종류 문자열 → 색 토큰 키 (위에서부터 먼저 일치하는 것) */
export type RouteTypeKey = "airport" | "express" | "direct" | "seat" | "village" | "normal" | "default";

const RULES: [string, RouteTypeKey][] = [
  ["공항", "airport"],
  ["광역", "express"],
  ["직행좌석", "direct"],
  ["좌석", "seat"],
  ["마을", "village"],
  ["일반", "normal"],
];

export function routeTypeKey(type: string | undefined | null): RouteTypeKey {
  if (!type) return "default";
  for (const [word, key] of RULES) if (type.includes(word)) return key;
  return "default";
}

/** CSS 변수 이름 (style 속성에서 var() 로 쓴다) */
export const routeColorVar = (type: string | undefined | null) => `var(--route-${routeTypeKey(type)})`;

/** 지도 경로선처럼 실제 색 값이 필요한 곳: 현재 테마의 CSS 변수 값을 읽는다 */
export function routeColor(type: string | undefined | null): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--route-${routeTypeKey(type)}`).trim();
  return v || "#667085";
}
