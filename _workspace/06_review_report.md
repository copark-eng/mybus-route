# 06. 코드 리뷰 & 테스트 보고서 (2026-11-19)

## 종합 평가
- **배포 준비 상태**: 🟡 수정 후 배포 — 🔴 필수 수정은 없다. 아래 🟡-1(실시간 조회 전체 실패가 화면에서 "추정"으로만 보임)을 정리하고, 브라우저 수동 체크(04 문서 E2E 1~6)와 기상청 활용신청 후 실제 응답 확인을 마치면 배포 가능.
- **테스트**: Vitest 227개 전부 통과 (web 161 / worker 66). `npm test`·`npm run build` 녹색. 커버리지 수치는 미측정(coverage 패키지 미설치) — `web/src/lib` 의 순수 함수(router·data·places·storage·timebar·weather·util·routeType)와 `worker/src` 의 공개 함수·4개 핸들러는 모두 테스트로 실행된다. `api.ts`, `map.ts`, React 훅·컴포넌트는 단위 테스트 범위 밖.
- **총평**: 리디자인은 ADR-021~025 를 충실히 따른다(화면 순서, 시간 막대·빗금, 날씨 실패 시 숨김, 보일 때만 30초 갱신, 공유 1초 타이머, 즐겨찾기 실시간 카드). 테스트로 `isRunning` 경계 버그 1건과 자동완성 UI 버그 1건을 찾아 고쳤다.

## QA 중 고친 버그 (작은 것만)
| # | 위치 | 내용 | 수정 |
|---|---|---|---|
| F-1 | `web/src/lib/router.ts:106` | `isRunning` 이 `now < first` 일 때 다음 날로 넘겨서, 설계 의도인 **첫차 10분 전 여유 구간**(예: 첫차 06:00 → 05:50~05:59, P9801형 첫차=막차 07:00 → 06:50~06:59)이 항상 `false` 였다. 실시간 예측이 없는 첫차 직전 경로가 `notRunning` 으로 빠짐. 테스트 3개가 실패로 잡음 | `if (now < first - 10) now += 24 * 60;` — 자정 넘김(05:00~00:30) 경계 테스트도 그대로 통과 |
| F-2 | `web/src/components/features/PlaceInput.tsx:65-81` | 주소처럼 보이는 입력 후 300ms 안에 정류장을 고르면, 대기 중이던 Geocoding 응답이 `latestQuery` 가 그대로라 **고른 뒤 자동완성 목록을 다시 연다** | `pick()`·`clear()` 에서 `latestQuery.current = ""` |

## 발견 사항

### 🔴 필수 수정 (보안/기능)
- 없음.

### 🟡 권장 수정 (품질/성능)
1. **실시간 조회 전체 실패가 오류로 보이지 않음** — `web/src/lib/router.ts:245` `evaluate()` 가 정류장별 `fetchArrivals` 실패를 `() => undefined` 로 삼키므로 `evaluate` 는 사실상 reject 하지 않는다. 그 결과 `web/src/hooks/useLiveOptions.ts:36`, `web/src/hooks/useFavoriteBoard.ts:60` 의 catch 와 01 문서 "실시간 조회 실패 → 이전 결과 유지 + RefreshStatus 오류", 즐겨찾기 카드 `error` 상태가 도달 불가. Worker·data.go.kr 장애 시 사용자는 모든 경로가 "추정" + "첫 버스 실시간 정보 없음 (운행 종료이거나…)"로 보이고, 운행 시간 밖 노선은 "경로 없음"이 된다(오해 소지). 제안: `evaluate` 가 조회 실패 수를 세어 **필요한 정류장이 모두 실패하면 throw** (lib 로직 변경이라 아키텍트 확인 후 프런트가 수정).
2. **1초 틱마다 localStorage 읽기** — `web/src/screens/SearchScreen.tsx:136` `store.isFavorite(r.plan)` 은 `storage.ts:105` 에서 매번 `localStorage.getItem` + `JSON.parse`. 결과 카드 8개 × 매초 = 초당 8회 파싱(NFR-8 "1초 틱에서 표시만 갱신" 취지와 어긋남). 제안: `!!store.findFavorite(r.plan)` (useSaved 메모 배열 사용).
3. **즐겨찾기 보드의 오래된 응답 덮어쓰기** — `web/src/hooks/useFavoriteBoard.ts:39-69` 에는 `useLiveOptions` 같은 요청 id 비교가 없다. 즐겨찾기를 추가/삭제한 직후(plans 변경 → 강제 재실행) 이전 실행이 늦게 끝나면 `setStates` 가 새 결과를 덮어써 새 카드가 최대 30초 "로딩" 스켈레톤으로 남을 수 있다. 제안: `reqId` ref 로 마지막 실행만 반영.
4. **공개 API 호출 한도 소진 가능성(기존부터)** — `worker/src/index.ts:61` `stationId` 는 형식(숫자 6~12자리)만 검사하므로 임의의 id 를 바꿔 가며 부르면 캐시를 우회해 data.go.kr 일일 한도를 쓸 수 있다. `/api/weather` 도 국내 좌표 범위 안 격자마다 2회 호출. 인증이 없는 구조(ADR-004)라 완전한 방지는 어렵지만, 성남 정류장 id 목록(또는 접두사 `2060`/`2280` 등) 허용 목록과 Cloudflare Rate Limiting 규칙을 권장.
5. **터치 영역 44px 미만** — `web/src/styles/components.css:47-48` Segmented 버튼 `min-height: 40px`, `components.css:124` `.chip-x` 폭 40px, `web/src/styles/map.css:22-23` 지도 팝업 출발/도착 버튼 40px (NFR-7·ADR-014 는 ≥44px).

### 🟢 참고 사항
1. `web/src/lib/places.ts:30` 자동완성 색인이 모듈 전역(`index`)이라 처음 받은 DB 에 고정된다. 지금은 `useBusDb` 가 DB 를 한 번만 만들어 문제없음. DB 를 다시 불러오는 기능이 생기면 `WeakMap<BusDb, …>` 로.
2. `web/src/lib/router.ts:265-266` `db.stations.get(...)!` — 현재 데이터는 모든 노선 정류장이 stations.json 에 있음(5,189곳·299노선, 누락 0 확인). 03 문서 경고대로 누락이 생기면 `evaluate` 전체가 TypeError → 즐겨찾기 전부 실패. `favoriteToPlan` 에서 정류장 존재도 확인하면 안전.
3. `web/src/lib/storage.ts:116` `favoriteToPlan` 은 저장된 `toIndex` 위치의 정류장이 맞으면 그대로 쓰는데, 순환 노선에서 `fromIndex` 만 뒤로 밀린 경우 `toIndex ≤ fromIndex` 로 null 이 된다(뒤쪽의 같은 정류장을 다시 찾지 않음). 드문 경우.
4. `web/src/lib/map.ts:87-94` 지도 임의 위치를 빠르게 두 번 누르면 앞선 reverse-geocode 응답이 나중 팝업을 덮을 수 있다(경쟁 상태). 무해하지만 요청 번호 비교로 막을 수 있음.
5. `web/src/components/features/PlaceInput.tsx:103` blur 의 `setTimeout` 과 39행 debounce 타이머는 언마운트 시 정리하지 않는다(React 19 에서 경고 없음, 무해).
6. `web/src/components/features/RouteOptionCard.tsx:39` role 없는 `<span aria-label>` 은 스크린리더가 읽지 않는 경우가 많다 → `<span className="sr-only">즐겨찾기됨</span>` + 별은 `aria-hidden`.
7. 홈·상세·검색 화면 전체가 1초마다 다시 그려진다(`useCountdown` 을 화면 최상단에서 사용: `HomeScreen.tsx:18`, `DetailScreen.tsx:22`, `SearchScreen.tsx:26`). 타이머 자체는 모듈 하나로 공유되어 ADR-015 를 지키고, 지도 effect 는 의존성이 바뀌지 않아 재실행되지 않음 — 현재 규모에선 문제 없음. 커지면 카운트다운 표시 부분만 하위 컴포넌트로 분리.
8. 탭이 다시 보이면 홈/상세는 `enabled` 가 바뀌어 30초 경과 여부와 상관없이 즉시 1회 갱신한다(`useArrivalsRefresh.ts:38-40`). ADR-015("다시 보이면 바로 갱신")에는 맞고, 01 문서("30초 지났을 때")보다 호출이 약간 많다.
9. ADR-014 의 웹 앱 매니페스트는 이전 index.html 에도 없었다(이번 회귀 아님).
10. 출발지와 도착지가 같은 곳일 때 별도 안내가 없다(이전 main.ts 도 동일).
11. `worker/src/index.ts:43-44` 최상위 catch 는 `String(e)` 를 그대로 돌려준다. 현재 예외 메시지에 키가 들어가는 경로는 없음(테스트로 weather 오류 본문 확인). 상위 URL 을 문자열화하는 코드를 추가하지 말 것(02 문서 규칙 유지).

## 정합성 매트릭스
| 검증 항목 | 상태 | 비고 |
|---|---|---|
| 아키텍처 ↔ 코드 (화면·훅·디렉터리) | ✅ | 01 문서 구조 그대로. 라우터 라이브러리 없이 view+history, 검색 화면 hidden 유지, `#fav/<id>` 복원 |
| ADR-022 홈 순서 (날씨 → 즐겨찾기 → 검색 → 최근) | ✅ | `HomeScreen.tsx:33-82`, 0개면 EmptyState + 큰 검색 입력, 편집 중 카드 이동 없음 |
| ADR-023 시간 막대 | ✅ | 합계 = arriveSec, 0 길이 제거, 최소 4%, clip, 빗금(`components.css:193-195`), `role="img"` + aria-label (테스트) |
| ADR-024 / FR-6.2 날씨 숨김 | ✅ | 로딩·실패·temp null → `WeatherLine` null. Worker 502 + 60초 실패 캐시 (테스트) |
| ADR-015 30초 갱신·숨김 탭 중지·1초 공유 타이머 | ✅ | `useArrivalsRefresh` interval 은 visible 일 때만, `useCountdown` 모듈 타이머 1개. 브라우저 Network 확인은 미실시 |
| ADR-009 정렬 | ✅ | `compareOptions` 테스트, 화면은 evaluate 순서 그대로 사용 |
| ADR-017 즐겨찾기 경로 단위·복원 | ✅ | `favoriteToPlan` 테스트(밀림·삭제·역방향 → "노선 정보가 바뀌었습니다") |
| ADR-022 즐겨찾기 N개 = evaluate 1회 | ✅ | `useFavoriteBoard` 한 번 호출 + 정류장 중복 제거(테스트). 오래된 응답 처리 🟡-3 |
| 01 문서 오류 상태표 (실시간 조회 실패) | ⚠️ | 🟡-1 — evaluate 가 실패를 삼켜 오류 UI 도달 불가 |
| 회귀 (00_input 완료 기준) | ⚠️ | 자동완성·직행/환승·즐겨찾기·최근 검색·자동 갱신 로직은 단위 테스트로 확인. 지도 선택·375px·다크 모드는 브라우저 수동 확인 필요(서버 미실행) |
| API 명세 ↔ 구현 | ✅ | 4개 엔드포인트 상태 코드·오류 문구·Cache-Control·`{error,detail}` 형식이 02 문서와 일치(핸들러 테스트 36개) |
| DB 스키마 ↔ 마이그레이션 | ✅ (해당 없음) | DB 없음. localStorage `mybus-route:v1` 형식 변경 없음, 깨진 값·다른 버전 → 빈 값 (테스트) |
| 프런트 ↔ 백엔드 연동 | ✅ | `WeatherSummary` 필드 동일(web `lib/api.ts` ↔ worker `weather.ts`), 좌표 3자리 반올림 → 격자 캐시 적중 확인 |
| 보안 체크리스트 | ✅ | `dangerouslySetInnerHTML` 없음, 유일한 `innerHTML`(`map.ts:75`)은 `esc()` 처리, 번들에 `VITE_NAVER_MAP_CLIENT_ID` 외 비밀 없음, `.env`·`.dev.vars` gitignore, Worker 오류 본문에 키 없음(테스트). 호출 한도 남용은 🟡-4 |

## 이번 QA 변경 파일
- 설정: `package.json`(루트 `test`), `web/package.json`·`worker/package.json`(`vitest` devDependency, `"test": "vitest run"`), `package-lock.json`
- 테스트: `web/src/test/{fixtures,data,places,router,timebar,storage,format}.test.ts`, `worker/test/{weather,http,handlers}.test.ts`
- 버그 수정: `web/src/lib/router.ts:106` (F-1), `web/src/components/features/PlaceInput.tsx` (F-2)
- 참고: npm 이 `esbuild` postinstall 을 `allowScripts` 미등록으로 건너뛰었다는 경고를 냈지만 Vitest·빌드 모두 정상 동작.

---

## Phase 3 통합 (오케스트레이터, 2026-11-19)

QA 리뷰 이후 반영한 수정과 실제 브라우저 검증 결과.

### 반영한 수정
| 항목 | 파일 | 내용 |
|---|---|---|
| 🟡 API 장애가 "추정"으로 숨겨짐 | `web/src/lib/router.ts` `evaluate` | 도착정보를 **하나도** 못 받으면 오류를 던져 화면에 오류로 표시. 일부 실패는 기존처럼 추정으로 계속. 테스트 2개로 교체 |
| 🟡 1초마다 localStorage 파싱 | `web/src/hooks/useSaved.ts` | `isFavorite` 가 이미 읽어 둔 favorites 로 판단 |
| 🟡 터치 영역 40px | `styles/components.css`, `styles/map.css` | 44px 로 |
| 🔴(브라우저에서 발견) 검색 화면 지도가 비어 보임 | `web/src/lib/map.ts`, `components/features/NaverMap.tsx` | React 개발 모드 이중 마운트에서 첫 지도를 만든 뒤 destroy 하면 같은 요소의 두 번째 지도 화면까지 지워졌다. AbortSignal 로 취소된 쪽은 지도를 아예 만들지 않게 수정 |
| 상세 화면이 아래로 스크롤된 채 열림 | `web/src/App.tsx` `navigate` | 새 화면은 맨 위에서 시작 |

### 남긴 항목
- 🟡 `useFavoriteBoard` 늦게 도착한 이전 응답 필터링 — 30초 주기라 영향이 작아 보류
- 🟡 Worker stationId 허용 목록 — 정적 데이터가 Worker 에 없어 보류 (형식 검증 + 20초 캐시로 완화)

### 브라우저 검증 (localhost:5173 + wrangler dev 8787, 실제 키)
- 홈: 즐겨찾기 없음 안내 → 검색 → 07015 → 07147 실시간 결과 4건, 시간 막대, 출발 정류장 도착판 ✅
- 지도: 경로선, 출/도 핀, 정류장 마커 ✅ (수정 후)
- 상세: 큰 시간 막대, 단계별 시각, 지도, ★ 즐겨찾기 추가 ✅
- 홈 즐겨찾기 카드 실시간 "n분 후 출발 · HH:MM 도착" ✅
- 날씨: 기상청 미승인 → 502, 날씨 줄 숨김 ✅ (FR-6.2)
- 모바일 375px / 데스크톱 1280px 좌우 배치 / 다크 모드 ✅
- 테스트: web 162 + worker 66 = 228개 통과, `npm run build` 통과
