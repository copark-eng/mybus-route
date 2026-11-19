# 00. 입력 정리 (2026-11-19)

## 요청
"미니멀 화이트로 미려하게 리디자인 + 날씨 표시" — fullstack-webapp 하네스로 진행.

## 모드
**기존 코드 확장 / 리팩토링 모드**: architect + frontend-dev + backend-dev + qa-engineer. devops 는 제외(배포는 나중에, ADR-020 구성 유지).

## 기존 코드 (그대로 활용)
- `web/src/data.ts` — 정류장·노선 DB 로드, 격자 색인, 거리·도보 시간
- `web/src/places.ts` — 정류장 검색(이름·번호·초성), 방향 힌트, 주소 판별
- `web/src/router.ts` — 직행/1회 환승 후보, 실시간 평가(차량 추적, 운행시간), 정렬
- `web/src/storage.ts` — 최근 검색, 즐겨찾기(localStorage)
- `web/src/api.ts` — Worker API 클라이언트
- `web/src/map.ts` — 네이버 지도 (마커, 지도에서 고르기, 경로선)
- `web/src/main.ts`, `style.css`, `index.html` — **화면 전체를 React 로 다시 만든다**
- `worker/src/index.ts` — `/api/arrivals`, `/api/geocode`, `/api/reverse-geocode`
- `worker/src/weather.ts` — `/api/weather` (작성됨, 미검증: 기상청 서비스 활용신청 전)

## 확정된 결정 (doc/adr.md)
- ADR-021 미니멀 화이트: 흰 배경, 연회색 카드, 넓은 여백, 포인트 색 하나, 큰 숫자
- ADR-022 첫 화면 = 날씨 한 줄 → 즐겨찾기 카드(실시간 "n분 후 출발 · HH:MM 도착") → 작은 검색 → 최근 검색. 지도는 검색·상세에서만
- ADR-023 경로 결과 = 시간 막대(도보·대기·탑승·환승을 시간 비율로), 추정 구간 빗금
- ADR-024 날씨 = 첫 화면 상단 한 줄, 기상청 단기예보, Worker 10분 캐시
- ADR-025 React 도입 (Vite + React + TypeScript)
- ADR-014 모바일 우선 / ADR-015 30초 갱신 + 1초 카운트다운 / ADR-009 도착 시각 우선 정렬

## 제약
- 성남시 정류장만 (ADR-010), 최대 환승 1회 (ADR-011), DB·인증 없음
- data.go.kr 일일 호출 한도 (정류소 조회 ~1,000건/일, 도착정보는 프록시 20초 캐시)
- 기상청 단기예보: **아직 활용신청 전** → 날씨는 실패해도 화면이 깨지지 않아야 함 (FR-6.2)

## 완료 기준
- 기존 기능(자동완성, 지도 선택, 직행·환승 검색, 즐겨찾기, 최근 검색, 자동 갱신) 회귀 없음
- 홈·검색·상세 3개 화면, 시간 막대, 즐겨찾기 카드 실시간 표시, 날씨 줄(실패 시 숨김)
- `npm run build` 통과, 단위 테스트 통과, 브라우저에서 모바일(375px)·데스크톱 확인
