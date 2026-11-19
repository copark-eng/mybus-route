import { type ComponentProps, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { useDb } from "../../context";
import { reverseGeocode } from "../../lib/api";
import { config } from "../../lib/config";
import type { Station } from "../../lib/data";
import { initMap, type MapView } from "../../lib/map";
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

function NaverMapInner({ from, to, path, onPick, className = "" }: {
  from: Place | null;
  to: Place | null;
  path?: OptionResult | null;
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

  useEffect(() => {
    if (!view) return;
    try {
      if (!path) { view.showPath([]); return; }
      view.showPath(path.legs.map((l, n) => ({
      color: routeColor(l.route.type),
      coords: l.route.stops
        .slice(path.plan.legs[n].fromIndex, path.plan.legs[n].toIndex + 1)
        .map((id) => db.stations.get(id))
        .filter((s): s is Station => !!s)
        .map((s) => [s.y, s.x] as [number, number]),
      })));
    } catch (e) {
      console.warn("경로 표시 실패", e);
    }
  }, [view, path, db]);

  if (failed) {
    return <div className={`map map-missing ${className}`} data-testid="map">{failed}</div>;
  }
  return <div ref={el} className={`map ${className}`} data-testid="map" />;
}
