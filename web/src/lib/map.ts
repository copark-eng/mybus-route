/** 네이버 지도 (ADR-002): 정류장 마커, 지도에서 출발지·도착지 고르기, 경로 표시 */
import { config } from "./config";
import type { BusDb, Station } from "./data";
import type { Place } from "./places";
import { esc } from "./util";

declare global {
  interface Window {
    naver?: any; // 네이버 지도 SDK는 공식 타입이 없어 any 로 둔다.
  }
}

export type PickHandler = (place: Place, role: "from" | "to") => void;

export interface MapView {
  setEndpoints(from: Place | null, to: Place | null): void;
  showPath(segments: { coords: [number, number][]; color: string }[]): void;
  focus(lat: number, lng: number): void;
  /** 지도와 이벤트를 정리한다 (React 언마운트 시) */
  destroy(): void;
}

const MARKER_MIN_ZOOM = 16;

export async function initMap(
  el: HTMLElement,
  db: BusDb,
  describe: (s: Station) => string,
  onPick: PickHandler | null,
  reverse: (lng: number, lat: number) => Promise<string | null>,
  signal?: AbortSignal,
): Promise<MapView | null> {
  if (!config.naverMapClientId) {
    el.textContent = "VITE_NAVER_MAP_CLIENT_ID 가 설정되지 않아 지도를 표시하지 않습니다.";
    el.classList.add("map-missing");
    return null;
  }
  await loadSdk();
  // SDK 를 기다리는 동안 컴포넌트가 사라졌으면 지도를 만들지 않는다.
  // (만든 뒤 destroy 하면 같은 요소에 새로 만든 지도의 화면까지 지워진다 — React 개발 모드 이중 마운트)
  if (signal?.aborted) return null;
  const { naver } = window;
  const map = new naver.maps.Map(el, {
    center: new naver.maps.LatLng(config.initialCenter.lat, config.initialCenter.lng),
    zoom: 16,
    scaleControl: false,
    mapDataControl: false,
  });
  // 레이아웃이 자리 잡기 전 크기로 지도가 만들어지면 가운데가 어긋나 팝업이 잘린다 → 실제 크기를 계속 알려 준다
  const resize = new ResizeObserver(() => {
    if (el.clientWidth && el.clientHeight) map.setSize(new naver.maps.Size(el.clientWidth, el.clientHeight));
  });
  resize.observe(el);
  const info = new naver.maps.InfoWindow({ borderWidth: 0, backgroundColor: "transparent", disableAnchor: true, pixelOffset: new naver.maps.Point(0, -8) });

  // ---- 정류장 마커 (화면에 보이는 영역만) ----
  let stationMarkers: any[] = [];
  const renderStations = () => {
    stationMarkers.forEach((m) => m.setMap(null));
    stationMarkers = [];
    if (map.getZoom() < MARKER_MIN_ZOOM) return;
    const b = map.getBounds();
    const list = db.grid.inBounds(b.getMin().y, b.getMin().x, b.getMax().y, b.getMax().x, 300);
    for (const s of list) {
      const m = new naver.maps.Marker({
        position: new naver.maps.LatLng(s.y, s.x),
        map,
        icon: { content: `<div class="stop-dot" title="${esc(s.name)}"></div>`, anchor: new naver.maps.Point(7, 7) },
        zIndex: 10,
      });
      if (onPick) naver.maps.Event.addListener(m, "click", () => openPicker(s.y, s.x, `${s.name} (${s.no})`, describe(s), {
        kind: "station", stationId: s.id, label: `${s.name} (${s.no})`, lat: s.y, lng: s.x,
      }));
      stationMarkers.push(m);
    }
  };
  naver.maps.Event.addListener(map, "idle", renderStations);
  renderStations();

  // ---- 지도에서 고르기 ----
  /** 팝업을 닫거나 새로 열 때마다 올린다. 주소 확인이 늦게 끝나도 닫은 팝업을 다시 열지 않기 위함 */
  let pickerSeq = 0;
  const closePicker = () => { pickerSeq++; info.close(); };

  function openPicker(lat: number, lng: number, title: string, sub: string, place: Place) {
    const box = document.createElement("div");
    box.className = "picker";
    box.innerHTML = `<button type="button" class="picker-close" data-close aria-label="닫기">✕</button>
      <strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}
      <div class="picker-btns"><button type="button" data-role="from">출발</button><button type="button" data-role="to">도착</button></div>`;
    box.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!t) return;
      if (t.dataset.close !== undefined) { closePicker(); return; }
      const role = t.dataset.role as "from" | "to" | undefined;
      if (role) { closePicker(); onPick?.(place, role); }
    });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
    info.setContent(box);
    const pos = new naver.maps.LatLng(lat, lng);
    // 화면 가장자리에서 눌러도 팝업이 잘리지 않게: 누른 곳을 지도 가운데로, 팝업이 위로 열릴 자리를 조금 더 둔다
    map.setCenter(pos);
    map.panBy(new naver.maps.Point(0, -Math.min(60, el.clientHeight * 0.15)));
    info.open(map, pos);
  }

  if (onPick) naver.maps.Event.addListener(map, "click", async (e: any) => {
    const lat = e.coord.y;
    const lng = e.coord.x;
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

  return {
    setEndpoints(from, to) {
      endpointMarkers.forEach((m) => m.setMap(null));
      endpointMarkers = [];
      for (const [p, cls, text] of [[from, "from", "출"], [to, "to", "도"]] as const) {
        if (!p) continue;
        endpointMarkers.push(new naver.maps.Marker({
          position: new naver.maps.LatLng(p.lat, p.lng),
          map,
          icon: { content: `<div class="pin pin-${cls}">${text}</div>`, anchor: new naver.maps.Point(14, 14) },
          zIndex: 100,
        }));
      }
      if (from && to) {
        const bounds = new naver.maps.LatLngBounds(
          new naver.maps.LatLng(Math.min(from.lat, to.lat), Math.min(from.lng, to.lng)),
          new naver.maps.LatLng(Math.max(from.lat, to.lat), Math.max(from.lng, to.lng)),
        );
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
      } else if (from || to) {
        const p = (from ?? to)!;
        map.panTo(new naver.maps.LatLng(p.lat, p.lng));
      }
    },
    showPath(segments) {
      lines.forEach((l) => l.setMap(null));
      lines = segments.map((s) => new naver.maps.Polyline({
        map,
        path: s.coords.map(([lat, lng]) => new naver.maps.LatLng(lat, lng)),
        strokeColor: s.color,
        strokeWeight: 5,
        strokeOpacity: 0.85,
      }));
    },
    focus(lat, lng) {
      map.panTo(new naver.maps.LatLng(lat, lng));
    },
    destroy() {
      // SDK 내부 상태(인증 실패 등)에 따라 예외가 날 수 있어 각각 감싼다
      const safe = (f: () => void) => { try { f(); } catch { /* 무시 */ } };
      safe(() => resize.disconnect());
      safe(() => info.close());
      [...stationMarkers, ...endpointMarkers, ...lines].forEach((o) => safe(() => o.setMap(null)));
      safe(() => map.destroy());
    },
  };
}

/** SDK 스크립트는 모듈 단위 Promise 로 한 번만 불러온다 */
let sdk: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdk ??= loadScript(
    `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(config.naverMapClientId!)}`,
  ).catch((e) => { sdk = null; throw e; });
  return sdk;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`스크립트를 불러오지 못했습니다: ${src}`));
    document.head.appendChild(s);
  });
}
