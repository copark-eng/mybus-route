import { useEffect, useState } from "react";

declare const __BUILD_ID__: string;

/** 지금 화면을 만든 빌드 (vite define). 테스트·개발에서는 "dev" */
export const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

const CHECK_EVERY_MS = 10 * 60_000;

/**
 * 새 버전 확인 (ADR-034). 열어 둔 탭이나 홈 화면에 추가한 앱은 새로 배포돼도 예전 코드를 계속 쓴다.
 * 화면이 다시 보일 때와 10분마다 version.json 을 (캐시 없이) 읽어, 빌드가 다르면 true.
 */
export function useNewVersion(): boolean {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (BUILD_ID === "dev" || import.meta.env.DEV) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
        const j = await res.json();
        if (alive && j?.build && j.build !== BUILD_ID) setStale(true);
      } catch {
        /* 오프라인 등: 다음에 다시 */
      }
    };
    void check();
    const id = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return stale;
}
