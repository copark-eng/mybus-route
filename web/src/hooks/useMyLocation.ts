import { useEffect, useState } from "react";

/** 내 위치 (ADR-030). enabled 동안 브라우저 위치를 계속 받는다 (watchPosition) */
export interface MyLocation {
  lat: number;
  lng: number;
  accuracy: number; // m
  at: number;
}

export type LocationError = "unsupported" | "denied" | "unavailable" | "timeout";

export const LOCATION_ERROR_TEXT: Record<LocationError, string> = {
  unsupported: "이 브라우저는 위치 기능을 지원하지 않습니다",
  denied: "위치 권한이 막혀 있어 브라우저가 다시 묻지 않습니다. 아래 방법으로 허용해 주세요",
  unavailable: "현재 위치를 찾을 수 없습니다",
  timeout: "위치를 찾는 데 시간이 오래 걸립니다",
};

function toError(e: GeolocationPositionError): LocationError {
  return e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable";
}

/**
 * 위치 권한 상태 (ADR-030 보완).
 * - prompt: 아직 안 물어봄 → getCurrentPosition 을 부르면 브라우저가 허용 팝업을 띄운다
 * - denied: 이미 거부됨 → 브라우저는 다시 묻지 않는다. 사용자가 설정에서 바꿔야 한다
 * - unknown: Permissions API 가 없는 브라우저 → 일단 요청해 본다
 */
export type PermissionStateX = "granted" | "prompt" | "denied" | "unknown";
export async function locationPermission(): Promise<PermissionStateX> {
  try {
    const s = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return s ? (s.state as PermissionStateX) : "unknown";
  } catch {
    return "unknown";
  }
}

/** 기기·브라우저별 위치 권한 켜는 방법 */
export type DeviceKind = "ios" | "android" | "inapp" | "desktop";
export function deviceKind(ua = navigator.userAgent): DeviceKind {
  if (/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua)) return "inapp";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in globalThis)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export const PERMISSION_STEPS: Record<DeviceKind, string[]> = {
  ios: [
    "설정 앱 → 개인정보 보호 및 보안 → 위치 서비스가 켜져 있는지 확인",
    "같은 화면에서 Safari 웹 사이트(또는 사용 중인 브라우저) → '앱을 사용하는 동안' 선택",
    "Safari 주소창 왼쪽 'ᴀA' → 웹 사이트 설정 → 위치 → '허용' (또는 '묻기')",
    "이 화면으로 돌아와 '다시 시도'를 누르세요",
  ],
  android: [
    "주소창 왼쪽 자물쇠(또는 ⓘ) 아이콘 → 권한(사이트 설정) → 위치 → '허용'",
    "휴대폰 설정 → 위치가 켜져 있는지, 브라우저 앱에 위치 권한이 있는지 확인",
    "이 화면으로 돌아와 '다시 시도'를 누르세요",
  ],
  inapp: [
    "카카오톡·네이버 등 앱 안의 브라우저는 위치를 막는 경우가 많습니다",
    "오른쪽 위 메뉴에서 '다른 브라우저로 열기'(Safari·Chrome)를 눌러 주세요",
  ],
  desktop: [
    "주소창 왼쪽 자물쇠 아이콘 → 위치 → '허용'",
    "페이지를 새로고침하거나 '다시 시도'를 누르세요",
  ],
};

const OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 };

/** 한 번만 받기 (내 위치 버튼을 눌렀을 때) */
export function getMyLocation(): Promise<MyLocation> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject("unsupported" satisfies LocationError);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp }),
      (e) => reject(toError(e)),
      OPTIONS,
    );
  });
}

export function useMyLocation(enabled: boolean): { location: MyLocation | null; error: LocationError | null } {
  const [location, setLocation] = useState<MyLocation | null>(null);
  const [error, setError] = useState<LocationError | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!("geolocation" in navigator)) { setError("unsupported"); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setLocation({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp });
      },
      (e) => setError(toError(e)),
      OPTIONS,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { location, error };
}
