import { defineConfig } from "vite";

// GitHub Pages 주소가 https://<아이디>.github.io/mybus-route/ 이므로 base 를 맞춘다 (ADR-001, ADR-003).
export default defineConfig({
  base: "/mybus-route/",
});
