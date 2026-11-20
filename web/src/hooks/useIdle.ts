/**
 * 사용자 조작 감지 (ADR-035). 화면을 켜 둔 채 두면 자동 갱신이 data.go.kr 일일 한도를 계속 쓰므로,
 * 마지막 조작 후 IDLE_MS 가 지나면 자동 갱신을 멈춘다. 다시 만지면 바로 이어서 갱신한다.
 */
export const IDLE_MS = 5 * 60_000;

let lastInteraction = Date.now();
const listeners = new Set<() => void>();

function touch() {
  const wasIdle = isIdle();
  lastInteraction = Date.now();
  if (wasIdle) listeners.forEach((f) => f());
}

if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"] as const) {
    window.addEventListener(ev, touch, { capture: true, passive: true });
  }
  // 다른 앱에 갔다가 돌아온 것도 조작으로 본다
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") touch(); });
}

export const isIdle = (now = Date.now()) => now - lastInteraction > IDLE_MS;

/** 쉬다가(idle) 다시 조작했을 때 부를 함수를 등록한다 */
export function onResume(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 테스트용 */
export function __setLastInteraction(t: number) {
  lastInteraction = t;
}
