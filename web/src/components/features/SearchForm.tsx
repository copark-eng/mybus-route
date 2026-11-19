import type { Ref } from "react";
import type { Place } from "../../lib/places";
import { IconButton, Segmented } from "../ui";
import { PlaceInput, type PlaceInputHandle } from "./PlaceInput";

export type SearchMode = "transfer" | "direct";

const MODES = [
  { value: "transfer" as const, label: "환승 포함" },
  { value: "direct" as const, label: "직행만" },
];

/** 출발·도착 입력 + ⇅ 바꾸기 + 환승 포함/직행만 */
export function SearchForm({ from, to, mode, onFrom, onTo, onSwap, onMode, fromRef, toRef }: {
  from: Place | null;
  to: Place | null;
  mode: SearchMode;
  onFrom(p: Place | null): void;
  onTo(p: Place | null): void;
  onSwap(): void;
  onMode(m: SearchMode): void;
  fromRef?: Ref<PlaceInputHandle>;
  toRef?: Ref<PlaceInputHandle>;
}) {
  return (
    <form className="search-form" autoComplete="off" onSubmit={(e) => e.preventDefault()} data-testid="search-form">
      <div className="search-inputs">
        <div className="search-fields">
          <PlaceInput
            ref={fromRef}
            role="from"
            value={from}
            onChange={onFrom}
            onPicked={() => {
              // 도착지가 비어 있으면 도착 입력으로 넘어간다
              if (to || !toRef || typeof toRef !== "object" || !toRef.current) return false;
              toRef.current.focus();
              return true;
            }}
          />
          <PlaceInput ref={toRef} role="to" value={to} onChange={onTo} />
        </div>
        <IconButton label="출발지와 도착지 바꾸기" icon="⇅" onClick={onSwap} data-testid="swap" className="swap-btn" />
      </div>
      <Segmented label="검색 방식" options={MODES} value={mode} onChange={onMode} />
    </form>
  );
}
