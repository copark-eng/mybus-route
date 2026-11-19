import { config } from "../../lib/config";
import { IconButton } from "../ui";

/** "방금 갱신 · 30초마다 자동" / "갱신 중…" + ↻ 버튼. 오류는 --danger 로 */
export function RefreshStatus({ lastUpdated, loading, now, error, onRefresh }: {
  lastUpdated: number;
  loading: boolean;
  now: number;
  error?: string | null;
  onRefresh(): void;
}) {
  const ago = lastUpdated ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null;
  // 스크린리더 소음을 줄이려고 aria-live 문구는 갱신 상태가 바뀔 때만 달라지게 한다
  const live = error ? "실시간 정보를 가져오지 못했습니다" : loading ? "갱신 중…" : lastUpdated ? "갱신 완료" : "";
  const text = error
    ? "실시간 정보를 가져오지 못했습니다"
    : loading
      ? "갱신 중…"
      : ago === null
        ? ""
        : `${ago < 5 ? "방금" : `${ago}초 전`} 갱신 · ${config.refreshMs / 1000}초마다 자동`;
  return (
    <div className="refresh-status" data-testid="refresh-status">
      <span className={error ? "danger" : ""}>{text}</span>
      <span className="sr-only" aria-live="polite">{live}</span>
      <IconButton label="새로고침" icon="↻" onClick={onRefresh} data-testid="refresh" className={loading ? "spinning" : ""} />
    </div>
  );
}
