# mybus-route

출발지와 도착지를 고르면 경기도 버스 실시간 정보로 가장 빨리 도착하는 경로(직행 / 1회 환승)를 추천하는 웹서비스입니다.

- 요구사항: [doc/requirements.md](doc/requirements.md)
- 결정 기록(ADR): [doc/adr.md](doc/adr.md)
- 의사결정 목록: [doc/decisions.md](doc/decisions.md)

## 구조
웹 화면과 API 를 Cloudflare Worker 하나로 배포합니다 ([ADR-020](doc/adr.md#adr-020)).
서비스 주소: https://mybus-route.copark-ai.workers.dev
```
web/      프런트엔드 (TypeScript + Vite, 카카오맵) → 빌드 결과 web/dist
worker/   Cloudflare Worker: web/dist 정적 파일 + /api/* (data.go.kr, 카카오 로컬)
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
cp web/.env.example web/.env                   # 카카오 JavaScript 키 입력
npm run dev:web                                # http://localhost:5173  (/api 는 8787 로 전달)
```

## 정류장·노선 DB 수집
```
npm run build:db      # worker/.dev.vars 의 BUS_API_KEY 사용 → web/public/data/*.json
```
- 경기도 버스기반정보 서비스로 그날의 정류소·노선·노선-정류소 파일 주소를 받아(API 1번) 내려받고, 웹용 압축 JSON(v2)으로 만듭니다 ([ADR-027](doc/adr.md#adr-027)).
- 경기도 전체: 노선 약 3,160개, 정류장 약 41,000곳(고를 수 있는 경기도 정류장 약 38,000곳). 서울·인천 정류장은 노선 경로로만 씁니다.
- 받은 파일은 `scripts/.cache/baseinfo`에 버전별로 보관해 같은 날 다시 받지 않습니다. 정류장 수가 20% 넘게 줄면 기존 파일을 지킵니다.

## 배포 (Cloudflare)
### 처음 한 번
```
cd worker
npx wrangler login
npx wrangler secret put BUS_API_KEY
npx wrangler secret put KAKAO_REST_KEY
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
- Build variables: `VITE_KAKAO_MAP_KEY`

## 준비할 계정·API
- data.go.kr (같은 키): 경기도_버스도착정보 조회, 경기도_버스기반정보 조회, 기상청_단기예보 조회서비스 (정류소·버스노선 조회는 이전 수집 방식용)
- 카카오 개발자센터 앱 (ADR-044): JavaScript 키(지도) + REST API 키(로컬 주소 검색)
  - [제품 설정] → 카카오맵 사용 설정 ON, 유료 API 는 켜지 않는다 (쿼터를 넘으면 과금 없이 멈춤)
  - [플랫폼] → Web 도메인: Worker 주소(`https://mybus-route.<서브도메인>.workers.dev`), `http://localhost:5173`
- Cloudflare 계정 (Workers 무료 플랜)
