/**
 * 카카오맵 (ADR-044, 이전: 네이버 지도 ADR-002): 정류장 마커, 지도에서 출발지·도착지 고르기, 경로 표시.
 * 카카오맵은 무료 쿼터를 넘으면 과금 없이 멈춘다(유료 API 를 켜지 않은 경우).
 */
import { config } from "./config";
import type { BusDb, Station } from "./data";
import { offsetRight } from "./offset";
import type { Place } from "./places";
import { esc } from "./util";

declare global {
  interface Window {
    kakao?: any; // 카카오맵 SDK 는 공식 타입이 없어 any 로 둔다.
  }
}

export type PickHandler = (place: Place, role: "from" | "to") => void;

export interface MapView {
  setEndpoints(from: Place | null, to: Place | null): void;
  showPath(segments: { coords: [number, number][]; color: string }[]): void;
  /** 운행 중 버스 표시 (노선 정보 화면, ADR-028) */
  showBuses(buses: { lat: number; lng: number; label: string }[]): void;
  /** 좌표들이 다 보이게 */
  fitTo(coords: [number, number][]): void;
  focus(lat: number, lng: number): void;
  /** 정류장 하나로 이동·확대하고 강조 표시 (노선 화면에서 정류장을 눌렀을 때, ADR-036). null 이면 강조를 지운다 */
  showStop(stop: { lat: number; lng: number; label: string } | null): void;
  /** 지도와 이벤트를 정리한다 (React 언마운트 시) */
  destroy(): void;
}

/**
 * 카카오맵 확대 레벨: 1 이 가장 가깝고 숫자가 클수록 넓게 본다.
 * 레벨 L 에서 1px ≈ 0.25 × 2^(L-1) m (레벨 3 ≈ 1m, 레벨 4 ≈ 2m).
 */
const START_LEVEL = 4;
/** 이 레벨 이하(가까이)에서만 정류장 점을 그린다 */
const MARKER_MAX_LEVEL = 4;
/** 정류장을 눌러 이동할 때 레벨 */
const FOCUS_LEVEL = 3;
export const metersPerPixelAtLevel = (level: number) => 0.25 * 2 ** (level - 1);

/** 노선 선 두께와, 도로 가운데에서 오른쪽으로 옮기는 거리(px) (ADR-037) */
const LINE_WEIGHT = 5;
const LANE_PX = 4;

export async function initMap(
  el: HTMLElement,
  db: BusDb,
  describe: (s: Station) => string,
  onPick: PickHandler | null,
  reverse: (lng: number, lat: number) => Promise<string | null>,
  signal?: AbortSignal,
): Promise<MapView | null> {
  if (!config.kakaoMapKey) {
    el.textContent = "VITE_KAKAO_MAP_KEY 가 설정되지 않아 지도를 표시하지 않습니다.";
    el.classList.add("map-missing");
    return null;
  }
  await loadSdk();
  // SDK 를 기다리는 동안 컴포넌트가 사라졌으면 지도를 만들지 않는다 (React 개발 모드 이중 마운트)
  if (signal?.aborted) return null;
  const { kakao } = window;
  const K = kakao.maps;
  const ll = (lat: number, lng: number) => new K.LatLng(lat, lng);
  const map = new K.Map(el, { center: ll(config.initialCenter.lat, config.initialCenter.lng), level: START_LEVEL });

  // 이벤트는 정리할 수 있게 모아 둔다
  const listeners: [any, string, (...a: any[]) => void][] = [];
  const on = (target: any, type: string, fn: (...a: any[]) => void) => {
    K.event.addListener(target, type, fn);
    listeners.push([target, type, fn]);
  };

  // 레이아웃이 자리 잡기 전 크기로 지도가 만들어지면 가운데가 어긋난다 → 크기가 바뀌면 다시 맞춘다
  const resize = new ResizeObserver(() => { if (el.clientWidth && el.clientHeight) map.relayout(); });
  resize.observe(el);

  /** HTML 조각을 지도 위에 올린다 (카카오 CustomOverlay). 가운데 기준 */
  const overlay = (lat: number, lng: number, content: HTMLElement | string, zIndex: number, yAnchor = 0.5) =>
    new K.CustomOverlay({ position: ll(lat, lng), content, xAnchor: 0.5, yAnchor, zIndex, clickable: true, map });
  const elFrom = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild as HTMLElement;
  };

  // ---- 정류장 마커 (화면에 보이는 영역만) ----
  let stationMarkers: any[] = [];
  const renderStations = () => {
    stationMarkers.forEach((m) => m.setMap(null));
    stationMarkers = [];
    if (map.getLevel() > MARKER_MAX_LEVEL) return;
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const list = db.grid.inBounds(sw.getLat(), sw.getLng(), ne.getLat(), ne.getLng(), 300);
    for (const s of list) {
      const dot = elFrom(`<div class="stop-dot" title="${esc(s.name)}"></div>`);
      if (onPick) {
        dot.style.cursor = "pointer";
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          openPicker(s.y, s.x, `${s.name} (${s.no})`, describe(s), {
            kind: "station", stationId: s.id, label: `${s.name} (${s.no})`, lat: s.y, lng: s.x,
          });
        });
      }
      stationMarkers.push(overlay(s.y, s.x, dot, 10));
    }
  };
  on(map, "idle", renderStations);
  renderStations();

  // ---- 지도에서 고르기 ----
  /** 팝업을 닫거나 새로 열 때마다 올린다. 주소 확인이 늦게 끝나도 닫은 팝업을 다시 열지 않기 위함 */
  let pickerSeq = 0;
  let picker: any = null;
  const closePicker = () => { pickerSeq++; picker?.setMap(null); picker = null; };

  function openPicker(lat: number, lng: number, title: string, sub: string, place: Place) {
    picker?.setMap(null);
    const wrap = document.createElement("div");
    wrap.className = "picker-wrap";
    const box = document.createElement("div");
    box.className = "picker";
    box.innerHTML = `<button type="button" class="picker-close" data-close aria-label="닫기">✕</button>
      <strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}
      <div class="picker-btns"><button type="button" data-role="from">출발</button><button type="button" data-role="to">도착</button></div>`;
    wrap.appendChild(box);
    // 팝업 안을 눌러도 지도 클릭(다른 곳 고르기)으로 넘어가지 않게
    for (const t of ["mousedown", "touchstart", "click"]) wrap.addEventListener(t, (e) => e.stopPropagation());
    box.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!t) return;
      if (t.dataset.close !== undefined) { closePicker(); return; }
      const role = t.dataset.role as "from" | "to" | undefined;
      if (role) { closePicker(); onPick?.(place, role); }
    });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
    // 화면 가장자리에서 눌러도 팝업이 잘리지 않게: 누른 곳을 지도 가운데로, 팝업이 위로 열릴 자리를 조금 더 둔다
    map.setCenter(ll(lat, lng));
    map.panBy(0, -Math.min(60, el.clientHeight * 0.15));
    picker = overlay(lat, lng, wrap, 400, 1);
  }

  if (onPick) on(map, "click", async (e: any) => {
    const lat = e.latLng.getLat();
    const lng = e.latLng.getLng();
    const seq = ++pickerSeq;
    openPicker(lat, lng, "주소 확인 중…", "", { kind: "point", label: "지도에서 선택한 위치", lat, lng });
    const addr = await reverse(lng, lat).catch(() => null);
    if (seq !== pickerSeq) return; // 그사이 닫았거나 다른 곳을 눌렀다
    const label = addr ?? "지도에서 선택한 위치";
    openPicker(lat, lng, label, "이 위치에서 가까운 정류장으로 찾습니다", { kind: "point", label, lat, lng });
  });

  // ---- 출발·도착 표시와 경로 ----
  let endpointMarkers: any[] = [];
  let lines: any[] = [];
  let busMarkers: any[] = [];
  let stopMarker: any = null;

  // 노선 선은 도로 오른쪽으로 (ADR-037). 화면 픽셀 기준이라 확대 레벨이 바뀌면 다시 계산한다.
  let pathSegs: { coords: [number, number][]; color: string }[] = [];
  const toPath = (cs: [number, number][]) => cs.map(([lat, lng]) => ll(lat, lng));
  const laneOffset = () => LANE_PX * metersPerPixelAtLevel(map.getLevel());
  on(map, "zoom_changed", () => {
    const off = laneOffset();
    lines.forEach((l, i) => { if (pathSegs[i]) l.setPath(toPath(offsetRight(pathSegs[i].coords, off))); });
  });

  const fitBounds = (pts: [number, number][], pad: number) => {
    const b = new K.LatLngBounds();
    for (const [lat, lng] of pts) b.extend(ll(lat, lng));
    map.setBounds(b, pad, pad, pad, pad);
  };

  return {
    setEndpoints(from, to) {
      endpointMarkers.forEach((m) => m.setMap(null));
      endpointMarkers = [];
      // 내 위치면 "나" (ADR-030)
      const mark = (p: Place | null, def: string) => (p && p.kind === "point" && p.mine ? "나" : def);
      for (const [p, cls, text] of [[from, "from", mark(from, "출")], [to, "to", mark(to, "도")]] as const) {
        if (!p) continue;
        endpointMarkers.push(overlay(p.lat, p.lng, `<div class="pin pin-${cls}">${text}</div>`, 100));
      }
      if (from && to) fitBounds([[from.lat, from.lng], [to.lat, to.lng]], 40);
      else if (from || to) {
        const p = (from ?? to)!;
        map.panTo(ll(p.lat, p.lng));
      }
    },
    showPath(segments) {
      lines.forEach((l) => l.setMap(null));
      pathSegs = segments;
      const off = laneOffset();
      lines = segments.map((s) => new K.Polyline({
        map,
        path: toPath(offsetRight(s.coords, off)),
        strokeColor: s.color,
        strokeWeight: LINE_WEIGHT,
        strokeOpacity: 0.85,
        zIndex: 50,
      }));
    },
    showBuses(buses) {
      busMarkers.forEach((m) => m.setMap(null));
      busMarkers = buses.map((b) => overlay(b.lat, b.lng, `<div class="bus-marker" title="${esc(b.label)}">🚌</div>`, 200));
    },
    fitTo(coords) {
      if (coords.length < 2) return;
      fitBounds(coords, 30);
    },
    focus(lat, lng) {
      map.panTo(ll(lat, lng));
    },
    showStop(stop) {
      stopMarker?.setMap(null);
      stopMarker = null;
      if (!stop) return;
      stopMarker = overlay(stop.lat, stop.lng, `<div class="stop-focus" title="${esc(stop.label)}"><span>${esc(stop.label)}</span></div>`, 300);
      if (map.getLevel() > FOCUS_LEVEL) map.setLevel(FOCUS_LEVEL);
      map.panTo(ll(stop.lat, stop.lng));
    },
    destroy() {
      // SDK 상태에 따라 예외가 날 수 있어 각각 감싼다
      const safe = (f: () => void) => { try { f(); } catch { /* 무시 */ } };
      safe(() => resize.disconnect());
      safe(() => picker?.setMap(null));
      for (const [t, type, fn] of listeners) safe(() => K.event.removeListener(t, type, fn));
      [...stationMarkers, ...endpointMarkers, ...lines, ...busMarkers, stopMarker].filter(Boolean).forEach((o) => safe(() => o.setMap(null)));
      // 카카오맵은 destroy 가 없어 그린 내용을 비운다 (같은 요소에 새 지도를 만들 수 있게)
      safe(() => { el.innerHTML = ""; });
    },
  };
}

/** SDK 스크립트는 모듈 단위 Promise 로 한 번만 불러온다. autoload=false 로 받고 kakao.maps.load 로 준비를 기다린다 */
let sdk: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdk ??= loadScript(
    `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.kakaoMapKey!)}&autoload=false`,
  )
    .then(() => new Promise<void>((resolve, reject) => {
      if (!window.kakao?.maps?.load) { reject(new Error("카카오맵 SDK 를 불러오지 못했습니다 (키·도메인 등록 확인)")); return; }
      window.kakao.maps.load(() => resolve());
    }))
    .catch((e) => { sdk = null; throw e; });
  return sdk;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("카카오맵 스크립트를 불러오지 못했습니다"));
    document.head.appendChild(s);
  });
}
