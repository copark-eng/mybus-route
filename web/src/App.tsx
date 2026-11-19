import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, Button, Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { DbContext, RouteLinkContext, StoreContext } from "./context";
import { useBusDb } from "./hooks/useBusDb";
import { useSaved } from "./hooks/useSaved";
import { useNewVersion } from "./hooks/useNewVersion";
import type { Place } from "./lib/places";
import type { OptionResult, RoutePlan } from "./lib/router";
import { DetailScreen } from "./screens/DetailScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { RouteScreen } from "./screens/RouteScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { AppMenu } from "./components/features/AppMenu";

export type SearchView = { name: "search"; from?: Place; to?: Place; auto?: boolean; focus?: boolean };
export type DetailView =
  | { name: "detail"; kind: "favorite"; favoriteId: string }
  | { name: "detail"; kind: "result"; from: Place; to: Place; plan: RoutePlan; initial?: OptionResult };
/** 노선 정보 화면 (ADR-028). stationId 는 강조할 정류장 */
export type RouteView = { name: "route"; routeId: string; stationId?: string };
/** 메뉴에서 여는 문서 화면 (ADR-033) */
export type DocView = { name: "privacy" };
export type View = { name: "home" } | SearchView | DetailView | RouteView | DocView;

export interface Nav {
  navigate(v: View): void;
  back(): void;
}

const HOME: View = { name: "home" };

function hashOf(v: View): string {
  if (v.name === "search") return "#search";
  if (v.name === "detail") return v.kind === "favorite" ? `#fav/${encodeURIComponent(v.favoriteId)}` : "#route";
  if (v.name === "route") return `#bus/${v.routeId}${v.stationId ? `/${v.stationId}` : ""}`;
  if (v.name === "privacy") return "#privacy";
  return location.pathname + location.search;
}

/** 새로고침 뒤처럼 메모리 스택에 없을 때: #fav/<id>, #bus/<노선>[/<정류장>] 만 복원, 나머지는 홈 */
function viewFromHash(): View {
  const fav = /^#fav\/(.+)$/.exec(location.hash);
  if (fav) return { name: "detail", kind: "favorite", favoriteId: decodeURIComponent(fav[1]) };
  const bus = /^#bus\/(\d+)(?:\/(\d+))?$/.exec(location.hash);
  if (bus) return { name: "route", routeId: bus[1], stationId: bus[2] };
  if (location.hash === "#privacy") return { name: "privacy" };
  return HOME;
}

export function App() {
  const { db, error, retry } = useBusDb();
  const saved = useSaved();
  const newVersion = useNewVersion();

  // ---- 내비게이션: view 상태 + history.pushState (라우터 라이브러리 없음) ----
  const stack = useRef(new Map<number, View>());
  const [cur, setCur] = useState<{ idx: number; view: View }>(() => {
    const view = viewFromHash();
    const idx = typeof history.state?.idx === "number" ? history.state.idx : 0;
    stack.current.set(idx, view);
    history.replaceState({ idx }, "", hashOf(view));
    return { idx, view };
  });
  const curRef = useRef(cur);
  curRef.current = cur;

  const navigate = useCallback((view: View) => {
    const idx = curRef.current.idx + 1;
    // 앞으로 가기 기록은 버린다
    for (const k of [...stack.current.keys()]) if (k >= idx) stack.current.delete(k);
    stack.current.set(idx, view);
    history.pushState({ idx }, "", hashOf(view));
    setCur({ idx, view });
    // 새 화면은 맨 위에서 시작한다 (뒤로 가기는 브라우저가 위치를 되돌린다)
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }, []);
  const back = useCallback(() => {
    if (curRef.current.idx > 0) history.back();
    else navigate(HOME);
  }, [navigate]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const idx = typeof e.state?.idx === "number" ? e.state.idx : 0;
      const known = stack.current.get(idx);
      if (known) { setCur({ idx, view: known }); return; }
      const view = viewFromHash();
      stack.current.set(idx, view);
      history.replaceState({ idx }, "", hashOf(view));
      setCur({ idx, view });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ---- 검색 화면은 상세로 갈 때 숨겨서 유지하고, 홈으로 가면 언마운트한다 ----
  const [search, setSearch] = useState<{ key: number; view: SearchView } | null>(null);
  const v = cur.view;
  if (v.name === "search" && search?.view !== v) setSearch({ key: (search?.key ?? 0) + 1, view: v });
  if (v.name === "home" && search) setSearch(null);

  const nav: Nav = { navigate, back };
  const openRoute = useCallback(
    (routeId: string, stationId?: string) => navigate({ name: "route", routeId, stationId }),
    [navigate],
  );

  if (!db) {
    return (
      <div className="boot" data-testid="boot">
        {error ? (
          <EmptyState
            title="정류장 정보를 불러오지 못했습니다"
            action={<Button variant="primary" onClick={retry}>다시 시도</Button>}
          />
        ) : (
          <Spinner label="정류장 정보를 불러오는 중…" />
        )}
      </div>
    );
  }

  return (
    <DbContext.Provider value={db}>
      <StoreContext.Provider value={saved}>
        <RouteLinkContext.Provider value={openRoute}>
        {v.name === "home" && (
          <ErrorBoundary key="home" fallback={<ScreenError onHome={() => navigate(HOME)} />}>
            <HomeScreen nav={nav} />
          </ErrorBoundary>
        )}
        {search && (
          <ErrorBoundary key={`search-${search.key}`} fallback={v.name === "search" ? <ScreenError onHome={() => navigate(HOME)} /> : null}>
            <SearchScreen init={search.view} nav={nav} active={v.name === "search"} />
          </ErrorBoundary>
        )}
        {v.name === "detail" && (
          <ErrorBoundary key={`detail-${cur.idx}`} fallback={<ScreenError onHome={() => navigate(HOME)} />}>
            <DetailScreen view={v} nav={nav} />
          </ErrorBoundary>
        )}
        {v.name === "route" && (
          <ErrorBoundary key={`route-${cur.idx}`} fallback={<ScreenError onHome={() => navigate(HOME)} />}>
            <RouteScreen view={v} nav={nav} />
          </ErrorBoundary>
        )}
        {v.name === "privacy" && <PrivacyScreen nav={nav} />}
        {newVersion && (
          <div className="update-banner" role="status" data-testid="update-banner">
            <span>새 버전이 나왔습니다</span>
            <button type="button" onClick={() => location.reload()}>새로고침</button>
          </div>
        )}
        {/* 모든 화면 오른쪽 위 ☰ 메뉴 (ADR-033) */}
        <AppMenu onOpen={(name) => { if (v.name !== name) navigate({ name }); }} />
        </RouteLinkContext.Provider>
      </StoreContext.Provider>
    </DbContext.Provider>
  );
}

function ScreenError({ onHome }: { onHome(): void }) {
  return (
    <main className="screen" data-testid="screen-error">
      <EmptyState title="화면을 표시하지 못했습니다" action={<Button variant="primary" onClick={onHome}>홈으로</Button>} />
    </main>
  );
}
