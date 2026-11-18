export const config = {
  naverMapClientId: import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string | undefined,
  /** API 는 같은 주소의 /api 아래에 있다 (ADR-020). */
  apiBase: "/api",
  /** 실시간 정보 자동 갱신 주기 (ADR-015) */
  refreshMs: 30_000,
  /** 지도 초기 중심: 성남시 (ADR-010) */
  initialCenter: { lat: 37.3947, lng: 127.1112 },
};
