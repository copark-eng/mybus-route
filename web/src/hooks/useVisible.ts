import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

/** 탭이 보이는지 (숨김 탭에서는 갱신을 멈춘다) */
export function useVisible(): boolean {
  return useSyncExternalStore(subscribe, () => document.visibilityState === "visible");
}
