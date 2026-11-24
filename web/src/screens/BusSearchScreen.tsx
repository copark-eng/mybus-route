import type { Nav } from "../App";
import { RouteFinder } from "../components/features/RouteFinder";
import { IconButton } from "../components/ui";

/**
 * 버스 검색 (ADR-039): 오른쪽 위 🚌 버튼으로 어느 화면에서나 연다.
 * 들어오면 바로 입력할 수 있게 키패드를 띄우고, 노선을 고르면 노선 정보 화면으로 간다.
 */
export function BusSearchScreen({ nav }: { nav: Nav }) {
  return (
    <main className="screen bus-search" data-testid="screen-buses">
      <header className="topbar">
        <IconButton label="뒤로" icon="←" onClick={nav.back} data-testid="back" />
        <h1 className="topbar-title">버스 검색</h1>
      </header>
      <RouteFinder title={null} autoFocus onOpen={(routeId) => nav.navigate({ name: "route", routeId })} />
      <p className="muted small bus-search-note">노선 번호를 입력하세요. 같은 번호는 운행 지역과 기점 → 회차 정류장으로 구분합니다.</p>
    </main>
  );
}
