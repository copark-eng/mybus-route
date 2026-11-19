/**
 * 응답 생성과 캐시 공용 도구.
 *
 * 캐시 2단 구성:
 *   1) isolate 메모리 Map (항상 동작, isolate 가 살아 있는 동안만, 최대 MEM_MAX 개)
 *   2) caches.default (커스텀 도메인에서만 실제로 저장됨)
 * Cloudflare 문서: "Workers deployed to custom domains have access to functional cache operations"
 * (https://developers.cloudflare.com/workers/runtime-apis/cache/) — Cache API 는 zone 단위라
 * *.workers.dev 주소에서는 저장되지 않는 것으로 보고, 메모리 캐시를 1차로 둔다.
 * 로컬 wrangler dev 에서는 caches.default 가 동작하므로 로컬 결과만으로 판단하지 말 것.
 */

/** 모든 API 응답에 붙이는 기본 헤더 */
const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

// ---------- isolate 메모리 캐시 ----------

interface MemEntry {
  expires: number; // ms
  status: number;
  body: string;
  headers: [string, string][];
}

const MEM_MAX = 300;
const mem = new Map<string, MemEntry>();

function memGet(key: string): Response | null {
  const e = mem.get(key);
  if (!e) return null;
  if (e.expires <= Date.now()) {
    mem.delete(key);
    return null;
  }
  return new Response(e.body, { status: e.status, headers: e.headers });
}

function memPut(key: string, entry: MemEntry): void {
  mem.delete(key); // 다시 넣어 삽입 순서를 최신으로
  if (mem.size >= MEM_MAX) {
    const now = Date.now();
    for (const [k, v] of mem) if (v.expires <= now) mem.delete(k);
    // 그래도 가득 차 있으면 가장 오래된 것부터 지운다 (Map 은 삽입 순서 유지)
    while (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value as string);
  }
  mem.set(key, entry);
}

/** 테스트용: 메모리 캐시 비우기 */
export function clearMemCache(): void {
  mem.clear();
}

// ---------- 2단 캐시 ----------

/** 캐시 키는 실제 요청이 나가지 않는 가상 주소를 쓴다 */
const cacheUrl = (key: string) => `https://cache.mybus-route/${key}`;

/** 메모리 → caches.default 순으로 찾는다. 없으면 null. */
export async function cacheGet(key: string): Promise<Response | null> {
  const m = memGet(key);
  if (m) return m;
  try {
    const hit = await caches.default.match(new Request(cacheUrl(key)));
    return hit ?? null;
  } catch {
    return null; // 캐시 장애는 무시하고 상위 API 를 부른다
  }
}

/**
 * res 를 ttlSec 동안 두 캐시에 저장한다. res 본문은 읽지 않는다(복사본 사용).
 * caches.default 에는 Cache-Control: public, max-age=ttlSec 를 붙여 저장한다
 * (오류 응답도 상태 코드 그대로, max-age 로 짧게 저장 — 실패 캐시).
 */
export async function cachePut(key: string, res: Response, ttlSec: number, ctx: ExecutionContext): Promise<void> {
  const body = await res.clone().text();
  const headers = [...res.headers.entries()];
  memPut(key, { expires: Date.now() + ttlSec * 1000, status: res.status, body, headers });

  const stored = new Response(body, { status: res.status, headers });
  stored.headers.set("Cache-Control", `public, max-age=${ttlSec}`);
  ctx.waitUntil(caches.default.put(new Request(cacheUrl(key)), stored).catch(() => {}));
}
