import { useWeather } from "../../hooks/useWeather";
import { formatWeather } from "../../lib/weather";

/** 홈 최상단 날씨 한 줄. 로딩·실패 시 아무것도 그리지 않는다 (FR-6.2) */
export function WeatherLine({ lat, lng }: { lat?: number; lng?: number }) {
  const w = useWeather(lat, lng);
  const text = w ? formatWeather(w, new Date().getHours()) : null;
  if (!text) return null;
  return (
    <p className="weather" data-testid="weather-line" title={text}>
      {text}
    </p>
  );
}
