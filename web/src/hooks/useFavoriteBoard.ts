import { useCallback, useMemo, useRef, useState } from "react";
import { evaluate, type OptionResult, type RoutePlan } from "../lib/router";
import { type Favorite, favoriteToPlan } from "../lib/storage";
import { useDb } from "../context";
import { useArrivalsRefresh } from "./useArrivalsRefresh";

export type FavCardState =
  | { kind: "loading" }
  | { kind: "ok"; result: OptionResult }
  | { kind: "notRunning" }
  | { kind: "changed" }
  | { kind: "error" };

const LOADING: FavCardState = { kind: "loading" };

/** 즐겨찾기 전부를 evaluate 한 번으로 평가한다 (정류장 조회 중복 제거, ADR-015/022) */
export function useFavoriteBoard(favorites: Favorite[], enabled: boolean) {
  const db = useDb();
  const [states, setStates] = useState<Map<string, FavCardState>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);

  // 즐겨찾기 경로 구성이 바뀔 때만 plan 을 다시 만든다 (이름 변경은 무시)
  const key = favorites
    .map((f) => `${f.id}:${f.legs.map((l) => `${l.routeId}:${l.fromIndex}-${l.toIndex}`).join("|")}`)
    .join(",");
  const favRef = useRef(favorites);
  favRef.current = favorites;
  const plans = useMemo(() => {
    void key;
    const m = new Map<string, RoutePlan | null>();
    for (const f of favRef.current) m.set(f.id, favoriteToPlan(db, f));
    return m;
  }, [db, key]);

  const prev = useRef(states);
  prev.current = states;

  const task = useCallback(async () => {
    // evaluate 는 notRunning 을 빼고 정렬하므로 plan 객체 참조로 되돌려 찾는다
    const byPlan = new Map<RoutePlan, string>();
    const next = new Map<string, FavCardState>();
    for (const [id, p] of plans) {
      if (p) byPlan.set(p, id);
      else next.set(id, { kind: "changed" });
    }
    try {
      const results = byPlan.size ? await evaluate(db, [...byPlan.keys()]) : [];
      const seen = new Set<string>();
      for (const r of results) {
        const id = byPlan.get(r.plan);
        if (id) {
          next.set(id, { kind: "ok", result: r });
          seen.add(id);
        }
      }
      for (const id of byPlan.values()) if (!seen.has(id)) next.set(id, { kind: "notRunning" });
      setError(null);
      setLastUpdated(Date.now());
    } catch (e) {
      // 전체 실패: 이전 성공 값은 유지, 없으면 error
      for (const id of byPlan.values()) {
        const old = prev.current.get(id);
        next.set(id, old && old.kind !== "loading" ? old : { kind: "error" });
      }
      setError(`실시간 정보를 가져오지 못했습니다: ${String(e)}`);
    }
    setStates(next);
  }, [db, plans]);

  const { running, runNow } = useArrivalsRefresh(task, enabled && favorites.length > 0);
  const get = useCallback((id: string): FavCardState => states.get(id) ?? LOADING, [states]);
  const refresh = useCallback(() => void runNow(), [runNow]);
  return { get, loading: running, error, lastUpdated, refresh };
}
