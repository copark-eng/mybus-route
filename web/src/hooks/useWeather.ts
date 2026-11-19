import { useEffect, useState } from "react";
import { fetchWeather, type WeatherSummary } from "../lib/weather";

/** 모듈 메모리 캐시 10분 (키: 소수 2자리 lat,lng) */
const cache = new Map<string, { at: number; value: WeatherSummary }>();
const TTL = 10 * 60_000;

const cacheKey = (lat?: number, lng?: number) =>
  lat !== undefined && lng !== undefined ? `${lat.toFixed(2)},${lng.toFixed(2)}` : "default";

function cached(key: string): WeatherSummary | null {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < TTL ? hit.value : null;
}

/** 날씨 요약. 로딩 중·실패 시 null (FR-6.2: 줄 자체를 숨김). 같은 마운트에서 재시도하지 않는다. */
export function useWeather(lat?: number, lng?: number): WeatherSummary | null {
  const key = cacheKey(lat, lng);
  const [state, setState] = useState<{ key: string; value: WeatherSummary | null }>(() => ({ key, value: cached(key) }));

  useEffect(() => {
    if (cached(key)) return;
    let alive = true;
    fetchWeather(lat, lng)
      .then((w) => (w && typeof w === "object" ? w : null), () => null)
      .then((w) => {
        if (w) cache.set(key, { at: Date.now(), value: w });
        if (alive) setState({ key, value: w });
      });
    return () => { alive = false; };
    // lat/lng 는 key 에 반영되어 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.key === key ? state.value : cached(key);
}
