import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useDb } from "../../context";
import { searchRoutes } from "../../lib/routeSearch";
import { RouteBadge } from "./RouteBadge";

/** 마지막 검색어. 노선 화면에 갔다가 뒤로 오면 그대로 보여 준다 (ADR-039) */
let lastQuery = "";

/**
 * 버스 번호로 노선 바로 찾기 (ADR-038). 결과는 입력 아래에 펼쳐 두므로 키패드를 내려도 남는다.
 * 노선을 고르면 노선 정보 화면(실시간 버스 위치)으로 간다.
 */
export function RouteFinder({ onOpen, autoFocus = false, title = "버스 노선 바로 보기" }: {
  onOpen(routeId: string): void;
  /** 버스 검색 화면에서는 열자마자 입력 (키패드가 뜬다) */
  autoFocus?: boolean;
  /** 섹션 제목. null 이면 숨김(화면 제목이 따로 있을 때) */
  title?: string | null;
}) {
  const db = useDb();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQState] = useState(lastQuery);
  const setQ = (v: string) => { lastQuery = v; setQState(v); };
  // 열자마자 입력. 이전 검색 결과가 있으면(노선 화면에서 뒤로 옴) 키패드가 결과를 가리지 않게 띄우지 않는다
  useEffect(() => { if (autoFocus && !lastQuery) input.current?.focus(); }, [autoFocus]);
  const hits = useMemo(() => searchRoutes(db, q, 30), [db, q]);
  const shown = q.trim().length > 0;

  return (
    <section className={title ? "section route-finder" : "route-finder"} aria-labelledby={title ? `${id}-t` : undefined}>
      {title && <h2 id={`${id}-t`} className="section-title">{title}</h2>}
      <div className="route-finder-box">
        <span aria-hidden="true" className="route-finder-icon">🚌</span>
        <input
          ref={input}
          type="search"
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="버스 번호 (예: 9407, M4102)"
          aria-label="버스 번호"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); input.current?.blur(); } }}
          data-testid="route-finder-input"
        />
        {q && (
          <button type="button" className="place-clear" aria-label="버스 번호 지우기" onClick={() => { setQ(""); input.current?.focus(); }}>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {shown && (
        hits.length ? (
          <ul className="route-hits" data-testid="route-finder-list" onTouchMove={() => input.current?.blur()}>
            {hits.map((h) => (
              <li key={h.route.id}>
                <button type="button" className="route-hit" onClick={() => onOpen(h.route.id)} data-testid="route-hit">
                  <RouteBadge name={h.route.name} type={h.route.type} size="sm" />
                  <span className="route-hit-main">
                    <span className="route-hit-ends">{h.from}{h.to && h.to !== h.from ? ` → ${h.to}` : ""}</span>
                    {h.route.region && <small className="muted">{h.route.region}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small route-hits-empty">“{q.trim()}” 번 노선을 찾지 못했습니다.</p>
        )
      )}
    </section>
  );
}
