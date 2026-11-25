import { useEffect, useRef, useState } from "react";
import type { Nav } from "../App";
import { FavoriteCard } from "../components/features/FavoriteCard";
import { RecentPairs } from "../components/features/RecentPairs";
import { RouteFinder } from "../components/features/RouteFinder";
import { RefreshStatus } from "../components/features/RefreshStatus";
import { WeatherLine } from "../components/features/WeatherLine";
import { EmptyState } from "../components/ui";
import { useDb, useStore } from "../context";
import { useCountdown } from "../hooks/useCountdown";
import { useFavoriteBoard } from "../hooks/useFavoriteBoard";
import { useVisible } from "../hooks/useVisible";

/** 홈 (ADR-022): 날씨 → 즐겨찾기 카드 → 검색 진입 → 노선 바로 보기(ADR-038) → 최근 검색 → 푸터 */
export function HomeScreen({ nav }: { nav: Nav }) {
  const db = useDb();
  const store = useStore();
  const visible = useVisible();
  const now = useCountdown();
  const [editing, setEditing] = useState(false);
  const favs = store.favorites;
  const board = useFavoriteBoard(favs, visible);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  useEffect(() => { if (favs.length === 0) setEditing(false); }, [favs.length]);

  const d = new Date(db.updatedAt);
  const openSearch = () => nav.navigate({ name: "search", focus: true });

  return (
    <main className="screen home" data-testid="screen-home">
      {/* 사이트 제목 (공공데이터 활용 서비스명과 같게) */}
      <h1 ref={title} tabIndex={-1} className="home-title" data-testid="site-title">경기 버스 길찾기</h1>
      {/* 홈은 기본 위치(성남시청) 날씨 (ADR-026) */}
      <WeatherLine label="성남시청" />

      {favs.length > 0 ? (
        <>
          <section className="section" aria-labelledby="fav-title">
            <div className="section-head">
              <h2 id="fav-title" className="section-title">즐겨찾기</h2>
              <button type="button" className="text-btn" onClick={() => setEditing((e) => !e)} data-testid="favorite-edit">
                {editing ? "완료" : "편집"}
              </button>
            </div>
            <ul className="fav-list" data-testid="favorite-list">
              {favs.map((f) => (
                <FavoriteCard
                  key={f.id}
                  fav={f}
                  state={board.get(f.id)}
                  now={now}
                  editing={editing}
                  onOpen={() => nav.navigate({ name: "detail", kind: "favorite", favoriteId: f.id })}
                  onRename={(name) => store.renameFavorite(f.id, name)}
                  onRemove={() => store.removeFavorite(f.id)}
                />
              ))}
            </ul>
            {!editing && (
              <RefreshStatus lastUpdated={board.lastUpdated} loading={board.loading} now={now} error={board.error} onRefresh={board.refresh} paused={board.paused} />
            )}
          </section>
          <button type="button" className="search-entry" onClick={openSearch} data-testid="search-entry">
            <span aria-hidden="true">⌕</span> 어디로 갈까요?
          </button>
        </>
      ) : (
        <section className="section">
          <EmptyState title="자주 가는 경로를 즐겨찾기 해 보세요" testId="favorite-empty" />
          <button type="button" className="search-entry search-entry-lg" onClick={openSearch} data-testid="search-entry">
            <span aria-hidden="true">⌕</span> 어디로 갈까요?
          </button>
        </section>
      )}

      {/* 버스 번호로 노선 바로 보기 (ADR-038) */}
      <RouteFinder onOpen={(routeId) => nav.navigate({ name: "route", routeId })} />

      <RecentPairs
        pairs={store.pairs}
        onPick={(i) => {
          const p = store.pairs[i];
          if (p) nav.navigate({ name: "search", from: p.from, to: p.to, auto: true });
        }}
        onRemove={store.removePair}
      />

      <footer className="footer" data-testid="footer">
        정류장 정보 기준 {d.getFullYear()}.{d.getMonth() + 1}.{d.getDate()} · 정류장 {db.selectable.length.toLocaleString()}곳 · 노선{" "}
        {db.routes.size.toLocaleString()}개{db.partial ? " · 일부 수집 중" : ""}
      </footer>
    </main>
  );
}
