# Re: Note

**Re: Note**(읽기: 리놋)는 연구(탐구)를 하는 사람이 **겪은 고충을 공유하고**, **사이트 안의 선행 연구와 그 연구의 고충·한계·결과보고서를 찾아보고**, **보고서를 빠르게 작성**하도록 돕는 웹 서비스입니다.

- 화면에 보이는 서비스 이름은 환경변수 `NEXT_PUBLIC_APP_NAME`으로 바꿀 수 있습니다(기본값 `Re: Note`, `lib/messages.ts`). `NEXT_PUBLIC_` 변수는 빌드할 때 클라이언트 코드에 박히므로, 바꾼 뒤에는 다시 빌드해야 합니다.
- 저장소·패키지·DB 이름(`researchmate`)은 내부 식별자라 그대로 둡니다(`docs/decisions.md` #19).
- 요구사항은 `SPEC.md`, 구현 중 내린 결정은 `docs/decisions.md`, HWP 변환 검증 결과는 `docs/hwp-spike.md`, 완료 기준별 근거는 `docs/acceptance.md`에 있습니다.

## 기능 요약

| 영역 | 화면 | 내용 |
|---|---|---|
| 고충 게시판 | `/pains` | 마크다운 본문, 연구 단계·분야·태그, 익명 글, "나도 겪었어요"(댓글 없음), 해결됨 + 해결 방법, 신고 플래그 |
| 연구 탐색·추천 | `/`, `/explore`, `/research/[id]` | **사이트 내부 데이터만** 검색(pg_trgm + 한글 자모 정규화로 오타·띄어쓰기 허용, 선택적으로 pgvector 임베딩). 결과가 없으면 없다고 표시. 연구 상세에서 요약·한계·연결된 고충·결과보고서 PDF 뷰어 |
| 연구 공개 | `/projects/[id]/publish` | 프로젝트에서 요약·키워드·한계를 입력하고 확인 모달을 거쳐 공개 |
| 프로젝트 | `/projects`, `/projects/[id]` | 문서·데이터셋·첨부·고충 메모·챗봇 대화를 묶음. 보관, 30일 휴지통 |
| 보고서 에디터 | `/projects/[id]/docs/[docId]` | Tiptap 에디터, 2초 디바운스 자동 저장, IndexedDB 로컬 초안 복구, 버전 충돌 안내, 스냅샷(버전 기록·복원) |
| 캡션·상호 참조 | 에디터 | `Ctrl/Cmd+Shift+C`로 그림·표·수식 캡션, 번호 자동 재정렬, `@그림` 상호 참조, 그림·표 목차 |
| 수식 | 에디터 | `$...$`, `$$...$$` 입력 즉시 KaTeX 렌더링, 블록 수식 번호 |
| 서식 | 에디터 "서식" | 프리셋 3종(일반 보고서·학술 논문형·탐구 보고서형) + 내 템플릿, 용지·여백·글꼴·줄 간격·제목·캡션·쪽 번호, 서식 검사와 "모두 고치기" |
| CSV → 표·그래프 | 프로젝트 "데이터", 에디터 | UTF-8/CP949 자동 감지, 표 만들기, 그래프 5종(꺾은선·산점도·막대·히스토그램·상자그림), 추세선·R²는 코드로 계산 |
| 가져오기 | `/projects/[id]/import` | PDF·HWP·HWPX·DOCX·Markdown → **새 문서**. 품질 안내와 원본 미리보기를 나란히 표시. 스캔 PDF는 첨부로만 추가 |
| 내보내기 | 에디터 "내보내기" | PDF(서식 반영, Chromium 인쇄), DOCX, Markdown |
| HWP → PDF 변환 | `/tools/convert` | 로그인 없이 HWP/HWPX를 PDF로 변환·미리보기·내려받기 |
| AI 챗봇 | 모든 화면의 플로팅 버튼 | 스트리밍 응답, 사이트 내부 검색 결과에 출처 링크, 수식·서식·그래프 제안. 문서 반영은 사용자가 직접 눌러야 함 |
| 글쓰기 자동완성 | 에디터 툴바 "자동완성" | 쓰다 멈추면 이어질 말을 흐린 글씨로 제안, `Tab`으로 받아들이기·`Esc`로 닫기·`Ctrl+Space`로 바로 요청 |
| 설정 | `/settings` | 이름 변경, 계정 삭제(데이터 삭제) |

**글쓰기 자동완성.** 보고서 에디터에서 문단 끝에 커서를 두고 약 1.2초 멈추면(문단에 10자 이상, 선택 영역 없음), 앞 내용과 같은 어조로 이어질 말을 한 문장 이내로 흐리게 보여 줍니다. `Tab`을 눌러야 문서에 들어가며, 그 전까지는 화면에만 그려지므로 자동 저장·스냅샷·내보내기에 섞이지 않습니다. 계속 입력하거나 `Esc`를 누르면 사라지고, `Ctrl+Space`(mac도 Ctrl)로 바로 요청할 수 있습니다. 한글 조합 중, 표·코드 블록 안, 제목·캡션에서는 동작하지 않습니다. 툴바의 "자동완성" 버튼으로 끄고 켤 수 있고 설정은 브라우저에 기억됩니다. 서버(`POST /api/ai/autocomplete`)는 커서 앞 약 1,500자와 절 제목·문서 제목만 보내고, 모델에는 수치·출처를 지어내지 말라고 지시합니다. 자동완성은 호출이 잦아 챗봇과 별도로 분당·하루 한도를 둡니다(`RATE_LIMIT_AUTOCOMPLETE_PER_MINUTE`, `AI_AUTOCOMPLETE_DAILY_LIMIT`).

MVP에서 제외한 것(SPEC 3장): 실시간 공동 편집, 팀원 초대, HWP/HWPX **내보내기**, 외부 논문 DB 검색, 모바일 앱, 결제.

## 로컬 실행

필요한 것: Node.js 22, pnpm 10(`corepack enable`), 그리고 아래 두 방법 중 하나.

### 방법 1. `docker compose up`

`docker-compose.yml`은 `web`(Next.js), `db`(PostgreSQL 16 + pgvector), `redis`, `minio`(S3 호환 스토리지), `worker`(변환 워커) 다섯 서비스를 띄웁니다. `worker`는 외부 인터넷이 막힌 내부 네트워크(`backend`)에만 붙습니다.

> **검증하지 못함**: 개발 환경에 Docker 데몬이 없어 `docker compose up`으로 실제 기동해 보지 못했습니다(`docs/decisions.md` #4). 아래 절차는 compose 파일과 코드를 읽고 쓴 것입니다.

1. `.env.example`을 `.env`로 복사하고 값을 채웁니다. compose가 `DATABASE_URL`·`REDIS_URL`·`S3_ENDPOINT`는 덮어쓰지만, 나머지는 `.env`에서 읽습니다. 최소한 다음을 넣습니다.
   ```
   AUTH_SECRET=<openssl rand -base64 32 결과>
   S3_BUCKET=researchmate
   S3_ACCESS_KEY=minioadmin          # MinIO 루트 계정도 이 값으로 만들어진다
   S3_SECRET_KEY=minioadmin
   S3_PUBLIC_ENDPOINT=http://localhost:9000   # 브라우저가 업로드할 주소
   ```
   `S3_BUCKET`·`S3_ACCESS_KEY`·`S3_SECRET_KEY` 중 하나라도 비면 각 컨테이너가 **자기 로컬 디스크**(`.data/storage`)에 파일을 저장하므로, web과 worker가 서로의 파일을 보지 못합니다. 버킷이 없으면 첫 사용 때 만듭니다(`lib/storage/s3.ts`).
2. `docker compose up --build`
3. 다른 터미널에서 DB 마이그레이션과 시드:
   ```
   docker compose exec web pnpm db:deploy
   docker compose exec web pnpm db:seed
   ```
   web 컨테이너는 시작할 때 마이그레이션을 자동으로 돌리지 않습니다.
4. http://localhost:3000 에 접속합니다. MinIO 콘솔은 http://localhost:9001 입니다.

로그인: `EMAIL_SERVER`가 비어 있으면 매직링크 메일을 보내지 않고 web 로그에 `auth.magic_link`로 링크를 남깁니다(`docker compose logs web`). Google 로그인은 `AUTH_GOOGLE_ID`·`AUTH_GOOGLE_SECRET`을 넣으면 켜집니다.

### 방법 2. Docker 없이 직접 설치

이 저장소의 테스트는 이 방법으로 돌렸습니다.

1. 필요한 프로그램
   - **PostgreSQL 16** + 확장 `pg_trgm`, `pgvector`. 첫 마이그레이션이 `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;`를 실행하므로, DB 사용자에게 확장을 만들 권한이 없으면 관리자 계정으로 미리 만들어 둡니다.
   - **Redis**(선택). 없으면 변환 작업을 웹 프로세스가 직접 처리합니다(`CONVERSION_QUEUE=inline`).
   - 변환·가져오기 엔진(선택, 없으면 해당 기능만 실패): **LibreOffice**(`soffice`, HWPX→PDF는 H2Orestart 확장 필요), **poppler-utils**(`pdfinfo`·`pdftotext`·`pdftohtml`, PDF 가져오기와 변환 결과 검사), Python + `pyhwp`(`hwp5odt`·`hwp5html`) + `unhwp`(HWP/HWPX 가져오기). 설치 목록은 `worker/Dockerfile`과 같습니다.
   - **Chromium**: PDF 내보내기와 rhwp 변환 엔진이 Playwright의 Chromium을 씁니다. `pnpm exec playwright install chromium`.
   - 한글 글꼴: PDF 내보내기의 본문 글꼴은 `@fontsource` 패키지에서 공급하므로 따로 설치할 필요가 없습니다. LibreOffice 변환에는 `fonts-noto-cjk`·`fonts-nanum` 같은 시스템 글꼴이 필요합니다.
2. 설치와 DB 준비
   ```
   pnpm install                 # postinstall이 prisma generate 실행
   cp .env.example .env         # DATABASE_URL, AUTH_SECRET 등을 채운다
   createdb researchmate
   pnpm db:deploy               # 마이그레이션 적용 (개발 중 스키마를 바꿀 때는 pnpm db:migrate)
   pnpm db:seed                 # 서식 프리셋 3종 + 시드 연구 30건·고충 60건
   ```
3. 실행
   ```
   pnpm dev                     # http://localhost:3000
   pnpm worker                  # REDIS_URL이 있을 때만: BullMQ 변환 워커
   ```
   `REDIS_URL`이 있으면 변환 작업이 큐로 가므로 `pnpm worker`를 함께 띄워야 합니다. 워커 없이 쓰려면 `CONVERSION_QUEUE=inline`을 넣습니다.
4. 엔진이 PATH에 없으면 `SOFFICE_BIN`, `HWP5ODT_BIN`, `HWP5HTML_BIN`, `UNHWP_PYTHON`(unhwp가 설치된 python), `PDFINFO_BIN` 등으로 경로를 지정합니다.

개발 중 이메일 없이 로그인하려면 `.env`에 `AUTH_TEST_MODE=1`을 넣으면 로그인 화면에 "테스트 계정으로 로그인"이 생깁니다. **개발 전용입니다(아래 운영 주의 참고).**

## 환경변수

`.env.example`의 모든 변수입니다. "쓰는 곳"은 코드에서 실제로 읽는 파일입니다.

| 변수 | 의미 | 필수 | 기본값 | 쓰는 곳 |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL 접속 주소 | 필수 | 없음 | `lib/db.ts`, `prisma.config.ts`, `worker/index.ts` |
| `REDIS_URL` | BullMQ 큐용 Redis | 선택 | 없음(없으면 inline 처리) | `server/jobs/queue.ts`, `worker/index.ts` |
| `S3_ENDPOINT` | S3 호환 스토리지 주소(MinIO 등). 비우면 AWS S3 | 선택 | 없음 | `lib/storage/index.ts` |
| `S3_BUCKET` | 버킷 이름 | 선택* | 없음 | `lib/storage/index.ts` |
| `S3_ACCESS_KEY` | 접근 키 | 선택* | 없음 | `lib/storage/index.ts` |
| `S3_SECRET_KEY` | 비밀 키 | 선택* | 없음 | `lib/storage/index.ts` |
| `S3_REGION` | 리전 | 선택 | `us-east-1` | `lib/storage/index.ts` |
| `S3_PUBLIC_ENDPOINT` | 브라우저가 접근하는 스토리지 주소(presigned URL용) | 선택 | `S3_ENDPOINT` | `lib/storage/index.ts` |
| `STORAGE_LOCAL_DIR` | 로컬 파일 드라이버 저장 위치 | 선택 | `.data/storage` | `lib/storage/index.ts` |
| `AUTH_SECRET` | Auth.js 세션 서명 키, 로컬 스토리지 URL 서명 키 | 운영 필수 | 없음 | Auth.js(자동으로 읽음), `lib/storage/local.ts` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth. 둘 다 있으면 Google 로그인 표시 | 선택 | 없음 | `server/auth-providers.ts` |
| `EMAIL_SERVER` | 매직링크 SMTP 주소. 비우면 링크를 서버 로그에 출력 | 운영 필수(이메일 로그인 시) | 없음 | `server/auth-providers.ts` |
| `EMAIL_FROM` | 매직링크 보낸 사람 | 선택 | `no-reply@localhost` | `server/auth-providers.ts` |
| `ANTHROPIC_API_KEY` | Anthropic API 키(서버 전용) | AI 기능에 필수 | 없음 | `lib/ai/client.ts` |
| `ANTHROPIC_MODEL` | 사용할 모델 ID. 코드에 기본값 없음 | AI 기능에 필수 | 없음 | `lib/ai/client.ts` |
| `EMBEDDING_PROVIDER` | 임베딩 제공자. 현재 구현은 테스트용 `fake`뿐이며, 비우거나 모르는 값이면 trigram 검색만 사용 | 선택 | 없음 | `lib/search/embedding.ts` |
| `EMBEDDING_API_KEY` | 외부 임베딩 API 키 자리. **현재 코드에서 읽지 않음**(실제 제공자 미구현, SPEC 14장 미결정) | — | 없음 | 없음 |
| `AI_DAILY_LIMIT_PER_USER` | 사용자별 하루 AI 요청 한도(한국 시간 0시 기준). 자동완성은 세지 않음 | 선택 | `100` | `lib/ai/quota.ts` |
| `ANTHROPIC_AUTOCOMPLETE_MODEL` | 글쓰기 자동완성 모델 ID | 선택 | `claude-haiku-5-5` | `lib/ai/autocomplete.ts` |
| `RATE_LIMIT_AUTOCOMPLETE_PER_MINUTE` | 사용자별 분당 자동완성 요청 한도 | 선택 | `20` | `lib/ai/autocomplete.ts` |
| `AI_AUTOCOMPLETE_DAILY_LIMIT` | 사용자별 하루 자동완성 요청 한도(한국 시간 0시 기준, 프로세스 메모리로 셈) | 선택 | `300` | `lib/ai/autocomplete.ts` |
| `MAX_UPLOAD_MB` | 업로드 최대 크기(MB) | 선택 | `50` | `lib/files/types.ts`, `server/upload-form.ts` |
| `NEXT_PUBLIC_APP_NAME` | 화면에 보이는 서비스 이름(빌드 시 반영) | 선택 | `Re: Note` | `lib/messages.ts` |
| `AUTH_TEST_MODE` | `1`이면 이메일만으로 로그인하는 테스트 로그인 활성화. **운영 금지** | 선택 | 꺼짐 | `server/auth-providers.ts` |
| `TEST_DATABASE_URL` | 통합 테스트(Vitest) 전용 DB | 테스트 | `postgresql://researchmate:researchmate@localhost:5432/researchmate_test` | `tests/setup/env.ts` |
| `AI_FAKE` | `1`이면 실제 AI 대신 정해진 가짜 응답. `NODE_ENV=production`에서는 무시. **운영 금지** | 테스트 | 꺼짐 | `lib/ai/client.ts`, `lib/ai/fake.ts` |
| `CONVERSION_QUEUE` | `bullmq` 또는 `inline` | 선택 | `REDIS_URL`이 있으면 `bullmq`, 없으면 `inline` | `server/jobs/queue.ts` |
| `QUEUE_PREFIX` | BullMQ 키 prefix | 선택 | `rm` | `server/jobs/queue.ts` |
| `WORKER_CONCURRENCY` | 워커 동시 처리 수 | 선택 | `2` | `worker/index.ts` |
| `CONVERSION_TIMEOUT_MS` | 변환 작업당 제한 시간(ms) | 선택 | `120000` | `lib/conversion/to-pdf.ts` |
| `CONVERSION_ENGINES_HWP` | `.hwp` → PDF 엔진 순서(쉼표 구분) | 선택 | `pyhwp,libreoffice,rhwp` | `lib/conversion/engines.ts` |
| `CONVERSION_ENGINES_HWPX` | `.hwpx` → PDF 엔진 순서 | 선택 | `libreoffice,rhwp` | `lib/conversion/engines.ts` |
| `SOFFICE_BIN` | LibreOffice 실행 파일 | 선택 | PATH의 `soffice` | `lib/conversion/engines.ts` |
| `HWP5ODT_BIN` | pyhwp `hwp5odt` | 선택 | PATH의 `hwp5odt` | `lib/conversion/engines.ts` |
| `HWP5HTML_BIN` | pyhwp `hwp5html`(가져오기 2순위) | 선택 | PATH의 `hwp5html` | `lib/importer/hwp.ts` |
| `PDFINFO_BIN` | poppler `pdfinfo` | 선택 | PATH의 `pdfinfo` | `lib/conversion/pdf-inspect.ts` |
| `PDFTOTEXT_BIN` | poppler `pdftotext` | 선택 | PATH의 `pdftotext` | `lib/conversion/pdf-inspect.ts`, `lib/importer/pdf.ts` |
| `PDFTOHTML_BIN` | poppler `pdftohtml` | 선택 | PATH의 `pdftohtml` | `lib/importer/pdf.ts` |
| `UNHWP_PYTHON` | `unhwp`가 설치된 python | 선택 | `python3` | `lib/importer/hwp.ts` |
| `CONVERSION_IMPORT_ENGINES_HWP` | HWP/HWPX 가져오기 엔진 순서 | 선택 | `unhwp,hwp5html` | `lib/importer/hwp.ts` |
| `UNHWP_ENGINE_SCRIPT` | unhwp 추출 스크립트 | 선택 | `worker/engines/unhwp-extract.py` | `lib/importer/hwp.ts` |
| `RHWP_ENGINE_SCRIPT` | rhwp PDF 스크립트 | 선택 | `worker/engines/rhwp-pdf.mjs` | `lib/conversion/engines.ts` |
| `NODE_BIN` | rhwp 엔진을 돌릴 node | 선택 | 현재 node | `lib/conversion/engines.ts` |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | 사용자당 분당 업로드 URL 발급 한도 | 선택 | `60` | `app/api/assets/upload-url/route.ts` |
| `RATE_LIMIT_CONVERT_PER_HOUR` | IP(로그인 시 사용자)당 시간당 변환·가져오기 한도 | 선택 | `20` | `server/convert.ts`, `server/importer.ts` |

\* `S3_BUCKET`·`S3_ACCESS_KEY`·`S3_SECRET_KEY`가 **모두** 있으면 S3 드라이버, 하나라도 없으면 로컬 파일 드라이버를 씁니다. 로컬 드라이버는 개발·테스트용이며, 웹과 워커가 다른 머신이면 쓸 수 없습니다.

`.env.example`에 없지만 테스트 실행에 쓰는 변수: `E2E_DATABASE_URL`(기본 `researchmate_e2e`), `E2E_PORT`(기본 `3100`) — `playwright.config.ts`.

## DB 마이그레이션·시드

| 명령 | 하는 일 |
|---|---|
| `pnpm db:deploy` | `prisma migrate deploy`. `prisma/migrations`의 마이그레이션을 적용(운영·CI·compose용) |
| `pnpm db:migrate` | `prisma migrate dev`. 개발 중 스키마를 바꿀 때 새 마이그레이션 생성 |
| `pnpm db:seed` | `prisma/seed.ts`. 서식 프리셋 3종과 시드 계정(`seed-*@example.com`)의 연구 30건·고충 60건. 여러 번 실행해도 같은 결과(시드 계정 데이터만 지우고 다시 만듦). `EMBEDDING_PROVIDER`가 있으면 임베딩도 채움 |

서식 프리셋은 시드하지 않아도 서버가 필요할 때 만듭니다(`ensureFormatPresets`, `server/format-templates.ts`).

## 테스트

| 명령 | 내용 |
|---|---|
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `next typegen && tsc --noEmit` |
| `pnpm test` | Vitest 단위·통합 테스트(`tests/unit`). **실제 PostgreSQL**을 씀 |
| `pnpm test:e2e` | Playwright E2E(`tests/e2e`). `next dev`를 직접 띄움 |
| `pnpm test:bundle` | 가짜 API 키로 `next build` 후 `.next/static`에 키 값·변수명이 없는지 검사(1분 이상 걸려 `pnpm test`와 분리) |

테스트 DB 준비:

```
psql -c 'CREATE DATABASE researchmate_test' -c 'CREATE DATABASE researchmate_e2e'
export TEST_DATABASE_URL=postgresql://researchmate:researchmate@localhost:5432/researchmate_test
export E2E_DATABASE_URL=postgresql://researchmate:researchmate@localhost:5432/researchmate_e2e
```

- 두 테스트 모두 시작할 때 해당 DB에 `prisma migrate deploy`를 자동으로 실행합니다(`tests/setup/global.ts`, `tests/e2e/global-setup.ts`). 개발 DB에는 손대지 않습니다.
- E2E는 `AUTH_TEST_MODE=1`, `AI_FAKE=1`, `CONVERSION_QUEUE=inline`으로 서버를 띄우므로 실제 AI·Redis·워커가 필요 없습니다. Chromium은 Playwright 1.63의 것을 씁니다.
- PDF 검사에 poppler(`pdfinfo`·`pdffonts`·`pdftotext`)를 씁니다.
- **변환 엔진이 없으면 일부 테스트가 건너뛰어집니다.** `tests/setup/engines.ts`가 `soffice`, poppler, `hwp5html`, `python3 -c "import unhwp"`(또는 `UNHWP_PYTHON`)를 확인해 Vitest의 `skipIf`로 건너뛰고, `tests/e2e/scenario-2.spec.ts`는 HWP 가져오기 엔진이 없으면 `test.skip`으로 이유를 남깁니다. 제3자 HWP 샘플 테스트는 `worker/spike/fetch-samples.sh`로 샘플을 받아 둔 경우에만 돕니다. 반면 `tests/e2e/import.spec.ts`, `tests/e2e/convert.spec.ts`는 엔진이 없으면 건너뛰지 않고 **실패**합니다.

## 배포

**배포 대상은 정하지 않았습니다**(SPEC 14장 미결정 사항). 아래 두 방법의 절차와 주의점을 적어 두며, 어느 쪽을 쓸지는 운영자가 결정합니다. 두 방법 모두 실제로 배포해 보지는 못했습니다(**검증하지 못함**).

### A. 단일 VPS + docker compose

**운영용 구성과 단계별 안내는 `docs/deploy.md`에 있습니다** (`docker-compose.prod.yml`, `Caddyfile`, `scripts/deploy.sh`). 아래는 개발용 compose를 직접 손볼 때의 요점입니다.

1. 서버에 Docker와 Compose를 설치하고 저장소를 받습니다.
2. `.env`에 운영 값을 넣습니다: `AUTH_SECRET`, `AUTH_URL`(외부 주소, Auth.js가 읽음), `EMAIL_SERVER`·`EMAIL_FROM`(또는 Google OAuth), `S3_*`, `S3_PUBLIC_ENDPOINT`(브라우저가 접근할 스토리지 주소), `ANTHROPIC_API_KEY`·`ANTHROPIC_MODEL`. `AUTH_TEST_MODE`·`AI_FAKE`는 비웁니다.
3. `docker compose up -d --build` → `docker compose exec web pnpm db:deploy` (처음 한 번 `pnpm db:seed`).
4. 앞단에 HTTPS 리버스 프록시(nginx, Caddy 등)를 두고 `web:3000`과, 브라우저 업로드를 위해 MinIO(`9000`)를 내보냅니다.

주의:
- compose 파일은 개발용 기본 비밀번호(`researchmate`, `minioadmin`)와 공개 포트(5432, 6379, 9000, 9001)를 그대로 씁니다. 운영에서는 비밀번호를 바꾸고 DB·Redis·MinIO 콘솔 포트를 외부에 열지 마십시오.
- PDF 내보내기는 **웹 프로세스**가 Playwright Chromium을 띄워 만듭니다(`server/export.ts`). 루트 `Dockerfile`의 실행 단계에서 `playwright install --with-deps chromium`을 하도록 했지만, 이 이미지를 실제로 빌드·실행해 보지는 못했습니다.
- 변환 워커(`worker/Dockerfile`)는 LibreOffice, H2Orestart, JRE, pyhwp, unhwp, Chromium을 포함해 이미지가 큽니다. 변환 한 건이 최대 120초, 동시 2건(`WORKER_CONCURRENCY`)이므로 메모리를 넉넉히 잡습니다.
- 백업 대상: PostgreSQL 볼륨(`db-data`), MinIO 볼륨(`minio-data`).
- 휴지통 정리 cron을 등록합니다(아래 운영 주의).

### B. Vercel(웹) + Supabase(DB·파일 저장소) — 무료 구성

**단계별 안내는 `docs/deploy-vercel.md`에 있습니다** (Supabase 가입부터 Vercel 배포, Google 로그인 설정까지). 요점:

1. Supabase에서 PostgreSQL과 Storage(S3 호환)를 씁니다. Redis와 변환 워커는 없습니다.
2. `DATABASE_URL`은 트랜잭션 풀러(포트 6543), `DIRECT_URL`은 세션 풀러(포트 5432) 주소입니다. Vercel이 빌드할 때 `vercel-build` 스크립트(`prisma migrate deploy && next build`)가 `DIRECT_URL`로 마이그레이션을 적용합니다.
3. Vercel에서는 `lib/features.ts`가 서버 HWP 변환·파일 가져오기(`SERVER_CONVERSION`)와 PDF 내보내기(`PDF_EXPORT`)를 기본으로 끕니다. 해당 API는 501과 안내 문구를 돌려주고, 에디터의 내보내기에서 PDF 항목이 숨겨집니다. HWP는 브라우저에서 엽니다.

주의:
- 실제 Supabase·Vercel에 배포해 보지는 못했습니다(**검증하지 못함**). 특히 Supabase Storage의 presigned URL 업로드(브라우저 → 스토리지 직접 PUT)와 CORS는 확인하지 못했습니다.
- rate limit이 프로세스 메모리 기반이라 서버리스 인스턴스마다 따로 셉니다(아래 운영 주의).
- 서버리스 함수의 요청·응답 본문 크기 제한 때문에, 서버를 거쳐 내려받는 큰 파일(`/api/assets/:id`)이나 multipart 업로드가 실패할 수 있습니다.
- 서버 변환까지 쓰려면 관리형 Redis와 워커 호스트(VM 또는 컨테이너 서비스)에서 `worker/Dockerfile` 이미지를 실행하고(같은 `DATABASE_URL`, `REDIS_URL`, `S3_*`), 웹 쪽에 `SERVER_CONVERSION=1`과 `REDIS_URL`을 둡니다. 서버리스에서는 `CONVERSION_QUEUE=inline`이 동작하지 않습니다(코드가 501로 막습니다). 변환 워커는 SPEC 9장대로 외부 인터넷이 막힌 네트워크에서 돌립니다.
- PDF 내보내기를 서버리스에서 켜려면(`PDF_EXPORT=1`) 서버리스용 Chromium이 필요합니다(구현하지 않음).

## 운영 주의

- **`AUTH_TEST_MODE`는 운영에서 절대 켜지 마십시오.** 켜면 누구나 이메일 주소만으로 아무 계정에나 로그인할 수 있습니다. 코드가 `NODE_ENV`로 막지 않습니다.
- **`AI_FAKE`도 운영에서 켜지 마십시오.** `NODE_ENV=production`이면 무시되지만, 테스트 전용 설정입니다.
- **휴지통 정리**: 삭제한 프로젝트는 30일 동안 휴지통에 있고, `pnpm trash:purge`(`scripts/purge-trash.ts`)가 30일이 지난 항목을 영구 삭제합니다. 자동 실행되지 않으므로 cron 등으로 하루 한 번 실행합니다. 예: `15 4 * * * cd /app && pnpm trash:purge` (compose라면 `docker compose exec -T web pnpm trash:purge`).
- **rate limit은 프로세스 메모리 기반**입니다(`server/rate-limit.ts`). 웹 인스턴스가 여러 개면 인스턴스마다 따로 세어 한도가 그만큼 느슨해지고, 재시작하면 초기화됩니다. 여러 인스턴스로 운영하려면 `setRateLimitStore()`로 Redis 저장소를 끼워 넣어야 합니다(Redis 구현은 아직 없음). AI 일일 한도는 DB(`AiUsage`)로 세므로 인스턴스 수와 상관없습니다.
- **AI**: `ANTHROPIC_API_KEY`나 `ANTHROPIC_MODEL`이 비어 있으면 AI 기능이 503(`AI_UNAVAILABLE`)을 냅니다. 테스트는 모두 가짜 AI로 돌렸고, **실제 Anthropic API 호출은 검증하지 못했습니다.**
- **스토리지**: 테스트는 로컬 파일 드라이버와 S3 드라이버 단위 테스트로만 확인했고, **실제 MinIO/S3에 연결해 보지는 못했습니다.**
- **HWP 변환의 한계**는 `docs/hwp-spike.md`에 있습니다. 요약하면: 엔진 체인(pyhwp → LibreOffice+H2Orestart → rhwp)으로 샘플 9종은 모두 변환됐지만 다단·글꼴은 원본과 다를 수 있고, 한컴 전용 글꼴은 대체 글꼴로 바뀝니다. **수식이 든 HWP와 한컴오피스가 직접 저장한 HWPX는 검증하지 못했습니다.** 화면에는 "레이아웃이 원본과 다를 수 있음" 안내가 항상 나옵니다. pyhwp는 AGPL-3.0이라 배포 형태에 따른 고지 의무를 확인해야 합니다.
- 로그는 JSON 한 줄 형식(`lib/log.ts`)으로 표준 출력에 남습니다. 변환·AI 실패도 여기에 기록됩니다.
