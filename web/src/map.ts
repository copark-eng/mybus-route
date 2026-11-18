import { config } from "./config";

declare global {
  interface Window {
    naver?: any; // 네이버 지도 SDK는 공식 타입 패키지가 없어 우선 any 로 둔다.
  }
}

/** 네이버 지도 SDK를 불러와 #map 에 지도를 띄운다 (ADR-002). */
export async function initMap(el: HTMLElement): Promise<unknown | null> {
  if (!config.naverMapClientId) {
    el.textContent = "VITE_NAVER_MAP_CLIENT_ID 가 설정되지 않아 지도를 표시하지 않습니다.";
    el.classList.add("map-missing");
    return null;
  }
  await loadScript(
    `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(config.naverMapClientId)}`,
  );
  const { naver } = window;
  return new naver.maps.Map(el, {
    center: new naver.maps.LatLng(config.initialCenter.lat, config.initialCenter.lng),
    zoom: 15,
  });
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
