# 02. API 명세 — Cloudflare Worker `/api/*`

## 기본 정보
- **Base URL**: `/api` (웹과 같은 주소, ADR-020). 로컬: Vite 5173 → 8787 프록시. 버전 경로(`/v1`) 없음.
- **인증**: 없음 (ADR-004). 상위 API 키는 Worker Secret `BUS_API_KEY`, `NCP_KEY_ID`, `NCP_KEY`.
- **메서드**: `GET`만. 그 외 → `405 {"error":"method not allowed"}`.
- **CORS**: 설정 없음(같은 출처).
- **응답 형식**: `Content-Type: application/json; charset=utf-8`. 성공은 **데이터 그대로**(배열 또는 객체), 오류는 `{"error": string, "detail"?: string}`.

### 응답 형식 결정: 기존 형식 유지 (하네스 `{success,data}` 봉투 미적용)
- 클라이언트(`lib/api.ts` `getJson`)는 `res.ok`로 성공/실패를 가르고 본문을 그대로 쓴다. 이미 동작·검증된 코드다.
- 소비자가 우리 웹 하나뿐이라 봉투가 주는 이득(공통 메타데이터, 다중 클라이언트 호환)이 없다.
- 봉투로 바꾸면 Worker 4개 엔드포인트 + `api.ts` + 캐시된 응답 형식을 함께 바꿔야 하고 회귀 위험만 생긴다.
- 규칙: **HTTP 상태 코드가 성공/실패의 유일한 기준**. 2xx 본문 = 데이터, 4xx/5xx 본문 = `{error}`.

## 엔드포인트 목록
| Method | Path | 설명 | 쿼리 | 성공 응답 | 캐시 |
|---|---|---|---|---|---|
| GET | /api/arrivals | 정류장 실시간 도착 (경기도) | `stationId` | `RouteArrival[]` | Worker 20초 |
| GET | /api/geocode | 주소 → 좌표 (NCP) | `query` | `GeocodeResult[]` | 없음 |
| GET | /api/reverse-geocode | 좌표 → 주소 (NCP 원본 전달) | `lng`, `lat` | NCP 응답 원본 | 없음 |
| GET | /api/weather | 날씨 요약 (기상청) | `lat`?, `lng`? | `WeatherSummary` | Worker 10분 |
| GET | 그 외 /api/* | — | — | `404 {"error":"not found"}` | — |

공통: 처리 중 예외는 `502 {"error": String(e)}` (index.ts 의 try/catch).

---

## GET /api/arrivals
- **쿼리**: `stationId` — 숫자 6~12자리 (`/^\d{6,12}$/`). 예: `206000004`
- **응답 200** (`RouteArrival[]`, 도착 예정이 없는 정류장이면 `[]`):
```json
[
  {
    "routeId": "241224001",
    "routeName": "2",
    "staOrder": 15,
    "arrivals": [
      { "seconds": 240, "stopsLeft": 2, "plateNo": "경기70바1234" },
      { "seconds": 960, "stopsLeft": 8, "plateNo": null }
    ]
  }
]
```
| 필드 | 타입 | 설명 |
|---|---|---|
| routeId | string | 노선 ID (routes.json `id`) |
| routeName | string | 노선 번호 |
| staOrder | number \| null | 이 정류장의 노선 내 순번(1부터). 왕복 노선 구분용 (router.ts 는 `index+1`과 비교) |
| arrivals | 배열(0~2) | 다음 버스. `seconds`=도착까지 초(`predictTimeSec` 우선, 없으면 `predictTime`×60), `stopsLeft`=남은 정류장 수, `plateNo`=차량번호(차량 추적용) |
- **헤더**: `Cache-Control: public, max-age=20`
- **오류**: 400 `stationId 가 올바르지 않습니다` / 502 `data.go.kr <HTTP상태>` 또는 `data.go.kr <resultCode>: <메시지>` (resultCode 0·4(결과 없음)는 정상)
- **동작**: 429 이면 300·600·900ms 후 최대 3회 재시도. 키는 `decodeURIComponent` 후 사용(이중 인코딩 방지).
- **클라이언트**: `fetchArrivals(stationId, maxAgeMs=15000)`가 결과에 `fetchedAt`(수신 시각 ms)을 붙여 `StationArrivals`로 감싸고, 15초 안의 재요청은 메모리 Promise 를 재사용.

## GET /api/geocode
- **쿼리**: `query` — 앞뒤 공백 제거 후 2자 이상. 클라이언트는 `looksLikeAddress(q)`일 때만 300ms 디바운스로 호출.
- **응답 200** (`GeocodeResult[]`, 없으면 `[]`):
```json
[{ "roadAddress": "경기도 성남시 분당구 판교역로 166", "jibunAddress": "경기도 성남시 분당구 백현동 532", "lng": 127.1112, "lat": 37.3947 }]
```
- **오류**: 400 `query 는 2글자 이상` / 502 `{"error":"geocode <상태>","detail":"<NCP 응답 앞 300자>"}`
- 클라이언트는 실패 시 빈 배열로 처리(정류장 결과만 표시).

## GET /api/reverse-geocode
- **쿼리**: `lng`, `lat` — 유한한 숫자. 예: `?lng=127.1112&lat=37.3947`
- **응답 200**: NCP Reverse Geocoding 응답 **원본**(`orders=roadaddr,addr`, `output=json`). 클라이언트 `reverseGeocode()`가 `results[]`에서 `roadaddr` 우선, 없으면 `addr`로 "분당구 판교역로 166 ○○빌딩" 한 줄을 만든다. 주소가 없으면 `null`.
- **오류**: 400 `lng, lat 이 필요합니다` / 502 `{"error":"reverse-geocode <상태>","detail":...}`
- 클라이언트는 실패 시 "지도에서 선택한 위치" 라벨을 쓴다.
- (이번 범위에서 형식 변경 없음. 원본 전달이 어색하지만 동작 중이므로 유지)

---

## GET /api/weather (ADR-024, FR-6)
기상청 단기예보 조회서비스(`VilageFcstInfoService_2.0`)의 **초단기실황**(`getUltraSrtNcst`, 현재)과 **단기예보**(`getVilageFcst`, 오늘 남은 시간)를 병렬 호출해 요약한다. 키는 `BUS_API_KEY` 재사용(별도 활용신청 필요 — **현재 미신청 → 502 가 정상**).

### 요청
| 쿼리 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| lat | number | 37.3826 | 위도 (기본: 분당구청 부근) |
| lng | number | 127.1189 | 경도 |
- 좌표 → 기상청 격자 `(nx, ny)` 변환(LCC, `toGrid`). 기본 좌표의 격자는 성남 분당 부근.
- **클라이언트 호출 규칙**: 홈에서 즐겨찾기가 있으면 **첫 번째 즐겨찾기의 `from.lat/lng`**, 없으면 쿼리 없이 호출. 좌표는 소수 3자리로 반올림해 보낸다(같은 격자 → 캐시 적중).

### 응답 200 — `WeatherSummary`
```json
{
  "temp": 6.2,
  "feels": 3.1,
  "sky": "구름많음",
  "precip": "없음",
  "rainFrom": { "hour": 18, "pop": 60, "type": "비" },
  "maxPop": 70,
  "nx": 63,
  "ny": 124,
  "baseTime": "20261119 0800"
}
```
| 필드 | 타입 | 출처·규칙 |
|---|---|---|
| temp | number \| null | 초단기실황 `T1H` (℃) |
| feels | number \| null | 겨울철 체감온도 공식(`T1H`, `WSD`). 10℃ 초과 또는 풍속 < 4.8km/h 이면 `temp`와 같은 값. 둘 중 하나라도 없으면 null |
| sky | `"맑음"\|"구름많음"\|"흐림"\|null` | 단기예보 오늘 남은 시간 중 **가장 이른 시각**의 `SKY`(1/3/4) |
| precip | `"없음"\|"비"\|"비/눈"\|"눈"\|"빗방울"\|"빗방울눈날림"\|"눈날림"\|null` | 초단기실황 `PTY` (현재 강수 형태). 4(소나기)는 "비"로 |
| rainFrom | `{hour, pop, type}` \| null | 단기예보에서 **현재 시(포함) 이후 오늘** 처음 `PTY ≠ 0`인 시각. `hour`=KST 0~23, `pop`=그 시각 강수확률(%), `type`=precip 와 같은 문자열 |
| maxPop | number | 오늘 남은 시간 최대 `POP`(%). 데이터 없으면 0 |
| nx, ny | number | 사용한 격자 |
| baseTime | string | 초단기실황 발표 기준 `"YYYYMMDD HHmm"` (KST) |

- 발표 시각 계산(KST): 초단기실황 = (현재 − 40분)의 정시. 단기예보 = (현재 − 15분) 이전의 02·05·08·11·14·17·20·23시 중 가장 최근(00:00~02:14 는 전날 23시). `numOfRows` 10 / 400.
- **헤더**: `Cache-Control: public, max-age=600`

### 캐시
- 키: `https://cache.mybus-route/weather/{nx}-{ny}` (격자 단위), TTL 600초. 실패(502)는 `.../weather-err/{nx}-{ny}`에 60초(응답 헤더 `Cache-Control: public, max-age=60`).
- 저장소 2단(`worker/src/http.ts`): isolate 메모리 Map(최대 300개) → `caches.default`. Cloudflare 문서상 Cache API 는 커스텀 도메인에서만 동작이 명시되어 `*.workers.dev`에서는 메모리 캐시가 실질 캐시다(isolate 별, 보장 아님). `/api/arrivals`(20초)도 같은 구조.
- 모든 API 응답에 `X-Content-Type-Options: nosniff`. 405 에는 `Allow: GET`.
- (구현 반영 2026-11-19) 빈 `lat=`/`lng=` → 기본값, 범위 400, 23시 이후 sky fallback, 실패 60초 캐시 완료. `/api/reverse-geocode`는 빈 `lng`/`lat`도 400(이전엔 0 으로 통과), `/api/geocode`는 `query` 100자 초과 시 400 `query 는 100글자 이하`.
- 클라이언트 `useWeather`도 10분 메모리 캐시(이중 보호).

### 오류
| 상태 | 본문 | 조건 |
|---|---|---|
| 400 | `{"error":"lat, lng 가 필요합니다"}` | lat/lng 가 숫자가 아님(`NaN`) |
| 502 | `{"error":"Error: 기상청 getUltraSrtNcst 401: <본문 앞 120자>"}` | 기상청 HTTP 오류 (미신청 시 401/403 예상) |
| 502 | `{"error":"Error: 기상청 getVilageFcst 03: NO_DATA"}` 등 | `resultCode ≠ "00"` |
| 502 | `{"error":"SyntaxError: ..."}` | 기상청이 JSON 대신 XML 오류를 준 경우 |
- 오류 본문에 키 값은 포함되지 않는다(요청 URL 을 문자열화하지 않음 — 유지할 것).
- **프런트는 오류 내용을 화면에 쓰지 않는다**: 2xx 가 아니거나 JSON 파싱 실패 → `null` → 날씨 줄 숨김 (FR-6.2).

### 백엔드 작업 목록 (weather.ts)
1. **빈 파라미터**: `?lat=&lng=` 는 `Number("") = 0`이라 통과해 엉뚱한 격자가 된다. 빈 문자열은 기본값으로 처리.
2. **범위 검증**: 위도 33~39, 경도 124~132 밖이면 400 `{"error":"lat, lng 범위를 벗어났습니다"}`.
3. **23시 이후 sky=null**: 23:00 발표(23:15 이후 조회) 단기예보에는 오늘 시각이 없어 `hours`가 비고 `sky`가 null 이 된다. `sky`는 오늘이 비면 **가장 이른 예보 항목(내일 포함)**의 `SKY`로 채운다. `rainFrom`/`maxPop`은 오늘 기준 유지.
4. **실패 짧은 캐시**: 미신청·장애 시 홈을 열 때마다 기상청을 2회 호출하므로, 502 응답도 같은 키 계열(`.../weather-err/{nx}-{ny}`)에 **60초** 캐시.
5. **Cache API 확인**: `*.workers.dev`에서 `caches.default`가 no-op 일 수 있음(01 문서 백엔드 3). 필요하면 isolate 메모리 Map 캐시 추가(도착정보 포함).
6. 응답 필드 이름·타입은 위 표에서 바꾸지 말 것(프런트 계약).

### 프런트 표시 규칙 (`lib/weather.ts` `formatWeather(w, nowHour)`)
- 앞부분: `{temp 반올림}° {sky}` (sky null 이면 생략). `temp` null 이면 **줄 전체 숨김**.
- 체감: `feels`가 있고 `|feels − temp| ≥ 1`이면 `· 체감 {feels 반올림}°`.
- 강수 안내 (하나만, 위에서부터):
  1. `precip`가 "없음"/null 이 아니면 `· 지금 {precip} · 우산 챙기세요`
  2. `rainFrom`이 있으면 `· {오전/오후 h시}부터 {type} {pop}% · 우산 챙기세요` (0시=오전 12시, 12시=오후 12시, 현재 시각과 같으면 "곧")
  3. `maxPop ≥ 60` 이면 `· 강수확률 {maxPop}%`
- 예: `6° 구름많음 · 체감 3° · 오후 6시부터 비 60% · 우산 챙기세요`
- 아이콘은 쓰지 않거나 텍스트 앞 작은 글리프 1개(선택). 줄은 한 줄 말줄임(`text-overflow: ellipsis`).
