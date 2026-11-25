import { useEffect, useRef, useState } from "react";
import type { DocView } from "../../App";
import { BUILD_ID } from "../../hooks/useNewVersion";

/** 빌드 시각을 한국 시간 "2026.11.19 23:41" 로 (ADR-034). 지금 보고 있는 화면이 최신인지 확인용 */
function versionLabel(): string {
  const d = new Date(BUILD_ID);
  if (Number.isNaN(d.getTime())) return BUILD_ID;
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/** 메뉴 항목 (ADR-033). 문서가 늘면 여기에 추가한다 */
const ITEMS: { name: DocView["name"]; label: string }[] = [
  { name: "privacy", label: "개인위치정보 처리방침" },
  { name: "sources", label: "데이터 출처" },
];

/** 모든 화면 오른쪽 위 ☰ 버튼 + 펼침 메뉴. 바깥을 누르거나 Esc 로 닫힌다 */
export function AppMenu({ onOpen, onBus }: {
  onOpen(name: DocView["name"]): void;
  /** 🚌 버튼: 버스 번호 검색 화면으로 (ADR-039). 그 화면에서는 주지 않는다 */
  onBus?(): void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="app-menu" ref={box}>
      {onBus && (
        <button type="button" className="app-menu-btn app-bus-btn" aria-label="버스 번호로 노선 찾기" title="버스 검색" onClick={() => { setOpen(false); onBus(); }} data-testid="bus-search-btn">
          <span aria-hidden>🚌</span>
        </button>
      )}
      <button
        type="button"
        className="app-menu-btn"
        aria-label="메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="app-menu"
      >
        <span aria-hidden>☰</span>
      </button>
      {open && (
        <ul className="app-menu-list" role="menu" data-testid="app-menu-list">
          {ITEMS.map((it, n) => (
            <li key={it.name} role="none">
              <button
                ref={n === 0 ? first : undefined}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onOpen(it.name); }}
                data-testid={`menu-${it.name}`}
              >
                {it.label}
              </button>
            </li>
          ))}
          <li role="none" className="app-menu-version" data-testid="app-version">버전 {versionLabel()}</li>
        </ul>
      )}
    </div>
  );
}
