# mybus-route

출발지와 도착지를 고르면 경기도(성남시) 버스 실시간 정보로 가장 빨리 도착하는 경로(직행 / 1회 환승)를 추천하는 웹서비스입니다.

- 요구사항: [doc/requirements.md](doc/requirements.md)
- 결정 기록(ADR): [doc/adr.md](doc/adr.md)
- 의사결정 목록: [doc/decisions.md](doc/decisions.md)

## 구조
웹 화면과 API 를 Cloudflare Worker 하나로 배포합니다 ([ADR-020](doc/adr.md#adr-020)).
서비스 주소: https://mybus-route.copark-ai.workers.dev
```
web/      프런트엔드 (TypeScript + Vite, 네이버 지도) → 빌드 결과 web/dist
worker/   Cloudflare Worker: web/dist 정적 파일 + /api/* (data.go.kr, NCP Geocoding)
doc/      요구사항, ADR
```

## 로컬 실행
```
npm install
npm approve-scripts workerd        # 처음 한 번 (wrangler 로컬 실행에 필요)
```

API (터미널 1):
```
cp worker/.dev.vars.example worker/.dev.vars   # 키 입력
npm run dev:worker                             # http://localhost:8787
```

웹 (터미널 2):
```
cp web/.env.example web/.env                   # NCP Client ID 입력
npm run dev:web                                # http://localhost:5173  (/api 는 8787 로 전달)
```

## 정류장·노선 DB 수집
```
npm run build:db      # worker/.dev.vars 의 BUS_API_KEY 사용 → web/public/data/*.json
```
- 성남시 정류장에서 시작해 경유 노선 → 노선의 정류장 순서를 따라가며 모읍니다 ([ADR-006](doc/adr.md#adr-006)).
- data.go.kr 개발계정은 정류소 조회가 **하루 약 1,000건**이라 한 번에 다 못 모읍니다. 응답은 `scripts/.cache`에 저장되므로 다음 날 다시 실행하면 이어서 수집합니다. 덜 끝난 경우 데이터에 `partial` 표시가 붙고 화면 아래에 "일부 정류장 수집 중"이 보입니다.

## 배포 (Cloudflare)
### 처음 한 번
```
cd worker
npx wrangler login
npx wrangler secret put BUS_API_KEY
npx wrangler secret put NCP_KEY_ID
npx wrangler secret put NCP_KEY
```

### 방법 1: 직접 배포
```
npm run deploy        # web 빌드 → worker 배포
```

### 방법 2: GitHub push 시 자동 배포 (Workers Builds)
Cloudflare 대시보드 → Workers & Pages → `mybus-route` → Settings → Builds → GitHub 저장소 연결
- Root directory: `/`
- Build command: `npm ci && npm run build -w web`
- Deploy command: `npx wrangler deploy --config worker/wrangler.toml`
- Build variables: `VITE_NAVER_MAP_CLIENT_ID`

## 준비할 계정·API
- data.go.kr: 경기도_버스도착정보 조회(승인됨), 경기도_정류소 조회, 경기도_버스노선 조회
- 네이버 클라우드 플랫폼: Maps 애플리케이션 (Dynamic Map, Geocoding, Reverse Geocoding)
  - 서비스 URL: Worker 주소(`https://mybus-route.<서브도메인>.workers.dev`), `http://localhost:5173`
- Cloudflare 계정 (Workers 무료 플랜)
