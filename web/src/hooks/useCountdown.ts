import { useSyncExternalStore } from "react";

/** 모듈 하나의 1초 타이머를 모든 컴포넌트가 함께 쓴다 (ADR-015). 숨김 탭에서는 멈춘다. */
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  if (document.visibilityState !== "visible") return;
  now = Date.now();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

const noSubscribe = () => () => {};

/** 현재 시각(ms). 1초마다 갱신 */
export function useCountdown(enabled = true): number {
  return useSyncExternalStore(enabled ? subscribe : noSubscribe, () => now);
}

/** 남은 초 = sec - 흐른 시간, 0 미만은 0 */
export function remaining(sec: number | null, evaluatedAt: number, at: number): number | null {
  if (sec === null) return null;
  return Math.max(0, Math.round(sec - (at - evaluatedAt) / 1000));
}
