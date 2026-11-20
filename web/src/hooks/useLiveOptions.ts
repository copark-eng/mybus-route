import { useCallback, useEffect, useRef, useState } from "react";
import { compareOptions, evaluate, type OptionResult, type RoutePlan } from "../lib/router";
import { useDb } from "../context";
import { isDailyLimitError } from "../lib/api";
import { useArrivalsRefresh } from "./useArrivalsRefresh";

/** 자동 갱신 때 다시 평가할 위쪽 결과 수 (ADR-032) */
const REFRESH_TOP = 4;

export interface LiveOptions {
  results: OptionResult[];
  /** 지금 plans 로 한 번이라도 평가가 끝났는지 */
  done: boolean;
  loading: boolean;
  error: string | null;
  lastUpdated: number;
  refresh(): void;
  /** 조작이 없어 자동 갱신을 멈춤 (ADR-035) */
  paused: boolean;
}

/**
 * 경로 후보를 실시간으로 평가하고 30초마다 다시 평가한다. plans 가 바뀌면 이전 응답은 버린다.
 * data.go.kr 일일 호출 한도를 아끼려고(ADR-032), 첫 평가만 후보 전체를 보고
 * 자동 갱신은 위쪽 결과 REFRESH_TOP 개만 다시 평가한다. 나머지는 앞서 받은 값으로 카운트다운한다.
 * 수동 새로고침(↻)은 다시 전체를 본다.
 */
export function useLiveOptions(plans: RoutePlan[], enabled: boolean, limit = 8): LiveOptions {
  const db = useDb();
  const [state, setState] = useState<{ plans: RoutePlan[]; results: OptionResult[]; done: boolean; error: string | null; at: number }>(
    { plans, results: [], done: false, error: null, at: 0 },
  );
  const reqId = useRef(0);
  const full = useRef(true); // 다음 실행을 전체 평가로 할지
  const last = useRef<{ plans: RoutePlan[]; results: OptionResult[] } | null>(null);

  // 새 plans → 결과 초기화 (렌더 중 상태 맞추기)
  if (state.plans !== plans) setState({ plans, results: [], done: false, error: null, at: 0 });

  useEffect(() => {
    full.current = true;
    return () => { reqId.current++; };
  }, [plans]);

  const task = useCallback(async () => {
    if (plans.length === 0) return;
    const id = ++reqId.current;
    const prev = last.current?.plans === plans ? last.current.results : null;
    const doFull = full.current || !prev;
    const target = doFull ? plans : prev.slice(0, REFRESH_TOP).map((r) => r.plan);
    try {
      const fresh = await evaluate(db, target);
      if (id !== reqId.current) return;
      let results: OptionResult[];
      if (doFull) {
        results = fresh.slice(0, limit);
      } else {
        // 다시 본 위쪽 결과 + 나머지(이전 값) 를 합쳐 다시 정렬 (운행 종료로 빠진 것은 빠진 대로)
        const kept = prev.slice(REFRESH_TOP);
        results = [...fresh, ...kept].sort(compareOptions).slice(0, limit);
      }
      full.current = false;
      last.current = { plans, results };
      setState((s) => (s.plans === plans ? { ...s, results, done: true, error: null, at: Date.now() } : s));
    } catch (e) {
      if (id !== reqId.current) return;
      const msg = isDailyLimitError(e)
        ? (e as Error).message
        : `실시간 정보를 가져오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
      setState((s) => (s.plans === plans ? { ...s, done: true, error: msg } : s));
    }
  }, [db, plans, limit]);

  const { running, paused, runNow } = useArrivalsRefresh(task, enabled && plans.length > 0);
  const refresh = useCallback(() => { full.current = true; void runNow(); }, [runNow]);
  const cur = state.plans === plans ? state : { results: [], done: false, error: null, at: 0 };
  return { results: cur.results, done: cur.done, loading: running, paused, error: cur.error, lastUpdated: cur.at, refresh };
}
