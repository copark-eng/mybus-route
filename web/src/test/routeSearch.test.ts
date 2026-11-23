import { describe, expect, it } from "vitest";
import { searchRoutes } from "../lib/routeSearch";
import { ST, makeDb, route } from "./fixtures";

const db = makeDb([
  route("1", "100", "일반형시내버스", [ST.A, ST.B, ST.C], { turn: 2, region: "수원" }),
  route("2", "10", "일반형시내버스", [ST.A, ST.B, ST.C], { turn: 1, region: "용인" }),
  route("3", "10", "마을버스", [ST.C, ST.D], { turn: 1, region: "성남" }),
  route("4", "1550-1", "직행좌석형시내버스", [ST.T1, ST.D], { turn: 1 }),
  route("5", "M4102", "광역급행형시내버스", [ST.T2, ST.D], { turn: 1 }),
  route("6", "110", "일반형시내버스", [ST.A, ST.C], { turn: 1 }),
]);
const ids = (q: string) => searchRoutes(db, q).map((h) => h.route.id);

describe("searchRoutes (ADR-038)", () => {
  it("정확히 일치가 먼저, 같은 번호는 운행지역 순", () => {
    expect(ids("10")).toEqual(["3", "2", "1", "6", "5"]); // 10(성남), 10(용인), 100, 110, 중간 일치 M4102
  });

  it("앞부분 일치가 중간 일치보다 먼저", () => {
    expect(ids("1").slice(0, 2).sort()).toEqual(["2", "3"]); // 짧은 번호(10) 먼저
    expect(ids("410")).toEqual(["5"]); // 중간 일치
  });

  it("대소문자·공백·하이픈은 상관없다", () => {
    expect(ids("m4102")).toEqual(["5"]);
    expect(ids(" 1550 - 1 ")).toEqual(["4"]);
    expect(ids("15501")).toEqual(["4"]);
  });

  it("기점과 회차점 이름을 함께 준다", () => {
    const h = searchRoutes(db, "100")[0];
    expect(h).toMatchObject({ from: "판교역", to: "서현역" });
    expect(searchRoutes(db, "10")[1]).toMatchObject({ from: "판교역", to: "백현마을" });
  });

  it("빈 입력은 빈 결과, limit 적용", () => {
    expect(searchRoutes(db, "  ")).toEqual([]);
    expect(searchRoutes(db, "1", 2)).toHaveLength(2);
  });
});
