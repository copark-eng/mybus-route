/** 날씨 한 줄 (FR-6, ADR-024) */
import { fetchWeather, type WeatherSummary } from "./api";

export { fetchWeather, type WeatherSummary };

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
