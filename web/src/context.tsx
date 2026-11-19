import { createContext, useContext } from "react";
import type { BusDb } from "./lib/data";
import type { SavedApi } from "./hooks/useSaved";

export const DbContext = createContext<BusDb | null>(null);
export const StoreContext = createContext<SavedApi | null>(null);

/** DB 는 App 이 로딩을 끝낸 뒤에만 화면을 그리므로 항상 있다 */
export function useDb(): BusDb {
  const db = useContext(DbContext);
  if (!db) throw new Error("DbContext 가 없습니다");
  return db;
}

/** 노선 번호를 누르면 노선 정보 화면을 연다 (ADR-028). stationId 를 주면 그 정류장을 강조한다 */
export type OpenRoute = (routeId: string, stationId?: string) => void;
export const RouteLinkContext = createContext<OpenRoute | null>(null);
export const useOpenRoute = () => useContext(RouteLinkContext);

export function useStore(): SavedApi {
  const s = useContext(StoreContext);
  if (!s) throw new Error("StoreContext 가 없습니다");
  return s;
}
