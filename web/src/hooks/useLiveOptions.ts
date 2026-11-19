import { useCallback, useEffect, useRef, useState } from "react";
import { evaluate, type OptionResult, type RoutePlan } from "../lib/router";
import { useDb } from "../context";
import { useArrivalsRefresh } from "./useArrivalsRefresh";

export interface LiveOptions {
  results: OptionResult[];
  /** 지금 plans 로 한 번이라도 평가가 끝났는지 */
  done: boolean;
  loading: boolean;
  error: string | null;
  lastUpdated: number;
  refresh(): void;
}

/** 경로 후보를 실시간으로 평가하고 30초마다 다시 평가한다. plans 가 바뀌면 이전 응답은 버린다. */
export function useLiveOptions(plans: RoutePlan[], enabled: boolean, limit = 8): LiveOptions {
  const db = useDb();
  const [state, setState] = useState<{ plans: RoutePlan[]; results: OptionResult[]; done: boolean; error: string | null; at: number }>(
    { plans, results: [], done: false, error: null, at: 0 },
  );
  const reqId = useRef(0);

  // 새 plans → 결과 초기화 (렌더 중 상태 맞추기)
  if (state.plans !== plans) setState({ plans, results: [], done: false, error: null, at: 0 });

  useEffect(() => () => { reqId.current++; }, [plans]);

  const task = useCallback(async () => {
    if (plans.length === 0) return;
    const id = ++reqId.current;
    try {
      const results = (await evaluate(db, plans)).slice(0, limit);
      if (id !== reqId.current) return;
      setState((s) => (s.plans === plans ? { ...s, results, done: true, error: null, at: Date.now() } : s));
    } catch (e) {
      if (id !== reqId.current) return;
      setState((s) => (s.plans === plans ? { ...s, done: true, error: `실시간 정보를 가져오지 못했습니다: ${String(e)}` } : s));
    }
  }, [db, plans, limit]);

  const { running, runNow } = useArrivalsRefresh(task, enabled && plans.length > 0);
  const refresh = useCallback(() => void runNow(), [runNow]);
  const cur = state.plans === plans ? state : { results: [], done: false, error: null, at: 0 };
  return { results: cur.results, done: cur.done, loading: running, error: cur.error, lastUpdated: cur.at, refresh };
}
