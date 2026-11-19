/** 정류장·노선 DB (ADR-006). 빌드 스크립트가 만든 정적 JSON을 불러와 검색용 색인을 만든다. */

export interface Station {
  id: string;
  no: string;
  name: string;
  x: number; // 경도
  y: number; // 위도
  sel?: 1; // 경기도 정류장 = 출발지·도착지·환승으로 고를 수 있음 (ADR-027)
}

export interface Route {
  id: string;
  name: string;
  type: string;
  peek: number | null; // 출퇴근 시간 배차(분)
  npeek: number | null; // 평시 배차(분)
  first: string; // 기점 첫차 "HH:MM" (없으면 "")
  last: string; // 기점 막차
  turn: number;
  stops: string[];
  /** 노선 정보 화면용 (ADR-028). v1 데이터에는 없다 */
  downFirst?: string; // 종점 첫차
  downLast?: string; // 종점 막차
  company?: string;
  tel?: string;
  region?: string; // 운행지역 "성남,용인"
}

export interface StopRef {
  route: Route;
  index: number; // route.stops 안의 위치 (0부터)
}

export interface BusDb {
  updatedAt: string;
  /** 일일 호출 한도로 수집이 덜 끝난 데이터 (ADR-006) */
  partial: boolean;
  stations: Map<string, Station>;
  selectable: Station[];
  routes: Map<string, Route>;
  /** 정류장 → 지나가는 노선과 그 위치 */
  stopRefs: Map<string, StopRef[]>;
  grid: SpatialGrid;
}

export async function loadDb(): Promise<BusDb> {
  const base = import.meta.env.BASE_URL;
  const [s, r] = await Promise.all([
    fetch(`${base}data/stations.json`).then((res) => res.json()),
    fetch(`${base}data/routes.json`).then((res) => res.json()),
  ]);
  return buildDb(s, r);
}

/** stations.json / routes.json 를 메모리 DB 로. v2(행 배열, ADR-027)와 v1(객체 배열) 둘 다 읽는다 */
export function buildDb(s: any, r: any): BusDb {
  let stationList: Station[];
  let routeList: Route[];
  if (s.v === 2) {
    // [id, no, name, x, y, sel] — routes 의 stops 는 이 배열의 인덱스
    stationList = (s.rows as [string, string, string, number, number, number][]).map(([id, no, name, x, y, sel]) =>
      sel ? { id, no, name, x, y, sel: 1 as const } : { id, no, name, x, y },
    );
    type Row = [string, string, string, number | null, number | null, string, string, number, number[], string?, string?, string?, string?, string?];
    routeList = (r.rows as Row[]).map(
      ([id, name, type, peek, npeek, first, last, turn, stops, downFirst, downLast, company, tel, region]) => ({
        id, name, type, peek, npeek, first, last, turn,
        stops: stops.map((i) => stationList[i].id),
        downFirst, downLast, company, tel, region,
      }),
    );
  } else {
    stationList = s.stations as Station[];
    routeList = r.routes as Route[];
  }
  const stations = new Map<string, Station>(stationList.map((st) => [st.id, st]));
  const routes = new Map<string, Route>(routeList.map((rt) => [rt.id, rt]));
  const stopRefs = new Map<string, StopRef[]>();
  for (const route of routes.values()) {
    route.stops.forEach((id, index) => {
      const list = stopRefs.get(id) ?? [];
      list.push({ route, index });
      stopRefs.set(id, list);
    });
  }
  const selectable = [...stations.values()].filter((st) => st.sel);
  return {
    updatedAt: s.updatedAt,
    partial: !!s.partial,
    stations,
    selectable,
    routes,
    stopRefs,
    grid: new SpatialGrid(selectable),
  };
}

// ---------- 거리 계산 ----------

/** 두 좌표 사이 직선거리 (m) */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const stationDistance = (a: Station, b: Station) => distanceM(a.y, a.x, b.y, b.x);

/** 근처 정류장을 빠르게 찾기 위한 격자 색인 (약 220m 칸) */
export class SpatialGrid {
  private cells = new Map<string, Station[]>();
  private static readonly CELL = 0.002;

  constructor(stations: Station[]) {
    for (const s of stations) {
      const key = this.key(s.y, s.x);
      const list = this.cells.get(key) ?? [];
      list.push(s);
      this.cells.set(key, list);
    }
  }

  private key(lat: number, lng: number) {
    return `${Math.floor(lat / SpatialGrid.CELL)}:${Math.floor(lng / SpatialGrid.CELL)}`;
  }

  /** 반경 안의 정류장을 가까운 순으로 */
  near(lat: number, lng: number, radiusM: number): { station: Station; dist: number }[] {
    const span = Math.ceil(radiusM / 180) + 1;
    const cy = Math.floor(lat / SpatialGrid.CELL);
    const cx = Math.floor(lng / SpatialGrid.CELL);
    const out: { station: Station; dist: number }[] = [];
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        for (const s of this.cells.get(`${cy + dy}:${cx + dx}`) ?? []) {
          const dist = distanceM(lat, lng, s.y, s.x);
          if (dist <= radiusM) out.push({ station: s, dist });
        }
      }
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /** 지도 화면 영역 안의 정류장 */
  inBounds(south: number, west: number, north: number, east: number, limit = 400): Station[] {
    const out: Station[] = [];
    for (let y = Math.floor(south / SpatialGrid.CELL); y <= Math.floor(north / SpatialGrid.CELL); y++) {
      for (let x = Math.floor(west / SpatialGrid.CELL); x <= Math.floor(east / SpatialGrid.CELL); x++) {
        for (const s of this.cells.get(`${y}:${x}`) ?? []) {
          if (s.y >= south && s.y <= north && s.x >= west && s.x <= east) out.push(s);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }
}

/** 도보 시간(초): 직선거리 × 1.3 ÷ 1.2m/s, 최소 60초 (ADR-012) */
export function walkSeconds(distM: number): number {
  if (distM < 15) return 0;
  return Math.max(60, Math.round((distM * 1.3) / 1.2));
}
