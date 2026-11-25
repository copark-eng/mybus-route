import { useEffect, useRef } from "react";
import type { Nav } from "../App";
import { IconButton } from "../components/ui";

/** 데이터 출처 (ADR-043). 공공데이터 이용허락(출처표시)에 맞춰 제공기관과 데이터 이름을 밝힌다 */
export function SourcesScreen({ nav }: { nav: Nav }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus({ preventScroll: true }), []);

  return (
    <main className="screen doc-screen" data-testid="screen-sources">
      <header className="topbar">
        <IconButton label="뒤로" icon="←" onClick={nav.back} data-testid="back" />
        <h1 ref={title} tabIndex={-1} className="topbar-title">데이터 출처</h1>
      </header>

      <article className="doc">
        <p>
          경기 버스 길찾기는 <b>공공데이터포털(data.go.kr)</b>에서 제공하는 아래 공공데이터를 이용합니다.
          각 데이터의 저작권은 제공기관에 있습니다.
        </p>
        <p className="small">
          이용허락: <b>공공누리 제1유형(출처표시)</b> · 저작자표시(CC BY). 출처를 밝히면 상업적 이용과 변경이 가능한 조건이며,
          이 서비스는 데이터를 가공(경로 계산·요약)해 보여 줍니다.
        </p>

        <h2>버스 정보 — 경기도</h2>
        <ul>
          <li>경기도_버스도착정보 조회: 정류장별 실시간 도착 예정 시각</li>
          <li>경기도_버스위치정보 조회: 노선별 운행 중인 버스 위치</li>
          <li>경기도_버스 기반정보 조회(노선·정류소): 노선·정류장 목록과 좌표, 배차 간격, 첫차·막차</li>
        </ul>

        <h2>날씨 — 기상청</h2>
        <ul>
          <li>기상청_단기예보 조회서비스: 초단기실황(현재 기온·강수), 단기예보(하늘 상태·강수확률)</li>
        </ul>

        <h2>지도</h2>
        <ul>
          <li>카카오맵 API (Kakao Developers): 지도</li>
          <li>카카오 로컬 API: 주소 검색, 지도에서 누른 곳의 주소 확인</li>
        </ul>

        <h2>요금</h2>
        <ul>
          <li>경기도 버스요금 안내(2025년 10월 25일 시행, 성인 교통카드 기준)를 바탕으로 이 서비스가 계산한 추정값입니다. 실제 요금과 다를 수 있습니다.</li>
        </ul>

        <p className="muted small">
          실시간 정보는 제공기관 사정에 따라 늦거나 맞지 않을 수 있습니다. 경로·도착 시각·요금은 참고용으로 이용해 주세요.
        </p>
      </article>
    </main>
  );
}
