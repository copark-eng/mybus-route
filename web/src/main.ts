import "./style.css";
import { initMap } from "./map";

const status = document.querySelector<HTMLDivElement>("#status")!;

initMap(document.querySelector<HTMLDivElement>("#map")!).catch((e: unknown) => {
  status.textContent = `지도를 불러오지 못했습니다: ${String(e)}`;
});

// TODO: 정류장 DB 로드와 자동완성 (FR-1, ADR-006), 경로 탐색 (FR-4), 저장·즐겨찾기 (FR-3, FR-5)
status.textContent = "기본 구조입니다. 기능은 단계별로 추가합니다.";
