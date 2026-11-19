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

/** 장소 라벨을 짧게: 정류장 번호 "(12345)" 와 앞의 "○○시 ○○구" 를 떼고 max 글자까지 */
export function shortLabel(label: string, max = 14): string {
  return label
    .replace(/\s*\(\d+\)$/, "")
    .replace(/^(\S+시\s+)?(\S+구\s+)?/, "")
    .slice(0, max);
}

/** "n분 후" 형식의 출발 안내. 60초 미만은 "곧" */
export function fmtDepart(sec: number): string {
  return sec < 60 ? "곧 출발" : `${fmtWait(sec)} 후 출발`;
}
