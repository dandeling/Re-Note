# 병렬 작업 규칙 (서브에이전트용)

여러 에이전트가 각자의 git worktree에서 동시에 작업하고, 메인 세션이 브랜치를 병합한다. 충돌을 줄이기 위한 규칙이다.

## 시작할 때
1. 작업 디렉터리(자기 worktree)에서 `cp /home/user/.env .env && pnpm install` (postinstall이 prisma generate 실행).
2. 자기 전용 DB를 만든다. `<name>`은 배정받은 에이전트 이름.
   `psql postgresql://researchmate:researchmate@localhost:5432/postgres -c 'CREATE DATABASE rm_<name>_test' -c 'CREATE DATABASE rm_<name>_e2e'`
3. 테스트는 항상 아래 환경변수와 함께 실행한다 (다른 에이전트와 DB·포트가 겹치면 서로의 테스트를 깨뜨린다).
   `export TEST_DATABASE_URL=postgresql://researchmate:researchmate@localhost:5432/rm_<name>_test`
   `export E2E_DATABASE_URL=postgresql://researchmate:researchmate@localhost:5432/rm_<name>_e2e`
   `export E2E_PORT=<배정받은 포트>`
   개발 DB(`researchmate`)에는 마이그레이션·시드를 실행하지 않는다.

## 반드시 먼저 읽을 것
`SPEC.md`(유일한 요구사항), `docs/decisions.md`, `AGENTS.md`(Next.js 16 주의: 모르는 API는 `node_modules/next/dist/docs/`에서 확인), 그리고 기존 코드의 패턴:
- API: `server/api.ts`(`route`, `parseBody`, `parseQuery`, `requireApiUser`, `ApiError`, 에러 형식 `{error:{code,message}}`), `server/access.ts`(소유자 검사, 남의 자원은 404), 예시 `app/api/projects/**`, `app/api/docs/**`
- 검증: 모든 입력은 zod (`lib/validation/*`)
- UI: `components/ui/*`(shadcn 규약, 직접 작성), 문구는 전부 `messages/ko.json` (`lib/messages.ts`)
- 테스트: 통합 테스트는 실제 DB 사용 `tests/unit/*.test.ts` + `tests/setup/{db,session}.ts`(로그인 mock), E2E는 `tests/e2e/*.spec.ts` + `tests/e2e/helpers.ts`(테스트 로그인)

## 규칙
- 배정받은 PROGRESS 항목만 구현한다. SPEC에 없는 기능을 추가하지 않는다. SPEC "제외" 항목은 만들지 않는다.
- 각 항목의 완료 기준을 Vitest 또는 Playwright 테스트로 옮긴다. 권한 검사는 테스트로 증명한다.
- 항목 하나를 끝낼 때마다 `pnpm lint && pnpm typecheck && pnpm test`(필요하면 `pnpm test:e2e <자기 spec>`)를 통과시키고 커밋한다. 커밋 메시지: `<항목ID>: <요약>`, 끝에 다음 두 줄.
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01WQaDu5jDy9Rs2sb3awDbcg`
- **PROGRESS.md는 건드리지 않는다** (메인 세션이 병합 후 체크한다).
- `messages/ko.json`에는 배정받은 최상위 키 안에만 추가한다. 기존 키는 수정·삭제하지 않는다.
- `docs/decisions.md`에는 표 맨 아래에 행만 추가한다. 번호는 `<name>-1`, `<name>-2`처럼 붙인다.
- 공용 파일(`app/layout.tsx`, `app/projects/[id]/page.tsx`, `components/editor/document-editor.tsx`, `prisma/schema.prisma`, `package.json`)은 배정받지 않았다면 최소한으로만 고친다(새 컴포넌트를 만들고 한두 줄로 끼워 넣기). 스키마 변경이 꼭 필요하면 새 마이그레이션을 추가하고 보고에 적는다.
- 비밀 값·API 키를 코드에 넣지 않는다. 새 환경변수는 `.env.example`에 추가한다. AI 모델 ID는 환경변수로만 참조한다.
- 사용자에게 질문하지 않는다. 결정이 필요하면 `docs/decisions.md`에 기록하고 진행한다.
- 같은 항목에서 3회 연속 실패하면 그 항목은 멈추고 이유를 최종 보고에 적은 뒤 다음 항목으로 넘어간다.
- 외부 네트워크는 npm/PyPI 레지스트리 정도만 된다. `ui.shadcn.com`, `github.com` 등은 막혀 있다. Docker 데몬은 없다. PostgreSQL 16(pg_trgm, pgvector), Redis(`redis-server`), LibreOffice(`soffice`), Chromium(Playwright 1.63, `playwright install` 금지)이 로컬에 있다.

## 끝날 때 보고할 것
항목별 완료/미완료, 만든 주요 파일, 테스트 결과(개수), 스키마·의존성·환경변수 변경, 임시 처리(TODO)와 SPEC과 달라진 점, 브랜치 이름과 마지막 커밋.

## 문서 노드 계약 (에디터 관련 작업이 공유)
- `caption`: 블록 노드, 내용은 인라인 텍스트, attrs `{ kind: "figure" | "table" | "equation", id: string }`. 번호는 저장하지 않고 문서 순서로 계산한다.
- `crossRef`: 인라인 atom 노드, attrs `{ targetId: string }` (가리키는 caption/수식의 id).
- `mathInline`: 인라인 atom, attrs `{ latex: string }`. `mathBlock`: 블록 atom, attrs `{ latex: string, id: string }`.
- 그림은 기존 `image`, 표는 기존 `table` 노드. 스키마 확장 목록은 `lib/editor/extensions.ts`의 `documentExtensions()` 한 곳.
