# mybus-route — 작업 규칙

이 프로젝트는 **fullstack-webapp 하네스**(`.claude/HARNESS.md`, `.claude/skills/fullstack-webapp/skill.md`)로 작업한다.
에이전트 정의는 `.claude/agents/`, 확장 스킬은 `.claude/skills/`에 있다.

## 하네스를 이 프로젝트에 맞춘 부분
하네스 기본값보다 **`doc/adr.md`의 결정이 우선**한다.

| 하네스 기본 | 이 프로젝트 | 근거 |
|---|---|---|
| Next.js + Tailwind | **Vite + React + TypeScript**, CSS 변수 기반 디자인 토큰 | ADR-001, ADR-025, ADR-021 |
| Next.js API Routes / Express | **Cloudflare Worker 하나**가 `web/dist` 정적 파일과 `/api/*` 제공 | ADR-020 |
| Prisma + DB | **DB 없음.** 정류장·노선은 정적 JSON(`web/public/data`), 사용자 데이터는 localStorage | ADR-006, ADR-007 |
| 회원가입/인증 | **없음.** 비밀 키는 Worker Secret 에만 | ADR-004 |
| Vercel 배포 | Cloudflare Workers (`npm run deploy`) | ADR-020 |
| `src/` 단일 폴더 | `web/`(프런트), `worker/`(API), `scripts/`(DB 수집) | ADR-018 |

## 문서 위치
- 요구사항: `doc/requirements.md` / 결정: `doc/adr.md` (새 결정은 ADR-0XX 로 추가)
- 하네스 산출물: `_workspace/00_input.md` ~ `06_review_report.md`

## 로컬 실행·검증
- `npm run dev:worker` (8787) + `npm run dev:web` (5173, `/api`는 8787로 전달)
- `npm run build` 로 타입 검사·빌드. 기능 검증은 브라우저에서 실제로 눌러 본다.
- 비밀값: `worker/.dev.vars`, `web/.env` (git 에 올리지 않음)

## 사용자 선호
- 응답·문서는 한국어
- 배포는 사용자가 요청할 때만. 로컬 구현·검증에 집중
- 커밋 후 push 는 사용자에게 확인
