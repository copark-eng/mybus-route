/**
 * 도착정보 API 호출 수 측정 (ADR-032). 실제 경기도 데이터로 대표 검색 몇 개를 돌려
 * 첫 평가와 자동 갱신(위쪽 4개만) 때 부르는 정류장 수를 센다. 데이터 파일이 없으면 건너뛴다.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchArrivals: vi.fn(async (id: string) => { calls.push(id); return { stationId: id, fetchedAt: Date.now(), routes: [] }; }),
}));

import { buildDb } from "../lib/data";
import type { Place } from "../lib/places";
import { evaluate, findPlans } from "../lib/router";

const dir = path.resolve(__dirname, "../../public/data");
const has = fs.existsSync(path.join(dir, "stations.json"));

describe.skipIf(!has)("도착정보 호출 수", () => {
  const db = has
    ? buildDb(JSON.parse(fs.readFileSync(path.join(dir, "stations.json"), "utf8")), JSON.parse(fs.readFileSync(path.join(dir, "routes.json"), "utf8")))
    : (null as never);
  const stop = (no: string): Place => {
    const s = db.selectable.find((x) => x.no === no)!;
    return { kind: "station", stationId: s.id, label: s.name, lat: s.y, lng: s.x };
  };
  const pt = (lat: number, lng: number): Place => ({ kind: "point", label: "p", lat, lng });
  beforeEach(() => { calls.length = 0; });

  it.each([
    ["07015 → 07147 (정류장→정류장)", () => stop("07015"), () => stop("07147")],
    ["판교역로 166 → 서현역 (주소→정류장)", () => pt(37.3955, 127.1104), () => stop("07147")],
    ["판교 → 수원시청 (시 경계)", () => stop("07015"), () => stop("02251")],
  ])("%s", async (name, from, to) => {
    const plans = findPlans(db, from(), to(), true);
    await evaluate(db, plans);
    const first = calls.length;
    calls.length = 0;
    await evaluate(db, plans.slice(0, 4));
    const refresh = calls.length;
    console.log(`${name}: 후보 ${plans.length}개, 첫 평가 ${first}회, 자동 갱신 1회당 최대 ${refresh}회 (+출발 정류장 도착판 1회)`);
    expect(first).toBeGreaterThan(0);
  });
});
