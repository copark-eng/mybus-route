export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 남은 시간 표시: "곧 도착" / "3분 20초" / "25분" */
export function fmtWait(sec: number): string {
  if (sec < 60) return "곧";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m >= 10 || s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

export const fmtMin = (sec: number) => `${Math.max(1, Math.round(sec / 60))}분`;

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
