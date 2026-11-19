import { describe, expect, it } from "vitest";
import { directionHint, looksLikeAddress, samePlace, searchStations, stationPlace } from "../lib/places";
import { ST, standardDb } from "./fixtures";

// searchStations 는 첫 호출 때 색인을 모듈에 보관하므로, 이 파일은 DB 하나만 쓴다.
const { db } = standardDb();

describe("searchStations", () => {
  it("이름 앞부분 일치 — 같은 이름 정류장 둘 다", () => {
    const res = searchStations(db, "판교");
    expect(res.map((s) => s.id)).toEqual([ST.A.id, ST.A2.id]);
  });

  it("공백·기호를 무시한다", () => {
    expect(searchStations(db, " 판 교 ").map((s) => s.id)).toEqual([ST.A.id, ST.A2.id]);
  });

  it("중간 일치도 찾고, 같은 점수면 이름 길이 → 가나다 순", () => {
    const res = searchStations(db, "역");
    expect(res.map((s) => s.name)).toEqual(["서현역", "판교역", "판교역"]);
  });

  it("앞부분 일치(점수 2)가 중간 일치(점수 3)보다 먼저", () => {
    // "환승" 은 두 정류장 모두 앞부분, "건너" 는 중간 일치
    expect(searchStations(db, "환승").map((s) => s.id).sort()).toEqual([ST.T1.id, ST.T2.id].sort());
    expect(searchStations(db, "건너").map((s) => s.id)).toEqual([ST.T2.id]);
  });

  it("5자리 정류장 번호 정확히 일치가 맨 앞", () => {
    const res = searchStations(db, "01003");
    expect(res[0].id).toBe(ST.B.id);
  });

  it("앞자리 0 을 빼고 입력해도 정확 일치로 본다 (1003 → 01003)", () => {
    const res = searchStations(db, "1003");
    expect(res[0].id).toBe(ST.B.id);
  });

  it("번호 일부 일치는 여러 개", () => {
    const res = searchStations(db, "0100");
    expect(res.map((s) => s.no).sort()).toEqual(["01001", "01002", "01003", "01004"]);
  });

  it("초성 검색", () => {
    expect(searchStations(db, "ㅂㅎ").map((s) => s.id)).toEqual([ST.B.id]);
    expect(searchStations(db, "ㅎㅅ").map((s) => s.id).sort()).toEqual([ST.T1.id, ST.T2.id].sort());
  });

  it("초성과 글자가 섞이면 초성 검색을 하지 않는다", () => {
    expect(searchStations(db, "ㅂ현")).toEqual([]);
  });

  it("빈 입력·공백만 → 빈 배열", () => {
    expect(searchStations(db, "")).toEqual([]);
    expect(searchStations(db, "   ")).toEqual([]);
  });

  it("sel 이 아닌(성남 밖) 정류장은 나오지 않는다", () => {
    expect(searchStations(db, "성남밖")).toEqual([]);
  });

  it("limit 적용", () => {
    expect(searchStations(db, "0100", 2)).toHaveLength(2);
  });

  it("6자리 이상 숫자는 번호 검색이 아니다", () => {
    expect(searchStations(db, "010030")).toEqual([]);
  });
});

describe("looksLikeAddress", () => {
  it.each([
    ["판교역로 166", true],
    ["분당구", true],
    ["백현동", true],
    ["성남시 분당구 정자일로", true],
    ["불정로 ", true],
    ["판교역", false],
    ["서현", false],
    ["정자동주민센터", false], // '동' 뒤에 글자가 이어지면 주소로 보지 않음
    ["시흥", false],
  ])("%s → %s", (q, expected) => {
    expect(looksLikeAddress(q)).toBe(expected);
  });

  it("숫자만 있어도 주소 후보 (정류장 번호와 함께 Geocoding 을 시도)", () => {
    expect(looksLikeAddress("07015")).toBe(true);
  });
});

describe("directionHint / stationPlace / samePlace", () => {
  it("다음 정류장 이름으로 방면 표시", () => {
    expect(directionHint(db, ST.B)).toBe("서현역 방면");
  });

  it("다음 정류장이 없으면 빈 문자열", () => {
    expect(directionHint(db, ST.D)).toBe("");
  });

  it("stationPlace 라벨에 번호", () => {
    expect(stationPlace(ST.A)).toEqual({ kind: "station", stationId: ST.A.id, label: "판교역 (01001)", lat: ST.A.y, lng: ST.A.x });
  });

  it("samePlace: 정류장은 id, 위치는 좌표로 비교", () => {
    expect(samePlace(stationPlace(ST.A), { ...stationPlace(ST.A), label: "다른 라벨" })).toBe(true);
    expect(samePlace(stationPlace(ST.A), stationPlace(ST.A2))).toBe(false);
    const p = { kind: "point" as const, label: "x", lat: 37.4, lng: 127.1 };
    expect(samePlace(p, { ...p, label: "y" })).toBe(true);
    expect(samePlace(p, stationPlace(ST.A))).toBe(false); // 종류가 다르면 좌표가 같아도 다름
  });
});
