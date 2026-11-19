import { useCallback, useMemo, useState } from "react";
import type { Place } from "../lib/places";
import type { RoutePlan } from "../lib/router";
import * as store from "../lib/storage";

export interface SavedApi {
  favorites: store.Favorite[];
  pairs: store.SavedPair[];
  addFavorite(from: Place, to: Place, plan: RoutePlan): store.Favorite;
  renameFavorite(id: string, name: string): void;
  removeFavorite(id: string): void;
  savePair(from: Place, to: Place): void;
  removePair(index: number): void;
  isFavorite(plan: RoutePlan): boolean;
  /** 이 경로와 같은 즐겨찾기 (없으면 undefined) */
  findFavorite(plan: RoutePlan): store.Favorite | undefined;
}

const favLegKey = (f: store.Favorite) => f.legs.map((l) => `${l.routeId}:${l.fromIndex}-${l.toIndex}`).join("|");

/** storage.ts 를 감싸고, 바뀔 때마다 version 을 올려 다시 그린다 */
export function useSaved(): SavedApi {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return useMemo<SavedApi>(() => {
    void version; // version 이 바뀌면 localStorage 를 다시 읽는다
    const favorites = store.getFavorites();
    return {
      favorites,
      pairs: store.getPairs(),
      addFavorite(from, to, plan) {
        const f = store.addFavorite(from, to, plan);
        bump();
        return f;
      },
      renameFavorite(id, name) { store.renameFavorite(id, name); bump(); },
      removeFavorite(id) { store.removeFavorite(id); bump(); },
      savePair(from, to) { store.savePair(from, to); bump(); },
      removePair(i) { store.removePair(i); bump(); },
      // 이미 읽어 둔 favorites 로 판단한다 (1초마다 localStorage 를 다시 파싱하지 않도록)
      isFavorite: (plan) => {
        const key = store.favoriteKey(plan);
        return favorites.some((f) => favLegKey(f) === key);
      },
      findFavorite(plan) {
        const key = store.favoriteKey(plan);
        return favorites.find((f) => favLegKey(f) === key);
      },
    };
  }, [version, bump]);
}
