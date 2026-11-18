# mybus-route

출발지와 도착지를 고르면 경기도(성남시) 버스 실시간 정보로 가장 빨리 도착하는 경로(직행 / 1회 환승)를 추천하는 웹서비스입니다.

- 요구사항: [doc/requirements.md](doc/requirements.md)
- 결정 기록(ADR): [doc/adr.md](doc/adr.md)
- 의사결정 목록: [doc/decisions.md](doc/decisions.md)

## 구조
```
web/      프런트엔드 (TypeScript + Vite, 네이버 지도) → GitHub Pages
worker/   API 프록시 (Cloudflare Workers) → data.go.kr, NCP Geocoding
doc/      요구사항, ADR
.github/  GitHub Pages 배포 워크플로
```

## 로컬 실행
```
npm install
```

API 프록시 (터미널 1):
```
cp worker/.dev.vars.example worker/.dev.vars   # 키 입력
npm run dev:worker                             # http://localhost:8787
```

웹 (터미널 2):
```
cp web/.env.example web/.env                   # NCP Client ID 입력
npm run dev:web                                # http://localhost:5173/mybus-route/
```

## 배포
- **프록시:** `cd worker && npx wrangler login && npx wrangler secret put BUS_API_KEY` (NCP_KEY_ID, NCP_KEY 도 같은 방식) → `npm run deploy -w worker`
- **웹:** main 브랜치에 push 하면 GitHub Actions 가 GitHub Pages 에 배포합니다. 저장소 설정은 [deploy-web.yml](.github/workflows/deploy-web.yml) 상단 주석을 참고하세요.

## 준비할 계정·API
- data.go.kr: 경기도_버스도착정보 조회(승인됨), 경기도_정류소 조회, 경기도_버스노선 조회
- 네이버 클라우드 플랫폼: Maps 애플리케이션 (Dynamic Map, Geocoding, Reverse Geocoding)
- Cloudflare 계정 (Workers 무료 플랜)
