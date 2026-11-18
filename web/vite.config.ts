import { defineConfig } from "vite";

// 웹과 API 를 같은 Worker 주소에서 제공한다 (ADR-020).
// 로컬 개발 중에는 /api 요청을 로컬 Worker(wrangler dev, 8787)로 넘긴다.
export default defineConfig({
  base: "/",
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
