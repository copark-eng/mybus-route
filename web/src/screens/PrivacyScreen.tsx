import { useEffect, useRef } from "react";
import type { Nav } from "../App";
import { IconButton } from "../components/ui";

// 위치정보 관리책임자·문의 항목은 2026-11-19 사용자 요청으로 뺐다. 다시 넣을 때는 ADR-033 참고
export const PRIVACY_EFFECTIVE_DATE = "2026년 11월 20일";

/** 개인위치정보 처리방침 (ADR-033). 실제 앱 동작(ADR-030, 032, 033)과 일치해야 한다 */
export function PrivacyScreen({ nav }: { nav: Nav }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus({ preventScroll: true }), []);

  return (
    <main className="screen doc-screen" data-testid="screen-privacy">
      <header className="topbar">
        <IconButton label="뒤로" icon="←" onClick={nav.back} data-testid="back" />
        <h1 ref={title} tabIndex={-1} className="topbar-title">개인위치정보 처리방침</h1>
      </header>

      <article className="doc">
        <p className="muted small">시행일: {PRIVACY_EFFECTIVE_DATE}</p>
        <p>
          경기 버스 길찾기(mybus-route, 이하 "서비스")는 이용자의 위치정보를 소중히 다루며, 「위치정보의 보호 및 이용 등에 관한 법률」 등
          관련 법령을 지킵니다. 이 방침은 서비스가 어떤 위치정보를, 왜, 어떻게 쓰고 지키는지 설명합니다.
        </p>

        <h2>1. 수집하는 위치정보와 수집 방법</h2>
        <ul>
          <li><b>내 위치(기기의 현재 위치)</b>: 이용자가 검색 화면의 "📍 내 위치에서 출발"을 눌러 브라우저의 위치 사용을 허용한 경우에만 받습니다.</li>
          <li>출발지가 내 위치로 정해져 있고 검색 화면이 열려 있는 동안 위치를 계속 받아, 30m 이상 움직이면 출발지를 바꿉니다. 화면을 닫거나 다른 앱으로 넘어가면 받지 않습니다.</li>
          <li><b>이용자가 고른 장소</b>: 입력한 주소, 지도에서 누른 지점, 고른 정류장.</li>
        </ul>

        <h2>2. 이용 목적</h2>
        <ul>
          <li>가까운 버스 정류장 찾기, 가장 빨리 도착하는 경로와 걷는 시간 계산</li>
          <li>출발지·도착지 날씨 보여 주기</li>
          <li>지도에 출발지·도착지와 경로 표시</li>
        </ul>

        <h2>3. 위치정보가 기기 밖으로 나가는 경우</h2>
        <p>경로 계산은 이용자의 기기(브라우저) 안에서 합니다. <b>내 위치 좌표는 서비스 서버로 보내지 않습니다.</b> 다만 아래 기능을 쓰려면 일부 정보가 전달됩니다.</p>
        <table className="doc-table">
          <thead><tr><th>기능</th><th>보내는 정보</th><th>받는 곳</th></tr></thead>
          <tbody>
            <tr><td>날씨</td><td>위치를 기기에서 기상청 격자 번호(약 5km 칸)로 바꾼 값만</td><td>서비스 서버 → 기상청(공공데이터포털)</td></tr>
            <tr><td>버스 도착·위치</td><td>정류장 번호, 노선 번호 (위치 없음)</td><td>서비스 서버 → 경기도(공공데이터포털)</td></tr>
            <tr><td>주소 검색, 지도에서 위치 고르기</td><td>입력한 주소, 지도에서 누른 지점의 좌표 (내 위치 아님)</td><td>서비스 서버 → 네이버 클라우드 플랫폼</td></tr>
            <tr><td>지도 보기</td><td>화면에 보이는 지역의 지도 그림 요청</td><td>네이버 지도</td></tr>
          </tbody>
        </table>
        <p className="small muted">서비스 서버는 Cloudflare에서 운영하며, 위 정보를 바로 전달만 하고 저장하지 않습니다.</p>

        <h2>4. 보관 기간과 파기</h2>
        <ul>
          <li><b>서버</b>: 위치정보를 저장하지 않습니다. 운영을 위해 요청 기록(기능 이름, 정류장·노선 번호, 화면 이름, 처리 결과, 처리 시간)을 3일간 보관한 뒤 자동으로 지웁니다. 이 기록에는 위치 좌표나 주소가 들어가지 않습니다.</li>
          <li><b>이용자 기기</b>: 최근 검색과 즐겨찾기에 출발지·도착지(내 위치는 마지막으로 받은 좌표)를 브라우저에 저장합니다. 이용자가 지울 때까지 기기에만 남습니다.</li>
        </ul>

        <h2>5. 이용자의 권리와 행사 방법</h2>
        <ul>
          <li>브라우저나 기기 설정에서 위치 사용을 언제든 끌 수 있습니다. 끄면 "내 위치" 기능만 쓸 수 없고 나머지 기능은 그대로 쓸 수 있습니다.</li>
          <li>홈 화면 최근 검색의 ×, 즐겨찾기 삭제로 저장된 위치를 지울 수 있습니다. 브라우저의 사이트 데이터 삭제로 모두 지울 수도 있습니다.</li>
          <li>회원가입이 없어 서버에 이용자별 정보가 없으므로, 열람·정정할 서버 보관 위치정보가 없습니다.</li>
        </ul>

        <h2>6. 8세 이하 아동 등</h2>
        <p>서비스는 이용자의 나이를 확인하지 않으며, 위치정보를 서버에 저장하지 않습니다. 8세 이하 아동 등이 이용하는 경우 보호자가 위치 사용 허용 여부를 결정해 주세요.</p>

        <h2>7. 방침의 변경</h2>
        <p>내용이 바뀌면 이 화면에서 시행일과 함께 알립니다.</p>
      </article>
    </main>
  );
}
