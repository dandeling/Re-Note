# API 보안 점검표 (P8-1, SPEC 9장)

모든 `app/api/**/route.ts`를 훑은 결과다. 2026-11-16 기준, 변환·가져오기 브랜치 병합 전.

- **로그인**: `requireApiUser()`(비로그인 401)
- **소유자 검사**: 남의 자원은 404(`server/access.ts` 등). 고충은 공개 글이라 남의 글 수정·삭제는 403(decisions pains-1)
- **zod**: 본문 `parseBody`, 쿼리 `parseQuery` (`lib/validation/*`). 경로 파라미터만 받는 엔드포인트는 "—"
- **rate limit**: `server/rate-limit.ts`. 한도 숫자는 `RATE_LIMITS`(환경변수로 조정), 고충은 `PAIN_RATE_LIMITS`, AI는 `lib/ai/quota.ts`
  - `auth`: IP당 10분 30회 · `search`: IP당 1분 60회 · `upload`: 사용자당 1분 60회 · `export`: 사용자당 1분 10회 · `write`: 사용자당 1분 120회(문서 자동 저장은 `doc-save` 키로 따로) · `ai`: 사용자당 1분 20회 + 하루 한도(`AI_DAILY_LIMIT_PER_USER`)
  - 429 응답은 `{ error: { code: "RATE_LIMITED", message, retryAfterSeconds } }`

| 엔드포인트 | 로그인 | 소유자 검사 | zod | rate limit |
|---|---|---|---|---|
| `GET/POST /api/auth/*` (Auth.js) | — | — | 제공자 내부(테스트 로그인은 zod) | **auth (IP)**: POST 전부 + GET `/callback/*`. 세션 조회 GET은 제외. 로그인 화면 서버 액션도 같은 한도 |
| `GET /api/account` | 필요 | 본인 | — | — |
| `PATCH /api/account` | 필요 | 본인 | 본문 | 30회/분 (사용자) |
| `DELETE /api/account` | 필요 | 본인 | 본문(확인 문구) | 5회/10분 (사용자) |
| `GET /api/projects` | 필요 | 본인 것만 조회 | 쿼리 | — |
| `POST /api/projects` | 필요 | — | 본문 | **write** |
| `GET /api/projects/:id` | 필요 | 404 | — | — |
| `PATCH /api/projects/:id` | 필요 | 404 | 본문 | **write** |
| `DELETE /api/projects/:id` | 필요 | 404 | — | **write** |
| `GET /api/projects/:id/docs` | 필요 | 404 | — | — |
| `POST /api/projects/:id/docs` | 필요 | 404 | 본문 | **write** |
| `GET /api/docs/:id` | 필요 | 404 | — | — |
| `PATCH /api/docs/:id` (자동 저장) | 필요 | 404 | 본문(5MB, 낙관적 잠금) | **write (`doc-save` 키)** |
| `DELETE /api/docs/:id` | 필요 | 404 | — | **write** |
| `GET /api/docs/:id/snapshots` | 필요 | 404 | — | — |
| `POST /api/docs/:id/snapshots` | 필요 | 404 | — | **write** |
| `POST /api/docs/:id/restore` | 필요 | 404 | 본문 | **write** |
| `POST /api/docs/:id/export` (pdf/docx/md, `saveAsAsset`) | 필요 | 404 | 본문 | **export** (PDF는 Chromium) |
| `POST /api/assets/upload-url` | 필요 | 프로젝트 404 | 본문(확장자·용량) | upload |
| `POST /api/assets/complete` | 필요 | 자기 업로드 경로만, 프로젝트 404 | 본문(+매직바이트) | **upload** |
| `GET /api/assets/:id` | 필요 | 404 | — | — |
| `GET/PUT /api/storage/local/*` (개발용 presigned) | 서명(HMAC+만료) | 서명된 키만 | — | — (서명 발급이 upload 한도) |
| `POST /api/datasets` | 필요 | 자산·프로젝트 404 | 본문 | **upload** (CSV 파싱) |
| `GET /api/datasets` | 필요 | 프로젝트 404 | 쿼리 | — |
| `GET /api/datasets/:id/preview` | 필요 | 404 | 쿼리 | — |
| `GET /api/format-templates` | 필요 | 문서 404 | 쿼리 | — |
| `POST /api/format-templates` | 필요 | 내 템플릿만 | 본문 | **write** |
| `GET /api/format-fonts`, `/api/format-fonts/:pkg/:file` | — (공개 OFL 글꼴) | — | — (`readFontFile`이 등록된 패키지·파일만, 그 외 404) | — (정적 파일) |
| `GET /api/search` | — (비로그인 가능) | 공개 데이터만 | 쿼리(200자) | **search (IP)** |
| `GET /api/research/:id` | — | 공개 연구만, 작성자 정보 없음 | — | — |
| `GET /api/research/:id/report` | — | 공개 연구에 연결된 PDF만 | — | — |
| `POST /api/research` | 필요 | 프로젝트 404, 보고서 자산은 본인 PDF만(400) | 본문 | **write** |
| `GET /api/pains` | — | 공개 글, 익명 작성자 비노출 | 쿼리 | — |
| `POST /api/pains` | 필요 | 연결 프로젝트·연구 본인 것만 | 본문 | 20회/10분 |
| `GET /api/pains/:id` | — | 익명 비노출 | — | — |
| `PATCH/DELETE /api/pains/:id` | 필요 | 작성자만(403) | 본문 | 20회/10분 |
| `POST /api/pains/:id/comments` | 필요 | — | 본문 | 30회/10분 |
| `POST /api/pains/:id/reactions` | 필요 | — | — | 60회/10분 |
| `POST /api/pains/:id/reports` | 필요 | — | 본문 | 10회/시간 |
| `POST /api/chat` (SSE) | 필요 | 문서·프로젝트 404 | 본문 | ai + 하루 한도 |
| `GET /api/chat/threads`, `/api/chat/threads/:id` | 필요 | 404 | — | — |
| `POST /api/ai/latex`, `/api/ai/format`, `/api/ai/chart-suggest` | 필요 | 데이터셋 404 | 본문 | ai + 하루 한도 |
| `POST /api/convert`, `GET /api/convert/:jobId` | — | — | — | **병합 대기** (다른 브랜치) |
| `POST /api/import` | — | — | — | **병합 대기** (다른 브랜치) |

읽기 전용 GET은 로그인·소유자 검사로 남의 데이터가 나가지 않으므로 한도를 두지 않았다. 비로그인으로 비용이 큰 읽기는 검색뿐이라 검색만 IP당 한도를 둔다.

## 출력 sanitize 점검

| 출력 경로 | 처리 | 테스트 |
|---|---|---|
| 고충 본문·댓글·해결 방법 (마크다운) | `lib/markdown.ts` `renderMarkdown`: markdown-it `html:false` + sanitize-html 허용 목록, 이미지 미렌더링, http/https/mailto 링크만 | `tests/unit/sanitize.test.ts`, `markdown.test.ts`, E2E `pains.spec.ts` |
| 내보내기 HTML (PDF 원본) | `lib/export/html.ts`: 정적 렌더 후 sanitize-html, 수식은 sanitize 뒤 KaTeX(trust 꺼짐) MathML, 인쇄 페이지는 JS 끔·외부 요청 차단 | `sanitize.test.ts`, `export.test.ts` |
| 가져오기 결과 | **병합 대기** (`app/api/import`, `worker/`가 이 브랜치에 없음) | — |
| 챗봇 답변·제안 | `components/chat/*`가 React 텍스트로만 그림(HTML 주입 없음) | `sanitize.test.ts` 정적 검사 |
| 연구 제목·요약·한계·키워드 | React 이스케이프 (`app/research/[id]/page.tsx`, 카드) | `sanitize.test.ts` |
| `dangerouslySetInnerHTML` | `components/pains/markdown.tsx`(renderMarkdown 결과), `components/editor/math-panel.tsx`(고정 LaTeX 상수의 KaTeX) 두 곳뿐 | `sanitize.test.ts`가 사용처 목록을 고정하고 각각의 입력을 검사 |
