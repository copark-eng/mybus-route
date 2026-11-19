import { useEffect, useRef, useState } from "react";
import type { DocView } from "../../App";

/** 메뉴 항목 (ADR-033). 문서가 늘면 여기에 추가한다 */
const ITEMS: { name: DocView["name"]; label: string }[] = [
  { name: "privacy", label: "개인위치정보 처리방침" },
];

/** 모든 화면 오른쪽 위 ☰ 버튼 + 펼침 메뉴. 바깥을 누르거나 Esc 로 닫힌다 */
export function AppMenu({ onOpen }: { onOpen(name: DocView["name"]): void }) {
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
        </ul>
      )}
    </div>
  );
}
