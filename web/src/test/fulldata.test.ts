/**
 * 실제 경기도 데이터(web/public/data)로 로딩·검색 시간을 확인한다 (ADR-027).
 * 데이터 파일이 없으면 건너뛴다.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDb } from "../lib/data";
import { findPlans } from "../lib/router";
import type { Place } from "../lib/places";

const dir = path.resolve(__dirname, "../../public/data");
const has = fs.existsSync(path.join(dir, "stations.json")) && fs.existsSync(path.join(dir, "routes.json"));

describe.skipIf(!has)("경기도 전체 데이터", () => {
  const t0 = performance.now();
  const db = has
    ? buildDb(
        JSON.parse(fs.readFileSync(path.join(dir, "stations.json"), "utf8")),
        JSON.parse(fs.readFileSync(path.join(dir, "routes.json"), "utf8")),
      )
    : (null as never);
  const loadMs = performance.now() - t0;

  const point = (lat: number, lng: number, label: string): Place => ({ kind: "point", label, lat, lng });
  const stop = (no: string): Place => {
    const s = db.selectable.find((x) => x.no === no)!;
    return { kind: "station", stationId: s.id, label: s.name, lat: s.y, lng: s.x };
  };

  it("데이터를 읽어 색인을 만든다 (1.5초 이내)", () => {
    console.log(`buildDb ${loadMs.toFixed(0)}ms, 정류장 ${db.stations.size}, 선택 가능 ${db.selectable.length}, 노선 ${db.routes.size}`);
    expect(db.selectable.length).toBeGreaterThan(30000);
    expect(db.routes.size).toBeGreaterThan(3000);
    expect(loadMs).toBeLessThan(1500);
  });

  it.each([
    ["판교원마을 07015 → 서현역 07147", () => stop("07015"), () => stop("07147")],
    ["판교 → 수원시청 (주소)", () => stop("07015"), () => point(37.2636, 127.0286, "수원시청")],
    ["성남시청 → 의정부시청 (장거리)", () => point(37.42, 127.1267, "성남시청"), () => point(37.7381, 127.0337, "의정부시청")],
  ])("%s: 후보 탐색 0.5초 이내", (_name, from, to) => {
    const t = performance.now();
    const plans = findPlans(db, from(), to(), true);
    const ms = performance.now() - t;
    console.log(`${_name}: 후보 ${plans.length}개, ${ms.toFixed(0)}ms, 예) ${plans.slice(0, 3).map((p) => p.legs.map((l) => l.route.name).join("→")).join(", ")}`);
    expect(ms).toBeLessThan(500);
  });

  it("서현역 07147 → 판교원마을 07015: 602 타고 백현마을1단지에서 341·103 으로 갈아타는 경로를 후보에 넣는다 (ADR-042)", () => {
    const plans = findPlans(db, stop("07147"), stop("07015"), true);
    const names = plans.map((p) => p.legs.map((l) => l.route.name).join(">"));
    expect(names).toContain("602>341");
    expect(names).toContain("602>103");
    const p = plans.find((x) => x.legs.map((l) => l.route.name).join(">") === "602>341")!;
    expect(db.stations.get(p.legs[0].route.stops[p.legs[0].toIndex])!.name).toBe("백현마을1단지");
    // 같은 곳에서 같은 두 번째 버스로 갈아타는 후보는 하나만
    const keys = plans.filter((x) => x.legs.length === 2).map((x) => x.legs[1].route.id + "@" + x.legs[1].route.stops[x.legs[1].fromIndex]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
