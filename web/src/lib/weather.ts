/** 날씨 한 줄 (FR-6, ADR-024) */
import { fetchWeather, type WeatherSummary } from "./api";

export { fetchWeather, type WeatherSummary };

/** 위경도 → 기상청 격자 (worker/src/weather.ts 의 toGrid 와 같은 식). 서울시청 → (60, 127) */
export function toGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180;
  const re = RE / GRID;
  const slat1 = SLAT1 * D, slat2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

/** 두 위치가 같은 기상청 격자(약 5km)에 있으면 날씨가 같다 */
export function sameWeatherGrid(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  const ga = toGrid(a.lat, a.lng);
  const gb = toGrid(b.lat, b.lng);
  return ga.nx === gb.nx && ga.ny === gb.ny;
}

function hourLabel(hour: number, nowHour: number): string {
  if (hour === nowHour) return "곧";
  const ampm = hour < 12 ? "오전" : "오후";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${ampm} ${h}시`;
}

/** WeatherSummary → "6° 구름많음 · 체감 3° · 오후 6시부터 비 60% · 우산 챙기세요". temp 가 없으면 null(줄 숨김) */
export function formatWeather(w: WeatherSummary, nowHour: number): string | null {
  if (w.temp === null || w.temp === undefined || !Number.isFinite(w.temp)) return null;
  const temp = Math.round(w.temp);
  let s = `${temp}°${w.sky ? ` ${w.sky}` : ""}`;
  if (w.feels !== null && w.feels !== undefined && Math.abs(w.feels - w.temp) >= 1) s += ` · 체감 ${Math.round(w.feels)}°`;
  if (w.precip && w.precip !== "없음") s += ` · 지금 ${w.precip} · 우산 챙기세요`;
  else if (w.rainFrom) {
    const when = hourLabel(w.rainFrom.hour, nowHour);
    s += ` · ${when === "곧" ? "곧" : `${when}부터`} ${w.rainFrom.type} ${w.rainFrom.pop}% · 우산 챙기세요`;
  } else if (w.maxPop >= 60) s += ` · 강수확률 ${w.maxPop}%`;
  return s;
}
