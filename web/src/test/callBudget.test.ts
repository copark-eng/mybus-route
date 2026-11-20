/** 불필요한 호출 줄이기 (ADR-035) */
import { describe, expect, it } from "vitest";
import { __setLastInteraction, IDLE_MS, isIdle } from "../hooks/useIdle";
import { looksLikeAddress } from "../lib/places";

describe("자동 갱신 멈춤 판단 (idle)", () => {
  it("마지막 조작 후 5분이 지나면 idle", () => {
    const now = Date.now();
    __setLastInteraction(now - IDLE_MS - 1000);
    expect(isIdle(now)).toBe(true);
    __setLastInteraction(now - 60_000);
    expect(isIdle(now)).toBe(false);
  });
});

describe("정류장 번호는 주소 검색을 부르지 않는다", () => {
  it.each(["07015", "7015", " 07147 "])("%s → 주소 아님", (q) => expect(looksLikeAddress(q)).toBe(false));
  it.each(["판교역로 166", "서현동 263", "분당구 정자동"])("%s → 주소", (q) => expect(looksLikeAddress(q)).toBe(true));
});
