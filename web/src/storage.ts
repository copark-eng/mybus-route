/** 브라우저 저장 (ADR-007): 최근 출발지·도착지 쌍(FR-3)과 즐겨찾기 경로(FR-5, ADR-017) */
import type { BusDb } from "./data";
import type { Place } from "./places";
import type { RoutePlan } from "./router";

const KEY = "mybus-route:v1";

export interface SavedPair { from: Place; to: Place; at: number }

/** 즐겨찾기: 노선 ID와 정류장 위치로 저장해 두고, 열 때 DB에서 다시 찾는다. */
export interface FavoriteLeg { routeId: string; routeName: string; fromIndex: number; toIndex: number; fromStationId: string; toStationId: string }
export interface Favorite {
  id: string;
  name: string;
  from: Place;
  to: Place;
  legs: FavoriteLeg[];
  walkStartSec: number;
  walkTransferSec: number;
  walkEndSec: number;
}

interface Store { version: 1; pairs: SavedPair[]; favorites: Favorite[] }

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s?.version === 1) return s;
    }
  } catch {
    /* 사생활 보호 모드 등: 저장 없이 동작 */
  }
  return { version: 1, pairs: [], favorites: [] };
}

function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 실패는 무시 */
  }
}

const placeKey = (p: Place) => (p.kind === "station" ? `s:${p.stationId}` : `p:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);

export const getPairs = () => read().pairs;

export function savePair(from: Place, to: Place) {
  const s = read();
  const key = placeKey(from) + ">" + placeKey(to);
  s.pairs = [{ from, to, at: Date.now() }, ...s.pairs.filter((p) => placeKey(p.from) + ">" + placeKey(p.to) !== key)].slice(0, 8);
  write(s);
}

export function removePair(index: number) {
  const s = read();
  s.pairs.splice(index, 1);
  write(s);
}

export const getFavorites = () => read().favorites;

export function addFavorite(from: Place, to: Place, plan: RoutePlan): Favorite {
  const s = read();
  const fav: Favorite = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: `${short(from.label)} → ${short(to.label)}`,
    from,
    to,
    legs: plan.legs.map((l) => ({
      routeId: l.route.id,
      routeName: l.route.name,
      fromIndex: l.fromIndex,
      toIndex: l.toIndex,
      fromStationId: l.route.stops[l.fromIndex],
      toStationId: l.route.stops[l.toIndex],
    })),
    walkStartSec: plan.walkStartSec,
    walkTransferSec: plan.walkTransferSec,
    walkEndSec: plan.walkEndSec,
  };
  s.favorites.unshift(fav);
  write(s);
  return fav;
}

export function renameFavorite(id: string, name: string) {
  const s = read();
  const f = s.favorites.find((x) => x.id === id);
  if (f) { f.name = name; write(s); }
}

export function removeFavorite(id: string) {
  const s = read();
  s.favorites = s.favorites.filter((f) => f.id !== id);
  write(s);
}

export function favoriteKey(plan: RoutePlan): string {
  return plan.legs.map((l) => `${l.route.id}:${l.fromIndex}-${l.toIndex}`).join("|");
}

export const isFavorite = (plan: RoutePlan) =>
  getFavorites().some((f) => f.legs.map((l) => `${l.routeId}:${l.fromIndex}-${l.toIndex}`).join("|") === favoriteKey(plan));

/** 저장된 즐겨찾기를 현재 DB 기준 경로로 되돌린다. 노선·정류장 순서가 바뀌었으면 null (ADR-017) */
export function favoriteToPlan(db: BusDb, f: Favorite): RoutePlan | null {
  const legs = [];
  for (const l of f.legs) {
    const route = db.routes.get(l.routeId);
    if (!route) return null;
    // 노선 정류장 순서가 바뀌었으면 같은 정류장을 다시 찾는다
    let fromIndex = route.stops[l.fromIndex] === l.fromStationId ? l.fromIndex : route.stops.indexOf(l.fromStationId);
    let toIndex = route.stops[l.toIndex] === l.toStationId ? l.toIndex : route.stops.indexOf(l.toStationId, fromIndex + 1);
    if (fromIndex < 0 || toIndex <= fromIndex) return null;
    legs.push({ route, fromIndex, toIndex });
  }
  return { legs, walkStartSec: f.walkStartSec, walkTransferSec: f.walkTransferSec, walkEndSec: f.walkEndSec };
}

function short(label: string) {
  return label
    .replace(/\s*\(\d+\)$/, "")
    .replace(/^(\S+시\s+)?(\S+구\s+)?/, "")
    .slice(0, 16);
}
