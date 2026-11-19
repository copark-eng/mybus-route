import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMine, myLocationPlace, samePlace, stationPlace } from "../lib/places";
import * as store from "../lib/storage";

describe("내 위치 Place (ADR-030)", () => {
  it("myLocationPlace 는 mine 표시가 붙은 point", () => {
    const p = myLocationPlace(37.4, 127.1);
    expect(p).toEqual({ kind: "point", label: "내 위치", lat: 37.4, lng: 127.1, mine: true });
    expect(isMine(p)).toBe(true);
    expect(isMine({ kind: "point", label: "주소", lat: 37.4, lng: 127.1 })).toBe(false);
    expect(isMine(null)).toBe(false);
  });

  it("좌표가 달라도 내 위치끼리는 같은 장소로 본다", () => {
    expect(samePlace(myLocationPlace(37.4, 127.1), myLocationPlace(37.41, 127.12))).toBe(true);
  });

  it("내 위치와 같은 좌표의 일반 지점은 다르다", () => {
    expect(samePlace(myLocationPlace(37.4, 127.1), { kind: "point", label: "x", lat: 37.4, lng: 127.1 })).toBe(false);
  });
});

describe("최근 검색: 내 위치가 움직여도 한 항목만 남는다", () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
  });

  it("위치 3번 갱신 → 최근 검색 1개, 마지막 좌표로", () => {
    const to = stationPlace({ id: "1", no: "07147", name: "서현역", x: 127.12, y: 37.38 });
    store.savePair(myLocationPlace(37.40, 127.10), to);
    store.savePair(myLocationPlace(37.401, 127.101), to);
    store.savePair(myLocationPlace(37.402, 127.102), to);
    const pairs = store.getPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].from).toMatchObject({ mine: true, lat: 37.402 });
  });
});
