import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** 빌드마다 바뀌는 버전 (ADR-034): 화면에 넣고, dist/version.json 으로도 내보낸다 */
const BUILD_ID = new Date().toISOString();

/** 열려 있는 화면이 새 버전이 나왔는지 확인할 수 있게 version.json 을 만든다 */
function versionFile(): Plugin {
  return {
    name: "mybus-version-file",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

// 웹과 API 를 같은 Worker 주소에서 제공한다 (ADR-020).
// 로컬 개발 중에는 /api 요청을 로컬 Worker(wrangler dev, 8787)로 넘긴다.
export default defineConfig({
  base: "/",
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
