import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../lib/config";
import { useVisible } from "./useVisible";

/**
 * 실시간 갱신 (ADR-015): enabled 가 되면(또는 task 가 바뀌면) 즉시 1회, 이후 intervalMs 마다(탭이 보일 때만).
 * 다시 보이면 마지막 실행 후 intervalMs 가 지났을 때 바로 실행. 진행 중이면 건너뛴다.
 */
export function useArrivalsRefresh(task: () => Promise<void>, enabled: boolean, intervalMs = config.refreshMs) {
  const visible = useVisible();
  const [lastRun, setLastRun] = useState(0);
  const [running, setRunning] = useState(false);
  /** 진행 중인 실행 번호 (0 = 없음) */
  const busy = useRef(0);
  const seq = useRef(0);
  const last = useRef(0);
  const taskRef = useRef(task);
  taskRef.current = task;

  const runNow = useCallback(async (force = false) => {
    if (busy.current && !force) return;
    const id = ++seq.current;
    busy.current = id;
    setRunning(true);
    try {
      await taskRef.current();
    } finally {
      last.current = Date.now();
      if (busy.current === id) {
        busy.current = 0;
        setLastRun(last.current);
        setRunning(false);
      }
    }
  }, []);

  // 새 task(새 검색) → 진행 중인 요청이 있어도 바로 다시 실행 (오래된 응답은 task 쪽에서 버린다)
  useEffect(() => {
    if (enabled) void runNow(true);
  }, [enabled, task, runNow]);

  useEffect(() => {
    if (!enabled || !visible) return;
    if (last.current && Date.now() - last.current >= intervalMs) void runNow();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void runNow();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, visible, intervalMs, runNow]);

  return { lastRun, running, runNow };
}
