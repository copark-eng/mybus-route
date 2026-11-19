import { useCallback, useEffect, useState } from "react";
import { type BusDb, loadDb } from "../lib/data";

/** 정류장·노선 DB 는 모듈 단위 Promise 로 한 번만 불러온다 */
let dbPromise: Promise<BusDb> | null = null;
function getDb(): Promise<BusDb> {
  dbPromise ??= loadDb().catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

export function useBusDb(): { db: BusDb | null; error: string | null; retry(): void } {
  const [db, setDb] = useState<BusDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    getDb().then(
      (d) => { if (alive) setDb(d); },
      (e) => { if (alive) setError(String(e)); },
    );
    return () => { alive = false; };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { db, error, retry };
}
