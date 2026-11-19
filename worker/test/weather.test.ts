import { describe, expect, it } from "vitest";
import { kstNow, parseCoord, summarize, toGrid, ultraBase, vilageBase, windChill } from "../src/weather";

/** kstNow 형식 Date: UTC 메서드가 한국 시각을 돌려준다 */
const kst = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));

describe("toGrid (기상청 LCC 격자)", () => {
  it("서울시청 37.5665,126.9780 → (60,127)", () => {
    expect(toGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("분당구청 부근(기본 좌표) → (62,123)", () => {
    expect(toGrid(37.3826, 127.1189)).toEqual({ nx: 62, ny: 123 });
  });

  it("판교역 부근도 성남 격자 근처", () => {
    const g = toGrid(37.3947, 127.1112);
    expect(Math.abs(g.nx - 62)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.ny - 123)).toBeLessThanOrEqual(1);
  });

  it("격자 원점(38N,126E) → (43,136)", () => {
    expect(toGrid(38, 126)).toEqual({ nx: 43, ny: 136 });
  });
});

describe("parseCoord", () => {
  it("없거나 빈 값(공백 포함)이면 기본값", () => {
    expect(parseCoord(null, 1.5)).toBe(1.5);
    expect(parseCoord("", 1.5)).toBe(1.5);
    expect(parseCoord("  ", 1.5)).toBe(1.5);
  });
  it("숫자가 아니면 null, 숫자면 그 값", () => {
    expect(parseCoord("abc", 1.5)).toBeNull();
    expect(parseCoord("Infinity", 1.5)).toBeNull();
    expect(parseCoord("37.38", 1.5)).toBe(37.38);
  });
});

describe("windChill", () => {
  it("10℃ 초과 또는 풍속 4.8km/h 미만이면 기온 그대로", () => {
    expect(windChill(10.1, 10)).toBe(10.1);
    expect(windChill(0, 1.3)).toBe(0); // 4.68 km/h
  });
  it("0℃, 5m/s(18km/h) → 약 -4.9℃ (소수 1자리)", () => {
    expect(windChill(0, 5)).toBeCloseTo(-4.9, 5);
  });
  it("경계: 정확히 10℃ 는 공식 적용(바람이 충분할 때)", () => {
    expect(windChill(10, 5)).toBeLessThan(10);
  });
});

describe("발표 시각 (KST)", () => {
  it("ultraBase: (현재-40분)의 정시", () => {
    expect(ultraBase(kst(2026, 11, 19, 8, 30))).toEqual({ date: "20261119", time: "0700" });
    expect(ultraBase(kst(2026, 11, 19, 8, 40))).toEqual({ date: "20261119", time: "0800" });
    expect(ultraBase(kst(2026, 11, 19, 0, 20))).toEqual({ date: "20261118", time: "2300" }); // 날짜 넘김
  });

  it("vilageBase: (현재-15분) 이전의 02·05·…·23시", () => {
    expect(vilageBase(kst(2026, 11, 19, 8, 30))).toEqual({ date: "20261119", time: "0800" });
    expect(vilageBase(kst(2026, 11, 19, 8, 10))).toEqual({ date: "20261119", time: "0500" });
    expect(vilageBase(kst(2026, 11, 19, 2, 15))).toEqual({ date: "20261119", time: "0200" }); // 경계
    expect(vilageBase(kst(2026, 11, 19, 2, 14))).toEqual({ date: "20261118", time: "2300" });
    expect(vilageBase(kst(2026, 11, 19, 23, 20))).toEqual({ date: "20261119", time: "2300" });
  });

  it("vilageBase: 1월 1일 새벽은 전년도 12월 31일 23시", () => {
    expect(vilageBase(kst(2027, 1, 1, 1, 0))).toEqual({ date: "20261231", time: "2300" });
  });

  it("kstNow: UTC+9", () => {
    const d = kstNow(Date.UTC(2026, 10, 19, 15, 0)); // UTC 15시 = KST 다음날 0시
    expect(d.getUTCDate()).toBe(20);
    expect(d.getUTCHours()).toBe(0);
  });
});

// ---------------------------------------------------------------- summarize

const ncst = (o: Record<string, string | number>) => Object.entries(o).map(([category, obsrValue]) => ({ category, obsrValue }));
const fc = (date: string, time: string, o: Record<string, string | number>) =>
  Object.entries(o).map(([category, fcstValue]) => ({ fcstDate: date, fcstTime: time, category, fcstValue }));

describe("summarize", () => {
  const now = kst(2026, 11, 19, 8, 30);
  const items = [
    ...fc("20261119", "0700", { SKY: 1, POP: 99, PTY: 1 }), // 지난 시각 → 무시
    ...fc("20261119", "0800", { SKY: 3, POP: 20, PTY: 0 }),
    ...fc("20261119", "0900", { SKY: 4, POP: 30, PTY: 0 }),
    ...fc("20261119", "1800", { SKY: 4, POP: 60, PTY: 1 }),
    ...fc("20261119", "2100", { SKY: 4, POP: 70, PTY: 3 }),
    ...fc("20261120", "0000", { SKY: 4, POP: 90, PTY: 1 }), // 내일 → maxPop/rainFrom 제외
  ];

  it("평범한 날: 현재 값 + 가장 이른 SKY + 처음 비 시각 + 오늘 최대 POP", () => {
    const s = summarize(ncst({ T1H: 6.2, WSD: 3, PTY: 0 }), items, now, 62, 123, "20261119 0800");
    expect(s).toEqual({
      temp: 6.2,
      feels: windChill(6.2, 3),
      sky: "구름많음",
      precip: "없음",
      rainFrom: { hour: 18, pop: 60, type: "비" },
      maxPop: 70,
      nx: 62,
      ny: 123,
      baseTime: "20261119 0800",
    });
  });

  it("현재 시각(정시)의 예보도 포함한다", () => {
    const s = summarize([], fc("20261119", "0800", { SKY: 1, PTY: 4, POP: 40 }), now, 1, 1, "");
    expect(s.sky).toBe("맑음");
    expect(s.rainFrom).toEqual({ hour: 8, pop: 40, type: "비" }); // 4(소나기) → "비"
  });

  it("23시 이후: 오늘 예보가 없으면 SKY 는 내일 가장 이른 값, rainFrom/maxPop 은 오늘 기준(없음)", () => {
    const late = kst(2026, 11, 19, 23, 30);
    const tomorrow = [...fc("20261120", "0000", { SKY: 1, POP: 80, PTY: 1 }), ...fc("20261120", "0100", { SKY: 4 })];
    const s = summarize(ncst({ T1H: -1, WSD: 0.5, PTY: 0 }), tomorrow, late, 62, 123, "x");
    expect(s.sky).toBe("맑음");
    expect(s.rainFrom).toBeNull();
    expect(s.maxPop).toBe(0);
    expect(s.feels).toBe(-1); // 바람 약함 → 기온 그대로
  });

  it("값이 빠지면 null — 기온 없음 → temp·feels null, 풍속 없음 → feels null", () => {
    expect(summarize(ncst({ WSD: 3 }), [], now, 1, 1, "")).toMatchObject({ temp: null, feels: null, sky: null, precip: null, rainFrom: null, maxPop: 0 });
    expect(summarize(ncst({ T1H: 5 }), [], now, 1, 1, "")).toMatchObject({ temp: 5, feels: null });
    expect(summarize(ncst({ T1H: "" }), [], now, 1, 1, "").temp).toBeNull();
  });

  it("현재 강수 형태 코드 매핑", () => {
    const p = (code: number) => summarize(ncst({ T1H: 1, PTY: code }), [], now, 1, 1, "").precip;
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(p)).toEqual(["없음", "비", "비/눈", "눈", "비", "빗방울", "빗방울눈날림", "눈날림"]);
    expect(p(9)).toBeNull();
  });

  it("POP 이 숫자가 아니면 0 으로 본다", () => {
    const s = summarize([], fc("20261119", "1000", { POP: "x", PTY: 0 }), now, 1, 1, "");
    expect(s.maxPop).toBe(0);
  });
});
