import { type ComponentProps, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { useDb } from "../../context";
import { reverseGeocode } from "../../lib/api";
import { config } from "../../lib/config";
import type { Route } from "../../lib/data";
import { initMap, type MapView } from "../../lib/map";
import { routeSegment, straightSegment, wholeRoute } from "../../lib/shapes";
import { type Place, directionHint } from "../../lib/places";
import type { OptionResult } from "../../lib/router";
import { routeColor } from "../../lib/routeType";

/** 네이버 지도 (검색·상세 화면에서만). 마운트 시 1회 초기화, 언마운트 시 destroy */
export function NaverMap(props: ComponentProps<typeof NaverMapInner>) {
  return (
    <ErrorBoundary fallback={<div className={`map map-missing ${props.className ?? ""}`} data-testid="map">지도를 표시하지 못했습니다.</div>}>
      <NaverMapInner {...props} />
    </ErrorBoundary>
  );
}

function NaverMapInner({ from, to, path, line, buses, onPick, className = "" }: {
  from: Place | null;
  to: Place | null;
  path?: OptionResult | null;
  /** 노선 전체를 도로 선으로 그린다 (노선 정보 화면) */
  line?: Route | null;
  /** 운행 중 버스 위치 */
  buses?: { lat: number; lng: number; label: string }[];
  onPick?(p: Place, role: "from" | "to"): void;
  className?: string;
}) {
  const db = useDb();
  const el = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [failed, setFailed] = useState<string | null>(config.naverMapClientId ? null : "지도 Client ID 가 설정되지 않아 지도를 표시하지 않습니다.");
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const canPick = !!onPick;

  useEffect(() => {
    if (!config.naverMapClientId || !el.current) return;
    const ctrl = new AbortController();
    let made: MapView | null = null;
    initMap(
      el.current,
      db,
      (s) => directionHint(db, s),
      canPick ? (p, role) => pickRef.current?.(p, role) : null,
      reverseGeocode,
      ctrl.signal,
    ).then(
      (m) => {
        if (ctrl.signal.aborted) return; // 취소됐으면 initMap 이 지도를 만들지 않았다
        made = m;
        setView(m);
      },
      (e) => { if (!ctrl.signal.aborted) setFailed(`지도를 불러오지 못했습니다: ${String(e)}`); },
    );
    return () => {
      ctrl.abort();
      made?.destroy();
      setView(null);
    };
  }, [db, canPick]);

  useEffect(() => {
    try { view?.setEndpoints(from, to); } catch (e) { console.warn("지도 표시 실패", e); }
  }, [view, from, to]);

  // 경로(승차~하차 구간)를 도로 형상으로 그린다 (ADR-029). 형상을 받기 전에는 정류장 직선을 먼저 보여 준다
  useEffect(() => {
    if (!view || line) return;
    let alive = true;
    const draw = (segs: { coords: [number, number][]; color: string }[]) => {
      try { if (alive) view.showPath(segs); } catch (e) { console.warn("경로 표시 실패", e); }
    };
    if (!path) { draw([]); return; }
    const legs = path.legs.map((l, n) => ({ route: l.route, from: path.plan.legs[n].fromIndex, to: path.plan.legs[n].toIndex }));
    draw(legs.map((l) => ({ color: routeColor(l.route.type), coords: straightSegment(db, l.route, l.from, l.to) })));
    Promise.all(legs.map((l) => routeSegment(db, l.route, l.from, l.to))).then((segs) =>
      draw(segs.map((coords, n) => ({ color: routeColor(legs[n].route.type), coords }))),
    );
    return () => { alive = false; };
  }, [view, path, db, line]);

  // 노선 전체 (노선 정보 화면)
  useEffect(() => {
    if (!view || !line) return;
    let alive = true;
    wholeRoute(db, line).then((coords) => {
      if (!alive) return;
      try {
        view.showPath([{ coords, color: routeColor(line.type) }]);
        view.fitTo(coords);
      } catch (e) { console.warn("노선 표시 실패", e); }
    });
    return () => { alive = false; };
  }, [view, line, db]);

  useEffect(() => {
    if (!view) return;
    try { view.showBuses(buses ?? []); } catch (e) { console.warn("버스 표시 실패", e); }
  }, [view, buses]);

  if (failed) {
    return <div className={`map map-missing ${className}`} data-testid="map">{failed}</div>;
  }
  return <div ref={el} className={`map ${className}`} data-testid="map" />;
}
