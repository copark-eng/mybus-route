import { useWeather } from "../../hooks/useWeather";
import { config } from "../../lib/config";
import type { Place } from "../../lib/places";
import { formatWeather, sameWeatherGrid } from "../../lib/weather";

/** 날씨 한 줄. 위치를 안 주면 기본 위치(성남시청). 로딩·실패 시 아무것도 그리지 않는다 (FR-6.2) */
export function WeatherLine({ lat, lng, label }: { lat?: number; lng?: number; label?: string }) {
  const w = useWeather(lat ?? config.weatherDefault.lat, lng ?? config.weatherDefault.lng);
  const text = w ? formatWeather(w, new Date().getHours()) : null;
  if (!text) return null;
  return (
    <p className="weather" data-testid="weather-line" title={label ? `${label}: ${text}` : text}>
      {label && <span className="weather-label">{label}</span>}
      {text}
    </p>
  );
}

/**
 * 출발지·도착지 날씨 (ADR-026). 같은 기상청 격자(5km)면 한 줄, 다르면 두 줄.
 * 출발지·도착지가 없으면 기본 위치(성남시청)를 보여 준다.
 */
export function RouteWeather({ from, to }: { from?: Place | null; to?: Place | null }) {
  if (!from && !to) return <WeatherLine label="성남시청" />;
  if (from && to && !sameWeatherGrid(from, to)) {
    return (
      <div className="weather-pair" data-testid="route-weather">
        <WeatherLine lat={from.lat} lng={from.lng} label="출발" />
        <WeatherLine lat={to.lat} lng={to.lng} label="도착" />
      </div>
    );
  }
  const p = (from ?? to)!;
  return <WeatherLine lat={p.lat} lng={p.lng} label={from && to ? "출발·도착" : from ? "출발" : "도착"} />;
}
