export const config = {
  naverMapClientId: import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string | undefined,
  apiBase: (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8787",
  /** 실시간 정보 자동 갱신 주기 (ADR-015) */
  refreshMs: 30_000,
  /** 지도 초기 중심: 성남시 (ADR-010) */
  initialCenter: { lat: 37.3947, lng: 127.1112 },
};
