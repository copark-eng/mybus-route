import { describe, expect, it } from "vitest";
import { remaining } from "../hooks/useCountdown";
import { routeColorVar, routeTypeKey } from "../lib/routeType";
import { esc, fmtClock, fmtDepart, fmtMin, fmtWait, shortLabel } from "../lib/util";
import { type WeatherSummary, formatWeather } from "../lib/weather";

const w = (over: Partial<WeatherSummary> = {}): WeatherSummary => ({
  temp: 6.2,
  feels: 3.1,
  sky: "구름많음",
  precip: "없음",
  rainFrom: null,
  maxPop: 0,
  nx: 62,
  ny: 123,
  baseTime: "20261119 0800",
  ...over,
});

describe("formatWeather (02_api_spec 프런트 표시 규칙)", () => {
  it("문서 예시 그대로", () => {
    const s = formatWeather(w({ rainFrom: { hour: 18, pop: 60, type: "비" }, maxPop: 70 }), 8);
    expect(s).toBe("6° 구름많음 · 체감 3° · 오후 6시부터 비 60% · 우산 챙기세요");
  });

  it("temp 가 null·NaN 이면 줄 전체 숨김(null)", () => {
    expect(formatWeather(w({ temp: null }), 8)).toBeNull();
    expect(formatWeather(w({ temp: Number.NaN }), 8)).toBeNull();
  });

  it("sky 가 null 이면 기온만", () => {
    expect(formatWeather(w({ sky: null, feels: null }), 8)).toBe("6°");
  });

  it("체감: 차이 1° 이상일 때만", () => {
    expect(formatWeather(w({ temp: 6, feels: 5.1, sky: null }), 8)).toBe("6°");
    expect(formatWeather(w({ temp: 6, feels: 5, sky: null }), 8)).toBe("6° · 체감 5°");
    expect(formatWeather(w({ temp: 6, feels: null, sky: null }), 8)).toBe("6°");
  });

  it("지금 비가 오면 rainFrom 보다 우선", () => {
    const s = formatWeather(w({ feels: null, precip: "비", rainFrom: { hour: 18, pop: 60, type: "비" } }), 8);
    expect(s).toBe("6° 구름많음 · 지금 비 · 우산 챙기세요");
  });

  it("precip null 은 '없음'과 같다", () => {
    expect(formatWeather(w({ feels: null, precip: null }), 8)).toBe("6° 구름많음");
  });

  it.each([
    [0, 8, "오전 12시부터"],
    [11, 8, "오전 11시부터"],
    [12, 8, "오후 12시부터"],
    [23, 8, "오후 11시부터"],
  ])("rainFrom.hour %d → %s", (hour, now, label) => {
    expect(formatWeather(w({ feels: null, rainFrom: { hour, pop: 40, type: "눈" } }), now)).toBe(`6° 구름많음 · ${label} 눈 40% · 우산 챙기세요`);
  });

  it("rainFrom 이 지금 시각이면 '곧'", () => {
    expect(formatWeather(w({ feels: null, rainFrom: { hour: 14, pop: 80, type: "비" } }), 14)).toBe("6° 구름많음 · 곧 비 80% · 우산 챙기세요");
  });

  it("비 예보가 없고 강수확률 60% 이상이면 확률만 (경계 60)", () => {
    expect(formatWeather(w({ feels: null, maxPop: 60 }), 8)).toBe("6° 구름많음 · 강수확률 60%");
    expect(formatWeather(w({ feels: null, maxPop: 59 }), 8)).toBe("6° 구름많음");
  });

  it("영하 반올림", () => {
    expect(formatWeather(w({ temp: -3.6, feels: null, sky: "맑음" }), 8)).toBe("-4° 맑음");
  });
});

describe("util 포맷", () => {
  it.each([
    [0, "곧"],
    [59, "곧"],
    [60, "1분"],
    [61, "1분 1초"],
    [599, "9분 59초"],
    [600, "10분"],
    [659, "10분"],
  ])("fmtWait(%d) = %s", (sec, out) => {
    expect(fmtWait(sec)).toBe(out);
  });

  it("fmtMin: 반올림, 최소 1분", () => {
    expect(fmtMin(0)).toBe("1분");
    expect(fmtMin(89)).toBe("1분");
    expect(fmtMin(90)).toBe("2분");
    expect(fmtMin(3600)).toBe("60분");
  });

  it("fmtDepart: 60초 미만 '곧 출발'", () => {
    expect(fmtDepart(59)).toBe("곧 출발");
    expect(fmtDepart(60)).toBe("1분 후 출발");
    expect(fmtDepart(125)).toBe("2분 5초 후 출발");
  });

  it("fmtClock: HH:MM 두 자리", () => {
    expect(fmtClock(new Date(2026, 10, 19, 7, 5).getTime())).toBe("07:05");
    expect(fmtClock(new Date(2026, 10, 19, 23, 59).getTime())).toBe("23:59");
  });

  it("shortLabel: 번호·시·구 제거 후 max 글자", () => {
    expect(shortLabel("판교역 (07015)")).toBe("판교역");
    expect(shortLabel("성남시 분당구 판교역로 166")).toBe("판교역로 166");
    expect(shortLabel("분당구 정자일로 95")).toBe("정자일로 95");
    expect(shortLabel("아주아주아주아주긴정류장이름입니다", 5)).toBe("아주아주아");
  });

  it("esc: HTML 특수문자", () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  });

  it("remaining: 흐른 시간만큼 줄이고 0 미만은 0, null 은 null", () => {
    expect(remaining(300, 1_000_000, 1_000_000 + 60_000)).toBe(240);
    expect(remaining(30, 1_000_000, 1_000_000 + 60_000)).toBe(0);
    expect(remaining(null, 0, 0)).toBeNull();
  });
});

describe("routeTypeKey (01_architecture 노선 종류 표)", () => {
  it.each([
    ["마을버스", "village"],
    ["일반형시내버스", "normal"],
    ["직행좌석형시내버스", "direct"],
    ["좌석형시내버스", "seat"],
    ["광역급행형시내버스", "express"],
    ["일반형시외버스", "normal"],
    ["일반형 공항버스", "airport"], // '일반' 보다 '공항' 이 먼저
    ["리무진형 공항버스", "airport"],
    ["관광지순환", "default"],
    ["", "default"],
  ])("%s → %s", (type, key) => {
    expect(routeTypeKey(type)).toBe(key);
  });

  it("null/undefined → default, CSS 변수 이름", () => {
    expect(routeTypeKey(null)).toBe("default");
    expect(routeTypeKey(undefined)).toBe("default");
    expect(routeColorVar("마을버스")).toBe("var(--route-village)");
  });
});
