# SPEC.md — 연구 고충 공유 · 연구 탐색 · 보고서 도우미 플랫폼

> 가칭: **ResearchMate** (이름은 `NEXT_PUBLIC_APP_NAME` 환경변수로 교체 가능하게 할 것)

## 1. 한 줄 요약

연구(탐구)를 하는 사람이 **(a) 겪은 고충을 공유하고, (b) 키워드로 사이트 내 선행 연구와 그 연구의 고충·한계·결과보고서를 찾아보고, (c) 보고서를 빠르게 작성**할 수 있는 웹 서비스.

## 2. 사용자와 핵심 시나리오

| 사용자 | 하고 싶은 일 |
|---|---|
| 연구를 시작하는 사람 | 키워드를 넣어 비슷한 연구가 있었는지, 그 사람들이 어디서 막혔는지 확인 |
| 연구 중인 사람 | 막힌 점을 올리고 다른 사람의 해결 경험을 얻음 |
| 보고서를 쓰는 사람 | HWP/PDF를 불러와 서식·캡션·수식·표·그래프를 빠르게 정리하고 PDF로 내보냄 |
| 연구를 끝낸 사람 | 결과보고서와 한계를 공개해 다음 사람이 참고하게 함 |

## 3. 범위

### 포함 (MVP)
1. 고충 게시판
2. 연구 아카이브 + 사이트 내 키워드 검색·추천
3. 보고서 도우미 (에디터, 변환, 캡션, 수식, 서식, CSV → 표·그래프)
4. 사이트 내 AI 챗봇
5. 자동 저장, PDF/HWP 가져오기
6. 사용자별 프로젝트

### 제외 (MVP 이후)
- 실시간 공동 편집(동시 커서), 프로젝트 팀원 초대
- HWP/HWPX **내보내기** (MVP는 PDF·DOCX 내보내기만)
- 외부 논문 DB(RISS, Google Scholar 등) 검색 — 검색은 **사이트 내부 한정**
- 모바일 앱, 결제

## 4. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Next.js (App Router) + TypeScript | 프론트·API 통합 |
| UI | Tailwind CSS + shadcn/ui | 한국어 UI, 반응형 |
| DB | PostgreSQL + Prisma | `pg_trgm`, `pgvector` 확장 사용 |
| 인증 | Auth.js (이메일 매직링크 + Google OAuth) | |
| 파일 저장 | S3 호환 스토리지 (로컬은 MinIO) | |
| 에디터 | Tiptap (ProseMirror) | 문서는 JSON으로 저장 |
| 수식 | KaTeX | LaTeX 기반 |
| 그래프 | Plotly.js (또는 Recharts) | PNG/SVG로 문서에 삽입 |
| CSV 파싱 | PapaParse | 인코딩 UTF-8 / EUC-KR(CP949) 자동 감지 |
| 변환 워커 | 별도 Docker 컨테이너 (LibreOffice headless) | 아래 7.3 참고 |
| PDF 내보내기 | Playwright(Chromium) 인쇄 | 에디터 HTML → PDF |
| 작업 큐 | BullMQ + Redis | 변환·임베딩 등 비동기 작업 |
| AI | Anthropic API (Claude) | 모델 ID는 `ANTHROPIC_MODEL` 환경변수, 하드코딩 금지 |
| 테스트 | Vitest(단위) + Playwright(E2E) | |
| 로컬 실행 | `docker compose up` 한 번으로 전체 기동 | |

## 5. 정보 구조 (페이지)

```
/                      랜딩 + 통합 검색창
/login
/explore               연구 탐색 (키워드 검색·추천 결과)
/research/[id]         연구 상세: 요약 · 한계 · 고충 목록 · 결과보고서 뷰어
/pains                 고충 게시판 목록 (필터: 분야, 단계, 태그)
/pains/new             고충 작성
/pains/[id]            고충 상세 + 댓글 + "나도 겪었어요"
/projects              내 프로젝트 목록
/projects/[id]         프로젝트 홈: 문서 · 데이터 · 고충 · 공개 설정
/projects/[id]/docs/[docId]   보고서 에디터 (우측 패널: AI 챗봇 / 서식 / 데이터)
/tools/convert         HWP → PDF 단독 변환 도구 (로그인 없이 사용 가능, 용량 제한)
/settings
```

모든 페이지 우측 하단에 **AI 챗봇 플로팅 버튼**. 에디터에서는 우측 패널로 고정.

## 6. 데이터 모델 (Prisma 기준 초안)

```
User            id, email, name, image, createdAt
Project         id, ownerId→User, title, description, field, keywords[], visibility(PRIVATE|PUBLIC), createdAt, updatedAt
Document        id, projectId, title, contentJson, formatTemplateId?, version(int), updatedAt
DocumentSnapshot id, documentId, contentJson, version, createdAt, reason(AUTO|MANUAL|IMPORT)
FormatTemplate  id, ownerId?, name, rulesJson, isPreset
Asset           id, projectId?, ownerId, kind(IMAGE|PDF|HWP|HWPX|CSV|OTHER), storageKey, filename, size, mime, createdAt
Dataset         id, projectId, assetId, name, columnsJson, rowCount
ConversionJob   id, ownerId?, inputAssetId, outputAssetId?, type(HWP_TO_PDF|IMPORT_HWP|IMPORT_PDF), status(QUEUED|RUNNING|DONE|FAILED), error?, createdAt
Research        id, projectId?, authorId, title, summary, field, keywords[], limitations(text), reportAssetId?(PDF), embedding(vector)?, publishedAt
PainPost        id, authorId, researchId?, projectId?, title, body, stage(주제선정|설계|실험|분석|보고서작성|기타), tags[], isAnonymous, resolved(bool), resolution(text)?, embedding(vector)?, createdAt
Comment         id, painPostId, authorId, body, createdAt
Reaction        id, painPostId, userId, type(ME_TOO)   — (painPostId,userId) unique
ChatThread      id, userId, projectId?, documentId?, title, createdAt
ChatMessage     id, threadId, role(user|assistant), content, citationsJson?, createdAt
```

- 프로젝트·문서는 **기본 비공개**. 공개되는 것은 사용자가 명시적으로 "공개하기"를 누른 `Research`와 `PainPost`뿐.
- `PainPost`는 프로젝트 없이도 단독 작성 가능. 익명 작성 옵션 제공.

## 7. 기능 상세

### 7.1 고충 게시판 (요구 1)

- 작성 항목: 제목, 본문(마크다운), 연구 단계, 분야, 태그, (선택) 연결할 연구/프로젝트, 익명 여부
- 상세: 댓글, "나도 겪었어요" 반응 수, 해결됨 표시 + 해결 방법 기록
- 목록: 최신순 / 공감순 정렬, 단계·분야·태그 필터, 검색
- 신고 버튼(관리자 검토용 플래그만 저장)

**완료 기준**
- [ ] 로그인 사용자가 고충을 작성·수정·삭제할 수 있다
- [ ] 비로그인 사용자도 목록·상세를 읽을 수 있다
- [ ] 익명 글은 작성자 정보가 API 응답에 포함되지 않는다
- [ ] 해결됨으로 바꾸면 해결 방법이 상단에 강조 표시된다

### 7.2 연구 탐색·추천 (요구 2)

- 입력: 키워드 1개 이상 (예: "음향 블랙홀 진동 감쇠")
- 검색 대상: **이 사이트에 공개된 `Research`와 `PainPost`만**
- 검색 방식 (하이브리드)
  1. `pg_trgm` 유사도 검색 (제목·요약·키워드·한계·본문) — 한국어는 형태소 사전이 없으므로 trigram 사용
  2. `pgvector` 임베딩 유사도 — `EmbeddingProvider` 인터페이스로 추상화, 환경변수 미설정 시 1번만으로 동작
  3. 두 점수를 가중 합산해 정렬
- 결과 화면
  - **유사 연구 있음**: 연구 카드(제목, 요약, 키워드, 유사도) → 클릭 시 상세
  - **유사 연구 없음**: "아직 이 사이트에 등록된 연구가 없어요"를 명확히 표시 + 관련 고충만 있으면 따로 노출
  - 각 연구 카드에 **고충 N건 · 한계 요약 · 결과보고서 유무** 배지
- 연구 상세 (`/research/[id]`): 요약 / 한계 / 연결된 고충 목록 / 결과보고서 PDF 인라인 뷰어 + 다운로드
- 추천: 연구 상세 하단에 "비슷한 연구", 프로젝트 홈에 "내 키워드와 관련된 연구·고충"
- 공개 흐름: 프로젝트 홈 → "연구 공개하기" → 요약·키워드·한계 입력 + 결과보고서(문서를 PDF로 내보내거나 파일 업로드) 선택 → `Research` 생성

**완료 기준**
- [ ] 키워드 검색 결과가 사이트 내부 데이터만으로 구성된다 (외부 호출 없음)
- [ ] 결과가 없을 때 없다고 분명히 표시한다 (AI가 지어낸 연구를 보여주지 않는다)
- [ ] 연구 상세에서 고충·한계·결과보고서를 한 화면에서 볼 수 있다
- [ ] 오타·띄어쓰기 차이가 있는 한국어 키워드도 검색된다 (trigram 테스트 포함)

### 7.3 보고서 도우미 (요구 3)

#### (a) HWP → PDF 변환
- 지원 입력: `.hwp`(HWP 5.x 바이너리), `.hwpx`
- 구현: 변환 워커 컨테이너에서 LibreOffice headless로 변환
  - **후보 방식**: LibreOffice + HWP 가져오기 확장(H2Orestart). 
  - ⚠️ **Phase 0에서 스파이크로 먼저 검증할 것**: 샘플 HWP/HWPX 5종(표, 수식, 그림, 다단, 각주 포함)을 변환해 품질을 `docs/hwp-spike.md`에 기록. 품질이 부족하면 대안(pyhwp, hwp.js 등 텍스트 추출 기반)을 비교해 결정하고 이 문서를 갱신.
- 흐름: 업로드 → `ConversionJob` 생성 → 큐 → 완료 시 다운로드 링크 (진행 상태 폴링 또는 SSE)
- 제한: 파일 50MB, 변환 타임아웃 120초, 실패 시 사유 표시
- 변환 결과 미리보기 제공, "레이아웃이 원본과 다를 수 있음" 안내 문구

#### (b) 캡션 빠른 삽입
- 그림·표·수식 선택 후 단축키(`Ctrl/Cmd+Shift+C`) 또는 버튼 → 캡션 노드 삽입
- 번호 **자동 부여·자동 재정렬**: `그림 1.`, `표 1.`, `식 (1)` — 중간에 삽입·삭제하면 전체 번호 갱신
- 본문에서 `@그림` 입력 시 상호 참조 삽입, 번호 변경 시 참조도 따라감
- 캡션 위치 규칙(그림은 아래, 표는 위)은 서식 템플릿에서 설정
- "그림 목차 / 표 목차" 자동 생성

#### (c) 수식 편집 자동화
- `$...$` 인라인, `$$...$$` 블록 입력 시 즉시 KaTeX 렌더링
- 수식 팔레트(분수, 적분, 행렬, 그리스 문자 등)
- **자연어 → LaTeX**: "x에 대한 2차 방정식 근의 공식" 입력 → AI가 LaTeX 제안 → 미리보기 후 삽입
- **이미지 → LaTeX**: 수식 캡처 이미지 붙여넣기 → AI가 LaTeX 변환 (비전 입력)
- 블록 수식 자동 번호, 상호 참조

#### (d) 서식 맞춤
- 사용자가 서식 규칙을 **폼 또는 자유 텍스트**로 입력
  - 폼: 용지, 여백, 본문 글꼴/크기, 줄 간격, 제목 단계별 스타일, 문단 들여쓰기, 캡션 스타일, 쪽 번호
  - 자유 텍스트 예: "본문 함초롬바탕 10pt, 줄간격 160%, 제목은 가운데 정렬 16pt 굵게" → AI가 `rulesJson`으로 변환 → 사용자 확인 후 적용
- `rulesJson` 스키마를 zod로 정의하고, 문서 전체에 CSS 변수 + 노드 속성으로 적용
- 프리셋 3종 제공(일반 보고서 / 학술 논문형 / 탐구 보고서형), 사용자 템플릿 저장·재사용
- **서식 검사**: 규칙에서 벗어난 부분(글꼴 불일치, 캡션 누락, 번호 건너뜀)을 목록으로 보여주고 "모두 고치기"
- 글꼴: 웹에서 사용 가능한 한글 글꼴만 제공(Noto Sans/Serif KR, 나눔 계열 등). 라이선스상 임베드 불가한 글꼴은 가장 가까운 대체 글꼴로 매핑하고 사용자에게 알림.

#### (e) CSV → 표·그래프
- CSV 업로드 → `Dataset` 저장 → 열 타입 자동 추론(숫자/날짜/문자)
- **표 만들기**: 열 선택, 소수 자릿수, 단위, 머리글 지정 → 에디터 표 노드로 삽입 (+ 캡션 자동)
- **그래프 만들기**: 유형(꺾은선/산점도/막대/히스토그램/상자그림), X·Y 열, 오차막대 열, 축 제목·단위, 로그 축, 추세선(선형 회귀 + R²) → 미리보기 → SVG/PNG로 삽입 (+ 캡션 자동)
- AI 추천: "이 데이터에 맞는 그래프 추천" → 유형과 축 구성 제안 (실제 그리기는 클라이언트에서 결정적으로 수행, AI가 수치를 생성하지 않음)
- 삽입된 그래프는 원본 Dataset과 연결 → 더블클릭 시 설정 다시 편집

**완료 기준**
- [ ] 샘플 HWP/HWPX가 PDF로 변환되어 다운로드된다
- [ ] 그림 3개 중 2번째를 삭제하면 캡션과 본문 참조 번호가 자동으로 바뀐다
- [ ] `$$` 입력과 자연어 입력 모두로 수식을 넣을 수 있다
- [ ] 서식 규칙을 바꾸면 문서 전체에 즉시 반영되고 PDF 내보내기 결과에도 동일하게 적용된다
- [ ] CP949로 저장된 한글 CSV가 깨지지 않고 표·그래프로 만들어진다

### 7.4 AI 챗봇 (요구 4)

- 위치: 전역 플로팅 버튼 + 에디터 우측 패널
- 스트리밍 응답(SSE), 대화 스레드 저장
- 컨텍스트
  - 에디터에서 열면 현재 문서 내용(선택 영역 우선)을 컨텍스트로 포함
  - 프로젝트에서 열면 프로젝트 설명·키워드 포함
- 도구(tool use)
  - `search_site(query)`: 7.2의 검색을 호출 → 답변에 **출처 링크(연구/고충 페이지)** 표시
  - `suggest_latex(description)`, `suggest_format(text)`, `suggest_chart(datasetId)`
  - `insert_into_document(...)`: 사용자가 "삽입" 버튼을 눌러야 실제 반영 (자동 반영 금지)
- 원칙
  - 사이트에 없는 연구를 있다고 말하지 않는다. 검색 결과가 없으면 없다고 답한다.
  - 사용자 문서 내용은 해당 사용자의 대화에만 사용한다.
- 비용 보호: 사용자별 일일 요청 한도(환경변수), 서버에서만 API 키 사용

**완료 기준**
- [ ] 에디터에서 문단을 선택하고 "이 문단 다듬어줘" → 제안 → 삽입 버튼으로 반영된다
- [ ] "○○ 관련 연구 있어?" 질문에 사이트 내부 검색 결과와 링크로 답한다
- [ ] API 키가 클라이언트 번들에 노출되지 않는다

### 7.5 자동 저장 · 가져오기 (요구 5)

#### 자동 저장
- 입력 멈춘 뒤 2초 디바운스로 서버 저장, 상단에 `저장 중… / 저장됨 HH:MM / 오프라인` 상태 표시
- 로컬 초안을 IndexedDB에 동시 보관 → 네트워크 끊김·탭 종료 후 복구 제안
- 낙관적 잠금: `Document.version` 불일치 시 충돌 안내(내 버전 유지 / 서버 버전 불러오기)
- 스냅샷: 10분마다 자동 + 수동 "버전 저장" → 버전 기록에서 복원 (문서당 최근 50개 유지)

#### 가져오기
- **PDF**: 텍스트·제목 구조·표(가능한 범위)·이미지를 추출해 에디터 문서로 변환. 스캔 PDF는 "텍스트 추출 불가" 안내 후 원본을 첨부 자산으로만 추가.
- **HWP/HWPX**: 변환 워커로 중간 포맷(HTML 또는 DOCX) 변환 → Tiptap JSON으로 매핑
- **DOCX, Markdown**도 같은 파이프라인으로 지원
- 가져오기는 항상 **새 문서 생성 또는 스냅샷 생성 후 삽입** (기존 내용 덮어쓰기 금지)
- 결과 화면에 "가져오기 품질 안내"와 원본 미리보기를 나란히 표시

#### 내보내기
- PDF(서식 반영), DOCX, Markdown

**완료 기준**
- [ ] 입력 후 새로고침해도 내용이 유지된다
- [ ] 오프라인에서 작성 후 온라인 복귀 시 자동 동기화된다
- [ ] PDF와 HWP 파일을 가져와 편집 가능한 문서가 만들어진다

### 7.6 프로젝트 (요구 6)

- 사용자는 프로젝트를 여러 개 생성 (제목, 설명, 분야, 키워드)
- 프로젝트 안에 문서 여러 개, 데이터셋, 첨부 파일, 고충 메모, 챗봇 대화가 묶임
- 프로젝트 홈: 최근 문서, 데이터, 내 고충, 관련 연구 추천, "연구 공개하기"
- 보관(archive)·삭제(30일 휴지통)
- 접근 제어: 소유자만 접근. 모든 API에서 `ownerId` 검증.

**완료 기준**
- [ ] 다른 사용자의 프로젝트·문서 ID로 요청하면 404가 반환된다 (테스트 포함)
- [ ] 프로젝트 삭제 시 하위 문서·자산이 함께 휴지통으로 이동하고 복구할 수 있다

## 8. API 개요

```
POST   /api/projects                GET /api/projects           GET/PATCH/DELETE /api/projects/:id
POST   /api/projects/:id/docs       GET/PATCH/DELETE /api/docs/:id
POST   /api/docs/:id/snapshots      GET /api/docs/:id/snapshots POST /api/docs/:id/restore
POST   /api/docs/:id/export         (pdf|docx|md)
POST   /api/assets/upload-url       POST /api/assets/complete
POST   /api/convert                 GET /api/convert/:jobId
POST   /api/import                  (pdf|hwp|hwpx|docx|md → 새 문서)
POST   /api/datasets                GET /api/datasets/:id/preview
GET    /api/search?q=               GET /api/research/:id       POST /api/research
GET    /api/pains  POST /api/pains  GET/PATCH/DELETE /api/pains/:id
POST   /api/pains/:id/comments      POST /api/pains/:id/reactions
POST   /api/chat                    (SSE 스트리밍)
POST   /api/ai/latex                POST /api/ai/format         POST /api/ai/chart-suggest
GET/POST /api/format-templates
```

모든 입력은 zod로 검증. 에러 형식 `{ error: { code, message } }` 통일.

## 9. 비기능 요구사항

- **보안**: 업로드 파일은 확장자 + 매직바이트 검증, 변환 워커는 네트워크 차단된 컨테이너에서 실행, 마크다운·HTML 출력은 sanitize, 인증·AI·업로드 엔드포인트에 rate limit
- **개인정보**: 프로젝트·문서는 기본 비공개, 공개 전 확인 모달, 익명 글 작성자 비노출, 계정 삭제 시 데이터 삭제
- **성능**: 에디터 입력 지연 체감 없음(200쪽 분량 문서 기준), 검색 응답 1초 이내(1만 건 기준)
- **접근성**: 키보드만으로 에디터 주요 기능 사용, 명도 대비 WCAG AA
- **언어**: UI 한국어 기본, 문자열은 `messages/ko.json`으로 분리
- **관측**: 구조화 로그, 변환·AI 작업 실패율 기록

## 10. 디렉터리 구조

```
/app                Next.js 라우트
/components         UI 컴포넌트 (editor/, pains/, research/, chat/ ...)
/lib                도메인 로직 (search/, ai/, format/, captions/, csv/)
/server             API 핸들러, 권한 검사, 큐 프로듀서
/worker             변환 워커 (Dockerfile, LibreOffice, 변환 스크립트)
/prisma             schema.prisma, migrations, seed
/tests              unit/, e2e/, fixtures/ (샘플 hwp·hwpx·pdf·csv)
/docs               hwp-spike.md, decisions.md
docker-compose.yml  web, db, redis, minio, worker
.env.example
```

## 11. 환경변수 (`.env.example`)

```
DATABASE_URL=
REDIS_URL=
S3_ENDPOINT= S3_BUCKET= S3_ACCESS_KEY= S3_SECRET_KEY=
AUTH_SECRET= AUTH_GOOGLE_ID= AUTH_GOOGLE_SECRET= EMAIL_SERVER= EMAIL_FROM=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
EMBEDDING_PROVIDER=        # 비우면 trigram 검색만 사용
EMBEDDING_API_KEY=
AI_DAILY_LIMIT_PER_USER=100
MAX_UPLOAD_MB=50
NEXT_PUBLIC_APP_NAME=ResearchMate
```

## 12. 구현 단계 (Phase)

각 Phase가 끝나면 `lint`, `typecheck`, `test`가 통과해야 하고, 실행 방법과 확인 방법을 요약한다.

| Phase | 내용 | 산출물 |
|---|---|---|
| **0. 기반 + HWP 스파이크** | 저장소 초기화, docker compose, Prisma 스키마, 인증, 기본 레이아웃, **HWP 변환 스파이크** | 로그인 가능한 빈 앱, `docs/hwp-spike.md` |
| **1. 프로젝트 + 에디터 + 자동 저장** | 프로젝트 CRUD, Tiptap 에디터, 자동 저장, 스냅샷, IndexedDB 복구 | 문서 작성·복구 가능 |
| **2. 보고서 도우미 I** | 캡션·상호 참조, 수식(KaTeX), 서식 템플릿·서식 검사, PDF 내보내기 | 서식 반영된 PDF |
| **3. 변환·가져오기** | 변환 워커, HWP→PDF 도구, PDF/HWP/DOCX/MD 가져오기 | `/tools/convert`, 가져오기 |
| **4. CSV → 표·그래프** | Dataset, 표 생성기, 그래프 생성기 | 문서에 표·그래프 삽입 |
| **5. 고충 게시판** | 작성, 목록, 댓글, 반응, 해결 표시 | `/pains` |
| **6. 연구 아카이브·검색** | 연구 공개, 하이브리드 검색, 추천, 연구 상세 | `/explore`, `/research/[id]` |
| **7. AI 챗봇** | 스트리밍 채팅, 도구 호출, 문서 삽입, 수식·서식·그래프 AI 보조 | 전역 챗봇 |
| **8. 마무리** | E2E 시나리오, 접근성, rate limit, 시드 데이터, README 배포 가이드 | 배포 가능한 상태 |

## 13. E2E 수용 시나리오

1. 가입 → 프로젝트 생성 → 문서 작성 → 새로고침 후 내용 유지
2. HWP 파일 가져오기 → 서식 템플릿 적용 → 그림 캡션 추가 → PDF 내보내기
3. CSV 업로드 → 산점도 + 추세선 생성 → 문서 삽입 → 캡션 번호 자동 부여
4. 고충 작성 → 다른 계정으로 댓글·"나도 겪었어요" → 원 작성자가 해결됨 처리
5. 연구 공개(요약·한계·결과보고서) → 다른 계정이 키워드 검색 → 연구 상세에서 고충·한계·보고서 확인
6. 챗봇에 "○○ 관련 연구 있어?" → 내부 검색 결과 링크로 답변 / 없는 주제는 "없음"으로 답변
7. 타 사용자의 프로젝트 URL 직접 접근 → 404

## 14. 미결정 사항 (구현 중 `docs/decisions.md`에 기록)

- HWP 변환 엔진 최종 선택 (Phase 0 스파이크 결과에 따름)
- 임베딩 제공자 (없이도 동작해야 함)
- 배포 대상 (Vercel + 별도 워커 호스트 / 단일 VPS docker compose)
- 고충·연구 게시물 관리자 검수 정책
