import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useDb } from "../../context";
import { geocode } from "../../lib/api";
import { type Place, directionHint, looksLikeAddress, searchStations, stationPlace } from "../../lib/places";
import { debounce } from "../../lib/util";

export interface PlaceInputHandle { focus(): void }

interface Suggest { place: Place; hint: string }

/**
 * 출발·도착 입력 (FR-1.2~1.4). combobox 패턴.
 * 정류장 7개(이름·번호·초성) + 주소처럼 보이면 300ms 뒤 Geocoding 주소 4개.
 */
export const PlaceInput = forwardRef<PlaceInputHandle, {
  role: "from" | "to";
  value: Place | null;
  onChange(p: Place | null): void;
  /** 고른 뒤 다음 입력으로 넘어가면 true (아니면 입력에서 포커스를 뺀다) */
  onPicked?(): boolean;
}>(function PlaceInput({ role, value, onChange, onPicked }, ref) {
  const db = useDb();
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value?.label ?? "");
  const [items, setItems] = useState<Suggest[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const latestQuery = useRef("");

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  // 바깥에서 값이 바뀌면(지도 선택, 바꾸기, 최근 검색) 입력 글자도 맞춘다
  useEffect(() => { setText(value?.label ?? ""); }, [value]);

  const lookup = useMemo(
    () =>
      debounce(async (q: string, base: Suggest[]) => {
        const found = await geocode(q).catch(() => []);
        if (latestQuery.current !== q) return;
        const addr = found.slice(0, 4).map<Suggest>((a) => ({
          place: { kind: "point", label: (a.roadAddress ?? a.jibunAddress ?? q).replace(/^경기도\s*/, ""), lat: a.lat, lng: a.lng },
          hint: "",
        }));
        setItems([...base, ...addr]);
        setOpen(base.length + addr.length > 0);
      }, 300),
    [],
  );

  const onInput = (raw: string) => {
    setText(raw);
    const q = raw.trim();
    latestQuery.current = q;
    setActive(-1);
    if (q.length < 1) { setItems([]); setOpen(false); return; }
    const stations = searchStations(db, q, 7);
    const base = stations.map((s) => ({ place: stationPlace(s), hint: directionHint(db, s) }));
    setItems(base);
    setOpen(base.length > 0);
    if (q.length >= 2 && looksLikeAddress(q)) lookup(q, base);
  };

  const pick = (s: Suggest) => {
    latestQuery.current = ""; // 대기 중인 주소 검색 응답이 고른 뒤 목록을 다시 열지 않게
    setOpen(false);
    setActive(-1);
    setText(s.place.label);
    onChange(s.place);
    if (!onPicked?.()) inputRef.current?.blur();
  };

  const clear = () => {
    latestQuery.current = "";
    setText("");
    setItems([]);
    setOpen(false);
    onChange(null);
    inputRef.current?.focus();
  };

  const tag = role === "from" ? "출발" : "도착";
  return (
    <div className={`place-input place-${role}`}>
      <span className={`place-dot dot-${role}`} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={`${tag}지`}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        placeholder={`${tag} · 정류장 이름·번호 또는 주소`}
        enterKeyHint={role === "from" ? "next" : "search"}
        autoComplete="off"
        value={text}
        data-testid={`input-${role}`}
        onChange={(e) => onInput(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open && items.length) setOpen(true);
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const s = items[active >= 0 ? active : 0];
            if (s) pick(s);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {text && (
        <button type="button" className="place-clear" aria-label={`${tag}지 지우기`} onClick={clear} data-testid={`clear-${role}`}>
          <span aria-hidden="true">×</span>
        </button>
      )}
      <ul id={listId} role="listbox" className="suggest" hidden={!open} data-testid={`suggest-${role}`}>
        {items.map((s, i) => (
          <li
            key={`${s.place.kind}-${s.place.label}-${i}`}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? "active" : ""}
            onMouseDown={(e) => { e.preventDefault(); pick(s); }}
            onMouseEnter={() => setActive(i)}
          >
            <span className={`kind kind-${s.place.kind}`}>{s.place.kind === "station" ? "정류장" : "주소"}</span>
            <span className="sg-main">{s.place.label}</span>
            {s.hint && <small>{s.hint}</small>}
          </li>
        ))}
      </ul>
    </div>
  );
});
