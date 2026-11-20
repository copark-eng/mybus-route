import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../lib/config";
import { isIdle, onResume } from "./useIdle";
import { useVisible } from "./useVisible";

/**
 * 실시간 갱신 (ADR-015, ADR-035)
 * - task 가 바뀌면(새 검색) 바로 1회 실행한다.
 * - 화면이 다시 활성화되면(다른 앱에서 돌아옴, 상세에서 돌아옴) 마지막 실행 뒤 intervalMs 가 지났을 때만 실행한다.
 *   (예전에는 돌아올 때마다 바로 다시 불러 호출이 늘었다)
 * - 이후 intervalMs 마다 실행. 탭이 안 보이거나, 5분 넘게 조작이 없으면(idle) 멈춘다 → paused.
 *   다시 조작하면 오래된 경우 바로 실행하고 이어서 갱신한다.
 */
export function useArrivalsRefresh(task: () => Promise<void>, enabled: boolean, intervalMs = config.refreshMs) {
  const visible = useVisible();
  const [lastRun, setLastRun] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  /** 진행 중인 실행 번호 (0 = 없음) */
  const busy = useRef(0);
  const seq = useRef(0);
  const last = useRef(0);
  const taskRef = useRef(task);
  taskRef.current = task;
  /** 마지막으로 실행한 task (같은 task 를 다시 켤 때 오래되지 않았으면 건너뛰기 위함) */
  const ranTask = useRef<(() => Promise<void>) | null>(null);

  const runNow = useCallback(async (force = false) => {
    if (busy.current && !force) return;
    const id = ++seq.current;
    busy.current = id;
    ranTask.current = taskRef.current;
    setRunning(true);
    setPaused(false);
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

  const stale = () => !last.current || Date.now() - last.current >= intervalMs;

  // 새 task(새 검색) → 진행 중인 요청이 있어도 바로 다시 실행. 같은 task 를 다시 켠 것이면 오래됐을 때만.
  useEffect(() => {
    if (!enabled) return;
    if (ranTask.current !== task) void runNow(true);
    else if (stale()) void runNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, task, runNow]);

  useEffect(() => {
    if (!enabled || !visible) return;
    if (stale() && !isIdle()) void runNow();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (isIdle()) { setPaused(true); return; }
      void runNow();
    }, intervalMs);
    const off = onResume(() => {
      setPaused(false);
      if (stale()) void runNow();
    });
    return () => { clearInterval(id); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, visible, intervalMs, runNow]);

  return { lastRun, running, paused, runNow };
}
