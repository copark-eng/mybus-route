/**
 * 노선 선을 진행 방향 오른쪽으로 평행 이동 (ADR-037).
 * 버스는 도로 오른쪽 차로로 다니므로, 도로 가운데선 형상을 오른쪽으로 옮겨 그린다.
 * 왕복 노선이 같은 도로를 지나면 가는 선·오는 선이 나란히 보인다.
 */
import type { LatLng } from "./shapes";

const R = 6_378_137; // 지구 반지름(m), 웹 메르카토르

/** 화면 1px 이 몇 m 인지 (256px 타일 기준 줌, 네이버 지도 v3 와 같다) */
export function metersPerPixel(lat: number, zoom: number): number {
  return (2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

/**
 * coords 를 진행 방향 오른쪽으로 meters 만큼 옮긴 좌표.
 * 꺾이는 곳은 앞뒤 선분 법선의 평균 방향으로 옮기고(마이터), 급히 꺾이는 곳(회차 등)은 2배까지만 늘린다.
 */
export function offsetRight(coords: LatLng[], meters: number): LatLng[] {
  if (coords.length < 2 || !meters) return coords;
  const lat0 = coords[0][0];
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180); // 경도 1도 → m
  const ky = (Math.PI / 180) * R; // 위도 1도 → m
  // 평면 좌표(m)로, 거의 같은 점은 빼서 방향이 튀지 않게
  const pts: { x: number; y: number }[] = [];
  for (const [la, ln] of coords) {
    const p = { x: ln * kx, y: la * ky };
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.3) pts.push(p);
  }
  if (pts.length < 2) return coords;
  // 각 선분의 오른쪽 단위 법선: 방향 (dx,dy) → (dy,-dx)
  const normals = pts.slice(1).map((p, i) => {
    const dx = p.x - pts[i].x;
    const dy = p.y - pts[i].y;
    const len = Math.hypot(dx, dy);
    return { x: dy / len, y: -dx / len };
  });
  return pts.map((p, i) => {
    const a = normals[Math.max(0, i - 1)];
    const b = normals[Math.min(normals.length - 1, i)];
    let nx = a.x + b.x;
    let ny = a.y + b.y;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) { nx = b.x; ny = b.y; } // 정확히 되돌아가는 곳
    else {
      // 마이터 길이 = 1/cos(반각), 2배 제한
      const cosHalf = len / 2;
      const scale = Math.min(2, 1 / Math.max(cosHalf, 0.5));
      nx = (nx / len) * scale;
      ny = (ny / len) * scale;
    }
    return [(p.y + ny * meters) / ky, (p.x + nx * meters) / kx] as LatLng;
  });
}
