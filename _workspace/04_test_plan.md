# 04. 테스트 계획 — 미니멀 화이트 리디자인 + 날씨 (2026-11-19)

## 테스트 전략
- **도구**: Vitest 5.1 (`web`, `worker` 각 devDependency), 환경 `node` (DOM 없음). 순수 모듈만 단위 테스트한다.
- **실행**: 루트 `npm test` (= `npm run test -w web && npm run test -w worker`), 각 워크스페이스 `vitest run`.
- **위치**: `web/src/test/*.test.ts` (빌드 `tsc --noEmit` 타입 검사 대상에 포함됨), `worker/test/*.test.ts` (Worker tsconfig 밖 — 실행만).
- **원칙**: AAA, 테스트 간 독립(매 테스트 `localStorage`·`fetch`·`caches` 대역을 새로 만들고 메모리 캐시 초기화), 경계값 포함. 실제 `data/*.json` 대신 합성 픽스처(`web/src/test/fixtures.ts`: 정류장 8개·노선 4개).
- **외부 의존 격리**: `fetchArrivals` 는 `vi.mock`, Worker 상위 API 는 `vi.stubGlobal("fetch")`, Cache API 는 `caches.default` 대역, 시각은 `vi.useFakeTimers({ toFake: ["Date"] })`.
- **커버리지 목표**: `web/src/lib`·`worker/src` 순수 함수 80% 이상(함수 단위). 측정 도구(`@vitest/coverage-v8`)는 이번에 넣지 않았다 → 수치 미측정. React 컴포넌트·훅은 단위 테스트 범위 밖(아래 E2E/수동).
- **테스트 피라미드(이 프로젝트 기준)**: 단위 227개 / 통합(Worker 핸들러를 `fetch` 대역으로 끝까지 호출) 36개 포함 / E2E 는 Playwright 미도입 → 수동 체크리스트.

| 파일 | 대상 | 테스트 수 |
|---|---|---|
| web/src/test/data.test.ts | `distanceM`, `walkSeconds`, `SpatialGrid.near/inBounds` | 18 |
| web/src/test/places.test.ts | `searchStations`(이름·번호·초성), `looksLikeAddress`, `directionHint`, `samePlace` | 27 |
| web/src/test/router.test.ts | `findPlans`, `isRunning`, `headwayMin`, `evaluate`(mock), `compareOptions` | 36 |
| web/src/test/timebar.test.ts | `toSegments`, `clip`, `layout`, `segLabel`, `describeSegments` | 25 |
| web/src/test/storage.test.ts | pairs·favorites CRUD, `favoriteToPlan`, 저장소 오류 내성 | 18 |
| web/src/test/format.test.ts | `formatWeather`, `fmtWait/fmtMin/fmtDepart/fmtClock/shortLabel/esc`, `remaining`, `routeTypeKey` | 37 |
| worker/test/weather.test.ts | `toGrid`, `parseCoord`, `windChill`, `ultraBase/vilageBase/kstNow`, `summarize` | 19 |
| worker/test/http.test.ts | `json`, `cachePut/cacheGet` (TTL·300개 상한·2단 캐시) | 11 |
| worker/test/handlers.test.ts | `/api/*` 라우팅·입력 검증·캐시·오류 형식 (fetch 대역) | 36 |
| **합계** | | **227 (web 161 + worker 66)** |

## 테스트 매트릭스
| 기능 (FR) | 단위 | 통합 (Worker) | E2E/수동 | 우선순위 |
|---|---|---|---|---|
| FR-1.2~1.4 자동완성(이름·번호·초성·방면) | ✅ places | – | ☐ 키보드만으로 선택 | P0 |
| FR-1.6 주소 출발지(500m·도보) | ✅ findPlans point, walkSeconds | ✅ geocode 검증·형식 | ☐ 주소 입력 → 결과 | P0 |
| FR-1.1/1.7 지도 선택 | – (SDK 의존) | ✅ reverse-geocode 검증 | ☐ 정류장·임의 위치 | P0 |
| FR-1.5 ⇅ | – | – | ☐ | P0 |
| FR-3 최근 검색(중복·8개·삭제) | ✅ storage | – | ☐ 칩 → 즉시 검색 | P0 |
| FR-4.1 직행/환승 모드 | ✅ findPlans allowTransfer | – | ☐ | P0 |
| FR-4.2 정렬(ADR-009) | ✅ compareOptions, evaluate 정렬 | – | ☐ | P0 |
| FR-4.3/4.4 대기·탑승·환승 시간 | ✅ evaluate(첫 탑승 가능 버스, 차량 추적, 환승 대기) | – | ☐ 상세 단계 | P0 |
| FR-4.5 출발 정류장 도착판 | – | ✅ arrivals 변환 | ☐ | P1 |
| FR-4.6 추정 표시 | ✅ toSegments estimated, evaluate 추정 플래그 | – | ☐ 빗금·"추정" | P0 |
| FR-4.7 30초 갱신·숨김 탭 중지 | – (훅) | ✅ arrivals 20초 캐시 | ☐ Network 탭 | P0 |
| FR-5 즐겨찾기 저장·이름·삭제·복원 | ✅ storage, favoriteToPlan(밀림·삭제·역방향) | – | ☐ 홈 카드 실시간 | P0 |
| FR-6.1 날씨 한 줄 | ✅ formatWeather, summarize, toGrid | ✅ /api/weather 정상·캐시 | ☐ 문구 | P1 |
| FR-6.2 날씨 실패 격리 | ✅ formatWeather null | ✅ 401/NO_DATA/XML → 502 + 60초 캐시 | ☐ 홈에 줄 없음 | P0 |
| ADR-023 시간 막대 | ✅ 합계 = arriveSec, 0 길이 제거, 최소 폭 4%, clip | – | ☐ 375px | P0 |
| NFR-4 키 비노출 | – | ✅ 오류 본문·URL 에 키 없음, NCP 키는 헤더로만 | ✅ 번들 grep | P0 |
| NFR-6 호출 수 | ✅ evaluate 정류장 중복 제거 | ✅ 메모리 캐시 TTL·상한 | ☐ 즐겨찾기 N개 요청 수 | P1 |

## 테스트 시나리오

### 경로 탐색 (router)
| # | 시나리오 | 입력 | 기대 결과 | 유형 |
|---|---|---|---|---|
| 1 | 직행 | A→C (R1: A,B,C) | R1 0→2 하나, 도보 0 | 단위 |
| 2 | 역방향 | C→A | 후보 없음 | 단위 |
| 3 | 200m 도보 환승 | A→D (R2: A→T1, R3: T2→D, T1↔T2 55m) | R2→R3, 환승 도보 60초 | 단위 |
| 4 | 직행만 모드 | A→D, allowTransfer=false | 빈 배열 | 단위 |
| 5 | 성남 밖 환승 금지 | T1 의 sel 제거 | 빈 배열 | 단위 |
| 6 | 주소 출발 | A 남쪽 111m 지점 | walkStartSec 120 | 단위 |
| 7 | 첫 탑승 가능 버스 | 도보 120초, 예측 60·600초 | 600초 버스, 대기 480 | 단위(mock) |
| 8 | 차량 추적 | 하차 정류장에 같은 번호판 | rideEstimated=false | 단위(mock) |
| 9 | 차량 추적 실패 | 번호판 다름·없음·하차 예측이 승차 이전 | 탑승 시간 추정 | 단위(mock) |
| 10 | 받은 뒤 흐른 시간 | fetchedAt 30초 전 | 예측 −30초 | 단위(mock) |
| 11 | 왕복 노선 | 같은 routeId 2개, staOrder 1/5 | index+1 인 것 | 단위(mock) |
| 12 | 예측 없음 + 운행 중 | 빈 도착정보 | 배차/2 대기, note | 단위(mock) |
| 13 | 예측이 모두 지나감 | 예측 60·200, 도보 300 | 200+배차 | 단위(mock) |
| 14 | 운행 시간 아님 | 첫차 05:00·막차 06:00, 12시 | 결과에서 제외 | 단위(mock) |
| 15 | 조회 실패 | fetchArrivals reject | 예외 없이 추정 | 단위(mock) |
| 16 | 정류장 중복 조회 제거 | plan 2개(승차 A 공유) | A·C·T1 각 1회 | 단위(mock) |
| 17 | isRunning 경계 | 첫차−10분, 막차+90분, 자정 넘김(05:00~00:30), 첫차=막차(P9801형) | 표 그대로 | 단위 |
| 18 | 정렬 | 도착 → 환승 수 → 도보, note 는 뒤, null 맨 뒤 | ADR-009 | 단위 |

### 시간 막대 (timebar)
| # | 시나리오 | 입력 | 기대 결과 | 유형 |
|---|---|---|---|---|
| 1 | 직행 세그먼트 | 도보120·승차600·하차1100·도보30 | walk/wait/ride/walk, 합 1130 | 단위 |
| 2 | 환승 세그먼트 | 환승 도보 60 | transferWalk·transferWait, 합 = arriveSec | 단위 |
| 3 | 0 길이 제거 | 도보 0·대기 0 | ride 하나 | 단위 |
| 4 | null 시각 | boardSec/arriveSec null | [] | 단위 |
| 5 | clip | 300초 경과, 경계, 전부 경과 | 앞 잘림 / [] / 원본 불변 | 단위 |
| 6 | layout | 10:1000 | 4% / 96%, 합 100 | 단위 |
| 7 | layout 많은 세그먼트 | 30개 | 최소 폭 1/n, 합 100 | 단위 |

### 저장 (storage)
| # | 시나리오 | 입력 | 기대 결과 | 유형 |
|---|---|---|---|---|
| 1 | 최근 검색 중복 | 같은 정류장 쌍(라벨 다름) | 1개, 앞으로 | 단위 |
| 2 | 위치 좌표 비교 | 소수 5자리 같음/다름 | 1개 / 2개 | 단위 |
| 3 | 최대 8개 | 10회 저장 | 최신 8개 | 단위 |
| 4 | 저장소 오류 | 깨진 JSON, version 2, getItem/setItem 예외 | 빈 값, 예외 없음 | 단위 |
| 5 | 즐겨찾기 추가·이름·삭제 | | 최신이 앞, 기본 이름 짧은 라벨 | 단위 |
| 6 | favoriteToPlan 정류장 밀림 | 앞에 정류장 2개 추가 | 인덱스 다시 찾음 | 단위 |
| 7 | favoriteToPlan 순환 노선 | (C,X,A,B,C) | 하차는 승차 뒤 C | 단위 |
| 8 | 노선 사라짐·정류장 빠짐·역방향 | | null ("노선 정보가 바뀌었습니다") | 단위 |

### Worker API
| # | 시나리오 | 입력 | 기대 결과 | 유형 |
|---|---|---|---|---|
| 1 | 메서드 | POST | 405 + `Allow: GET` | 통합 |
| 2 | 경로 없음 | /api/nope | 404 `{error}` | 통합 |
| 3 | stationId 검증 | "", abc, 5자리, 13자리, `;` | 400, 상위 호출 없음 | 통합 |
| 4 | 도착정보 변환 | 1건 객체, predictTimeSec 없음 | 배열·초 단위, 키 디코딩 | 통합 |
| 5 | 도착정보 캐시 | 같은 정류장 2회 | 상위 1회 | 통합 |
| 6 | 상위 오류 | resultCode 30, HTTP 500, 429 후 성공 | 502(캐시 안 함) / 재시도 | 통합 |
| 7 | geocode 검증 | 1자, 101자, 100자 | 400 / 400 / 200 | 통합 |
| 8 | reverse-geocode 검증 | 빈 값, 숫자 아님, Infinity | 400 | 통합 |
| 9 | weather 검증 | NaN, 범위 밖(50,127 등) | 400 (문구 계약대로) | 통합 |
| 10 | weather 빈 파라미터 | `lat=&lng=` | 기본 격자 62·123 | 통합 |
| 11 | weather 미신청 | 상위 401 | 502 + max-age=60, 재요청 캐시 적중, 키 없음 | 통합 |
| 12 | weather 정상 | 실황+예보 | 200 + max-age=600, 같은 격자 캐시 | 통합 |
| 13 | weather XML/NO_DATA | | 502 | 통합 |
| 14 | toGrid | 서울시청 / 분당구청 / 원점 | (60,127) / (62,123) / (43,136) | 단위 |
| 15 | summarize | 평범한 날, 23시 이후, 값 누락, PTY 코드표 | 02 명세 표 그대로 | 단위 |
| 16 | 캐시 | TTL 경계(−1ms 적중, 0ms 만료), 300개 상한, 만료 우선 삭제, 재삽입 순서 | | 단위 |

## E2E 핵심 플로우 (수동 — Playwright 미도입)
1. **홈 → 검색 → 상세 → 즐겨찾기**: 홈(날씨 줄 → 즐겨찾기 → "어디로 갈까요?" → 최근 검색 순서) → 출발 "판교역" 자동완성 Enter → 도착 "07015" → 결과 카드(시간 막대) → 카드 → 상세 ☆ → 뒤로(검색 결과 유지) → 뒤로(홈) → 즐겨찾기 카드 "n분 후 출발 · HH:MM 도착".
2. **즐겨찾기 편집**: 편집 → 이름 입력 Enter/Esc → × 삭제 → 0개면 EmptyState + 큰 검색 입력.
3. **새로고침 복원**: `#fav/<id>` 에서 새로고침 → 같은 즐겨찾기 상세.
4. **자동 갱신**: Network 탭에서 30초 간격 `/api/arrivals`, 탭 숨김 동안 요청 없음, 다시 보이면 30초 지났을 때 즉시 1회. 즐겨찾기 N개 → 정류장 수만큼만 요청.
5. **날씨 실패**: 기상청 미신청 상태에서 홈에 날씨 줄이 없고 나머지 정상.
6. **화면**: 375px 가로 스크롤 없음, 다크 모드, 키보드만으로 검색 완료.

## 코드 리뷰 체크리스트
- [x] TypeScript 타입 안전성 (`npm run build` 통과, 테스트 파일 포함)
- [x] 입력 검증 — Worker 4개 엔드포인트 모두 (Zod 대신 정규식·`toNum`/`parseCoord`, 테스트로 확인)
- [~] 에러 처리 일관성 — Worker `{error}` 형식 일관. 프런트 실시간 조회 실패 경로는 사실상 도달 불가(06 보고서 🟡-1)
- [x] SQL 인젝션 — 해당 없음(DB 없음)
- [x] XSS — `dangerouslySetInnerHTML` 없음, 지도 InfoWindow `innerHTML` 은 `esc()` 적용
- [x] 환경변수 하드코딩 없음 — 브라우저 번들에는 `VITE_NAVER_MAP_CLIENT_ID` 만, `.env`/`.dev.vars` git 제외
- [x] N+1 쿼리 — 해당 없음. 대신 `evaluate` 정류장 조회 중복 제거 확인
- [~] 불필요한 리렌더링 — 1초 틱마다 검색 결과 카드가 localStorage 를 읽음(06 보고서 🟡-2)
