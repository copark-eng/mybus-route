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
  denied: "위치 권한이 꺼져 있습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요",
  unavailable: "현재 위치를 찾을 수 없습니다",
  timeout: "위치를 찾는 데 시간이 오래 걸립니다",
};

function toError(e: GeolocationPositionError): LocationError {
  return e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable";
}

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
