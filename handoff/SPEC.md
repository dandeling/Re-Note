# SPEC.md — Re: Note (리놋) 제품 명세 · 인계판

> 이 문서는 처음부터 다시 만들 AI 에이전트에게 넘기는 **완결된 요구사항 문서**다. 원본 기획(`SPEC.md`, 가칭 ResearchMate) 이후 실제로 만들어 보며 바뀐 결정과 겪은 문제를 반영했다.
> - 기준 시점: 2026-11-17, 저장소 `dandeling/Re-Note`의 main(마지막 커밋 "서비스 이름을 Re: Note로 변경").
> - 작업 지시문은 `PROMPT.md`. 두 문서가 어긋나면 이 SPEC이 요구사항, PROMPT가 일하는 방식의 기준이다.
> - 표기: **[A]** 아티팩트판(주 배포) · **[W]** 웹 체험판 · **[S]** 서버 앱(선택). 표시가 없으면 세 형태 공통.
> - "확인됨"은 실제로 돌려 본 것, "로컬만"은 로컬 모크·가짜 AI로만 돌려 본 것, "미검증"은 돌려 보지 못한 것이다.

## 요약

- **무엇**: 학생·연구자가 (a) 연구 중 겪은 고충을 공유하고, (b) 사이트 안의 비슷한 연구와 그 고충·한계·결과보고서를 찾고, (c) 보고서를 빨리 쓰게 돕는 서비스. 이름은 **Re: Note**(읽기: 리놋).
- **형태가 셋으로 나뉘었다.** 사용자는 최종적으로 **claude.ai 아티팩트판을 주 배포 형태로 유지**하기로 했다.
  1. **[A] 아티팩트판** — 빌드 없는 순수 JS. 공유 DB·로그인·AI·파일 저장은 아티팩트 런타임 기능(db, user, sample, downloads, assets)을 쓴다.
  2. **[W] 웹 체험판** — 같은 아티팩트 소스를 정적 호스팅(GitHub Pages)용으로 감싼 것. 데이터는 그 브라우저에만 저장, AI·파일 업로드 없음.
  3. **[S] 서버 앱** — 원래 명세의 Next.js 16 + PostgreSQL 앱. 만들어져 있지만 실제 배포는 미결정·미검증.
- 원본 대비 큰 변화: 고충 댓글 제거, HWP는 서버 변환 대신 **브라우저 자체 파서**, UI 단순화, 쉬운 수식 입력, DOCX 내보내기, 결과보고서 PDF 업로드, "의미로 더 찾기", 글쓰기 자동완성, 예시 데이터 690건(연구 230·고충 460).
- **확인 필요**: [A] 자동완성이 실제 아티팩트에서 "안 되는 것 같다"는 사용자 보고가 있었다. 로컬에서 원인 둘(한글 조합 중 멈춤, AI 동의 시점)을 재현해 고쳤지만 **실제 아티팩트에서 다시 확인하지는 못했다**(B24). 실제 Vercel·Supabase 배포, Docker 이미지 빌드, 실제 Anthropic API 호출, GitHub Pages 접속도 확인하지 못했다(15장).

---

## 0. 대회 실행 기준

- **전제**: 이 SPEC과 `PROMPT.md`만 받은 에이전트가 **170분 안에 처음부터** 만든다(1차 실행 + 사람 점검 + 2차 실행 포함). 실행 중 사용자에게 묻지 않는다. 모호하면 이 문서의 기본값으로 진행하고 기록한다.
- **산출물은 [A] 아티팩트판 하나.** [W] 웹 체험판·[S] 서버 앱은 만들지 않는다(이 문서의 [W]·[S] 내용은 참고용).
- 세부 동작·문구·상수는 뒤의 **부록**(가~라)을 기본값으로 따른다. 부록에 없는 부분은 7장을 따른다.

| 우선순위 | 기능 | 검사 가능한 완료 기준 |
|---|---|---|
| **P0** (1차에 반드시) | 공통 뼈대·디자인·라우팅 | `index.html`+`core.js`+`mod-*.js`가 빌드 없이 열리고, 메뉴 4개(연구 탐색·고충 게시판·내 프로젝트·한글 파일 열기)와 `#home` `#explore` `#pains` `#projects`가 화면을 바꾸며, 콘솔 오류 없음, 400px 폭에서 가로 스크롤 없음, 다크 모드 토큰 적용(부록 가, 나.1) |
| P0 | 예시 데이터와 둘러보기 | `seed.json`에 연구 ≥ 200·고충 ≥ 400(모두 과거 날짜, `isExample: true`, 익명 고충은 연구 미연결). db·user가 null이면 예시를 읽기 전용으로 보이고 안내 띠 문구(가.6)가 나오며 쓰기 버튼이 없다(7.7) |
| P0 | 연구 탐색·검색·상세 | 「음향블랙홀」「음향 블랙홀」 둘 다 같은 연구를 찾고, 없는 주제는 「아직 이 사이트에 등록된 연구가 없어요」가 나오며, 상세에 요약·한계·연결된 고충(익명 제외)·비슷한 연구가 보인다(라.1, 나.3, 나.4) |
| P0 | 고충 게시판(작성·공감·해결, 댓글 없음) | 작성 → 목록 맨 위에 보임, 다른 사용자가 「나도 겪었어요」로 수가 1 오름, 작성자가 해결 방법을 넣으면 본문 위 초록 상자, 익명 글의 공유 문서에 `authorId`가 null, 댓글 UI 없음(나.6~나.8, 라.10) |
| P0 | 내 프로젝트·문서 에디터 기본 | 프로젝트 생성 → 새 문서 → 문단·제목(1~3)·목록·굵게 입력 → 2초 뒤 저장 상태 「저장됨」 → 새로 고침 뒤 내용 유지. 개인 데이터는 `RN.userColl`/`RN.userDoc` 경로만(나.9, 나.10, 라.2, 다.3) |
| P0 | 연구 공개 | 프로젝트에서 「공개」 → 제목·요약·키워드 입력 → 확인 창 → 연구 상세로 이동, 다른 사용자가 키워드 검색으로 찾는다(나.5, 라.11.1) |
| **P1** (1차 후반~2차) | 표·그림·캡션 번호·상호 참조 | 그림 3개 중 2번째를 지우면 캡션·참조 번호가 바뀐다(라.3) |
| P1 | 수식(쉬운 입력) | `x^2`, `a/b`, `sqrt(x)` 입력이 MathML로 미리 보이고 문서에는 LaTeX로 저장(7.3 (c)) |
| P1 | Markdown·DOCX 내보내기 | `downloads.save`로 .md·.docx 저장, DOCX zip이 열리고 `word/document.xml`이 있다(라.5) |
| P1 | CSV → 표·그래프 | CP949 CSV가 깨지지 않고 표·SVG 그래프로 문서에 들어간다(7.3 (e)) |
| P1 | 한글 파일 열기 | HWPX 먼저(zip+XML), 그다음 HWP5. 글자·표가 보이고 「내 프로젝트로 가져오기」로 문서가 된다. 열기만으로는 저장 안 됨 안내(7.3 (a)) |
| **P2** (시간이 남을 때만) | 챗봇, 의미로 더 찾기, 자동완성, 결과보고서 PDF 업로드, 서식 템플릿, 스냅샷 | 각 7장 완료 기준. `sample`·`assets`가 null이면 UI가 숨는다 |

- **1차 실행 종료 조건**: P0 전부가 위 기준을 만족하고, Playwright(로컬 모크) 테스트가 P0마다 1개 이상 통과. 남은 시간에 P1을 위에서부터.
- **2차 실행 종료 조건**: 1차 점검에서 나온 결함을 먼저 고치고, P1을 끝낸 뒤 P2를 위에서부터. 끝나기 전에 전체 테스트를 다시 돌린다.
- 산출물 목록: `artifact/index.html`, `core.js`, `mod-*.js`, `seed.json`(+생성 스크립트), `dev-mock.js`, `dev-server.mjs`, `tests/*.spec.cjs`, `PROGRESS.md`, `DECISIONS.md`, `CONTRACT.md`, `HANDOFF.md`(결과 주소, 끝낸 것·못 끝낸 것, 확인 못 한 것, **사람이 볼 것** 목록), 막힌 것이 있으면 `BLOCKED.md`.
- **시각 종료 조건이 우선한다**: 종료 시각과 실행 규칙은 `PROMPT.md`의 1차·2차 프롬프트를 따른다(1차 20:25, 2차 21:35 강제 종료, 마감 15분 전부터 새 작업 금지). 위 조건을 다 채우지 못해도 그 시각에는 동작하는 상태를 게시하고 `HANDOFF.md`를 쓰고 끝낸다.

---

## 표 A — 바뀐 지점

| # | 영역 | 처음 명세 | 지금 명세 | 바꾼 이유 | 반영된 곳 |
|---|---|---|---|---|---|
| A1 | 이름 | 가칭 ResearchMate | Re: Note(중간에 Re;Note). 코드·DB 내부 식별자 `researchmate`는 유지 | 사용자 요청 | 1장, 11장 |
| A2 | 배포 형태 | Next.js 서버 앱 하나 | [A] 아티팩트(주) + [W] 웹 체험판 + [S] 서버 앱(선택) | 사용자 요청(앱 자체를 아티팩트로, 웹 배포) | 3.1, 3.2 |
| A3 | 기술 스택 [A] | Next.js·Prisma·Tiptap·Plotly | 빌드 없는 순수 JS, 아티팩트 런타임 기능, 자체 블록 에디터, 직접 그린 SVG | 기술 제약(아티팩트는 정적 파일만, 외부 요청 불가) | 4.1, 4.4 |
| A4 | 로그인 [A] | Auth.js(매직링크·Google) | claude.ai 계정(`user` 기능). 연결 안 되면 읽기 전용 "둘러보기" | 기술 제약 | 4.1, 7.7 |
| A5 | HWP 처리 | 워커에서 LibreOffice로 HWP→PDF 변환 | 브라우저 자체 파서(HWP5: CFB+deflate, HWPX: zip+XML)로 글자·표·그림 읽기. 서버 변환은 [S] Docker 배포에서만 | 사용자 요청(HWP 열기) + 기술 제약 | 7.3 (a) |
| A6 | HWP 그림 | 언급 없음 | 그림 개체가 가리키는 래스터 그림(PNG·JPEG·GIF·WebP, BMP→PNG)만 추출 | 사용자 요청 | 7.3 (a) |
| A7 | HWP 미리보기 | 변환 PDF 미리보기 | 넓은 "종이" 미리보기(화면 폭을 넓게 씀) | 사용자 요청 | 7.3 (a) |
| A8 | HWP 열기와 저장 | 가져오기 = 새 문서 | "열기"는 저장하지 않음. "내 프로젝트로 가져오기"를 눌러야 문서가 되고 그때부터 자동 저장. 화면에 한 줄 안내 | 사용자 혼란(고충 B10) | 7.3 (a), 14장 |
| A9 | UI | 페이지마다 기능 나열 | 한 화면 한 가지 주된 일, 컨트롤은 "더 보기"·메뉴 뒤로, 배지 최대 2개, 주 버튼 하나 | 사용자 요청(복잡하다) | 5.3 |
| A10 | 디자인 | shadcn 기본 | 색·글꼴·버튼 토큰, 책상 배경 위 흰 종이 에디터, 떠 있는 도구 막대 | 사용자 요청(더 예쁘게) | 5.3 |
| A11 | 에디터 [A] | Tiptap(ProseMirror) | 자체 블록 JSON 에디터(한 contenteditable). 여러 문단에 걸친 선택, 문단 안 줄바꿈(Shift+Enter) | 사용자 요청 + 기술 제약 | 7.3, 7.5 |
| A12 | 수식 입력 | `$…$` LaTeX, AI 자연어→LaTeX | 쉬운 표기(`a/b`, `x^2`, `sqrt(x)`, `알파`, `<=`)를 LaTeX로 바꿔 미리보기 후 넣기. 문서엔 LaTeX만 저장 | 사용자 요청 | 7.3 (c) |
| A13 | 수식 렌더링 [A] | KaTeX(HTML+CSS) | KaTeX `output: "mathml"`만 | 기술 제약(KaTeX CSS를 못 불러옴) | 4.4, 7.3 (c) |
| A14 | 내보내기 | PDF(서식)·DOCX·Markdown | [A][W] DOCX·HTML(서식 반영)·Markdown, PDF 없음. [S] Vercel에서는 PDF 꺼짐 | 기술 제약(`window.print` 불가, 서버리스 Chromium 불가) + 사용자 요청(DOCX) | 7.5 |
| A15 | 결과보고서 | 문서를 PDF로 내보내거나 PDF 업로드 | [A] 내 문서에서 만든 HTML 또는 PDF 업로드(20MiB) 중 하나. PDF는 pdf.js로 미리보기 | 사용자 요청 + 기술 제약 | 7.2 |
| A16 | 검색 | pg_trgm + pgvector 임베딩 | [A] 브라우저 trigram + 한글 자모 분해. "의미로 더 찾기": AI는 검색어만 제안, 결과는 사이트 데이터에서만 | 사용자 요청(임베딩 비슷한 검색) + 기술 제약 | 7.2 |
| A17 | 고충 댓글 | 댓글 + "나도 겪었어요" | 댓글 없음. 공감·신고·해결됨 표시·작성자 수정은 유지 | 사용자 요청(한 번 쓰고 댓글 불가) | 6장, 7.1, 13장 |
| A18 | 예시 데이터 | 연구 30·고충 60 | [A][W] 연구 230·고충 460(문서 690). 날짜는 모두 과거. [S] 시드는 30/60 그대로 | 사용자 요청(최소 600건) + 고충 B9 | 7.7 |
| A19 | 자동완성 | 없음 | 쓰다 멈추면 흐린 글씨로 한 문장 제안, Tab 수락·Esc 닫기 | 사용자 요청 | 7.3 (f) |
| A20 | 데이터 모델 [A] | Prisma 테이블 | 아티팩트 db 경로(공유 `research`·`pains`·`reports`, 개인 `data/users/<id>/<name>/items`) | 기술 제약 | 6.1 |
| A21 | AI 호출 [A] | 서버의 Anthropic API 키 | 아티팩트 `sample` 기능(키 없음). 하루 한도는 개인 문서 `aiUsage`로 셈 | 기술 제약 | 7.4 |
| A22 | 가져오기 | PDF·HWP·HWPX·DOCX·MD | [A][W] HWP·HWPX·MD·TXT. [S] Docker는 전부, Vercel은 HWP·HWPX·MD·TXT(브라우저) | 기술 제약 | 7.5 |
| A23 | 그래프 [A] | Plotly.js | 직접 그린 SVG(수치는 코드 계산) | 기술 제약(외부 스크립트 제한) | 7.3 (e) |
| A24 | 서버 배포 [S] | 미결정 | 두 안을 문서화: Docker 단일 서버 / Vercel+Supabase(기능 플래그로 서버 변환·PDF 끔). 둘 다 미검증 | 기술 제약 + 사용자 요청(웹 배포) | 3.1, 11장, 14장 |
| A25 | 진행 방식 | Phase마다 멈추고 확인 | 확인 대기 없이 진행, 결정은 `docs/decisions.md`에 기록, 보고는 짧게 | 사용자 요청 | 12장, PROMPT |

## 표 B — 겪은 고충과 해결 방법

| # | 고충(무슨 일이 있었나) | 원인 | 이번에 쓴 해결 | 다음에 처음부터 막는 방법 | 상태 |
|---|---|---|---|---|---|
| B1 | 아티팩트를 조직 밖 계정·독립 페이지로 열면 Claude에 로그인해 있어도 "로그인 안 됨" | 그런 보기에서는 `db`·`user` 기능이 null | 예시 데이터로 읽기 전용 "둘러보기" + 이유를 말하는 안내 띠 | 모든 기능은 null일 수 있다고 보고 설계. 쓰려면 공유 메뉴로 초대하거나 서버 배포가 필요하다고 안내 | 우회함 |
| B2 | 개인 데이터 저장이 실제 아티팩트에서 깨짐 | db 경로 규칙(문서=짝수, 컬렉션=홀수 세그먼트) 위반 | `RN.userColl`/`RN.userDoc` 헬퍼, 로컬 모크가 경로를 검사해 TypeError | 경로를 직접 조립하지 말고 헬퍼만. 모크는 실제 규칙을 똑같이 강제 | 해결됨 |
| B3 | 27MB rhwp WASM으로 HWP를 보여 줄 수 없었음 | "읽지 않은 파일은 게시 금지" 규칙(바이너리는 읽을 수 없음) | HWP5·HWPX 파서를 직접 작성(`lib/hwp-browser`, `mod-convert.js`) | 게시할 파일은 전부 사람이 읽을 수 있는 소스로. 바이너리 의존은 처음부터 배제 | 해결됨 |
| B4 | 외부 스크립트가 막힘 | 아티팩트는 허용 CDN의 정확한 버전만 로드 | KaTeX·PapaParse는 cdnjs 고정 버전, pdf.js는 `RN.loadScript`(cdnjs만 허용)로 필요할 때만 | 4.4 체크리스트를 먼저 확인하고, 필요한 라이브러리는 cdnjs 정확한 버전으로만 | 해결됨 |
| B5 | 인쇄·파일 내려받기가 안 됨 | 아티팩트에서 `window.print`, `<a download>` 불가 | 파일 저장은 `downloads` 기능, PDF 대신 DOCX·HTML | 내보내기 설계 전에 런타임 기능 확인. `downloads`가 없으면 버튼 숨김 | 우회함 |
| B6 | 수식 모양이 깨짐 | KaTeX CSS를 불러올 수 없음 | `katex.renderToString(…, {output:"mathml"})`만 사용 | 수식은 처음부터 MathML 출력 | 우회함 |
| B7 | 게시가 거부됨 | 소스에 U+FFFD 문자 리터럴이 있음 | 리터럴 대신 `\uFFFD` 이스케이프 | 게시 전 소스에서 U+FFFD 리터럴 검사 | 해결됨 |
| B8 | 화면에 "null", "[object …]" 글자가 찍힘 | `Element.append`에 배열·null을 넘김 | `core.js`가 append/prepend/replaceChildren에서 배열을 펴고 null을 건너뜀 | DOM 헬퍼를 처음부터 이렇게 만들고 모듈은 헬퍼만 사용 | 해결됨 |
| B9 | 새 글이 목록 뒤로 밀림 | 예시 데이터 날짜가 미래 | 예시 날짜를 과거(2026-06-01 ~ 2026-11-05)로 | 예시 데이터는 항상 과거 날짜, 생성 스크립트에서 검사 | 해결됨 |
| B10 | 한글 파일을 열었는데 저장이 안 됐다고 혼동 | "열기"는 미리보기일 뿐, "가져오기"를 눌러야 문서 | 미리보기 위에 "아직 저장되지 않았어요…" 한 줄 안내 | 열기/가져오기 차이를 화면에 늘 표시. 자동 문서 생성 여부는 14장 미결정 | 우회함 |
| B11 | [S] Vercel에서 서버 HWP 변환·PDF 내보내기 불가 | 서버리스에서 LibreOffice·Chromium 실행 불가 | `SERVER_CONVERSION`·`PDF_EXPORT` 플래그(Vercel에서 기본 끔), HWP는 브라우저 파서 | 무거운 네이티브 의존 기능은 처음부터 플래그 뒤에 두고 대체 경로 마련 | 우회함 |
| B12 | [S] 브라우저 → 스토리지 presigned PUT이 깨질 수 있음 | S3 SDK가 빈 본문 체크섬을 URL에 붙임 | `requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"` | S3 클라이언트 생성 시 처음부터 WHEN_REQUIRED | 해결됨(실환경 미검증) |
| B13 | [S] Supabase 무료 Direct 주소로 빌드 서버가 접속 못 할 수 있음 | 무료 프로젝트 Direct 연결 제약 | `DATABASE_URL`=트랜잭션 풀러(6543), `DIRECT_URL`=세션 풀러(5432) | 처음부터 pooler 주소 두 개 체계 | 해결됨(실환경 미검증) |
| B14 | `prisma migrate dev`가 멈춤 | 대화형 프롬프트 | 비대화형 `prisma migrate deploy` 사용 | 에이전트는 대화형 명령 금지. 마이그레이션 파일은 직접 만들고 deploy로 적용 | 해결됨 |
| B15 | Docker 데몬·shadcn 레지스트리·GitHub 릴리스에 접근 불가 | 개발 환경 네트워크·권한 제한 | UI 컴포넌트는 손으로, compose는 문법 검사만, H2Orestart 최신판 미시험 | 시작할 때 환경에서 되는 것·안 되는 것을 확인해 기록하고, 안 되는 것은 "미검증"으로 보고 | 우회함 |
| B16 | 큰 바이너리(wasm 27MB, whl)가 커밋됨 | 커밋 전 확인 없이 `git add` | 다음 커밋에서 삭제, `.gitignore`에 `*.whl` 추가. 단 wasm은 이력에 남았고 `pyhwp-0.1b15.tar.gz`는 아직 추적 중 | 커밋 전 `git diff --cached --stat`로 크기 확인, 1MB 넘는 바이너리 금지 | 우회함 |
| B17 | 타입 검사·린트가 깨짐 | 저장소 안에 또 다른 클론(`re-note/`)을 둠 | tsconfig·eslint·vitest·.gitignore·.dockerignore에서 제외 | 저장소 안에 다른 클론을 두지 않는다. 필요하면 바깥 폴더 | 해결됨 |
| B18 | 병렬 에이전트의 `next dev`가 서로 막힘 | 같은 폴더에서는 `next dev`가 하나만 뜸(포트가 달라도) | 에이전트마다 복사본이나 git worktree | 병렬 작업은 처음부터 worktree, 에이전트마다 포트·DB 분리 | 우회함 |
| B19 | 병렬 에이전트가 같은 파일(`messages/ko.json` 등)을 동시에 고침 | 담당 경계가 없음 | 담당 파일·최상위 키를 미리 나누고 좁은 Edit만 | 시작 전 파일 담당표를 만들고 공용 파일은 한 에이전트만 | 우회함 |
| B20 | 사용 한도(5시간)로 여러 에이전트가 한꺼번에 멈춤 | 큰 작업 단위, 동시 실행 | 작업을 작게 나누고 `PROGRESS.md`로 재개 | 항목 하나 = 커밋 하나. 진행 기록 파일을 항상 최신으로 | 우회함 |
| B21 | 매 단계 확인 대기와 반복 보고로 진행이 느림 | 원본 Prompt가 Phase마다 멈추게 함 | 확인 없이 진행, 결정은 `docs/decisions.md`에 | PROMPT의 진행 규칙 따름. 사용자가 요청한 경우 마지막 리뷰 생략 가능 | 해결됨 |
| B22 | [S] H2Orestart가 HWP 9개 중 3개에서 크래시, 일부는 종료 코드 0인 빈 PDF | 변환 엔진 품질 | 엔진 체인(pyhwp → H2Orestart → rhwp), 성공은 결과물(쪽수·글자)로 판정 | 외부 변환기는 종료 코드를 믿지 말고 결과물을 검사 | 우회함 |
| B23 | 세 형태 사이 기능이 어긋나 문서가 낡음(예: 배포 문서의 "미반영" 목록) | 아티팩트에서 먼저 바꾸고 서버 앱에 일부만 옮김 | 이 SPEC 3.2의 기능×형태 표 | 기능을 바꿀 때 3.2 표를 같이 고친다 | 미해결 |
| B24 | [A] 자동완성이 실제 아티팩트에서 "안 되는 것 같다" | ① 한글은 마지막 글자가 조합 중인 채로 멈추는데, 조합 중이면 요청을 아예 보내지 않았다(로컬 재현). ② AI 사용 동의를 타이머에서 묻게 되어 거절·취소되면 조용히 꺼졌다. ③ 빈 응답을 실패로 세고, 머리말 줄을 제안으로 띄웠다 | 조합 중에는 본문 밖 겹침 상자로 제안을 그리고 Tab은 조합 확정 뒤 삽입. 동의는 "허용하기" 클릭에서만 요청. 토글 옆 상태 글자 추가. 로컬 테스트 24개 통과 | 한글 입력 기능은 **조합이 열린 상태**를 반드시 테스트한다. 동의가 필요한 호출은 사용자 클릭에서 시작한다. 조용히 실패하지 말고 상태를 화면에 보인다. 실제 환경 확인 전에는 완료로 보고하지 않는다 | 우회함(실제 아티팩트 재확인 필요) |
| B25 | 실제 배포·실제 API를 확인하지 못함 | 세션 네트워크 차단, 계정·키 없음 | 문서에 "미검증"으로 명시 | 15장 목록을 유지하고 확인한 것만 지운다 | 미해결 |

---

## 1. 한 줄 요약

연구(탐구)를 하는 사람이 **(a) 겪은 고충을 공유하고, (b) 키워드로 사이트 안의 선행 연구와 그 연구의 고충·한계·결과보고서를 찾아보고, (c) 보고서를 빠르게 작성**할 수 있는 서비스. 서비스 이름은 **Re: Note**(읽기: 리놋). [S]에서는 `NEXT_PUBLIC_APP_NAME`으로 바꿀 수 있고, [A][W]는 UI 문구에 서비스 이름을 직접 쓰지 않는다(`<title>`만).

## 2. 사용자와 핵심 시나리오

| 사용자 | 하고 싶은 일 |
|---|---|
| 연구를 시작하는 사람 | 키워드로 비슷한 연구가 있었는지, 그 사람들이 어디서 막혔는지 확인 |
| 연구 중인 사람 | 막힌 점을 한 번에 올리고, 같은 문제를 겪은 사람의 공감·해결 기록을 봄 |
| 보고서를 쓰는 사람 | 한글 파일을 열어 내용을 가져오고, 캡션·수식·표·그래프·서식을 빠르게 정리해 DOCX 등으로 내보냄 |
| 연구를 끝낸 사람 | 요약·한계·결과보고서를 공개해 다음 사람이 참고하게 함 |
| 처음 온 사람 | 로그인·권한 없이도 예시 데이터로 둘러봄 |

## 3. 범위와 배포 형태

### 3.1 배포 형태

| 형태 | 상태 | 무엇 | 데이터·계정 | AI |
|---|---|---|---|---|
| **[A] 아티팩트판 (주)** | 만들어짐, 사용자가 주 배포로 결정 | claude.ai 아티팩트. `index.html` + `core.js` + `mod-*.js` + `seed.json` | 아티팩트 공유 db, claude.ai 계정 | `sample` 기능 |
| **[W] 웹 체험판** | 빌드 스크립트 있음(`artifact/build-web.sh`), GitHub Pages 접속 미검증 | 같은 소스 + `web-backend.js`(window.claude 대체) | 그 브라우저의 IndexedDB만. 임시 사용자 1명. 다른 방문자와 공유 안 됨 | 없음 |
| **[S] 서버 앱 (선택)** | 만들어짐, 배포 미결정·미검증 | Next.js 16 App Router + PostgreSQL | Prisma DB, Auth.js | 서버의 Anthropic API |

- [W]는 [A] 소스를 고치지 않고 감싸기만 한다. [A]에서 기능이 `null`이면 숨기는 규칙 덕분에 [W]에서 AI·업로드 버튼이 자동으로 숨는다.
- [S]의 배포 안: (1) Docker 단일 서버(`docker-compose.prod.yml` + Caddy HTTPS, 모든 기능), (2) Vercel + Supabase(무료, 서버 HWP 변환·서버 PDF 내보내기 꺼짐). 어느 쪽을 쓸지, 쓸지 말지는 14장 미결정.

### 3.2 기능 × 형태 적용표

O = 있음, X = 없음, △ = 조건부.

| 기능 | [A] 아티팩트 | [W] 웹 체험판 | [S] 서버 앱 |
|---|---|---|---|
| 고충 게시판(작성·수정·삭제·익명·공감·신고·해결) | O | O(로컬만) | O |
| 고충 댓글 | X | X | X(DB 테이블만 남음) |
| 연구 공개·키워드 검색·추천 | O | O(로컬만) | O(pg_trgm) |
| 의미로 더 찾기 | O(`sample`) | X | X(임베딩 인터페이스만, 실제 제공자 없음) |
| 프로젝트·문서·자동 저장·스냅샷·휴지통 | O | O(로컬만) | O |
| 여러 문단 선택·문단 안 줄바꿈 | O | O | Tiptap 기본 동작(별도 확인 안 함) |
| 캡션·상호 참조·그림/표 목차 | O | O | O |
| 쉬운 수식 입력 | O | O | O(`lib/easy-math.ts`) |
| AI 자연어·이미지 → LaTeX | △ 챗봇 `suggest_latex` 제안 | X | O(`/api/ai/latex`) |
| 서식 규칙·프리셋·서식 검사 | O | O | O |
| CSV → 표·그래프 | O(SVG) | O | O(Plotly) |
| 한글 파일 열기(브라우저 파서, 그림 포함) | O | O | O(Vercel 기본 경로) |
| 서버 HWP→PDF 변환, PDF·DOCX 가져오기 | X | X | △ Docker만 |
| 내보내기 DOCX / Markdown | O / O | O / O | O / O |
| 내보내기 HTML(서식 반영) | O | O | X |
| 내보내기 PDF | X | X | △ Docker만 |
| 결과보고서 PDF 업로드 | O(`assets`) | X | O |
| AI 챗봇 | O | X | O |
| 글쓰기 자동완성 | △ 한글 조합·동의 문제를 고침, 실제 아티팩트 재확인 필요(B24) | X | O(가짜 AI로만 확인) |
| 둘러보기(읽기 전용 예시) | O | 해당 없음(항상 로컬 쓰기 가능) | 비로그인 읽기 |
| 예시 데이터 | 690건 | 690건 | 시드 90건 |

### 3.3 포함
1. 고충 게시판(댓글 없음)
2. 연구 아카이브 + 사이트 내 키워드 검색·추천 + 의미로 더 찾기
3. 보고서 도우미(에디터, 한글 파일 열기, 캡션, 수식, 서식, CSV → 표·그래프, 자동완성)
4. 사이트 내 AI 챗봇
5. 자동 저장, 가져오기, 내보내기
6. 사용자별 프로젝트
7. 둘러보기 모드와 예시 데이터

### 3.4 제외
- 실시간 공동 편집, 프로젝트 팀원 초대
- HWP/HWPX **내보내기**
- 외부 논문 DB 검색(검색은 사이트 내부 한정)
- 고충 댓글(사용자 요청으로 제거)
- 모바일 앱, 결제
- [A][W] PDF 내보내기(런타임 제약), PDF·DOCX 가져오기

## 4. 기술 스택

### 4.1 [A] 아티팩트판
| 영역 | 선택 |
|---|---|
| 언어 | 빌드 없는 순수 JS. 각 모듈은 즉시 실행 함수, 전역은 `window.RN` 하나. TypeScript·ES module import·번들러 없음 |
| 파일 | `index.html`(뼈대·CSS 토큰·스크립트 순서), `core.js`(공통), `mod-search/home/pains/research/editor/autocomplete/data/convert/chat.js`, `seed.json` |
| 런타임 기능 | `db`(공유 문서 DB), `user`(계정·권한), `sample`(AI), `downloads`(파일 저장), `assets`(파일 업로드). **각각 null일 수 있다** |
| 외부 스크립트 | cdnjs 정확한 버전만: KaTeX 0.16.9, PapaParse 5.4.1(첫 화면), pdf.js 3.11.174(필요할 때 `RN.loadScript`) |
| 에디터 | 자체 블록 JSON 에디터(본문 전체가 contenteditable 하나, 그림·표·수식·목차는 편집 불가 덩어리) |
| 로컬 테스트 | `dev-mock.js`(window.claude 흉내, 경로 규칙·256KiB 검사) + `dev-server.mjs` + Playwright(`tests/*.spec.cjs`) |

### 4.2 [W] 웹 체험판
`build-web.sh <출력>`이 `core.js`·`mod-*.js`·`seed.json`·`web-backend.js`를 복사하고, `index.html`을 문서 뼈대로 감싸 `web-backend.js`를 먼저 불러온다. `.nojekyll` 생성. `web-backend.js`: db=메모리+IndexedDB("renote-web", 처음 열면 seed.json 적재), user=브라우저 임시 사용자, downloads=일반 파일 저장, sample·assets=null.

### 4.3 [S] 서버 앱
| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Next.js 16 App Router + TypeScript | 모르는 API는 `node_modules/next/dist/docs/` 확인(AGENTS.md) |
| UI | Tailwind + shadcn 규약 컴포넌트를 직접 작성 | shadcn 레지스트리 접근 불가였음 |
| DB | PostgreSQL 16 + Prisma 7(드라이버 어댑터 pg) | `pg_trgm`, `vector` 확장 |
| 인증 | Auth.js v5(Google, 이메일 매직링크) JWT 세션 | 운영에서 `EMAIL_SERVER` 없으면 메일 로그인 끔 |
| 파일 | S3 호환(MinIO / Supabase Storage), 없으면 로컬 드라이버 | presigned PUT, 체크섬 WHEN_REQUIRED |
| 에디터 | Tiptap | 문서 JSON |
| 수식·그래프·CSV | KaTeX, Plotly.js(cartesian), PapaParse | |
| 변환 워커 | BullMQ + Redis, 엔진 체인(pyhwp → LibreOffice+H2Orestart → rhwp+Chromium) | `SERVER_CONVERSION` 플래그 |
| PDF 내보내기 | Playwright Chromium 인쇄 | `PDF_EXPORT` 플래그 |
| 브라우저 HWP | `lib/hwp-browser`(아티팩트 파서를 TS로 옮김) | Vercel 기본 경로 |
| AI | Anthropic SDK, 모델은 `ANTHROPIC_MODEL` | 자동완성 모델은 14장 미결정 참고 |
| 테스트 | Vitest(실제 PostgreSQL) + Playwright | |

### 4.4 아티팩트 런타임 제약 체크리스트 [A]
- [ ] 외부 요청 없음. fetch·이미지·스타일시트는 같은 아티팩트의 상대 경로만. 외부 스크립트는 허용 CDN(cdnjs 우선)의 **정확한 버전** URL만.
- [ ] `window.print()` 없음 → PDF 인쇄 기능을 만들지 않는다.
- [ ] `<a download>` 무효 → 파일 저장은 `downloads.save({filename, data})`. 없으면 버튼 숨김, 거절(`declined`)은 오류가 아님.
- [ ] `alert/confirm/prompt` 없음(confirm은 항상 false) → 직접 만든 토스트·확인 창.
- [ ] KaTeX는 `output: "mathml"`, `throwOnError: false`, `trust` 금지.
- [ ] 소스에 U+FFFD 리터럴 금지(`\uFFFD`로).
- [ ] 주소는 `#이름`만 전달 → 상세 화면 id는 상태(params)로.
- [ ] db: 문서 경로 짝수·컬렉션 홀수 세그먼트, 문서 256KiB 이하, 쿼리당 구독 한 번, 한 문서 동시 쓰기 한 번, 로딩 10초 타임아웃.
- [ ] 게시하는 모든 파일은 직접 읽은 텍스트 소스. 읽을 수 없는 바이너리(WASM 등) 게시 금지.
- [ ] 사용자 입력을 `innerHTML`로 넣지 않는다. HTML이 필요하면(MathML, 직접 만든 SVG) 입력을 이스케이프한 뒤에만.
- [ ] 색은 CSS 토큰만, 다크 모드 대응, 휴대폰 폭(400px)에서 가로 스크롤 없음.

## 5. 정보 구조(화면)

### 5.1 [A][W] 화면 이름
최상위(주소 `#이름`, 메뉴): `home`(처음: 제목 + 통합 검색창 + 바로 가기 3개), `explore`(연구 탐색), `pains`(고충), `projects`(내 프로젝트), `convert`(메뉴 문구 "한글 파일 열기").
상세(params로 이동, nav로 메뉴 강조): `research{id}`, `publish{projectId}`, `pain{id}`, `pain-edit{id?,projectId?,researchId?}`, `project{id}`, `editor{projectId,docId}`.
전역: 우측 하단 AI 챗봇 버튼(`sample`이 있을 때). 에디터에서는 오른쪽 패널의 "AI 도우미" 탭.

### 5.2 [S] 경로
`/`, `/login`, `/explore`, `/research/[id]`, `/pains`, `/pains/new`, `/pains/[id]`, `/pains/[id]/edit`, `/projects`, `/projects/[id]`, `/projects/[id]/docs/[docId]`, `/projects/[id]/publish`, `/projects/[id]/import`, `/tools/convert`, `/settings`.

### 5.3 UI 단순화·디자인 원칙(모든 형태)
- 한 화면에 한 가지 주된 일. 처음 보이는 컨트롤을 줄이고 나머지는 "더 보기"·메뉴·탭 뒤로.
- 배지는 카드당 최대 2개. 테두리·카드 중첩 대신 여백과 구분선.
- 설명 문장은 한 줄. 버튼 문구는 동사 하나("저장", "공개"). 주 버튼(강조색)은 화면당 하나.
- 색·글꼴·버튼·입력창은 토큰(`--bg --surface --fg --muted --line --accent --ok --warn --danger --paper --paper-fg` 등). 문서 "종이"는 항상 흰 종이(`--paper`), 에디터는 책상 배경 위 종이 + 떠 있는 도구 막대 + 저장 상태 표시.
- 폼 컨트롤에는 고정 id와 라벨, 키보드로 모두 조작 가능, 명도 대비 WCAG AA.
- UI 문구는 한국어. [S]는 `messages/ko.json`에 모은다.

## 6. 데이터 모델

### 6.1 [A][W] 아티팩트 db
공유(로그인한 사람 읽기, 참여 권한 이상 쓰기):
- `research/{id}`: `{ title, summary, field, keywords[], limitations, authorId, publishedAt(ms), report: {title, html}|null, reportAsset: {id, filename, sizeBytes}|null, isExample? }` — `report`(내 문서에서 만든 sanitize된 HTML, 200KiB 이하)와 `reportAsset`(업로드한 PDF) 중 하나.
- `pains/{id}`: `{ title, body(마크다운), stage(TOPIC|DESIGN|EXPERIMENT|ANALYSIS|REPORT|OTHER), field, tags[], isAnonymous, authorId(익명이면 null), researchId|null, resolved, resolution|null, createdAt, updatedAt, meTooCount, isExample? }`
- `pains/{id}/reactions/{userId}`: `{ createdAt }` (한 사람 한 번)
- `reports/{id}`: `{ painId, reason, createdAt }` (신고 플래그만)
- 예전 `pains/{id}/comments/*`가 남아 있을 수 있다. 새로 만들 때는 댓글 경로를 쓰지 않는다.

개인(본인만). 컬렉션은 `RN.userColl(name)` = `data/users/<uid>/<name>/items`, 단일 문서는 `RN.userDoc(name)` = `data/users/<uid>/<name>`. **경로를 직접 조립하지 않는다.**
- `myPains/{painId}`: `{ createdAt, projectId|null }` — 익명 글도 본인이 수정·삭제할 수 있게 "내 글" 표시를 개인 영역에 둔다.
- `projects/{pid}`: `{ title, description, field, keywords[], archivedAt|null, deletedAt|null, createdAt, updatedAt }`
- `docs/{docId}`: `{ projectId, title, content(블록 JSON), formatRules, version, deletedAt|null, updatedAt }`, 하위 `snapshots/{sid}`: `{ content, version, reason: AUTO|MANUAL|IMPORT, createdAt }`
- `formatTemplates/{id}`, `datasets/{id}`: `{ projectId, name, columns[{name,type,unit,missing}], rows(256KiB 넘으면 앞에서 자르고 알림), rowCount, createdAt }`
- `chats/{tid}`: `{ title, messages[{role, content, citations?}], updatedAt }`
- `aiUsage`(단일 문서): `{ day(한국 시간 YYYY-MM-DD), count(챗봇·의미 검색), autocomplete, updatedAt }`
- 사용자 이름·이메일은 저장하지 않는다(id만, 표시할 때 `user.profiles`로 풀기).

### 6.2 [S] Prisma
원본 모델(User, Project, Document, DocumentSnapshot, FormatTemplate, Asset, Dataset, ConversionJob, Research, PainPost, Reaction, ChatThread, ChatMessage)에 다음을 더한다: Auth.js용 `Account/Session/VerificationToken`, `Project.archivedAt/deletedAt`, `Document.deletedAt`, `Asset.deletedAt`, `PainPost.field`, `PainReport`(신고), `AiUsage(userId, kind, createdAt)`, 검색 색인 `SearchDocument`(트리거로 관리). `PainPost.stage`는 영문 enum. `Comment` 테이블은 기존 구현에 남아 있으나 쓰지 않는다(새로 만들 때는 만들지 않아도 된다).
- 프로젝트·문서는 기본 비공개. 공개되는 것은 사용자가 명시적으로 공개한 연구와 고충뿐.
- 고충은 프로젝트 없이도 작성 가능, 익명 옵션.

## 7. 기능 상세

### 7.1 고충 게시판
- 작성 항목: 제목, 본문(마크다운), 연구 단계, 분야, 태그(최대 10), (선택) 연결할 내 연구·프로젝트, 익명 여부.
- **댓글 없음.** 다른 사람은 "나도 겪었어요"(토글, 한 사람 한 번)와 신고(플래그만)만 한다.
- 작성자는 수정(화면에 "수정됨"), 삭제, 해결됨 표시(해결 방법 필수, 상단 강조), 해결 취소(해결 방법 삭제)를 할 수 있다. 수정 허용 여부는 14장에 미결정으로 남기되 기본값은 "허용".
- 목록: 최신순·공감순, 단계·분야·태그 필터, 검색, 구분선 목록(카드 중첩 없음). 예시 글은 "예시" 표시.
- 익명 보호: 익명 글의 공유 문서·API 응답 어디에도 작성자 id가 없다. 익명 글은 공개 연구에 연결할 수 없고, 연구 상세·검색 결과의 고충 수에서 빠진다. [S] 실명 글도 이메일·id는 내보내지 않는다.
- 마크다운: 원문 HTML 차단, 링크는 http/https/mailto만, 이미지 렌더링 안 함.

완료 기준
- [ ] 쓰기 권한이 있는 사용자가 고충을 작성·수정·삭제할 수 있다
- [ ] 비로그인·둘러보기 사용자도 목록·상세를 읽을 수 있다
- [ ] 상세 화면에 댓글 목록·작성 폼이 없다
- [ ] 익명 글은 작성자 정보가 저장 문서·응답에 없다(테스트로 증명)
- [ ] 해결됨으로 바꾸면 해결 방법이 본문 위에 강조 표시된다

### 7.2 연구 탐색·추천
- 입력: 키워드 1개 이상. 검색 대상은 **이 사이트에 공개된 연구·고충만**. 외부 호출 없음.
- 키워드 검색: 소문자 → 한글 음절을 두벌식 자판 글자로 분해("음향"→`dmagid`) → 기호는 공백. 제목·키워드·분야는 trigram `word_similarity`(오타 허용, 하한 0.5, 짧은 단어 0.7), 요약·한계·본문은 공백 없앤 부분 문자열(0.85점). 여러 단어면 단어별 평균 0.6 이상. 최대 6단어. [A][W]는 브라우저 순수 함수, [S]는 SQL 함수 + pg_trgm.
- **의미로 더 찾기** [A]: 버튼을 누르면 AI(`sample`)가 관련 검색어만 제안하고, 그 검색어들로 다시 사이트 내부를 찾는다(AI 요청 1회, 하루 한도에 포함). 결과는 늘 사이트 데이터에서만.
- 결과: 연구 카드(제목·요약 2줄·키워드·고충 수·보고서 유무), 결과 없음은 "아직 이 사이트에 등록된 연구가 없어요"로 분명히. 관련 고충은 따로.
- 연구 상세: 요약 / 한계 / 연결된 고충(익명 제외) / 결과보고서(HTML 본문 또는 PDF 미리보기·내려받기) / 비슷한 연구.
- 공개 흐름: 프로젝트 → "연구 공개" → 요약·키워드·한계 + 결과보고서(내 문서 선택 → HTML, 또는 PDF 업로드 [A] `assets` 20MiB) → 확인 창 → 생성.
- [S] 임베딩: `EmbeddingProvider` 인터페이스와 테스트용 fake만 있다. 실제 제공자는 미결정.

완료 기준
- [ ] 검색 결과가 사이트 내부 데이터만으로 구성된다
- [ ] 결과가 없을 때 없다고 분명히 표시한다(AI가 지어낸 연구 없음, 의미로 더 찾기 포함)
- [ ] 연구 상세에서 고충·한계·결과보고서를 한 화면에서 본다
- [ ] 오타·띄어쓰기 차이가 있는 한국어 키워드도 검색된다

### 7.3 보고서 도우미

#### (a) 한글 파일 열기
- 입력: `.hwp`(HWP 5.x), `.hwpx`, 최대 50MB. 브라우저에서 직접 읽고 서버로 올리지 않는다.
- 파서: HWP5 = Compound File(CFB/OLE2) → FileHeader → DocInfo(스타일·문단 모양·BinData) → BodyText/SectionN(raw deflate, `DecompressionStream("deflate-raw")`) → 레코드 트리 → 문단·표·그림. HWPX = zip(중앙 디렉터리 → 로컬 헤더) → `Contents/header.xml` + `sectionN.xml`(DOM 없는 작은 XML 파서).
- 뽑는 것: 제목(개요 수준), 문단(줄바꿈·탭), 표(병합 칸), 각주·미주(문서 끝), 수식은 `[수식: …]` 글자, 그림. 쪽 배치·글꼴은 다루지 않는다.
- 그림: 그림 개체가 가리키는 BinData만, 머리 바이트로 확인한 래스터(PNG·JPEG·GIF·WebP, BMP→PNG)만. SVG 등 글자 형식은 받지 않는다. 파일당 최대 200개·60MB.
- 오류는 사용자 문장으로: HWP가 아님, HWP 3.0 이하, 손상, 암호, 배포용 문서, 너무 큼, 브라우저 미지원. 압축 폭탄 방지(풀린 크기 합 400MB).
- 화면: 넓은 종이 미리보기, "텍스트로 저장"(.md), "내 프로젝트로 가져오기". **열기만으로는 저장되지 않는다**는 한 줄 안내를 미리보기 위에 늘 둔다.
- [S] Docker 배포에서만 서버 HWP→PDF 변환(`/tools/convert`, 엔진 체인, 120초 타임아웃, 결과물로 성공 판정, "레이아웃이 원본과 다를 수 있음" 안내).

#### (b) 캡션 빠른 삽입
그림·표·수식 캡션(`Ctrl/Cmd+Shift+C`), 번호는 저장하지 않고 문서 순서로 계산(`그림 1.`, `표 1.`, `식 (1)`), `@` 상호 참조(번호 따라감, 대상 삭제 시 "참조 대상 없음"), 그림 목차·표 목차. 캡션 위치(그림 아래, 표 위)는 서식 규칙. 블록 수식은 캡션 없어도 번호.

#### (c) 수식
- `$…$` 인라인(바로 안쪽이 공백이면 변환 안 함 — 금액 표기 보호), `$$…$$` 블록(문단 전체일 때).
- **쉬운 표기**: 수식 창에 `a/b`, `x^2`, `sqrt(x)`, `루트`, `알파`, `<=`, `->`, `+-`, 단위(`m/s`) 등을 치면 LaTeX로 바꿔 바로 미리 보여 주고 "넣기"를 눌러야 들어간다. 백슬래시가 있으면 이미 LaTeX로 본다. 바꿀 수 없으면 원문 유지(예외 없음). 문서에는 LaTeX만 저장.
- 팔레트(분수·적분·행렬·그리스 문자).
- AI: [S] 자연어·이미지 → LaTeX API. [A] 챗봇 `suggest_latex` 제안 카드.
- 렌더링: [A][W] MathML만.

#### (d) 서식
폼(용지·여백·글꼴·크기·줄 간격·제목 단계·들여쓰기·캡션·쪽 번호, 자주 쓰는 것 먼저 + "자세히"), 프리셋 3종(일반 보고서·학술 논문형·탐구 보고서형), 내 템플릿, 문서 전체에 CSS 변수로 즉시 적용, 서식 검사 + "모두 고치기". 글꼴은 웹에서 쓸 수 있는 한글 글꼴(Noto Sans/Serif KR, 나눔 계열), 그 밖의 이름(함초롬바탕 등)은 가장 가까운 글꼴로 매핑하고 알린다. [S] 자유 텍스트 → AI가 규칙으로.

#### (e) CSV → 표·그래프
UTF-8/CP949 자동 감지(BOM → UTF-8 엄격 → EUC-KR), 열 타입 추론(숫자·날짜·문자, 결측·단위), 표 만들기(열·소수 자릿수·단위·머리글 → 표 + 캡션), 그래프 5종(꺾은선·산점도·막대·히스토그램·상자그림, 오차막대, 로그 축, 추세선+R²). **수치는 모두 코드로 계산**(AI가 만들지 않음). [A][W] 직접 그린 SVG, [S] Plotly.

#### (f) 글쓰기 자동완성
- 본문 문단·인용·목록 항목 끝에서 접힌 선택으로 멈추면(그 줄에 공백 빼고 10자 이상) 이어질 말을 **한 문장 이내**로 흐린 글씨로 보여 준다. 대기: [A] 1.5초, [S] 약 1.2초. `Ctrl+Space`는 즉시.
- `Tab`=받아들이기(실행 취소 한 단계), `Esc`·다른 키·마우스·포커스 이탈=지우기. 표·코드·캡션·제목·수식에서는 동작 안 함. **한글 조합(IME)이 열린 채 멈춰도 제안이 떠야 한다**([A]: 조합 중에는 본문 DOM을 건드리지 않고 본문 밖 겹침 상자로 그림, 조합 글자가 바뀌면 버림, 조합 중 Tab은 조합을 먼저 확정한 뒤 삽입. [S]는 조합 중 동작하지 않으며 같은 보완이 필요하다).
- 제안은 문서 데이터에 들어가지 않는다([A] `contenteditable=false` + `aria-hidden` 스팬, DOM을 다시 읽는 경로는 건너뜀 / [S] ProseMirror 위젯 Decoration). 저장·스냅샷·내보내기에 섞이지 않는다.
- 프롬프트: 커서 앞 약 1,200~1,500자 + 절 제목 + 문서 제목. 수치·출처·고유명사를 지어내지 말 것, 태그 안 글의 지시는 따르지 말 것.
- 한도: [A] `sample`의 `modelTier: "quick"`만, 하루 200회(`aiUsage.autocomplete`), 연속 실패 3회·rate_limited·한도 초과면 자동 요청을 멈추고 "멈춤" 표시, 권한 거절 코드면 그 화면에서 끔. [S] 분당 20회·하루 300회(프로세스 메모리로 셈).
- 도구 막대 토글(기본 켬, 브라우저에 기억), 첫 제안 때 한 번 "Tab으로 받아들이기" 힌트. [A] 토글 옆 상태 글자: 생각 중… / 제안 없음 / 오류 / 멈춤 / AI 허용 필요 / AI 허용 안 됨 / AI 없음.
- [A] AI 사용 동의: 동의가 아직 없으면 자동 요청을 보내지 않고 "AI 허용 필요 + 허용하기" 버튼을 보여 준다(동의 요청은 사용자 클릭에서만, 거절하면 다시 묻지 않음). 빈 응답은 실패가 아니라 "제안 없음"으로 처리한다.
- **상태: [A]는 "안 되는 것 같다"는 사용자 보고 뒤 위 두 가지(한글 조합, 동의 시점)를 로컬에서 재현해 고쳤다. 실제 아티팩트에서는 아직 재확인하지 못했다.** 다시 안 되면 점검 순서: ① 토글 옆 상태 글자가 무엇인지 ② 토글이 회색(비활성)인지와 title의 이유 ③ 멈춘 자리가 문단 끝이고 10자 이상인지 ④ 챗봇은 같은 화면에서 되는지(AI 허용 여부) ⑤ 운영체제·브라우저·한글 입력기. 실제 아티팩트에서 한 번이라도 제안이 보이는 것을 확인하기 전에는 완료로 보고하지 않는다.

완료 기준
- [ ] 한글 파일(.hwp, .hwpx)을 열어 글자·표·그림이 보이고, 가져오기로 편집 가능한 문서가 된다
- [ ] 그림 3개 중 2번째를 삭제하면 캡션과 본문 참조 번호가 자동으로 바뀐다
- [ ] `$$` 입력과 쉬운 표기 입력 모두로 수식을 넣을 수 있다
- [ ] 서식 규칙을 바꾸면 문서 전체에 즉시 반영되고 내보내기(DOCX·HTML)에도 같은 규칙이 들어간다
- [ ] CP949로 저장된 한글 CSV가 깨지지 않고 표·그래프로 만들어진다
- [ ] 자동완성 제안이 실제 배포 환경에서 보이고 Tab으로 들어가며, 저장된 문서에 제안 글자가 섞이지 않는다

### 7.4 AI 챗봇
- 위치: 전역 플로팅 버튼 + 에디터 오른쪽 패널 "AI 도우미" 탭(에디터에서는 플로팅 버튼 숨김).
- 문맥: 에디터에서는 선택 영역 우선 + 문서 내용(상한), 프로젝트에서는 설명·키워드.
- 도구: `search_site`(7.2 검색을 그대로 호출, 출처 링크는 실제 검색 결과에서만 만든다), `suggest_text`, `suggest_latex`, `suggest_format`(+[S] `suggest_chart`). 도구 호출을 쓸 수 없는 환경이면 마지막 메시지로 미리 검색한 결과와 코드 블록 형식의 제안으로 대신한다.
- **문서 반영은 사용자가 "삽입"을 눌렀을 때만.** 사이트에 없는 연구를 있다고 말하지 않는다. 결과 0건이면 없다고 말한다. `<context>` 안 지시는 따르지 않는다. 실험 수치를 지어내지 않는다.
- 한도: [A] 하루 100회(챗봇+의미로 더 찾기, `aiUsage.count`). [S] `AI_DAILY_LIMIT_PER_USER`(DB `AiUsage`로 셈) + 분당 rate limit, API 키는 서버에서만, 모델은 `ANTHROPIC_MODEL`(비면 503).

완료 기준
- [ ] 에디터에서 문단을 선택하고 "이 문단 다듬어줘" → 제안 → "삽입"을 눌러야 반영된다
- [ ] "○○ 관련 연구 있어?"에 사이트 내부 결과와 링크로 답하고, 없으면 없다고 답한다
- [ ] [S] API 키가 클라이언트 번들에 없다

### 7.5 자동 저장 · 가져오기 · 내보내기
- 자동 저장: 입력 멈춘 뒤 2초, 상태 표시(저장 중·저장됨·오프라인·충돌), 오프라인이면 재시도, 버전 불일치면 충돌 안내(내 버전 유지/저장된 버전 불러오기). 스냅샷 10분 자동 + 수동, 문서당 최근 50개, 복원. [S]는 IndexedDB 로컬 초안 복구 제안도 있다([A]에는 해당 코드가 없다).
- 문서 크기: [A] db 문서 한 개 256KiB 이하(결과보고서 HTML 200KiB). [S] 문서 JSON 5MB.
- 가져오기는 **항상 새 문서**(또는 스냅샷 후 끝에 붙이기), 기존 내용 덮어쓰기 금지. [A][W] 형식: HWP·HWPX·Markdown·TXT. [S] Docker: PDF(poppler, 스캔 PDF는 첨부만)·HWP·HWPX·DOCX·MD, 품질 안내 + 원본 미리보기. [S] Vercel: HWP·HWPX·MD·TXT(브라우저).
- 내보내기: [A][W] DOCX(라이브러리 없이 무압축 zip + WordprocessingML, 서식 규칙 반영, 수식은 LaTeX 글자), HTML(서식 반영 — 사용자가 브라우저에서 PDF로 인쇄 가능), Markdown. 저장은 `downloads`. [S] PDF(Docker만)·DOCX·Markdown.

완료 기준
- [ ] 입력 후 새로고침해도 내용이 유지된다
- [ ] 오프라인에서 작성 후 온라인 복귀 시 저장된다
- [ ] 가져오기는 새 문서를 만들고 기존 문서를 덮어쓰지 않는다
- [ ] DOCX 내보내기 파일이 Word 호환 프로그램에서 열린다(직접 열어 확인)

### 7.6 프로젝트
여러 프로젝트(제목·설명·분야·키워드), 안에 문서·데이터셋·고충 메모·챗봇 대화. 프로젝트 홈: 최근 문서, 데이터, 내 고충, 관련 연구 추천, 연구 공개, 가져오기(다른 모듈이 섹션을 붙인다). 탭: 진행 중 / 보관함 / 휴지통(30일 뒤 영구 삭제 — [A]는 목록을 열 때 정리, [S]는 `pnpm trash:purge`를 cron으로). 소유자만 접근: [A]는 개인 경로 자체가 본인 전용, [S]는 모든 API에서 소유자 검사(남의 것은 404).

완료 기준
- [ ] 다른 사용자의 프로젝트·문서에 접근할 수 없다([S] 404, 테스트 포함)
- [ ] 프로젝트 삭제 시 하위 문서가 함께 휴지통으로 가고 복구할 수 있다

### 7.7 둘러보기 모드와 예시 데이터
- [A] `db`나 `user`가 없으면(독립 페이지, 주인 조직 밖 계정 등) 함께 게시한 `seed.json`을 읽기 전용으로 보여 준다. 머리에 "둘러보기" 표시, 쓰기 버튼 자리에 이유 한 문장: 독립 페이지면 "claude.ai의 아티팩트 화면에서 열어 주세요", 아니면 "만든 사람의 조직 계정이거나 초대받은 계정이어야 해요". 보기 권한만 있으면 "참여 권한을 요청하세요".
- 근본 해결은 아티팩트 공유 메뉴에서 초대하거나 [S]를 배포하는 것이다(14장).
- 예시 데이터: 연구 230건(각 고충 2개) + 고충 460건 = 문서 690건. 원래 30건 + 분야별 생성 200건. 모두 지어낸 예시(실존 인물·학교·논문 없음, 위험한 실험 없음), `isExample: true`로 "예시" 표시, 작성자 없음, 익명 고충은 연구에 연결하지 않음, 해결 방법은 약 1/3.
- **날짜는 모두 과거**(지금 `seed.json`은 2026-06-01 ~ 2026-11-05). 새로 만들 때는 생성 스크립트에서 미래 날짜를 검사해 거부한다.
- 실제 공유 db가 비어 있을 때 예시를 넣는 방법(게시자가 한 번 적재할지)은 구현에 따라 정하고 `docs/decisions.md`에 기록한다.

## 8. 인터페이스

### 8.1 [A] 모듈 계약(`RN`)
- 공통: `h(tag, attrs, ...children)`(문자열 자식은 항상 텍스트), `css(id, text)`, `toast`, `confirm → Promise<boolean>`, `loadScript(cdnjs URL)`, `fmtDate`, `newId`, `local.get/set/remove`(실패해도 안전), `notice`, `badge`, `field`, `writeBlockedReason()`, `STAGES`.
- 기능: `RN.ready → caps`, `RN.caps = { db, user, sample, downloads, assets, uid, me, canWrite }`(모두 null 가능), `RN.userColl(name)`, `RN.userDoc(name)`, `RN.names(ids)`.
- 공유 데이터: `RN.shared = { research, pains, loaded, error, examplesOnly }`, `RN.onShared(fn)` — core가 한 번만 구독, 모듈은 다시 구독하지 않는다.
- 화면: `RN.view(name, { title, nav?, mount(root, params) → 정리함수 })`, `RN.go(name, params)`.
- 모듈 사이: `RN.search`, `RN.searchExpanded`, `RN.similarResearch`, `RN.recommend`, `RN.pains.{listFor, renderList}`, `RN.markdown`, `RN.docs.{listProjects, listDocs, getDoc, createDoc, exportHtml, exportMarkdown}`, `RN.editor`(문서가 열려 있을 때만), `RN.editorPanels[]`, `RN.projectSections[]`, `RN.autocomplete.attach(bridge)`, `RN.aiQuota`, `RN.chat.open`. 상대 모듈이 없을 수 있으니 `RN.x && RN.x.y`로 확인.

### 8.2 [S] API
원본 8장 목록에서 고충 댓글(`POST /api/pains/:id/comments`)을 뺀다. 더한 것: `POST /api/pains/:id/reports`, `GET /api/research/:id/report`(공개 연구 보고서 비로그인 내려받기), `POST /api/ai/autocomplete`, `POST /api/docs/:id/export`의 `saveAsAsset`. `SERVER_CONVERSION`이 꺼지면 `/api/convert`·`/api/import`는 501, `PDF_EXPORT`가 꺼지면 PDF 내보내기 501. 모든 입력 zod, 에러 형식 `{ error: { code, message } }`, 남의 프로젝트·문서는 404, 남의 고충 수정은 403.

## 9. 비기능 요구사항
- **보안**: 사용자 입력 HTML 금지(마크다운은 허용 목록 렌더러), 업로드는 확장자+머리 바이트 검증, 그림은 래스터만, 압축 폭탄 한도, AI 프롬프트의 사용자 자료는 태그로 감싸고 지시로 따르지 않음. [S] 변환 워커는 네트워크 차단 컨테이너, 인증·검색·업로드·내보내기·AI에 rate limit(프로세스 메모리 기반이라 여러 인스턴스면 느슨해짐 — Redis 저장소 미구현).
- **비밀 값**: 코드·저장소·채팅에 넣지 않는다. `AUTH_TEST_MODE`, `AI_FAKE`는 운영 금지(특히 `AUTH_TEST_MODE`는 코드가 `NODE_ENV`로 막지 않는다).
- **개인정보**: 프로젝트·문서 기본 비공개, 공개 전 확인 창, 익명 비노출, [A] 이름·이메일을 저장하지 않음, [S] 계정 삭제 시 데이터 삭제.
- **성능**: 에디터 입력 지연 체감 없음, 검색 응답 1초 이내([S] 1만 건 기준 20~160ms 측정), [A] 공유 컬렉션은 최대 1000건씩 구독.
- **접근성**: 키보드만으로 주요 기능, 키보드 트랩 없음(Esc로 에디터 탈출), 명도 대비 WCAG AA, 폼 라벨.
- **반응형**: 400px 폭에서 가로 스크롤 없음.
- **언어**: UI 한국어.
- **관측**: [S] JSON 한 줄 구조화 로그, 변환·AI 실패 기록.

## 10. 디렉터리 구조
```
/artifact                 [A][W] 소스 (게시 대상: index.html, core.js, mod-*.js, seed.json)
  CONTRACT.md             모듈 계약
  dev-mock.js dev-server.mjs   로컬 테스트(게시 안 함)
  web-backend.js build-web.sh  [W] 웹 체험판
  make-seed.ts seed/      예시 데이터 생성 원본
  tests/*.spec.cjs        Playwright
/app /components /lib /server /worker /prisma /tests   [S] 서버 앱
/lib/hwp-browser          브라우저 HWP/HWPX 파서(TS)
/docs                     decisions.md, hwp-spike.md, acceptance.md, deploy.md, deploy-vercel.md
PROGRESS.md               진행 기록(재개용)
```
저장소 안에 다른 저장소 클론을 두지 않는다. 바이너리(WASM, whl, tar.gz)는 커밋하지 않는다.

## 11. 환경변수 ([S]만. [A][W]는 환경변수가 없다)
원본 목록에 더해: `DIRECT_URL`(마이그레이션 전용, Supabase 세션 풀러), `DATABASE_POOL_MAX`, `S3_REGION`, `S3_PUBLIC_ENDPOINT`, `STORAGE_LOCAL_DIR`, `SERVER_CONVERSION`, `PDF_EXPORT`(비우면 Vercel에서 끔), `ANTHROPIC_AUTOCOMPLETE_MODEL`, `RATE_LIMIT_AUTOCOMPLETE_PER_MINUTE`(20), `AI_AUTOCOMPLETE_DAILY_LIMIT`(300), `RATE_LIMIT_*`, 변환 엔진 경로·순서 변수, `AUTH_TEST_MODE`·`AI_FAKE`(테스트 전용), `TEST_DATABASE_URL`. `NEXT_PUBLIC_APP_NAME` 기본값 `Re: Note`. `EMBEDDING_API_KEY`는 자리만 있고 읽는 코드가 없다. 전체 목록은 `.env.example`이 기준이며 새 변수는 거기에 추가한다.

## 12. 구현 단계(다시 만들 때)
각 단계가 끝나면 그 형태의 테스트를 돌리고, **확인한 범위(로컬 모크 / 실제 아티팩트 / 실서비스)**를 구분해 짧게 보고한다. 사용자 확인을 기다리지 않는다.

| 단계 | 내용 | 산출물 |
|---|---|---|
| 0. 기반 [A] | `index.html` 토큰·뼈대, `core.js`(4.4 체크리스트, DOM 헬퍼 평탄화, 경로 헬퍼, 둘러보기), `CONTRACT.md`, 경로 규칙을 강제하는 로컬 모크, 실제 아티팩트에 빈 화면 한 번 게시해 기능 확인 | 게시 가능한 빈 앱, 기능 확인 기록 |
| 1. 검색·연구·고충 [A] | `mod-search`·`mod-home`·`mod-research`·`mod-pains`, 예시 데이터 690건(과거 날짜) | 둘러보기에서 검색·상세가 됨 |
| 2. 프로젝트·에디터 [A] | 블록 에디터(여러 문단 선택, Shift+Enter), 자동 저장·충돌·스냅샷·휴지통 | 문서 작성·복원 |
| 3. 보고서 도우미 [A] | 캡션·상호 참조·목차, 쉬운 수식(MathML), 서식·서식 검사, CSV→표·그래프(SVG), DOCX·HTML·MD 내보내기 | 서식 반영 내보내기 |
| 4. 한글 파일 [A] | 자체 HWP5·HWPX 파서, 그림 추출, 넓은 미리보기, 가져오기 + 저장 안내 | 한글 파일 → 문서 |
| 5. AI [A] | 챗봇(도구·삽입 버튼), 의미로 더 찾기, 자동완성, 하루 한도 — **실제 아티팩트에서 확인** | AI 기능 |
| 6. 마무리 [A] | 결과보고서 PDF 업로드(assets), 접근성·휴대폰 폭, 디자인 다듬기 | 주 배포 완료 |
| 7. 웹 체험판 [W] | `web-backend.js`, `build-web.sh`, 정적 호스팅 게시 | 체험판 URL |
| 8. 서버 앱 [S] (선택) | 14장 결정 후에만. 기존 구현(`dandeling/Re-Note`)을 3.2 표에 맞춰 갱신 | 배포 가능한 서버 앱 |

## 13. 수용 시나리오
[A] (실제 아티팩트에서, 계정 두 개 이상)
1. 프로젝트 생성 → 문서 작성 → 새로고침 후 내용 유지
2. 한글 파일 열기 → "저장되지 않음" 안내 확인 → 가져오기 → 서식 프리셋 적용 → 그림 캡션 → DOCX 내보내기
3. CSV 업로드 → 산점도 + 추세선 → 문서 삽입 → 캡션 번호 자동
4. 고충 작성 → 다른 계정으로 "나도 겪었어요"(댓글 UI 없음 확인) → 원 작성자가 해결됨 처리
5. 연구 공개(요약·한계·결과보고서 PDF) → 다른 계정이 키워드 검색 → 상세에서 고충·한계·보고서 확인
6. 챗봇 "○○ 관련 연구 있어?" → 내부 링크 답변 / 없는 주제는 "없음"
7. 조직 밖 계정 또는 독립 페이지로 열기 → 둘러보기 + 이유 안내, 예시 검색 가능, 쓰기 버튼 없음
8. 문단 끝에서 멈춤 → 흐린 제안 → Tab → 저장된 문서에 제안이 한 번만 들어감
[W] 9. 체험판을 열면 예시가 보이고, 쓴 글이 새로고침 뒤에도 남으며, AI·업로드 버튼이 없다.
[S] 원본 E2E 7개(시나리오 4는 댓글 없음으로 변경) — 기존 구현에 Playwright로 있음.

## 14. 확정된 기본 결정

아래는 결정된 것으로 보고 질문 없이 구현한다. 사용자가 달리 지시하면 바꾼다.

| 항목 | 결정 |
|---|---|
| 고충 작성 후 수정 | **허용**. 수정하면 「(수정됨)」 표시 |
| 한글 파일을 열 때 자동으로 문서 만들기 | **만들지 않음**. 「내 프로젝트로 가져오기」 버튼 + 「저장되지 않음」 안내 |
| 서버 앱 배포 | **하지 않음**(산출물은 [A]만, 0장) |
| [A] 공유 db에 예시 데이터 넣기 | **넣지 않음**. `seed.json`은 둘러보기용 읽기 전용 |
| 임베딩 제공자 | **없음**. [A]는 trigram 검색 + "의미로 더 찾기" |
| 자동완성 모델 | [A]는 `sample`의 `modelTier: "quick"`. 모델 ID를 코드에 쓰지 않는다 |
| 관리자 검수(신고 처리) | **신고 플래그 저장만**. 관리자 화면 없음 |
| rate limit 저장소([S]) | 해당 없음([S]를 만들지 않음) |

## 15. 검증하지 못한 것 · 확인 필요

| 항목 | 상태 |
|---|---|
| [A] 자동완성이 실제 아티팩트에서 동작하는지 | **재확인 필요** — "안 되는 것 같다"는 보고 뒤 원인 둘을 로컬에서 재현해 고쳤으나, 실제 한글 IME·실제 동의 창·실제 AI 응답으로는 확인하지 못함 |
| [A] 그 밖의 AI 기능(챗봇·의미로 더 찾기)의 실제 응답 품질 | 이 문서 작성 시점에 확인 기록 없음 — 확인 필요 |
| [W] GitHub Pages 접속 | 미검증(세션 네트워크 차단). 저장소에 Pages 배포 자동화 파일도 없다 |
| [S] Vercel·Supabase 실제 배포, presigned 업로드·CORS | 미검증 |
| [S] Docker 이미지 실제 빌드·기동(`docker compose up`) | 미검증(문법 검사와 `pnpm build`까지만) |
| [S] 실제 Anthropic API 호출(챗봇·수식·서식·자동완성) | 미검증(가짜 AI·mock만) |
| [S] 실제 MinIO/S3 연결 | 미검증(로컬 드라이버·단위 테스트만) |
| HWP: 수식이 든 HWP, 한컴오피스가 직접 저장한 HWPX | 미검증(샘플 없음). H2Orestart 최신판(0.7.x)도 미시험 |
| [S] E2E 시나리오 4(댓글 제거 후)와 병합 후 고친 E2E 2건 재실행 | 미확인(`docs/acceptance.md`) |
| [S] `pnpm test:bundle`(API 키 번들 비노출 빌드 검사) | 마지막 브랜치에서 실행 안 함 |
| [A] DOCX를 실제 Word·한글에서 열어 보기 | 확인 기록 없음 — 확인 필요 |

---

# 부록 — 실제 구현 상세 명세 ([A]·[W] 기준)

> 아래 부록은 `artifact/` 소스를 끝까지 읽고, 코드에 있는 그대로 옮긴 것이다(2026-11-17, main). 원본 코드 없이 같은 앱을 다시 만들 수 있게 쓰는 것이 목적이다. 앞 장(1~15장)은 요구사항, 이 부록은 "지금 만들어진 모습"이다. 둘이 다르면 앞 장의 결정이 우선이고, 부록은 다시 만들 때의 기본값이다.
> - 장 번호: **부록 가**(런타임 계약) · **나**(화면별 명세) · **다**(데이터 모델) · **라**(기능별 규칙·알고리즘).
> - 이번 판에 담은 절: 가.1~가.8, 나.1~나.10, 다.2(에디터 개인 컬렉션)·다.3(블록 JSON), 라.1~라.5, 라.10, 라.11. **시간 관계로 쓰지 못한 것**: 에디터 화면(나.11), 자동완성(라.6), CSV→표·그래프(라.7), HWP/HWPX(라.8), 챗봇·하루 한도(라.9), 상수 표·디자인 상세·테스트 목록·알려진 한계. 본문에서 이 절 번호가 나오면 **7장(기능 상세)과 6.1(데이터)을 기준으로 스스로 정한다**. 디자인 토큰 값은 가.1과 4.4의 규칙(CSS 토큰·다크 모드·400px)을 따른다.
> - 절 순서: 가 → 나.1~나.8 → (에디터 관련) 가.2-1·나.9·나.10·라.2.2 → 다.3·라.3~라.5·라.2.1·다.2 → 라.1·라.10·라.11.
> - 문구는 화면에 나오는 원문을 「」 또는 따옴표로 그대로 옮겼다. 원문 안의 따옴표 모양(‘’, “”)도 코드 그대로다.
> - "확인 필요"는 코드만으로 판단할 수 없었던 것이다. 그 자리에 적은 판단 기준대로 진행하고 `docs/decisions.md`에 기록한다.

## 부록 가. 런타임 계약

### 가.1 파일과 로드 순서 [A]
`index.html`은 `<html>`·`<head>`·`<body>` 없이 시작하는 **조각**이다(아티팩트가 문서 뼈대를 씌운다. [W] `build-web.sh`와 로컬 `dev-server.mjs`도 같은 뼈대를 직접 씌운다). 순서:

| 순서 | 무엇 | 비고 |
|---|---|---|
| 1 | `<title>Re: Note</title>`, `<meta name="claude:viewport-fit-sides" content="cover">` | 서비스 이름은 여기와 머리 로고에만 |
| 2 | Google Fonts 스타일시트 1개: Hahmlet(500·600·700), IBM Plex Sans KR(400·500·600·700), Noto Sans KR(400·500·700), Noto Serif KR(400·700), IBM Plex Mono(400·500), `display=swap` | 글꼴 토큰은 바.1 |
| 3 | `<style>` 토큰·공통 부품·에디터 화면 CSS | 바장 |
| 4 | 머리(`#rn-header`: 로고 `#rn-brand`, `nav#rn-nav`, `#rn-me`), 안내 띠 `#rn-banner`, `main#rn-view`(처음엔 「불러오는 중…」), 토스트 `#rn-toast` | 나.1 |
| 5 | `katex.min.js` 0.16.9, `papaparse.min.js` 5.4.1 (cdnjs) | 전역 `katex`, `Papa` |
| 6 | `core.js` → `mod-search.js` → `mod-home.js` → `mod-pains.js` → `mod-research.js` → `mod-editor.js` → `mod-autocomplete.js` → `mod-data.js` → `mod-convert.js` → `mod-chat.js` | 순서 고정. autocomplete는 editor 바로 뒤 |
| 7 | 인라인 스크립트: `RN.ready.then(...)`에서 `#rn-me` 글자·안내 띠를 정하고 `RN.start()` | 나.1 |

각 모듈은 `(function(){ "use strict"; const RN = window.RN; if (!RN) return; ... })()` 형태이고 전역은 `RN`에만 붙인다. 모듈 CSS는 `RN.css("모듈id", 문자열)`로 한 번만 넣는다(`<style data-mod="id">`).

### 가.2 `RN` 공개 API 전체

core.js가 만드는 것:

| 이름 | 시그니처 | 설명 |
|---|---|---|
| `h` | `h(tag, attrs, ...children) → Element` | `class`→className, `dataset`→병합, `style`(객체)→병합, `on*`(함수)→addEventListener(소문자 이벤트), 요소 속성에 있는 키(단 `list`·`form` 제외)는 프로퍼티로(실패하면 setAttribute), 그 밖은 setAttribute(`true`→빈 값). 값이 `null/false`면 건너뜀. 자식은 평탄화하고 null/false는 건너뛰며 **문자열은 항상 텍스트 노드** |
| (전역 패치) | `Element/DocumentFragment.prototype.append/prepend/replaceChildren` | 인자를 `flat(Infinity)` 하고 `null`·`undefined`·`false` 제거 후 원래 함수 호출 (B8) |
| `css` | `css(id, text)` | 같은 id는 한 번만 `<style>` 추가 |
| `toast` | `toast(message, kind?)` | `#rn-toast`에 글자, `data-kind`=`kind||"info"`, 4초 뒤 숨김(타이머 하나, 새 토스트가 이전 것을 덮음). `kind="error"`면 빨간 배경 |
| `loadScript` | `loadScript(url) → Promise` | `https://cdnjs.cloudflare.com/ajax/libs/`로 시작하지 않으면 「허용되지 않은 스크립트 주소」로 거절. 같은 URL은 한 번만, 실패하면 캐시에서 지워 재시도 가능, 오류 문구 「스크립트를 불러오지 못했어요」 |
| `confirm` | `confirm(message, {okLabel="확인", cancelLabel="취소", danger=false}) → Promise<boolean>` | `<dialog class="rn-dialog" aria-label=message>` + `showModal()`. 버튼 순서 [취소][확인], 확인은 `rn-primary` 또는 `danger`면 `rn-danger`. Esc(`cancel` 이벤트)=false. 닫으면 DOM에서 제거 |
| `fmtDate` / `fmtDateTime` | `(ms) → string` | `Intl.DateTimeFormat("ko-KR", {dateStyle:"medium"})` / `+timeStyle:"short"`. 0·없음이면 빈 문자열 |
| `newId` | `() → string` | `Date.now().toString(36) + Math.random().toString(36).slice(2,10)` |
| `local` | `get(key, fallback)`, `set(key, value)`, `remove(key)` | localStorage 키 앞에 `renote:`, JSON 직렬화, 모든 예외 무시 |
| `caps` | `{ db, user, sample, downloads, assets, uid, me, canWrite }` | 가.3 |
| `ready` | `Promise<caps>` | 가.3 |
| `userPath` | `(sub) → "data/users/<uid>/<sub>"|null` | **쓰지 않는다**(계약). 남아 있을 뿐 |
| `userColl` | `(name) → Collection|null` | `db.collection("data/users/<uid>/<name>/items")` |
| `userDoc` | `(name) → Doc|null` | `db.doc("data/users/<uid>/<name>")` |
| `names` | `(ids) → Promise<{id: 이름}>` | 중복·빈 값 제거 후 `user.profiles(list)`. 이름이 없으면 「이름 없음」. user가 없거나 실패하면 `{}` |
| `shared` | `{ research: [], pains: [], loaded: {research, pains}, error, examplesOnly }` | 가.4 |
| `onShared` | `(fn) → 해제함수` | 등록 즉시 한 번 호출 |
| `view` | `view(name, { title, nav?, mount(root, params) → cleanup? })` | 등록. 등록 전에 `go`가 불렸으면(pendingRoute) 등록 순간 이동 |
| `go` | `go(name, params?, replace?)` | 가.5 |
| `start` | `()` | 주소 `#이름`이 최상위 화면이면 그것, 아니면 `home`으로 `go(…, {}, true)` |
| `current` | getter `{ name, params, cleanup }` | |
| `notice` | `notice(text, kind?) → <p class="rn-notice[ rn-<kind>]">` | `kind==="error"`면 `role="alert"`, 그 밖은 `role="status"` |
| `writeBlockedReason` | `() → string|null` | db·uid가 없으면 `connectionHelp()`, `canWrite`가 거짓이면 「보기 권한만 있어 쓸 수 없어요. 아티팩트 주인에게 참여 권한을 요청하세요.」, 쓸 수 있으면 null |
| `connectionHelp` | `() → string` | 독립 페이지면(가.6) 「지금은 둘러보기만 할 수 있어요. 이 주소를 직접 열면 Claude 로그인 정보가 전달되지 않아요. claude.ai의 아티팩트 화면에서 열어 주세요.」, 아니면 「지금은 둘러보기만 할 수 있어요. Claude에 로그인했더라도, 이 아티팩트를 만든 사람의 조직 계정이거나 초대받은 계정이어야 글을 쓰고 내 프로젝트를 만들 수 있어요.」 |
| `isStandalone` | `() → boolean` | `window.top === window.self`(예외면 false) |
| `badge` | `badge(text, kind?)` | `<span class="rn-badge rn-badge-<kind>">` (ok·warn·accent) |
| `field` | `field(label, control, hint?)` | control에 id가 없으면 `"f-"+newId()`를 붙이고 `<div class="rn-field"><label for>…</label>control<small>hint</small></div>` |
| `STAGES` | 객체 | `TOPIC:"주제선정", DESIGN:"설계", EXPERIMENT:"실험", ANALYSIS:"분석", REPORT:"보고서작성", OTHER:"기타"` (순서 그대로 선택지 순서) |
| `search`, `editor`, `chat` | 처음 `null` | 모듈이 채운다 |
| `editorPanels`, `projectSections` | 처음 `[]` | 모듈이 push |

모듈이 채우는 것:

| 이름 | 만드는 모듈 | 시그니처 · 설명 |
|---|---|---|
| `RN.search` | search | `(query, {limit=10, kinds?, excludeResearchIds?}) → {query, research[], pains[]}` 동기. 라.1 |
| `RN.searchExpanded` | search | `(query, terms, {limit=20, kinds?}) → {query, terms, usedTerms, research, pains}` 라.1.6 |
| `RN.recommend` | search | `(keywords[], limit=5, opts?) → {query, research, pains}` 라.1.5 |
| `RN.similarResearch` | search | `(id, limit=4) → research[]` 라.1.5 |
| `RN.searchUtil` | search | `{ normalize, trigramSeq, excerpt, tokenize, cleanTerms }` |
| `RN.markdown` | pains | `(source) → <div class="rn-md">` 라.10.4 |
| `RN.pains` | pains | `{ listFor({researchId?, projectId?}) → 배열, renderList(items) → Node }` |
| `RN.research` | research | `{ card(r), painList(items), sanitizeReport(html) → DocumentFragment }` |
| `RN.docs` | editor | 부록 가.2 아래 "에디터 API" 표(나.11 끝) |
| `RN.editor` | editor | 문서가 열려 있을 때만 non-null. 나.11.10 |
| `RN.autocomplete` | autocomplete | `{ attach(bridge) → cleanup, cleanCompletion, buildPrompt }` 라.6 |
| `RN.aiQuota` | chat | `{ take(), takeAutocomplete(), … }` 라.9.6 |
| `RN.aiAutocompleteLimit` | (설정값) | 자동완성 하루 한도를 바꾸는 전역(기본 200) |
| `RN.chat` | chat | `{ open(context) }` 라.9 |
| `RN.data`, `RN.convert` | data, convert | 나.11·라.7·라.8에서 설명 |

다른 모듈을 부를 때는 언제나 `RN.x && typeof RN.x.y === "function"`으로 확인하고, 없으면 대체 문구(예: 「검색 기능을 불러오지 못했어요.」)를 보인다.

### 가.3 아티팩트 런타임 기능과 대체 동작

`RN.ready`는 `window.claude.use(name)`을 `db, user, sample, downloads, assets` 다섯 개에 동시에 부르고(각각 실패하면 null), user가 있으면 `user.me()`로 `caps.me`·`caps.uid`, `user.can("data.write")`로 `caps.canWrite = can !== false && !!uid`를 정한다(예외면 비로그인으로 둠). `window.claude`가 없으면 전부 null. `permissions`는 core가 아니라 mod-autocomplete가 따로 `claude.use("permissions")`로 얻는다.

| 기능 | 쓰는 곳 | 쓰는 방법 | 없을 때(null) |
|---|---|---|---|
| `db` | core(공유 구독), pains, research, editor, data, chat, autocomplete(한도) | `collection(path).limit(n).onSnapshot(next, err)`, `.where/.orderBy/.limit/.get/.add/.doc`, `doc.get/set/update/delete/onSnapshot/collection` | core가 `seed.json`을 읽기 전용으로(가.4). 쓰기 버튼은 모두 숨기고 이유 문구(`writeBlockedReason`) |
| `user` | core(`me`, `can`), `RN.names`(`profiles`) | | 둘러보기. 이름 표시는 「익명」/「이름 없음」 |
| `sample` | research(의미로 더 찾기, `sample.json`), chat(챗봇), autocomplete(`modelTier:"quick"`) | `sample(input, {modelTier, signal, onText, tools…})`, `sample.json(...)` | "의미로 더 찾기" 버튼·챗봇 버튼·AI 도우미 탭이 생기지 않고 자동완성 토글은 비활성 + title 이유 |
| `downloads` | research(보고서 HTML·PDF 저장), editor(DOCX·HTML·MD 내보내기), convert(텍스트로 저장) | `save({filename, data})` → `{status:"saved"}`; 오류 code `declined`(사용자 취소: 조용히), `rate_limited`(「저장 창이 이미 열려 있어요. 잠시 뒤 다시 눌러 주세요.」), 그 밖(「이 화면에서는 파일을 저장할 수 없어요.」) | 저장·내보내기 버튼을 만들지 않는다 |
| `assets` | research(결과보고서 PDF) | `upload(file, {type:"application/pdf"}) → {id, url, sizeBytes}`, `delete(id)` | PDF 올리기 선택지 대신 「PDF 올리기는 이 페이지에서 파일 올리기 권한이 있는 사람만 쓸 수 있어요.」 |
| `permissions` | autocomplete(AI 동의) | `state("sample")` → granted/prompt/denied, `request(["sample"])`, `manage()` | 동의를 묻지 않고 바로 요청, 거절 코드가 오면 알림(라.6.7) |

`caps.canWrite`가 거짓이면(보기 권한만) 공유 데이터는 읽되 쓰기 버튼을 숨기고 「읽기 전용: …」 경고를 보인다.

### 가.4 공유 데이터 구독(`RN.shared`)
- `ready` 뒤 db가 **있으면** `research`·`pains` 각각 `db.collection(name).limit(1000).onSnapshot(...)`을 **core가 한 번만** 건다. 스냅샷마다 `shared[name] = docs.map(d => ({id: d.id, ...d.data()}))`, `loaded[name]=true`, `error=null`, 리스너 호출. 오류 콜백이면 `loaded=true`, `error = err.code || "error"`. 10초 안에 첫 스냅샷이 안 오면 `loaded=true`, `error="timeout"`.
- db가 **없으면** `examplesOnly=true`로 두고 같은 폴더의 `seed.json`을 fetch해 `"research/<id>"`, `"pains/<id>"` 키만 골라 배열에 넣는다. 실패하면 `error="signed_out"`. 끝나면 두 `loaded`를 true로.
- 모듈은 `research`/`pains` 전체를 다시 구독하지 않는다. 다른 공유 경로(`pains/{id}/reactions` 등)는 화면이 필요할 때만 구독한다.
- 화면들이 쓰는 상태 판정(`sharedBlocked`, research 모듈): `error==="signed_out"` → 경고 「연구와 고충은 Claude에 로그인한 사람에게만 보여요. 로그인한 뒤 다시 열어 주세요.」 / 아직 안 불러옴 → 「불러오는 중…」 / `timeout`이고 항목 0개 → 오류 「데이터에 연결하지 못했어요. 잠시 뒤 다시 열어 주세요.」 / 그 밖 오류이고 0개 → 「데이터를 불러오지 못했어요 (<code>).」 / 그 밖 → 표시.

### 가.5 화면 전환
- 최상위 화면 `TOP = ["home","explore","pains","projects","convert"]`. 주소는 `#이름`만(아티팩트가 `#name`만 넘긴다).
- `go(name, params, replace)`: 등록 안 된 이름이면 보류(등록되는 순간 이동). 이전 화면의 정리함수 실행 → `#rn-view` 비움 → 메뉴 링크 중 `data-view === (def.nav || name)`에 `aria-current="page"` → `body.dataset.view = name` → `mount(root, params)`(예외면 「화면을 그리지 못했어요: <메시지>」 `role=alert`) → 주소 해시를 최상위 이름(상세 화면은 `nav`)으로 `pushState`(replace면 `replaceState`) → `scrollTo(0,0)` → 화면의 첫 `<h1>`에 `tabIndex=-1` 주고 `focus({preventScroll:true})`(화면 전환 때 스크린 리더가 제목을 읽게).
- `hashchange`: 새 해시가 최상위 이름이고 지금 화면(또는 지금 화면의 nav)과 다르면 그 화면으로 `go(name, {}, true)`. 그래서 상세 화면에서 브라우저 "뒤로"를 누르면 해시가 바뀐 경우에만 목록으로 돌아간다(상세 → 상세 이동은 기록에 남지 않는다).
- 상세 화면 id는 params로만 넘긴다. 새로 고치면 상세 화면은 그 nav의 최상위 화면으로 돌아간다(주소에 id가 없으므로).

### 가.6 둘러보기·체험판 판정 (index.html 인라인 스크립트)
- `connected = caps.db && caps.uid`.
- `#rn-me` 글자: `caps.me.name`이 있으면 그 이름, 아니면 connected면 「연결됨」, 아니면 「둘러보기」. 비어 있으면 숨김(CSS `:empty`).
- `window.__renoteLocal`(=[W])이면 `#rn-me`=「체험판」, 띠 문구 「체험판이에요. 쓴 글과 문서는 이 브라우저에만 저장되고 다른 사람에게 보이지 않아요. AI 도우미와 PDF 올리기는 꺼져 있어요.」
- 그 밖에 connected가 아니면 `#rn-me.title = connectionHelp()`, 띠 문구 = `connectionHelp() + " 보이는 연구와 고충은 예시 데이터예요."`
- 띠(`#rn-banner`, `role=status`)에는 「닫기」 버튼(`aria-label="안내 닫기"`, `rn-ghost`)이 있고 누르면 그 세션에서만 숨는다(기억하지 않음).

### 가.7 [W] 웹 체험판 백엔드(`web-backend.js`)
- `window.__renoteLocal = true`, `window.claude = { use: async name => (await loaded, table[name] ?? null) }` — 모든 기능이 IndexedDB 적재가 끝난 뒤 돌아온다.
- 사용자: localStorage `renote-web:uid`(없으면 `"local-" + 랜덤 10자` 생성, 저장 실패면 `"local-guest"`). 이름 「나」, `isOwner/canEdit/can` 모두 true, 색 `#2343d3`, email null. `profiles(ids)`는 본인만 이름 「나」, 남은 빈 이름.
- db: 메모리 Map + IndexedDB(이름 `renote-web`, 버전 1, object store `docs`, 키=경로). 시작 때 전부 읽고, `research/`·`pains/`로 시작하는 키가 하나도 없으면 `seed.json`을 fetch해 모두 넣는다(실패하면 예시 없이 시작). 경로 규칙(문서 짝수·컬렉션 홀수 세그먼트) 위반은 TypeError, 256KiB(`JSON.stringify(data).length > 262144`) 초과는 `{code:"invalid_argument"}`, 없는 문서 `update`는 `invalid_argument`. 권한 검사는 없음. 쿼리는 `where`(`== != > >= < <= array-contains in not-in`), `orderBy(field, "desc"?)`, `limit(n)`. 구독 알림은 변경 뒤 한 틱에 한 번으로 모은다. `acquire()`는 항상 `{acquired:true}`.
- downloads: Blob → `URL.createObjectURL` → 숨긴 `<a download>` 클릭, 30초 뒤 revoke, `{status:"saved"}`.
- `sample`, `assets`는 null → AI·PDF 올리기 UI가 저절로 사라진다.
- `build-web.sh <출력>`: `core.js`, `mod-*.js`, `seed.json`, `web-backend.js` 복사. `index.html`은 `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>RESET</style></head><body><script src="web-backend.js"></script>` + 원본 index.html + `</body></html>`. RESET = `html{color-scheme:light}:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}`. `.nojekyll` 생성, 마지막에 출력 파일 수를 찍는다.

### 가.8 로컬 모크(`dev-mock.js`)와 개발 서버
- `node dev-server.mjs [포트=4100]` → `http://localhost:<포트>/dev.html`(또는 `/`). 서버가 위와 같은 RESET 뼈대에 `<script src="dev-mock.js">`를 먼저 넣고 index.html을 붙인다. 그 밖의 경로는 폴더 안 정적 파일(경로 탈출 금지, 없으면 404).
- 쿼리: `?user=u2|u3`(기본 u1; 이름 u1=김연구, u2=박탐구, u3=이실험 — 로컬 전용 가짜 이름), `?anon=1`(uid null → db·assets null), `?nosample=1`, `?noassets=1`, `?nopermissions=1`, `?consent=prompt|denied`.
- db: 메모리 + localStorage `renote-mock-db`. 경로 규칙 TypeError, 256KiB 초과 `invalid_argument`, 권한: uid 없으면 읽기·쓰기 모두 `not_granted`, `data/users/<남>/…`는 읽기·쓰기 `not_granted`. 쿼리 연산은 `== != > >= < <= array-contains in`.
- user: `isOwner/canEdit`는 u1만 true, `can()`은 uid가 있으면 true.
- sample(가짜): 호출마다 `__mockSampleAttempts++`. 동의 상태가 prompt면 첫 호출에서 묻고(`__mockConsentAsked++`, 30ms 뒤 `__mockConsentAnswer`: grant(기본)/deny/dismiss), granted가 아니면 `{code:"not_granted"}`. 프롬프트에 `<before_cursor>`가 있고 `__mockSample`이 없으면 자동완성 흉내: `__mockAutocompleteCalls++`, `__mockAutocompletePrompt` 저장, `__mockAutocompleteDelay`(기본 50ms) 뒤 signal 확인(취소면 `cancelled`), 앞 글이 `.!?`로 끝나면 「 이를 통해 실험 조건이 결과에 미치는 영향을 확인할 수 있었다.」, 공백으로 끝나면 「측정값의 변화 경향을 비교하여 분석하였다.」, 그 밖은 앞에 공백을 붙인 같은 문장. 그 밖 호출은 `__mockSample(text, opts, input)`의 답 또는 「가짜 AI 응답: <앞 60자>」. 빈 답은 `{code:"empty_completion"}`. `onText`가 있으면 한 번에 전체를 넘긴다. `sample.json`은 답을 JSON.parse(실패 null), `sample.limits()`는 `{images:true}`.
- permissions(가짜): `state(name)`, `request(names)`(prompt면 물음), `manage()`(`__mockManageOpened++`, `__mockManageGrants`면 granted로).
- downloads(가짜): `window.__downloads`에 `{filename, data}`를 쌓고 saved. assets(가짜): 32자 16진 id, blob: URL, `window.__mockAssets`(Map).
- 테스트 도구: `window.__mockDb.reset()`, `__mockDb.seed({경로: 문서})`.

## 부록 나. 화면별 상세 명세 [A][W]

### 나.1 공통 틀
- **머리**(`#rn-header`, sticky, 흰 표면 + 아래 구분선): 로고 `Re: Note`(콜론만 강조색, 링크 `#home`, `aria-label="Re: Note 처음으로"`), 메뉴 `nav#rn-nav aria-label="주요 메뉴"`: 「연구 탐색」(#explore) 「고충 게시판」(#pains) 「내 프로젝트」(#projects) 「한글 파일 열기」(#convert). 현재 화면은 `aria-current="page"`(연한 강조 알약). 오른쪽 `#rn-me`(`aria-live=polite`). 메뉴 링크는 일반 `<a href="#…">`라서 hashchange로 이동한다(가.5).
- **좁은 화면(≤560px)**: h1 1.45rem, 본문 위아래 여백 22/88px, 로고가 한 줄을 차지하고 메뉴가 다음 줄 전체 폭에 가로 스크롤(스크롤바 숨김, 줄바꿈 없음).
- **본문** `main#rn-view`: 최대 폭 1120px(에디터 화면 1320px), 좌우 여백 `max(16px, safe-area)`, 위아래 32/96px, 세로 flex `gap 24px`, 최소 높이 60vh.
- **토스트** `#rn-toast`: 화면 아래 가운데 고정 알약, `role=status aria-live=polite`, 4초.
- **확인 창**: 가.2 `confirm`. 모든 삭제·공개·되돌리기는 이 창을 거친다(브라우저 `confirm`은 아티팩트에서 항상 false).
- **로딩/비어 있음/오류**: 한 줄 `RN.notice`. 오류는 빨간 글자 `role=alert`, 경고는 노란 배경 상자.

### 나.2 `home` — 처음
진입: 주소 없음·`#home`·로고 클릭. 위에서 아래로:
1. 영웅 구역(`section.home-hero`, 가운데 정렬, 뒤에 22px 간격 점 격자가 가운데에서 바깥으로 옅어지는 무늬):
   - `<h1>` 「비슷한 연구를 찾고, <mark>막힌 점</mark>을 나눠요」(mark는 형광펜 밑줄 모양)
   - 설명 「먼저 해 본 사람의 한계와 고충을 읽고, 내 보고서는 여기서 바로 씁니다.」
   - 검색 폼(`role=search`, 알약 모양): 숨긴 라벨 「연구·고충 검색」, `input#home-q type=search placeholder="키워드로 연구·고충 찾기 (예: 음향 블랙홀)" autocomplete=off`, 주 버튼 「검색」. 제출하면 앞뒤 공백을 자른 값이 비었으면 입력에 포커스만, 아니면 `RN.go("explore", {q})`.
   - 통계 줄(`p.home-stats`, 고정폭 글꼴, `aria-live=polite`): 공유 데이터가 둘 다 불러와지고 오류가 없을 때만 「연구 N건 · 고충 M건」, 아니면 빈 줄.
2. 바로 가기(`nav aria-label="바로 가기"`, 3열 → 620px 이하 1열): 「연구 탐색」/「공개된 연구의 요약과 한계, 결과보고서」, 「고충 게시판」/「실험하다 막힌 점을 묻고 답하기」, 「내 프로젝트」/「보고서 쓰기, 표·그래프, 연구 공개」. 제목 오른쪽에 강조색 「→」.

### 나.3 `explore` — 연구 탐색
진입: 메뉴, `RN.go("explore", {q?})`. 구성:
1. `<h1>` 「연구 탐색」, 설명 「이 사이트에 공개된 연구와 고충 글에서만 찾아요.」
2. 검색 폼: 숨긴 라벨 「검색어」, `input#explore-q placeholder="키워드 (예: 음향 블랙홀 진동 감쇠)"`(params.q로 채움), 주 버튼 「검색」, 그리고 `sample`이 있을 때만 「의미로 더 찾기」(`#explore-expand`, title 「AI가 관련 표현을 골라 주면, 그 표현들로 이 사이트를 더 찾아요(AI 요청 1회)」). 제출하면 검색어가 바뀐 경우 확장 결과를 버리고 다시 그린다.
3. 결과 영역 `#explore-results`(`aria-live=polite`), 공유 데이터가 바뀔 때마다 다시 그림:
   - 상태 판정(가.4)에 걸리면 그 안내만.
   - 검색어 없음: `<h2>` 「최근 공개된 연구」 + `publishedAt` 내림차순 30개. 0개면 `#explore-empty` 「아직 이 사이트에 등록된 연구가 없어요」.
   - 검색어 있음: `RN.search(q, {limit:20})`(확장 결과가 이 검색어의 것이면 `RN.searchExpanded(q, terms, {limit:20})`). 첫 줄 「“<정리된 검색어>” 검색 결과 — 연구 N건 · 고충 M건」. 확장이면 `#explore-terms` 「이런 표현으로도 찾았어요: a, b, …」(정리된 표현 전부). 연구가 있으면 연구 목록, 없으면 `#explore-empty`(`role=status`) 「아직 이 사이트에 등록된 연구가 없어요」 + 보조 한 줄: 고충이 있으면 「비슷한 연구는 없지만, 관련된 고충 글은 있어요.」, 확장 버튼이 있고 아직 확장 안 했으면 「다른 키워드로 찾거나 ‘의미로 더 찾기’를 눌러 보세요.」, 그 밖 「다른 키워드로 찾아보거나, 고충 게시판에 먼저 물어보세요.」. 고충이 있으면 `section#explore-pains` `<h2>` 「관련 고충 N건」 + 고충 목록. **유사도 점수는 정렬에만 쓰고 표시하지 않는다.**
4. 연구 항목(`article.rs-item.rs-card`, 구분선 목록): 제목 버튼(디스플레이 글꼴, 강조색, → `research{id}`), 요약 200자 발췌 2줄 말줄임, 메타 한 줄 「분야 · 고충 N건 · 결과보고서 있음 · #키워드 #키워드 #키워드」(빈 값 생략, 키워드 최대 3개) + 예시면 끝에 노란 작은 「예시」. 고충 수는 익명 제외.
5. 고충 항목(`li.rs-item`): 작은 제목 버튼(→ `pain{id}`), 발췌 2줄(검색 결과면 160자, 아니면 140자), 메타 「단계 · 해결됨|미해결 · #태그×3」 + 「예시」.
6. "의미로 더 찾기" 동작(라.1.6): 검색어가 비었으면 입력에 포커스 + 토스트 「먼저 검색어를 적어 주세요.」. 누르면 버튼 비활성·글자 「찾는 중…」. `RN.aiQuota.take()`가 false면 「오늘 쓸 수 있는 AI 요청을 모두 썼어요. 내일 다시 써 주세요.」. 오류: `cancelled`는 조용히, 끄는 코드(`not_granted, sampling_disabled, not_declared, capability_disabled, capability_removed`)면 버튼을 없애고 「이 화면에서는 AI 기능을 쓸 수 없어요.」, `rate_limited`면 「AI 요청이 많아요. 잠시 뒤 다시 눌러 주세요.」, 그 밖·표현 0개면 「관련 표현을 받지 못했어요. 다시 눌러 보세요.」. 응답이 오는 사이 검색어가 바뀌었으면 버린다.

### 나.4 `research` — 연구 상세 (nav: explore)
진입: `RN.go("research", {id})`. 공유 목록에 없으면(방금 공개) `db.collection("research").doc(id).get()`을 한 번 시도하고 그동안 「불러오는 중…」. id 없음 → `<h1>` 「연구 상세」 + 「연구를 고르지 않았어요.」 + 「← 연구 탐색으로」. 못 찾음 → `<h1>` 「연구를 찾을 수 없어요」 + 「삭제되었거나 주소가 잘못되었어요.」 + 같은 버튼. 같은 내용이면 다시 그리지 않는다(PDF 뷰어 상태·스크롤 유지; 비교 키 = 연구 원본 + 연결 고충의 id·제목·해결·단계 + 연구 수).
구성(최대 폭 860px, 구역 간격 30px):
1. 머리: 작은 링크 「← 연구 탐색」, `<h1>` 제목(없으면 「(제목 없음)」), 메타 「분야 · 공개 <날짜> · 공개한 사람 <이름> · #키워드…」 + 「예시」. 이름은 authorId가 있을 때 `RN.names`로 나중에 채운다.
2. `#research-summary` 「요약」(줄바꿈 유지, 없으면 「요약이 없어요.」).
3. `#research-limitations` 「한계」(없으면 「적힌 한계가 없어요.」).
4. `#research-report` 「결과보고서」: 우선순위 **PDF > HTML > 없음**.
   - PDF(`reportAsset`이 유효할 때, 라.11.3): 파일 이름 · 크기(「1.2MB」/「340KB」), `downloads`가 있으면 「PDF 저장」(`#research-pdf-save`), 상태 「미리보기를 여는 중…」, 쪽 캔버스들(`role=img aria-label="N쪽"`), 「다음 쪽 더 보기 (n/총)」(`#research-pdf-more`). 실패하면 `#research-pdf-error` 경고 「미리보기를 열 수 없어요」, 캔버스 지움(저장 버튼은 남음).
   - HTML(`report.html`): `downloads`가 있으면 제목 옆 「HTML로 저장」(`#research-report-save`), 보고서 제목 한 줄, 흰 "종이"(`#research-report-paper`, `role=document aria-label="결과보고서 본문"`, Noto Serif KR, 줄 간격 1.7, 안쪽 여백 `clamp(16px,5vw,48px)`, 가로 넘치면 스크롤)에 허용 목록 정리(라.11.2)를 거친 DOM.
   - 없음: 「등록된 결과보고서가 없어요.」
   - 작성자 본인이고 업로드 가능하면 그 아래 「PDF 올리기」/「PDF 바꾸기」(라.11.4).
5. `#research-pains` 「연결된 고충 N건」(익명 제외) + 쓸 수 있으면 오른쪽 「고충 남기기」(ghost, → `pain-edit{researchId}`). 0건이면 「이 연구에 연결된 고충 글이 아직 없어요.」, 있으면 `RN.pains.renderList`.
6. `#research-similar` 「비슷한 연구」: `RN.similarResearch(id, 4)`, 없으면 「이 사이트에 비슷한 연구가 아직 없어요.」
7. 작성자 본인 + 쓰기 권한이면 오른쪽 아래 「삭제」(`#research-delete`, danger). 확인 문구 「이 연구 공개를 취소하고 삭제할까요? 연결된 고충 글은 남아요.」(+PDF가 있으면 「 올린 결과보고서 PDF도 함께 지워요.」), 확인 버튼 「삭제」. 성공하면 PDF 자산도 지우고 「연구를 삭제했어요.」 → `explore`. 실패 「삭제하지 못했어요 (<code>).」

### 나.5 `publish` — 연구 공개 (nav: projects)
진입: 프로젝트 홈의 「공개」 → `RN.go("publish", {projectId})`.
1. `<h1>` 「연구 공개」, 설명 「공개하면 로그인한 모든 사람이 검색하고 볼 수 있어요.」
2. 쓸 수 없으면 경고 한 줄(`writeBlockedReason`)로 끝. projectId 없음 → 「공개할 프로젝트를 먼저 고르세요.」 + 「내 프로젝트로」. 불러오는 동안 「프로젝트를 불러오는 중…」, 10초 안에 못 그리면 「프로젝트를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.」, 없으면 「프로젝트를 찾을 수 없어요.」
3. 폼(`#publish-form`, 최대 폭 680px). 필드 기본값은 프로젝트에서:
   | id | 라벨 | 종류·제약 | 기본값 |
   |---|---|---|---|
   | `pub-title` | 제목 | text, maxLength 200, 필수 | 프로젝트 제목 |
   | `pub-field` | 분야 | text, maxLength 50, placeholder 「예: 물리」 | 프로젝트 분야 |
   | `pub-summary` | 요약 | textarea, maxLength 4000, 필수, placeholder 「무엇을, 어떻게 했고, 무엇을 알아냈는지」 | 프로젝트 설명 |
   | `pub-keywords` | 키워드 (힌트 「쉼표로 구분해요.」) | text, placeholder 「예: 음향 블랙홀, 진동 감쇠」 | 프로젝트 키워드를 「, 」로 |
   | `pub-limitations` | 한계 | textarea, maxLength 4000, placeholder 「하지 못한 것, 오차, 다음 사람이 조심할 점」 | 빈 값 |
   - 결과보고서 `fieldset#pub-report-choice`(legend 「결과보고서」), 라디오 `name=pub-report-kind`: 「내 문서에서 만들기」(doc; 휴지통 아닌 문서가 없으면 비활성), 「PDF 파일 올리기」(pdf; 업로드 가능할 때만 보임), 「없이 공개」(none). 기본은 문서가 있으면 doc, 아니면 none. 안내: 문서 기능이 없으면 「문서 기능을 불러오지 못했어요.」, 문서가 없으면 「이 프로젝트에 문서가 없어요.」, 업로드 불가면 `#pub-pdf-unavailable` 「PDF 올리기는 이 페이지에서 파일 올리기 권한이 있는 사람만 쓸 수 있어요.」
   - doc 선택 시 `select#pub-report`(라벨 「결과보고서로 쓸 문서」, 문서 제목 또는 「(제목 없는 문서)」, 힌트 「지금 내용이 공개돼요. 나중에 문서를 고쳐도 공개본은 그대로예요.」).
   - pdf 선택 시 `input#pub-pdf type=file accept="application/pdf,.pdf"`(라벨 「결과보고서 PDF」), 안내 `#pub-pdf-note` 기본 「20MB 이하 PDF」, 고르면 검사(라.11.3) 결과 또는 「<이름>.pdf · <크기>」.
   - 버튼 줄: 「취소」(ghost, → `project{id}`), 주 버튼 「공개」(`#pub-submit`). 상태 줄 `#pub-status`(`role=status`).
4. 제출 규칙은 라.11.1.

### 나.6 `pains` — 고충 게시판
1. 머리 줄: `<h1>` 「고충 게시판」 + 쓸 수 있으면 주 버튼 「글쓰기」(`#pains-new` → `pain-edit{}`). db는 있는데 못 쓰면 경고 「읽기 전용: <이유>」(db가 없으면 머리의 안내 띠가 대신한다).
2. 도구 줄(`form role=search`, 제출은 막음): 숨긴 라벨 「검색」 + `input#pains-q type=search placeholder="제목·본문 검색"`(입력할 때마다 바로 거름), 정렬 버튼 묶음(`role=group aria-label="정렬"`) 「최신순」(`#pains-sort-latest`)·「공감순」(`#pains-sort-popular`, `aria-pressed`로 상태), 「필터」(`#pains-filter-toggle`, `aria-expanded`, `aria-controls=pains-filters`; 적용된 필터가 n개면 글자 「필터 n」, aria-label 「필터 (n개 적용됨)」).
3. 필터 상자 `#pains-filters`(처음 숨김): `select#pains-stage` 「연구 단계」(전체 + STAGES 6개), `select#pains-field` 「분야」(전체 + 모든 고충의 분야를 한국어 정렬), `select#pains-tag` 「태그」(전체 + 모든 태그), 「필터 지우기」(`#pains-filter-clear`, 적용된 필터가 있을 때만; 누르면 셋 다 비우고 필터 버튼에 포커스). 선택지는 데이터가 바뀌면 다시 만들되 고른 값이 사라지면 「전체」로.
4. 상태 줄(`role=status`): 「N건 · p/P쪽」.
5. 목록 `ul#pains-list`(카드 없이 구분선): 항목마다 `<h2><a href="#pains">제목</a></h2>`(클릭 → `pain{id}`), 본문 발췌(한 줄 말줄임, 160자), 메타 「단계 · 분야 · 공감 N」 + 「 · 해결됨」(초록 굵게) + 「 · 내 글」 + 「 · 예시」(작게).
6. 쪽 넘김(20개/쪽, 2쪽 이상일 때): 「이전」(`#pains-prev`) 「p / P」 「다음」(`#pains-next`), 누르면 맨 위로 스크롤.
7. 상태: 불러오는 중 「고충 목록을 불러오는 중…」 / 걸러서 0건 「조건에 맞는 고충이 없어요. 검색어나 필터를 바꿔 보세요.」 / 원래 0건 「아직 올라온 고충이 없어요. 첫 글을 남겨 보세요.」 / `signed_out` → 쓰기 막힘 이유(경고) / `timeout` 0건 「고충 목록을 아직 불러오지 못했어요. 연결 상태를 확인해 주세요.」, 항목이 있는데 timeout이면 목록 위에 경고 「목록이 최신이 아닐 수 있어요.」 / 기타 오류 「고충 목록을 불러오지 못했어요.」
8. 검색·정렬 규칙은 라.10.1.

### 나.7 `pain` — 고충 상세 (nav: pains)
위에서 아래: 「← 고충 목록」 링크 → `<h1>` 제목 → 한 줄 「작성자 · 날짜( (수정됨)) · 단계 · 분야 · #태그… · 내 글 · 예시」 → (해결됨이면) 초록 상자 `#pain-resolution-box`(`aria-label="해결 방법"`, 굵은 「해결됨 · 해결 방법」 + 해결 방법 마크다운) → 본문 `article#pain-body`(마크다운) → (실명이고 연결된 연구가 있으면) 「연결된 연구: 」 + 링크 버튼 `#pain-research`(연구 제목, 공유 목록에 없으면 「연구 보기」) → (못 쓰면) 경고 「읽기 전용: …」 → 동작 줄.
- 작성자 표시: 예시면 「예시 데이터」, 익명이거나 authorId가 없으면 「익명」, 그 밖은 이름(처음엔 「…」, `RN.names`로 채움, 캐시).
- "수정됨"은 `updatedAt`이 있고 `createdAt`과 다를 때. 해결됨 표시·취소도 updatedAt을 바꾸므로 「(수정됨)」이 붙는다.
- 동작 줄: 쓸 수 있고 **내 글이 아니면** 주 버튼 「나도 겪었어요 N」(`#pain-metoo`, `aria-pressed`, 숫자는 `#pain-metoo-count`), 그 밖(내 글·읽기 전용)은 글자 「나도 겪었어요 N」(`#pain-metoo-count-ro`). 쓸 수 있으면 오른쪽 끝 「⋯」 메뉴(`#pain-more`, aria-label 「글 메뉴」): 내 글이면 「수정」(`#pain-edit`), 「해결됨으로 표시」(`#pain-resolve`) 또는 「해결 취소」(`#pain-unresolve`), 「삭제」(`#pain-delete`, 빨강). 남의 글이면 「신고」(`#pain-report`). 처리 중에는 해당 항목·공감 버튼 비활성.
- N은 반응 하위 컬렉션을 구독해 센 수(구독 실패면 공유 문서의 `meTooCount`).
- 다시 그릴 때 열린 메뉴와 포커스 위치를 되살린다.
- 못 찾음: `<h1>` 「고충을 찾을 수 없어요」 + 「지워졌거나 없는 글이에요.」(오류 상태면 오류 안내). 아직 안 불러옴: `<h1>` 「고충」 + 「불러오는 중…」.
- **댓글 구역은 없다.**
- 동작 규칙은 라.10.2.

⋯ 메뉴(`moreMenu`) 키보드: 버튼에서 ↓=열고 첫 항목, ↑=열고 끝 항목, Esc=닫기. 메뉴 안에서 ↓↑ 순환, Home/End, Esc=닫고 버튼으로 포커스, Tab=닫기. 항목은 `role=menuitem tabIndex=-1`, 비활성 항목은 건너뜀. 바깥 pointerdown이면 닫힘. 메뉴 `role=menu aria-labelledby=<버튼 id>`, 버튼 `aria-haspopup=menu aria-expanded aria-controls`.

### 나.8 `pain-edit` — 고충 쓰기/수정 (nav: pains)
params `{id?, projectId?, researchId?}`. `<h1>` 「고충 쓰기」/「고충 수정」, 위에 「← 돌아가기」(수정이면 상세로, 아니면 목록으로). 못 쓰면 경고 한 줄로 끝. 수정인데 아직 불러오는 중이면 「불러오는 중…」, 없으면 「지워졌거나 없는 글이에요.」, 내 글이 아니면 「내가 쓴 글만 고칠 수 있어요.」(둘 다 오류).
폼(`novalidate`):
| id | 라벨 | 종류·제약 | 비고 |
|---|---|---|---|
| `pain-title` | 제목 | text, maxLength 200, 필수 | 처음 포커스 |
| `pain-body` | 본문 | textarea rows 10, maxLength 20000, 필수 | 라벨 옆 「미리보기」 토글(`#pain-preview-toggle`, aria-pressed) → `#pain-preview`에 마크다운 렌더(입력마다 갱신, 비었으면 「미리 볼 내용이 없어요.」) |
| `pain-stage` | 연구 단계 | select STAGES | 기본 「기타」(OTHER) |
| `details#pain-more-settings` | 「추가 설정」 + 요약 힌트(` · 분야, 태그, 익명, 연구 연결, 프로젝트 연결` 중 설정된 것) | | 수정 중인 글에 분야·태그·익명·연구가 있거나 params.researchId가 있으면 펼친 채 |
| `pain-field` | 분야 | text, maxLength 100, placeholder 「예: 물리, 생명과학」, `datalist#pain-field-list`(기존 고충 분야들) | |
| `pain-tags` | 태그 (힌트 「쉼표로 구분, 최대 10개」) | text, placeholder 「쉼표로 구분 (예: 통계, 설문)」 | 쉼표·줄바꿈으로 나누고 앞의 `#` 제거, 중복 제거 |
| `pain-anon` | 익명으로 올리기 | checkbox | 켜면 연구 선택을 비우고 비활성 |
| `pain-research` | 연결할 연구 | select: 「연결 안 함」 + **내가 공개한 연구만** | 힌트 `#pain-research-hint`: 익명이면 「익명 글은 공개 연구에 연결할 수 없어요(작성자가 드러나요).」, 내 연구가 없으면 「내가 공개한 연구가 없어요.」(비활성), 그 밖 「내가 공개한 연구만 고를 수 있어요.」 |
| `pain-project` | 연결할 내 프로젝트 (나만 보여요) | select: 「연결 안 함」 + 휴지통 아닌 내 프로젝트 | `RN.docs.listProjects` 결과로 나중에 채움. 원하는 프로젝트가 목록에 없으면 「현재 프로젝트」 선택지를 덧붙임 |
- 오류 줄 `#pain-form-error`(`role=alert`), 저장 버튼 `#pain-save` 「올리기」/「저장」.
- 검사 문구: 「제목을 입력해 주세요.」 「본문을 입력해 주세요.」 「태그는 10개까지 넣을 수 있어요.」 「태그 하나는 30자까지예요.」 「내가 공개한 연구만 연결할 수 있어요.」(태그·연구 오류면 추가 설정을 펼침).
- 저장 규칙은 라.10.3.

#### 가.2-1 `RN.docs` (mod-editor)
| 이름 | 설명 |
|---|---|
| `listProjects()` | 내 프로젝트 전부 get(10초 제한) → 휴지통 아닌 것, `updatedAt` 내림차순 |
| `listDocs(projectId)` | `where("projectId","==",id)` → 휴지통 아닌 것, `updatedAt` 내림차순 |
| `getDoc(docId)` | 문서 하나(없거나 로그인 안 했으면 null) |
| `createDoc(projectId, {title, content | markdown | text, reason?, formatRules?}) → docId` | 새 문서. 제목 기본 「제목 없는 문서」(200자). markdown이면 그림 맞추기(라.5.5)와 `lastImportInfo = {imagesKept, imagesSkipped}`. 문서 레코드 UTF-8 JSON이 256KiB를 넘으면 오류 「문서가 256KiB를 넘어 저장할 수 없어요. 큰 그림이나 표를 줄여 주세요.」. `reason:"IMPORT"`면 스냅샷 「가져오기」(IMPORT)를 하나 남긴다. 프로젝트 `updatedAt` 갱신(실패 무시) |
| `exportHtml(doc)` | 결과보고서용 본문 HTML 조각(200KiB 한도, 넘으면 큰 그림을 빼고 토스트 「보고서 HTML이 200KiB를 넘어 큰 그림 N개를 뺐어요.」) |
| `exportMarkdown(doc)` | 라.5.1 |
| `exportDocx(doc) → Blob` | 라.5.4, MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `lastImportInfo` | 마지막 createDoc의 그림 처리 결과 |
| (그 밖) | `_cleanCompletion` 등 나.11 끝 표 |
`doc`은 `{content, formatRules, title}` 레코드나 `{blocks}` 둘 다 받는다. 서식 규칙이 없으면 기본 규칙.

### 나.9 `projects` — 내 프로젝트
1. 머리: `<h1>` 「내 프로젝트」 + 주 버튼 「새 프로젝트」(`#proj-new`, `aria-expanded`, `aria-controls=proj-form`; 못 쓰면 비활성).
2. 로그인·db 없음: 「로그인하면 내 프로젝트를 만들고 문서를 쓸 수 있어요. 프로젝트와 문서는 나만 볼 수 있어요.」만.
3. 만들기 폼 `#proj-form`(처음 숨김, `aria-label="새 프로젝트"`, 열면 제목에 포커스, 「새 프로젝트」 버튼은 숨김): `#proj-title` 「제목」(maxLength 120, 필수), `#proj-desc` 「설명」(textarea rows 3, 2000자), `#proj-field` 「분야」(40자, placeholder 「예: 물리, 생명과학」), `#proj-keywords` 「키워드」(300자, placeholder 「쉼표로 구분」, 힌트 「쉼표(,)로 여러 개」) / 「취소」(ghost) · 「만들기」(`#proj-create`). 제목이 비면 토스트 「제목을 입력하세요.」. 키워드는 `[,，、\n]`로 나눠 최대 12개. 저장 문서 `{title, description, field, keywords, archivedAt:null, deletedAt:null, createdAt, updatedAt}` → 「프로젝트를 만들었어요.」 → `project{id}`.
4. 쓰기 막힘 이유가 있으면 경고 한 줄.
5. 목록(구분선, `aria-live=polite`): 기본 탭 "진행 중"(휴지통·보관 아님). 항목 = 제목 링크(→ `project`; 휴지통 탭은 글자만) / 설명 한 줄 말줄임(title에 전문) / 「분야 · 수정 <날짜 시각>」(휴지통 탭은 「삭제함 <날짜> · N일 뒤 영구 삭제」). 정렬은 `updatedAt` 내림차순(휴지통은 `deletedAt` 내림차순).
   - 보관함 탭: 각 항목에 「보관 해제」. 휴지통 탭: 「복구」(「프로젝트와 문서를 복구했어요.」), 「영구 삭제」(danger, 확인 「“<제목>”와 안의 문서를 영구 삭제할까요? 되돌릴 수 없어요.」, 버튼 「영구 삭제」 → 문서·스냅샷·프로젝트 삭제).
   - 아래 링크 줄(`p.rn-pj-links`): 지금 탭이 아닌 「보관함 (n)」 · 「휴지통 (n)」. 보관함·휴지통 탭에서는 위에 `<h2>` 탭 이름 + 「← 진행 중인 프로젝트」.
   - 빈 상태: 진행 중 「아직 프로젝트가 없어요. ‘새 프로젝트’로 시작하세요.」, 보관함 「보관한 프로젝트가 없어요.」, 휴지통 「휴지통이 비어 있어요. 삭제한 프로젝트는 30일 동안 여기에 있어요.」
   - 첫 스냅샷이 10초 안에 안 오면 「프로젝트를 불러오지 못하고 있어요. 연결을 확인해 주세요.」. 첫 스냅샷에서 30일 지난 휴지통 항목을 영구 삭제하고 목록에서 뺀다.
6. 프로젝트 컬렉션 전체를 구독한다(정리함수에서 해제).

### 나.10 `project` — 프로젝트 홈 (nav: projects)
params `{id}`. 「← 내 프로젝트」 링크 + `<h1>`(프로젝트 제목). 로그인 없음 → 9번과 같은 안내. 못 찾음 → `<h1>` 「프로젝트를 찾을 수 없어요」 + 「없거나 내 프로젝트가 아니에요. 프로젝트는 만든 사람만 볼 수 있어요.」
1. 소개: (휴지통이면) 경고 상자 「휴지통에 있는 프로젝트예요. N일 뒤 영구 삭제돼요. 」 + 「복구」(`#proj-restore`, → 「복구했어요.」), 설명(흐린 글자), 배지 「보관됨」(warn)·분야.
2. 탭 목록(`role=tablist aria-label="프로젝트"`, 밑줄 탭, 가로 스크롤): 「문서」(기본) + `RN.projectSections`에 등록된 섹션들(등록 순서 = 스크립트 순서: **고충**(pains) · **연구 공개**(research) · **데이터**(data) · **가져오기**(convert)) + 「설정」. 탭 버튼 `#ptab-<id>`(섹션은 `s-<섹션id>`), 패널 `#ppanel-<id>`(`role=tabpanel`, 섹션 패널은 `<section data-section>`). ←/→ 순환, Home/End, 선택된 탭만 `tabIndex=0`(로빙 탭 인덱스). 패널은 **처음 열 때 한 번만 mount**하고 정리함수를 모은다. 섹션 mount 예외면 「이 영역을 그리지 못했어요.」
3. 「문서」 탭: 「문서 N개」(`#proj-doc-count`) + 주 버튼 「새 문서」(`#proj-new-doc`; 못 쓰거나 휴지통이면 비활성) → `createDoc(id, {title:"제목 없는 문서"})` → 에디터. 문서 줄(`.rn-doc-row`): 제목 링크(→ `editor{projectId, docId}`) + 「수정 <날짜 시각>」 + 「삭제」(ghost, `aria-label="“<제목>” 삭제"`, 확인 「“<제목>”를 휴지통으로 옮길까요? 30일 안에 복구할 수 있어요.」 버튼 「휴지통으로」 → `deletedAt=now`). 비면 「아직 문서가 없어요. ‘새 문서’로 시작하세요.」(프로젝트가 휴지통이면 「문서도 휴지통에 있어요.」). 아래 `<details>` 「휴지통의 문서 (n)」: 줄마다 「제목 · N일 뒤 영구 삭제」 + 「복구」. 10초 안에 못 받으면 「문서를 불러오지 못하고 있어요.」. 첫 스냅샷에서 30일 지난 문서를 영구 삭제.
4. 「설정」 탭(휴지통이거나 못 쓰면 그 이유 한 줄; 휴지통이면 「휴지통에 있는 프로젝트는 고칠 수 없어요. 먼저 복구하세요.」): 폼 `#proj-edit-form` — `#pe-title` 「제목」(120자), `#pe-desc` 「설명」, `#pe-field` 「분야」(40자), `#pe-keywords` 「키워드」(300자, 힌트 「쉼표로 구분」), 주 버튼 「저장」(`#proj-save`, → 「저장했어요.」). 그 아래 두 줄: 「끝난 프로젝트는 보관함으로 옮겨 목록을 가볍게 해요.」 + 「보관」(`#proj-archive`; 보관 중이면 「보관함에서 꺼내 진행 중 목록으로 돌려요.」 + 「보관 해제」, 토스트 「보관함으로 옮겼어요.」/「보관을 해제했어요.」) / 「휴지통으로 옮기면 30일 뒤 문서와 함께 영구 삭제돼요.」 + 「삭제」(`#proj-delete`, danger, 확인 「“<제목>”를 휴지통으로 옮길까요? 안의 문서도 함께 옮겨지고, 30일 안에 복구할 수 있어요.」 버튼 「휴지통으로」 → 「휴지통으로 옮겼어요. 30일 안에 복구할 수 있어요.」 → `projects`).
5. 섹션 각각은 라.10.5(고충), 라.11.5(연구 공개·추천), 라.7(데이터), 라.8(가져오기).

### 라.2 에디터 입력 모델 (mod-editor 10장)
본문 전체가 contenteditable 하나(`#ed-blocks`)이고, 그림·표·수식·목차는 그 안의 `contenteditable=false` 덩어리다. 편집은 `beforeinput`(inputType, getTargetRanges)에서 가로채 **모델(블록 JSON)을 고치고 바뀐 블록만 다시 그린다**. 한글 조합(IME) 중에는 브라우저에 맡기고 `compositionend`에서 DOM을 읽어 모델에 옮긴다.

#### 라.2.2 줄 모델 (순수)
- 글 블록 하나 = 줄 하나, **목록은 항목마다 한 줄**(`type:"item"`, `listId`, `ordered`, `item`), 코드 블록은 글 줄(`type:"code"`, 글자 하나), 그림·표·수식·목차는 **원자 줄**(길이 1: 앞 0, 뒤 1).
- 위치 `{line, off}`(off는 글자 수, 인라인 수식·참조·줄바꿈은 1칸). `flattenBlocks`/`unflattenLines`로 오간다(이어지는 같은 `listId` 항목을 한 목록으로 묶고, 겹치는 id는 새로 만든다).
| 동작 | 규칙 |
|---|---|
| 범위 삭제 `linesDelete` | 한 줄 안이면 그 부분만. 원자 줄 전체(0→1)를 지우면 빈 문단으로 바꿈. 여러 줄이면 첫 줄 앞부분 + 끝 줄 뒷부분을 합침(첫 줄 종류를 따름; 코드로 합칠 때는 글자로). 첫 줄이 원자면 끝 줄을 남기거나, 남는 글 줄이 없으면 빈 문단을 넣는다 |
| 글자 넣기 `linesInsertText` | 커서 앞 글자의 굵게·기울임을 이어받음(코드 줄은 서식 없음). 원자 줄 위에서는 앞(off 0)/뒤(off 1)에 새 문단 |
| 여러 줄 넣기 `linesInsertMulti`(붙여넣기·바꾸기) | 줄마다 새 문단(목록 안이면 새 항목, 인용 안이면 인용). 가운데 빈 줄은 버림. 첫 줄은 커서 자리에 붙이고 원래 뒷부분은 마지막 줄 끝에. 코드 줄에는 그대로 |
| Enter `linesSplit` | 원자 줄 위면 앞/뒤에 빈 문단. 코드 줄은 `\n` 글자. **빈 목록 항목에서 Enter → 목록 밖 빈 문단**. 줄 맨 앞(내용 있음)이면 위에 빈 줄(항목이면 빈 항목). 그 밖은 나누고 뒷부분은 새 문단(제목·캡션 뒤도 문단; 인용은 인용, 항목은 항목) |
| 줄 맨 앞 Backspace `linesBackspaceAtStart` | 원자 줄 → 그 원자를 선택. 코드 줄 → 비었으면 문단으로. 항목 → 앞이 같은 목록 항목이면 합치고, 아니면 문단으로. 제목·인용 → 문단으로. 캡션 → 비었으면 지우고 앞 줄(원자면 선택), 내용 있으면 그대로. 문단 → 앞이 원자면 (빈 문단이면 지우고) 그 원자 선택, 앞이 글이면 합침 |
| 줄 끝 Delete `linesDeleteAtEnd` | 원자 → 선택. 다음이 원자면 (지금이 빈 문단이면 지우고) 그 원자 선택. 다음이 글이면 합침 |
| 굵게·기울임 `linesToggleMark` | 범위의 글자가 모두 켜져 있으면 끄고, 아니면 켬. 코드 줄 제외 |
| 종류 바꾸기 `linesSetType(type, opt, toggle)` | 캡션·코드 줄 제외. list: 모두 항목이고 toggle이며 같은 종류면 문단으로, 모두 항목이면 그 목록들의 ordered만 바꿈, 아니면 한 목록으로 묶음. 그 밖: toggle이고 모두 그 종류(제목은 같은 level)면 문단으로, 아니면 그 종류로 |

### 다.3 에디터 문서의 블록 JSON 모델
문서 `content = { blocks: Block[] }`. 화면은 이 JSON에서만 그리고, 저장·내보내기·스냅샷도 이 JSON에서 만든다. **번호(그림·표·식)는 저장하지 않는다**(라.3). 불러올 때마다 `normalizeDoc`로 정리한다: 모르는 블록은 버리고, 블록이 하나도 없으면 빈 문단 하나.

블록 id: `/^[\w-]{1,80}$/`이 아니면 새로 만든다(`"b" + RN.newId()`).

| type | 필드 | 정규화 규칙 | 편집 방식 |
|---|---|---|---|
| `paragraph` | `content: Inline[]` | | 글자 블록 |
| `heading` | `level: 1|2|3`, `content` | level을 1~3으로 자르고 반올림, 기본 1 | 글자 블록 |
| `quote` | `content` | | 글자 블록 |
| `caption` | `kind: "figure"|"table"|"equation"`, `content` | 모르는 kind는 figure | 글자 블록(앞에 자동 번호 라벨) |
| `list` | `ordered: boolean`, `items: Inline[][]` | items가 비면 `[[]]` | 항목마다 글자 |
| `table` | `header: boolean`(기본 true, `false`일 때만 거짓), `rows: string[][]` | 칸은 문자열, 없으면 `[[""]]`, 가장 긴 줄 폭에 맞춰 빈칸 채움 | 원자 블록(칸은 별도 입력) |
| `figure` | `alt: string`, `svg: string` **또는** `src: data URL`, `meta?` | `svg`가 있으면 svg, 아니면 `src`가 `data:image/(png|jpeg|gif|webp);base64,`일 때만. 둘 다 없으면 블록 버림 | 원자 블록 |
| `math` | `latex: string` | | 원자 블록(블록 수식) |
| `toc` | `kind: "figure"|"table"` | table이 아니면 figure | 원자 블록(그림/표 목차) |
| `code` | `text: string` | | 원자 블록 |

인라인 노드 `Inline`:
| t | 필드 | 뜻 |
|---|---|---|
| `text` | `text`, `b?: true`, `i?: true` | 글자. 빈 글자는 버리고, 굵게·기울임이 같은 이웃 글자 노드는 합친다 |
| `math` | `latex` | 인라인 수식(한 칸짜리 원자) |
| `br` | — | 문단 안 줄바꿈(Shift+Enter). 한 칸짜리 원자 |
| `ref` | `target`(블록 id) | 상호 참조. 그림·표 캡션 id 또는 대상(그림·표·수식) id. 한 칸짜리 원자 |
- 글자 위치(오프셋)는 글자 노드는 글자 수, 원자 노드(math·br·ref)는 1칸으로 센다(`splitInline`이 이 규칙으로 자른다).
- 밑줄·글자색·링크 같은 다른 인라인 서식은 **없다**.

예:
```json
{ "blocks": [
  { "id": "b1", "type": "heading", "level": 1, "content": [{ "t": "text", "text": "1. 서론" }] },
  { "id": "b2", "type": "paragraph", "content": [
      { "t": "text", "text": "결과는 " }, { "t": "ref", "target": "b5" },
      { "t": "text", "text": "와 같다", "b": true }, { "t": "br" },
      { "t": "text", "text": "속도는 " }, { "t": "math", "latex": "v=\\frac{d}{t}" } ] },
  { "id": "b3", "type": "list", "ordered": false, "items": [[{ "t": "text", "text": "가" }], []] },
  { "id": "b4", "type": "figure", "alt": "산점도", "svg": "<svg …>…</svg>", "meta": { "…": "mod-data가 넣는 정보" } },
  { "id": "b5", "type": "caption", "kind": "figure", "content": [{ "t": "text", "text": "온도와 속도" }] },
  { "id": "b6", "type": "caption", "kind": "table", "content": [{ "t": "text", "text": "측정값" }] },
  { "id": "b7", "type": "table", "header": true, "rows": [["시간", "온도"], ["0", "20.1"]] },
  { "id": "b8", "type": "math", "latex": "E=mc^2" },
  { "id": "b9", "type": "toc", "kind": "figure" },
  { "id": "b10", "type": "code", "text": "print(1)" }
] }
```

### 라.3 캡션 번호·상호 참조·목차 (순수 함수, mod-editor)
- 라벨: 참조 라벨 `refLabel` = `그림 n` / `표 n` / `식 (n)`. 캡션 라벨 `captionLabel` = `그림 n.` / `표 n.` / `식 (n)`(식은 마침표 없음).
- 캡션 위치 규칙 `captionPositions(rules)`: 그림 `rules.caption.figurePosition`(기본 below), 표 `tablePosition`(기본 above), 식은 항상 below.
- **캡션 붙이기** `attachCaptions`: 캡션마다 규칙 쪽 이웃(아래 규칙이면 바로 앞 블록, 위 규칙이면 바로 뒤 블록)을 먼저, 없으면 반대쪽 이웃을 본다. 그 이웃이 같은 종류(figure→figure 블록, table→table, equation→math)이고 아직 캡션이 없으면 붙인다. 한 대상에 캡션 하나.
- **번호 매기기** `computeNumbering(doc, positions)`: 문서 순서대로 종류별 1부터.
  - 그림·표: **캡션 하나가 번호 하나**. 캡션 없는 그림·표는 번호가 없다. 대상이 없는 캡션도 번호를 받는다.
  - 식: **블록 수식 하나가 번호 하나**(캡션이 없어도). 붙은 식 캡션은 같은 번호를 공유하고 따로 세지 않는다. 대상 없는 식 캡션은 따로 번호.
  - 항목 `{id, ids:[캡션id, 대상id], kind, number, refLabel, captionLabel, text(캡션 글), latex?}`. `byId`로 캡션 id와 대상 id 모두 같은 항목을 찾는다.
- **참조 풀기** `resolveRef(numbering, target)`: 찾으면 그 refLabel, 못 찾으면 「[참조 대상 없음]」(broken). 참조는 id로 저장되므로 그림을 지우거나 순서를 바꾸면 번호가 저절로 따라간다(테스트 c.spec: 그림 3개 중 2번째 삭제).
- **`@` 참조 입력** `parseRefTrigger(textBefore)`: 커서 앞 글자의 마지막 `@`부터 커서까지가 query. query가 30자 이하이고 공백·`@`·`￼`가 없으며, `@` 바로 앞이 줄 처음이거나 공백·`([{"'“‘·,` 중 하나일 때만 트리거. 후보 거르기 `filterRefTargets`: query를 공백·`().`를 빼고 소문자로 비교해, 라벨이 query로 시작하거나 query가 라벨로 시작하거나 캡션 글에 포함되면. query가 비면 전부.
- **목차** 블록: 제목 「그림 목차」/「표 목차」, 줄마다 `<캡션 라벨> <캡션 글>`(글이 없으면 라벨만), 항목이 없으면 「(항목 없음)」.

### 라.4 서식 규칙
#### 라.4.1 규칙 구조와 기본값(`DEFAULT_RULES` = 프리셋 「일반 보고서」)
```json
{ "page": { "size": "A4", "orientation": "portrait", "margin": { "top": 25, "right": 25, "bottom": 25, "left": 25 } },
  "body": { "font": "noto-sans-kr", "sizePt": 11, "lineHeight": 160, "align": "justify" },
  "paragraph": { "indentPt": 0, "spacingPt": 6 },
  "headings": { "h1": { "font": "noto-sans-kr", "sizePt": 18, "bold": true, "align": "left" },
                "h2": { "font": "noto-sans-kr", "sizePt": 15, "bold": true, "align": "left" },
                "h3": { "font": "noto-sans-kr", "sizePt": 13, "bold": true, "align": "left" } },
  "caption": { "sizePt": 10, "bold": false, "align": "center", "figurePosition": "below", "tablePosition": "above" },
  "pageNumber": { "enabled": true, "position": "bottom-center", "style": "n" } }
```
단위: 여백 mm, 크기 pt, 줄 간격 %.

| 경로 | 허용 값 |
|---|---|
| `page.size` | A4(210×297) · B5(182×257) · Letter(215.9×279.4) mm |
| `page.orientation` | portrait · landscape(가로면 폭·높이 바꿈) |
| `page.margin.*` | 0~60 |
| `body.font`, `headings.h*.font` | `noto-sans-kr`(Noto Sans KR, sans-serif) · `noto-serif-kr`(Noto Serif KR, serif) · `ibm-plex-sans-kr`(IBM Plex Sans KR, sans-serif) |
| `body.sizePt`, `headings.*.sizePt`, `caption.sizePt` | 6~48 |
| `body.lineHeight` | 100~300 |
| `body.align` | left · justify |
| `headings.*.align`, `caption.align` | left · center · right |
| `paragraph.indentPt` / `spacingPt` | 0~60 / 0~40 |
| `*.bold`, `pageNumber.enabled` | boolean |
| `caption.figurePosition` / `tablePosition` | above · below |
| `pageNumber.position` | bottom-center · bottom-right · top-center · top-right |
| `pageNumber.style` | `n`(「3」) · `dash`(「- 3 -」) · `total`(「3 / 10」) |

프리셋 3종(`PRESETS`, 일반 보고서는 위 기본값):
| 항목 | 학술 논문형(`preset-academic`) | 탐구 보고서형(`preset-inquiry`) |
|---|---|---|
| 여백 위·오·아·왼 | 30·25·25·25 | 20·20·20·20 |
| 본문 | Noto Serif KR 10pt, 160%, 양쪽 | Noto Sans KR 12pt, 180%, 왼쪽 |
| 들여쓰기 / 문단 뒤 | 10pt / 0pt | 0pt / 8pt |
| 제목 1/2/3 | Serif 16 가운데 / 13 왼쪽 / 11 왼쪽, 모두 굵게 | IBM Plex 20 가운데 / 16 / 14, 굵게 |
| 캡션 | 9pt, 보통, 가운데 | 10pt, **굵게**, 가운데 |
| 쪽 번호 | 아래 가운데, dash | 아래 오른쪽, total |

#### 라.4.2 정규화 `normalizeRules(input, fallback=DEFAULT_RULES)` (순수)
기본 구조를 따라 걸으며 값이 없거나(`undefined/null/""`) 틀리면 fallback 값으로(`defaulted` 목록에 경로 기록, 단 제목 글꼴은 기록 안 함). 숫자 범위 경로의 문자열 숫자는 숫자로 바꾼다. 글꼴 값이 제공 글꼴 id가 아니면 `resolveFont`로 바꾸고 대체였으면 `fontNotices`에 `{path, requested, font}`. 입력에 본문 글꼴이 있고 제목 글꼴이 없으면 제목 글꼴을 본문 글꼴로. 결과 `{rules, fontNotices, defaulted}`.

#### 라.4.3 글꼴 이름 풀기 `resolveFont(name)`
키 = 소문자 + 공백·`-_"'` 제거.
- 같은 글꼴(대체 아님): 본고딕·노토산스·노토산스kr·notosanscjkkr → Noto Sans KR / 본명조·노토세리프·노토세리프kr·notoserifcjkkr → Noto Serif KR / ibm플렉스산스·플렉스산스·ibmplexsans → IBM Plex Sans KR / 세 글꼴의 id·family 이름.
- 대체: 함초롬바탕·hcrbatang·한컴바탕·바탕·바탕체·batang·궁서·gungsuh·나눔명조·nanummyeongjo·신명조·hy신명조·휴먼명조·hy견명조·applemyungjo·timesnewroman·times·georgia → Serif / 함초롬돋움·hcrdotum·한컴돋움·맑은고딕·malgungothic·굴림·굴림체·gulim·돋움·돋움체·dotum·나눔고딕·nanumgothic·나눔바른고딕·hy중고딕·휴먼고딕·applesdgothicneo·arial·helvetica·calibri → Sans / 나눔스퀘어·hy견고딕 → IBM Plex.
- 그 밖: 키에 `명조|바탕|궁서|myeongjo|myungjo|batang|mincho|serif|roman`이 있고 `sans|고딕|gothic`이 없으면 Serif, 아니면 Sans(대체).

#### 라.4.4 CSS 변수 `formatCssVars(rules)` (종이 화면과 HTML 내보내기가 같이 씀)
`--fmt-page-width/height`(mm), `--fmt-margin-top/right/bottom/left`(mm), `--fmt-body-font`(`"<family>", <generic>`), `--fmt-body-size`(pt), `--fmt-line-height`(lineHeight/100), `--fmt-body-align`, `--fmt-indent`(pt), `--fmt-para-spacing`(pt), `--fmt-caption-size`, `--fmt-caption-weight`(700/400), `--fmt-caption-align`, 그리고 h1~h3마다 `--fmt-hN-font/size/weight/align`.

#### 라.4.5 서식 검사·모두 고치기 `checkFormat(doc, rules)` / `fixFormat(doc, rules)` (순수)
검사 순서와 메시지(원문):
| code | 메시지 | 자동 고침 |
|---|---|---|
| `duplicate-id` | 같은 식별자를 쓰는 블록이 있어요 | 새 id |
| `number-mismatch` | 캡션에 번호를 직접 썼어요(“<쓴 것>”) — 자동 번호는 <라벨> | 앞 번호 글자 삭제 |
| `number-duplicate` | 캡션 앞의 “<쓴 것>”가 자동 번호와 겹쳐요 | 앞 번호 글자 삭제 |
| `caption-empty` | <캡션 라벨> 캡션 내용이 비어 있어요 | 없음 |
| `broken-ref` | 대상이 사라진 상호 참조가 있어요(직접 지우거나 다시 고르세요) | 없음 |
| `heading-skip` | 제목 단계를 건너뛰었어요: 제목 <앞> 다음에 제목 <뒤> — “<앞 30자>” | 앞 단계+1로 |
| `caption-position` | <그림/표> 캡션은 <위/아래>에 있어야 해요 | 캡션을 규칙 쪽으로 옮김 |
| `caption-missing` | <그림/표>에 캡션이 없어요 | 빈 캡션 추가 |
| `caption-orphan` | 붙을 <그림/표/식>이(가) 없는 캡션 — “<30자>” | 없음 |
- 손으로 쓴 번호 감지: 캡션 첫 글자 노드가 `^\s*\[?\s*(그림|표|식|Figure|Fig\.?|Table|Eq\.?)\s*\(?\s*(\d+)\s*\)?\s*\]?\s*[.:)\-–]?\s*`로 시작하면. 종류와 번호가 자동 번호와 같으면 duplicate, 아니면 mismatch.
- 그림·표 짝 검사: 규칙 쪽 이웃이 같은 종류의 아직 안 붙은 캡션이면 정상. 아니면 반대쪽 이웃이 그런 캡션이고 (위 규칙일 때 그 다음 블록이 같은 종류 대상이 아니면) 위치 오류, 그 밖은 캡션 없음. 블록 수식 앞뒤의 식 캡션은 붙은 것으로 친다.
- 결과는 블록 순서로 정렬. `fixFormat` → `{doc, fixed(고칠 수 있던 수), remaining(고친 뒤 다시 검사한 결과)}`.

### 라.5 내보내기·가져오기 (mod-editor)
#### 라.5.1 Markdown 내보내기 `documentToMarkdown(content, rules)`
블록 사이 빈 줄 하나, 끝에 줄바꿈.
| 블록 | 출력 |
|---|---|
| heading | `#`×level + 공백 + 인라인(줄바꿈은 공백) |
| paragraph | 인라인(비면 생략) |
| quote | 줄마다 `> ` |
| list | `- ` 또는 `n. `, 항목 안 줄바꿈은 `\n   ` |
| code | ```` ``` ```` 펜스 |
| table | `| a | b |` + `| --- | --- |` + 나머지 줄(첫 줄은 항상 머리글로), 칸의 줄바꿈은 공백 |
| figure | `![alt 또는 그림](src)` — svg는 `data:image/svg+xml;base64,…`(UTF-8 base64) |
| caption | `*<캡션 라벨> <글>*` |
| math | `$$\n<latex>\n$$ (n)` |
| toc | `**그림 목차**` + 빈 줄 + `- <줄>`들(없으면 「(항목 없음)」) |
인라인: 글자는 `\ \` * _ [ ] < > # | $`를 역슬래시 이스케이프, 기울임 `*…*`, 굵게 `**…**`(공백뿐이면 그대로), 수식 `$latex$`, 참조는 풀어 쓴 라벨, `br`은 `\` + 줄바꿈(제목·캡션에서는 공백).

#### 라.5.2 본문 HTML `bodyHtml(content, rules, {maxBytes?})`
블록별 HTML을 만들고 허용 목록 정리(`sanitizeHtml`: 허용 태그 `p h1 h2 h3 ul ol li blockquote pre code strong em span div table tbody tr td th figure img br` + MathML 태그들, 허용 속성 `class data-kind data-figure-id alt colspan rowspan xmlns` + MathML 속성들, `img src`는 `data:image/(png|jpeg|gif|webp|svg+xml);base64,`만, script·style·iframe·object는 제거, 그 밖 모르는 태그는 글자로).
| 블록 | HTML |
|---|---|
| heading | `<hN>` |
| paragraph | `<p>` |
| quote | `<blockquote><p>` |
| list | `<ul>/<ol><li>` |
| code | `<pre><code>` |
| table | `<table class="doc-table"><tbody>`, 첫 줄은 header면 `<th>` |
| figure | `<figure class="doc-figure" data-figure-id><img src alt>` |
| caption | `<p class="doc-caption" data-kind><span class="caption-label">그림 1.</span> 글</p>` |
| math | `<div class="doc-math-block">MathML <span class="math-label">(n)</span></div>` |
| toc | `<div class="doc-toc"><p><strong>그림 목차</strong></p><p>줄</p>…` |
인라인 수식 `<span class="doc-math-inline">MathML</span>`(KaTeX가 없으면 `$latex$` 글자), 참조 `<span class="doc-xref[ doc-xref-broken]">라벨</span>`, `br` → `<br>`. `maxBytes`를 넘으면 **가장 큰 그림부터** `<p class="doc-figure-omitted">[그림 생략: 용량이 커서 넣지 못했어요]</p>`로 바꿔 가며 다시 만든다(생략 수는 `lastExportInfo.omitted`). 결과보고서 공개(`RN.docs.exportHtml`)는 이 조각을 200KiB 한도로 만든다(라.11.1).

#### 라.5.3 HTML 문서 내보내기 `exportHtmlDocument(title, content, rules)`
독립 HTML 한 장: `<!doctype html><html lang="ko">`, Google Fonts(IBM Plex Sans KR·Noto Sans KR·Noto Serif KR) 링크, `<style>`에 `@page { size: <폭>mm <높이>mm; margin: …; @<쪽 번호 위치> { content: counter(page) | "- " counter(page) " -" | counter(page) " / " counter(pages); font-size: 9pt; } }`, `.doc`에 CSS 변수(라.4.4)와 본문 글꼴·크기·줄 간격·정렬, 종이 폭 최대·여백 안쪽 여백(인쇄할 때는 0), 문단 들여쓰기·간격, 제목 스타일(줄 간격 1.35), 표 테두리 `#555`·머리 `#f1f1f1`, 인용 왼쪽 회색 줄, 코드 회색 배경, 깨진 참조 빨강, 제목 뒤 쪽 나눔 피하기. 본문: `<article class="doc"><h1>제목</h1>` + `bodyHtml`(크기 한도 없음). 사용자는 이것을 브라우저에서 열어 PDF로 인쇄할 수 있다.

#### 라.5.4 DOCX 내보내기 `documentToDocx(title, content, rules) → {bytes, omittedFigures}`
라이브러리 없이 **무압축(store) zip** + WordprocessingML.
- zip: 파일마다 로컬 헤더(서명 0x04034b50, 버전 20, 플래그 0x0800=UTF-8 이름, 방식 0, DOS 시각, CRC-32(다항식 0xEDB88320 표), 크기 2번) + 데이터, 끝에 중앙 디렉터리(0x02014b50) + 끝 레코드(0x06054b50).
- 파일 목록(순서): `[Content_Types].xml`, `_rels/.rels`, `docProps/core.xml`(dc:title, dcterms:created), `word/document.xml`, `word/styles.xml`, `word/numbering.xml`, `word/_rels/document.xml.rels`, (쪽 번호가 켜졌으면) `word/footer1.xml` 또는 `word/header1.xml`, 그림 `word/media/imageN.png|jpeg`.
- 본문 매핑:
  | 블록 | DOCX |
  |---|---|
  | (문서 제목) | 스타일 `Title` 문단(가운데, h1 글꼴, h1 크기+4pt, 굵게) |
  | heading | `Heading1~3`(keepNext, 위 간격 240/200/160 twip, 아래 120, outlineLvl) |
  | paragraph | 기본 `Normal` |
  | quote | `Quote`(왼쪽 들여쓰기 567, 왼쪽 회색 테두리, 글자 #444444) |
  | code | `Code`(Consolas, 본문-1pt, 배경 F4F4F5) |
  | list | 항목마다 `ListParagraph` + `numPr`. 글머리표는 numId 1(•), 번호 목록은 목록마다 새 numId(2,3,…; 1부터 다시) |
  | table | `w:tbl`(폭 100%, 단일 테두리 sz 4 색 555555, 고정 레이아웃, 칸 폭 = 본문 폭/열 수), 첫 줄이 머리글이면 `tblHeader` + 굵게, 칸 문단은 `TableText` |
  | figure | PNG/JPEG data URL이면 `word/media`에 넣고 인라인 그림(크기는 PNG IHDR·JPEG SOF에서 읽은 픽셀 × 9525 EMU, 못 읽으면 600×400; 본문 폭보다 크면 비율 유지 축소), 스타일 `Figure`(가운데, keepNext). **SVG·GIF·WebP는 넣지 못하고** 기울임 글자 「[그림: DOCX에는 넣지 못했어요 — HTML로 저장하면 보여요]」(생략 수에 셈) |
  | caption | `Caption` 스타일 + 「그림 1. 」 + 글 |
  | math | `Equation`(가운데) + **LaTeX 원문 글자**(글꼴 Cambria Math) + 「    (n)」 |
  | toc | `TocHeading` 굵은 제목 + `TocLine` 줄들 |
  인라인: 글자 런(굵게 `w:b`, 기울임 `w:i`, 글자 안 `\n`은 `w:br`), `br` → `<w:br/>`, 인라인 수식 → LaTeX 글자(Cambria Math), 참조 → 라벨 글자. 본문이 비었거나 표로 끝나면 빈 문단을 덧붙인다(Word 요구).
- 스타일: `docDefaults`에 본문 글꼴(ascii·hAnsi·eastAsia·cs 모두)·크기(half-point = pt×2)·`ko-KR`·문단 뒤 간격(pt×20)·줄 간격(lineHeight/100×240, auto). `Normal`에 같은 값 + 첫 줄 들여쓰기(pt×20) + 정렬(left→left, justify→both, center, right). `Caption`: 위 60, 아래 max(문단 간격,120), 정렬·굵게·크기는 캡션 규칙. 그 밖 `ListParagraph`(왼쪽 720, 내어쓰기 360), `TableText`, `TocHeading`, `TocLine`.
- 구역: `pgSz`(mm×1440/25.4 twip, 가로면 `w:orient="landscape"`), `pgMar`(여백, header·footer 567, gutter 0). 쪽 번호가 켜지면 위치가 top이면 머리말, 아니면 꼬리말에 PAGE 필드(dash면 「- PAGE -」, total이면 「PAGE / NUMPAGES」), 정렬은 right면 오른쪽, 아니면 가운데.
- 파일 이름·저장은 나.11(내보내기 메뉴).

#### 라.5.5 Markdown·텍스트 가져오기
`markdownToBlocks(md)`:
| 입력 | 블록 |
|---|---|
| ```` ``` ```` 펜스 | code |
| `$$…$$` 한 줄 또는 여러 줄 | math |
| `#`~`######` | heading(level은 최대 3) |
| `>` 줄 묶음 | quote(줄을 공백으로 이어 붙임) |
| `- * +` 또는 `1.`/`1)` 줄 묶음 | list(첫 줄이 숫자면 ordered) |
| `|` 줄 + 다음 줄이 `---` 구분선 | table(header true, `\|` 이스케이프 처리) |
| 한 줄짜리 `![alt](주소)` | 주소가 `data:image/(png|jpeg|gif|webp);base64,`면 figure, 아니면 문단 「(그림: alt)」 또는 「(그림)」 |
| `---`, `***`, `___` | 버림 |
| 빈 줄 | 문단 끝 |
| 그 밖 | 문단. 줄 끝 `\` 또는 공백 2개 이상이면 `{t:"br"}`, 아니면 공백으로 이어 붙임 |
인라인: 이미지·링크는 글만 남김, `**…**`/`__…__` 굵게, `*…*`/`_…_` 기울임, `$…$` 인라인 수식(앞이 `\`·`$`가 아닐 때), `` `…` `` 글자, 역슬래시 이스케이프 풀기.
`textToBlocks(text)`: 빈 줄로 문단을 나누고 문단 안 줄바꿈은 공백. `looksMarkdown(s)`: 줄 처음의 `# `·목록 기호·`>`·표 줄·```` ``` ````·`$$`가 있거나 `**…**`가 있으면 Markdown으로 본다.
- Markdown에서 온 그림은 `shrinkImage`로 줄인다(긴 변 1400→1000→700→480px, 흰 배경 JPEG 품질 0.82, 18만 자 이하가 될 때까지, 실패하면 원본). 문서가 256KiB를 넘을 것 같으면 그 그림부터 나머지 그림을 문단 「(그림 생략: 문서 크기 제한)」으로 바꾼다(`fitMarkdownImages`).

#### 라.5.6 SVG 정리 `sanitizeSvg(str)`
`image/svg+xml`로 파싱해 루트가 svg가 아니거나 파싱 오류면 null. 허용 태그 `svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop clippath title desc marker pattern use symbol mask`, 그 밖 요소는 삭제. 속성: `on*` 삭제, `href`류는 `#…`만, 값에 `javascript:`·`data:`·`expression(`·`url(`(내부 `#` 참조 아님)이 있으면 삭제. `xmlns` 보장 후 직렬화.

### 라.2.1 자동 저장 컨트롤러 `AutosaveController` (순수)
- 옵션 `{version, savedAt, save(payload, version) → {version, updatedAt}, getPayload(), onStatus(s), debounceMs=2000, retryMs=10000}`.
- 상태 `kind`: `saved`(at) · `dirty` · `saving` · `offline` · `error`(message) · `conflict`(serverVersion).
- `markDirty()`: dirty 표시. 충돌 중이면 아무것도 안 함. saving·offline이 아니면 상태 dirty. 2초 뒤 flush 예약(입력할 때마다 다시 2초).
- `flush()`: 타이머 해제, 충돌이면 끝, 진행 중이면 그 Promise, dirty가 아니면 끝. `run()`: dirty=false, saving → `save(getPayload(), version)` → version 갱신, 그 사이 다시 dirty면 dirty 아니면 saved. 오류면 dirty=true, `SaveConflictError`면 conflict, `SaveOfflineError`면 offline, 그 밖 error. 끝나면 offline이면 10초 뒤 재시도, dirty면 2초 뒤.
- `retry()`(offline·error일 때 flush), `setOffline()`, `resolveKeepMine()`(서버 버전을 내 기준으로 삼아 다시 저장 = 덮어쓰기), `resolveUseServer(version, savedAt)`(내 변경 버림), `dispose()`.
- `decideDraft(draft, server)`: 초안이 없으면 discard, 제목·정규화 내용이 서버와 같으면 discard, 아니면 `offer`(+ `serverChanged = server.version !== draft.baseVersion`). — [A]에서 이 함수를 부르는 화면 코드는 이번 판에서 확인하지 못했다(7.5에 따라 [A]는 로컬 초안 복구가 없다고 보고, 만들지 않아도 된다).

### 다.2 개인 컬렉션(에디터 관련)
- 이름 상수: `projects`, `docs`, `formatTemplates`. 스냅샷 `RN.userColl("docs").doc(docId).collection("snapshots")`.
- 스냅샷 문서: `{content, version, reason: "AUTO"|"MANUAL"|"IMPORT", label: string|null, createdAt}`. 추가할 때마다 `createdAt` 내림차순으로 읽어 **50개를 넘는 것**을 지운다.
- 휴지통: `deletedAt`(ms). **30일**(`TRASH_DAYS`) 지난 항목은 목록을 열 때 영구 삭제(`purgeExpiredProjects`: 그 프로젝트의 문서와 스냅샷까지, `purgeExpiredDocs`). 문서 영구 삭제는 스냅샷을 먼저 하나씩 지운 뒤 문서.
- 프로젝트 휴지통으로: 그 프로젝트의 문서 중 아직 삭제되지 않은 것에 같은 `deletedAt=now`를 찍고 프로젝트에도. 복구: 프로젝트와 **같은 `deletedAt` 값을 가진 문서만** 되살린다(따로 지운 문서는 휴지통에 남음).
- 대기 한도: db 호출은 `withTimeout(p, 10000)`으로 감싸고 시간 초과는 `{code:"timeout"}`. 오류 문구 `errText`: timeout 「서버가 응답하지 않아요. 잠시 뒤 다시 해 보세요.」, quota_exceeded 「저장 공간이 가득 찼어요.」, 그 밖 「처리하지 못했어요: <메시지>」. 로그인 없이 부르면 「로그인이 필요해요」.

### 라.1 검색 (`mod-search.js`) [A][W]
대상은 `RN.shared`(공개 연구·고충)뿐, 외부 호출 없음, 동기 함수. [S] `lib/search/site-search.ts` + SQL `rm_search_normalize`·pg_trgm `word_similarity`를 그대로 옮긴 것이다.

#### 라.1.1 정규화 `normalize(text)`
1. 문자열로 바꾸고 앞 20,000자만, 소문자.
2. 글자마다:
   - 한글 음절(U+AC00~U+D7A3): `c = code - 0xAC00` → 초성 `CHO[c/588]` + 중성 `JUNG[(c%588)/28]` + 종성 `JONG[c%28]`(두벌식 자판 글자).
   - `a-z`, `0-9`: 그대로.
   - 호환 자모(U+3131~U+3163, 예: 초성만 친 「ㅇㅎ」): `COMPAT[code-0x3131]`.
   - 그 밖의 비ASCII 글자·숫자(`\p{L}\p{N}`): 그대로.
   - 나머지(기호·공백): 공백.
3. 연속 공백을 하나로, 앞뒤 자르기. 예: 「음향」→`dmagid`.
- 표: `CHO = r rr s e ee f a q qq t tt d w ww c z x v g`(19), `JUNG = k o i oo j p u pp h hk ho hl y n nj np nl b m ml l`(21), `JONG = (빈) r rr rt s sw sg e f fr fa fq ft fx fv fg a q qt t tt d w c z x v g`(28), `COMPAT = r rr rt s sw sg e ee f fr fa fq ft fx fv fg a q qq qt t tt d w ww c z x v g k o i oo j p u pp h hk ho hl y n nj np nl b m ml l`(51).

#### 라.1.2 trigram과 `word_similarity`
- `trigramSeq(norm)`: 공백으로 나눈 단어마다 `"  " + 단어 + " "`의 연속 3글자를 순서대로(pg_trgm 방식).
- `wordSimilarity(needle, docSeq, docSet, floor)`: needle trigram 집합 크기 n. 먼저 (문서에도 있는 needle trigram 수)/n < floor면 0. 아니면 문서 trigram 순서열의 모든 시작점 i(needle에 있는 trigram에서만)에서 j를 늘려 가며 `matched/(n + extra)`의 최댓값(matched=구간 안의 needle trigram 종류 수, extra=구간 안의 needle에 없는 trigram 종류 수). 1이면 즉시 1. 더 늘려도 나아질 수 없으면(`n/(n+extra) <= best`) 그 시작점을 끝낸다.

#### 라.1.3 토큰화와 점수 `search(query, opts)`
| 상수 | 값 | 뜻 |
|---|---|---|
| defaultLimit / maxLimit | 10 / 50 | 결과 수(종류별) |
| maxQueryLength | 200 | 검색어 앞 200자만 |
| maxTokens | 6 | 단어 최대 6개 |
| tokenFloor | 0.5 | 긴 단어의 word_similarity 하한 |
| shortTokenLength / shortTokenFloor | 7 / 0.7 | 정규화 글자 수 7 미만이면 하한 0.7 |
| minBodyNeedleLength | 4 | 본문 부분 문자열 검사는 정규화 4글자 이상만 |
| bodyWeight | 0.85 | 본문에서 찾으면 0.85점 |
| minTokenMean | 0.6 | 여러 단어면 단어 점수 평균 0.6 이상 |
| recommendMinScore | 0.75 | 추천·비슷한 연구 최소 점수 |
1. `tokenize`: 앞 200자, `[\s,]+`로 나누고 중복 제거, 최대 6개. 0개면 빈 결과.
2. 단어마다 정규화 후 공백 제거(`norms`, 중복 제거). 단어가 2개 이상이면 **붙여 쓴 형태**(`norms.join("")`)를 needle로 하나 더(「음향 블랙홀」↔「음향블랙홀」).
3. 색인(공유 배열이 바뀔 때만 다시): 연구 제목 텍스트 = `title + keywords + field`, 본문 = `summary + limitations`. 고충 제목 텍스트 = `title + tags + field`, 본문 = `body + resolution`. 제목 텍스트는 trigram 순서열·집합, 본문은 정규화 후 공백 제거한 문자열. 연구별 고충 수(익명 제외)도 함께.
4. 문서마다 needle k의 점수 v: word_similarity ≥ floor면 그 값. needle 길이 ≥ 4이고 v < 0.85이고 본문에 needle이 부분 문자열로 있으면 0.85. 원래 단어 needle들의 v는 합해 평균(`tok/ntok`), 붙여 쓴 needle은 따로 최댓값(`comp`). 최종 `lex = max(평균 ≥ (단어 2개 이상이면 0.6, 아니면 0) ? 평균 : 0, comp)`. lex > 0인 문서만, 점수는 `round(min(1,lex)*1000)/1000`.
5. 정렬: 점수 내림차순, 같으면 id 사전순. 연구는 `excludeResearchIds`를 뺀 뒤 limit개.
6. 결과 모양:
   - 연구: 원본 필드에서 `report`만 빼고 + `type:"research"`, `summary`(200자 발췌), `limitations`(120자 발췌), `keywords`(배열 보장), `painCount`(익명 제외), `hasReport`(`report.html` 또는 `reportAsset.id`가 있으면), `score`.
   - 고충: `{type:"pain", id, title, excerpt(160자), stage(없으면 OTHER), field, tags, resolved, researchId(익명이면 null), isAnonymous, isExample, meTooCount, commentCount, createdAt, score}` — **authorId는 넣지 않는다.**
   - 발췌 `excerpt(text, max)`: `[#*`>_~|\[\]]` 기호를 공백으로, 공백 정리, 넘치면 잘라 「…」.
7. `kinds`: `["research"]`, `["pain"]`(또는 `"pains"`), 기본 둘 다.

#### 라.1.4 [A] 확인된 동작 예(테스트 a.spec)
붙여 쓰기·띄어쓰기 차이, 한 글자 오타, 초성만, 결과 없음이 검증돼 있다(사.1).

#### 라.1.5 추천·비슷한 연구
- `recommend(keywords, limit=5, opts)`: 키워드를 다듬어 중복 제거 후 최대 6개. 키워드마다 `search(k, {limit})`를 하고 점수 ≥ `minScore`(기본 0.75)만 남긴 뒤, 문서별 최고 점수로 합쳐 점수·id 순 limit개. "가속도 센서"↔"반응 속도 … 압력 센서" 같은 부분 겹침을 빼려고 일반 검색보다 엄격하다.
- `similarResearch(id, limit=4)`: 그 연구의 키워드가 있으면 `recommend(keywords, limit, {kinds:["research"], excludeResearchIds:[id]})`, 없으면 제목으로 `search`. 자기 자신 제외.
- 프로젝트 홈 "연구 공개·추천"은 프로젝트 키워드로 `recommend(kws, 5)`(나.10).

#### 라.1.6 의미로 더 찾기 [A]
1. 프롬프트(원문 그대로, `sample.json(prompt, {modelTier:"quick"})`):
   ```
   연구·고충 공유 사이트의 검색을 넓히려고 합니다. 아래 검색어와 뜻이 같거나 가까운 표현, 동의어, 상위 개념을 5~8개 골라 JSON 문자열 배열로만 답하세요. 각 표현은 2~20자의 짧은 검색어(한국어, 필요하면 영어 용어)로 쓰고, 설명이나 다른 내용은 쓰지 마세요.
   예: ["진동 저감", "방진", "댐핑"]

   검색어: <검색어 앞 100자>
   ```
2. 하루 한도: 요청 전에 `RN.aiQuota.take()`(챗봇과 같은 하루 100회, 라.9.6).
3. `cleanTerms(raw, query)`: 배열이 아니면 []. 문자열만, 제어 문자·`<>"\`{}[]\\`는 공백, 공백 정리, 30자 초과 버림, 정규화 키가 원래 검색어 또는 앞의 표현과 같으면 버림, 최대 8개.
4. `searchExpanded(query, terms, {limit=20})`: 원래 검색어 결과는 점수 그대로, 각 표현으로 찾은 결과는 점수 × 0.85. 문서별 최고 점수로 합쳐 정렬, limit개. 각 결과에 `matchedBy`(찾게 한 표현, 원래 검색어면 null). `usedTerms` = 실제로 결과를 더한 표현. 화면은 `terms` 전체를 「이런 표현으로도 찾았어요: …」로 보인다.
5. AI가 준 것은 **검색어뿐**이고 결과는 늘 사이트 데이터다(지어낸 연구 없음).

### 라.10 고충 (`mod-pains.js`)
#### 라.10.1 목록 거르기·정렬
- 단계·분야·태그는 정확히 일치. 검색어는 소문자로 공백 분리한 단어가 **모두** `제목 + "\n" + 본문`(소문자)에 들어 있어야 한다(부분 문자열, 정규화·오타 허용 없음 — 통합 검색 라.1과 다르다).
- 정렬: 최신순 = `createdAt` 내림차순. 공감순 = `meTooCount` 내림차순, 같으면 최신순.
- 쪽 크기 20. 필터·정렬·검색을 바꾸면 1쪽으로.
- 목록에는 익명 글도 나온다(작성자 표시만 「익명」). 연구 상세·프로젝트 섹션·검색의 고충 수에서는 익명 글을 뺀다.

#### 라.10.2 공감·신고·해결·삭제
- **쓰기 큐** `write(ref, op, data)`: 같은 문서 경로의 쓰기를 차례로 하나씩(아티팩트 db의 "한 문서 동시 쓰기 한 번" 규칙). `unavailable` 오류면 300~1000ms 쉬고 한 번 재시도.
- **오류 문구** `errMsg(e, what="저장")`: 「<what>하지 못했어요. 」 + `quota_exceeded` 「저장 공간이 가득 찼어요.」 / `invalid_argument`·`not_granted` 「쓰기 권한이 없거나 내용이 너무 길어요.」 / `resource_exhausted` 「요청이 너무 많아요. 잠시 뒤 다시 시도하세요.」 / `revoked` 「접근 권한이 바뀌었어요.」 / 그 밖 「잠시 뒤 다시 시도하세요.」
- **나도 겪었어요**(내 글이 아닐 때만): 이미 눌렀으면 `pains/{id}/reactions/{uid}` 삭제, 아니면 `set({createdAt})`. 그 뒤 `syncCount`: 반응 하위 컬렉션을 `limit(1000).get()`해 그 개수로 `pains/{id}.meTooCount`를 `update`(실패는 무시 — 남의 글 문서를 고치는 쓰기라 권한 규칙에 따라 실패할 수 있다; 확인 필요 — 판단 기준: 공유 컬렉션은 "로그인한 참여자 쓰기"로 선언하고, 실패해도 화면 숫자는 반응 하위 컬렉션 개수로 보이므로 그대로 둔다). 실패 토스트 「반응을 저장하지 못했어요. …」.
- **신고**: localStorage `renote:pain-reported:<id>`가 있으면 「이미 신고한 글이에요.」. 대화 상자 「이 글 신고하기」, 라벨 「신고 이유 (선택)」(`#pain-report-reason`, maxLength 1000), 버튼 「취소」/「신고」(`#pain-report-reason-ok`). `reports/{newId}`에 `{painId, reason, createdAt}` set → 기억 → 「신고했어요. 관리자가 검토합니다.」. 신고한 사람 id는 저장하지 않는다. 관리자 화면은 없다.
- **해결됨으로 표시**: 대화 상자 「해결됨으로 표시」, 라벨 「해결 방법」(`#pain-resolution`, 필수, maxLength 5000, 기존 해결 방법으로 채움), 비우면 「해결 방법을(를) 입력해 주세요.」. `update({resolved:true, resolution, updatedAt})` → 「해결됨으로 표시했어요.」
- **해결 취소**: 확인 「해결됨 표시를 취소할까요? 해결 방법도 지워져요.」(버튼 「해결 취소」) → `update({resolved:false, resolution:null, updatedAt})`.
- **삭제**: 확인 「이 고충을 지울까요? 공감 기록도 함께 지워져요.」(버튼 「삭제」, danger) → `pains/{id}` 삭제(실패하면 「삭제하지 못했어요. …」로 멈춤) → 하위 `comments`(예전 댓글 정리용)·`reactions` 문서를 1000개까지 하나씩 삭제(실패 무시) → `myPains/{id}` 삭제 → 「고충을 지웠어요.」 → 목록.
- 대화 상자(`dialogForm`)는 `<dialog class="rn-dialog rn-pain-dialog">` 안 폼, 열리면 textarea에 포커스, Esc=취소.

#### 라.10.3 작성·수정 저장
- "내 글" 판정 `isMine(p)` = 개인 `myPains`에 그 id가 있거나 `p.authorId === uid`. `myPains`는 모듈이 한 번만 `limit(1000)` 구독(10초 타임아웃).
- **새 글**: id = `RN.newId()`. ① 개인 표시 먼저 `myPains/{id}` = `{createdAt: now, projectId}` ② 공유 `pains/{id}` = `{title, body, stage, field, tags, isAnonymous, authorId: 익명이면 null 아니면 uid, researchId: 익명이면 null, updatedAt: now, resolved:false, resolution:null, createdAt: now, meTooCount:0}` → 「고충을 올렸어요.」 → 상세. (개인 표시를 먼저 쓰는 이유: 익명 글도 나중에 본인이 고칠 수 있게.)
- **수정**: 같은 필드(`title, body, stage, field, tags, isAnonymous, authorId, researchId, updatedAt`)를 `update`. 실명 → 익명으로 바꾸면 `scrubComments`: 예전 `pains/{id}/comments`(500개까지) 중 `authorId === uid`인 문서를 `{authorId:null, isPostAuthor:true}`로 고친다. 개인 표시가 없거나 프로젝트 연결이 바뀌었으면 `myPains/{id}`를 다시 set. → 「고친 내용을 저장했어요.」 → 상세.
- 연구 연결은 **내가 공개한 연구**(`authorId === uid`)만, 익명이면 항상 null. 실패하면 오류 줄과 토스트에 `errMsg`.
- 고충 문서에는 작성자 이름·이메일이 없다. 익명 글에는 authorId도 없다(테스트 b.spec이 db 문서를 직접 읽어 확인).

#### 라.10.4 안전한 마크다운 렌더러 `RN.markdown(source)`
DOM 노드를 직접 만든다(innerHTML 없음). 전처리: CRLF→LF, 탭→공백 4, NUL→`�`. 결과 `<div class="rn-md">`.
| 블록 | 규칙 |
|---|---|
| 코드 펜스 | ```` ``` ```` 또는 `~~~`(3개 이상, 앞 공백 0~3), 같은 글자·같거나 긴 길이로 닫힘. `<pre><code>` |
| 제목 | `#`~`######` → `h3`~`h6`(수준+2, 최대 h6). 뒤 `#` 제거 |
| 가로줄 | `---`, `***`, `___`(3개 이상, 사이 공백 허용) |
| 인용 | `>` 줄 묶음, 안을 다시 블록 파싱 |
| 목록 | `-*+` 또는 `1.`/`1)`(1~9자리). 번호 목록이 1이 아니면 `start`. 들여쓰기 ≥ max(2, 표시 폭)이면 같은 항목, 빈 줄 뒤 들여쓴 줄이면 같은 항목(느슨한 목록), 항목 사이 빈 줄이면 느슨한 목록(`<p>` 유지), 아니면 `<li>` 안 `<p>`를 벗김 |
| 문단 | 빈 줄이나 다른 블록 시작까지 |
| 깊이 | 12단계 넘으면 나머지를 글자 그대로 한 문단 |
| 인라인 | 규칙 |
|---|---|
| 역슬래시 이스케이프 | ASCII 기호 앞 `\`. 줄 끝 `\`는 `<br>` |
| 줄바꿈 | 문단 안 `\n`은 `<br>`(줄 끝 공백 제거) |
| 코드 | 백틱 n개로 열고 같은 개수로 닫음, 양끝 공백 한 칸씩 제거 |
| 이미지 `![alt](…)` | **그리지 않고** 「(이미지: alt)」 또는 「(이미지)」 글자 |
| 링크 `[글](주소 "제목")`, `<주소>`, 맨 URL(`http(s)://…`, 끝 문장부호 제외) | `safeHref`: 제어 문자·공백 제거 후 `http:`/`https:`/`mailto:`만, 아니면 링크 없이 글자. `<a rel="nofollow noopener noreferrer ugc" target="_blank">`. 링크 글 안에서는 다시 링크를 만들지 않음 |
| 강조 | `**`/`__` → strong, `*`/`_` → em(단어 안 `_`는 무시), `~~` → s |
| 원시 HTML | 글자 그대로(태그로 해석하지 않음) |
- 목록용 발췌 `excerpt(source, 160)`: 코드 펜스 제거, 링크·이미지는 글만, 줄 앞 블록 기호 제거, `*_~\``제거, 공백 정리, 넘치면 「…」.

#### 라.10.5 프로젝트 홈 섹션 "내 고충"
`RN.projectSections`에 `{id:"pains", label:"고충"}`. `region aria-label="내 고충"`, 안내 「이 프로젝트에 연결한 내 고충 (연결은 나만 보여요)」 + 쓸 수 있으면 「글쓰기」(`#project-pain-new` → `pain-edit{projectId}`). 목록은 `listFor({projectId})`(개인 `myPains`의 projectId가 같은 글, 최신순; 익명 글도 포함 — 본인만 보는 화면). 0건 「이 프로젝트에 연결한 고충이 아직 없어요.」

### 라.11 연구 공개·결과보고서 (`mod-research.js`)
#### 라.11.1 공개 제출
1. 키워드: `[,，\n]+`(반각·전각 쉼표, 줄바꿈)로 나눠 다듬고 중복 제거, 최대 10개.
2. 검사: 제목 없음 「제목을 적어 주세요.」, 요약 없음 「요약을 적어 주세요.」, 키워드 0개 「키워드를 하나 이상 적어 주세요.」(해당 입력에 포커스).
3. doc이면 「결과보고서를 준비하는 중…」 → `RN.docs.getDoc(id)`(없으면 「고른 문서를 찾지 못했어요.」) → `RN.docs.exportHtml(doc)`(라.5.3) → UTF-8 크기 > 200KiB면 「결과보고서가 너무 커요(200KB 초과). 그림을 줄이거나 PDF로 올려 주세요.」 → `report = {title: 문서 제목||공개 제목, html}`. pdf면 파일 검사(라.11.3).
4. 확인 창: 「공개하면 로그인한 모든 사람이 이 연구의 요약·키워드·한계(·결과보고서)를 볼 수 있어요. 공개할까요?」, 버튼 「공개」.
5. pdf면 「PDF를 올리는 중…」 → 업로드. 「공개하는 중…」 → `research/{RN.newId()}` = `{title, summary, field, keywords, limitations, authorId: uid, publishedAt: Date.now(), report, reportAsset}`(쓰지 않은 쪽은 null) → 「연구를 공개했어요.」 → 상세.
6. 실패: 올린 PDF를 지우고(가리키는 행이 없게) 상태 줄에 메시지, `quota_exceeded` 「저장 공간이 가득 찼어요. 아티팩트 주인에게 알려 주세요.」, `invalid_argument` 「내용이 너무 크거나 형식이 맞지 않아요.」, 그 밖 「공개하지 못했어요 (<code>).」.
- 공개본은 그 순간의 사본이다. 문서를 고쳐도 공개본은 그대로(화면 안내에도 있음). 공개 후 수정 화면은 없다(삭제 후 다시 공개, 또는 PDF 바꾸기만).

#### 라.11.2 보고서 HTML 정리(`sanitizeReport`)
`DOMParser`로 파싱한 뒤 허용한 것만 새로 만든다(innerHTML로 넣지 않음).
- 내용째 버리는 태그: `script style iframe object embed noscript template link meta form input button textarea select foreignobject`.
- 허용 태그: `p h1~h6 ul ol li strong em b i u s del sub sup br hr blockquote pre code table thead tbody tfoot tr th td caption colgroup col figure figcaption img span div section article header footer small mark`, MathML `math semantics annotation mrow mi mo mn ms mtext mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mstyle mpadded mphantom menclose`, SVG `svg g path line rect circle ellipse polyline polygon text tspan title defs clippath`. 그 밖 태그는 벗기고 내용만.
- 허용 속성: `colspan rowspan alt width height style class data-caption-number viewbox d x y x1 x2 y1 y2 cx cy r rx ry points fill stroke stroke-width stroke-dasharray opacity fill-opacity transform text-anchor font-size font-weight font-family dominant-baseline clip-path preserveaspectratio mathvariant display encoding stretchy fence separator lspace rspace accent accentunder columnalign rowspacing columnspacing scriptlevel displaystyle notation`. `style`에 `url(`·`expression`·`@import`·`javascript:`가 있으면 버림. `class`는 `katex|caption|figure|table|align|math`로 시작하는 것만.
- `img`는 `src`가 `data:image/(png|jpeg|jpg|gif|webp);base64,`일 때만 남기고 아니면 요소째 버린다(외부 이미지 불가).
- 이름공간이 HTML이 아니면 `createElementNS`로 같은 이름공간 요소를 만든다(MathML·SVG 유지).
- "HTML로 저장" 파일: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>…</title><style>body{max-width:800px;margin:40px auto;padding:0 24px;font-family:"Noto Serif KR",serif;line-height:1.7;color:#111;background:#fff}table{border-collapse:collapse}th,td{border:1px solid #333;padding:4px 8px}img,svg{max-width:100%}</style></head><body>` + 저장된 `report.html`(정리 전 원문) + `</body></html>`. 파일 이름 = 보고서 제목(없으면 연구 제목)에서 `\/:*?"<>|`·제어 문자를 공백으로, 80자, 비면 「결과보고서」 + `.html`. 성공 「결과보고서를 저장했어요.」

#### 라.11.3 결과보고서 PDF (assets)
- 파일 검사 `checkPdf`: 없음 「PDF 파일을 골라 주세요.」, 0바이트 「빈 파일이에요.」, 20MiB 초과 「파일이 20MB를 넘어요. 용량을 줄여 주세요.」, 읽기 실패 「파일을 읽지 못했어요.」, 첫 5바이트가 `%PDF-`가 아니면 「PDF 파일이 아니에요.」
- 업로드: `assets.upload(file, {type:"application/pdf"})`. `store_unavailable`이면 1.5초 뒤 한 번 재시도. 끄는 코드(`not_granted, capability_disabled, capability_removed`)면 이 세션에서 업로드 UI를 숨긴다. 응답 id가 `^[A-Za-z0-9_-]{8,128}$`가 아니면 `upstream_error`. 응답 `url`은 세션 메모리에 기억. 저장되는 값 `{id, filename: 정리한 이름(확장자 .pdf 보장, 80자), sizeBytes}`.
- 업로드 오류 문구: `too_large` 「파일이 20MB를 넘어요. 용량을 줄여 주세요.」, `unsupported_type` 「PDF 파일만 올릴 수 있어요.」, `invalid_request` 「이 파일은 올릴 수 없어요. 다른 PDF로 해 보세요.」, `quota_or_state` 「저장 공간이 가득 찼거나 지금은 파일을 받을 수 없어요. 아티팩트 주인에게 알려 주세요.」, `rate_limited` 「요청이 많아요. 잠시 뒤 다시 해 주세요.」, `upstream_auth` 「로그인이 풀렸어요. 새로 고친 뒤 다시 해 주세요.」, `store_unavailable` 「지금 파일 저장소에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.」, 끄는 코드 「이 화면에서는 파일을 올릴 수 없어요.」, 그 밖 「PDF를 올리지 못했어요 (<code>).」
- 표시 주소: 이번 세션에 올린 url → (로컬 모크) `__mockAssets.get(id).url` → `"/_blob/" + encodeURIComponent(id)`. 같은 출처 fetch로 바이트를 받고 `%PDF-` 머리를 다시 확인(아니면 실패). 바이트 캐시 최근 3개.
- 미리보기: pdf.js 3.11.174(`pdf.min.js`와 `pdf.worker.min.js`를 **둘 다 메인 스레드에 `RN.loadScript`**로 불러 전역 `pdfjsWorker`가 생기게 해 "가짜 워커"로 돈다 — 아티팩트에서 외부 URL로 Worker를 만들 수 없기 때문). `getDocument({data, isEvalSupported:false, useSystemFonts:true})`(eval 끔: CVE-2024-4367 완화). 첫 쪽만 그리고 「다음 쪽 더 보기」로 한 쪽씩. 캔버스 CSS 폭 = 영역 폭(240~1000px), 배율 × min(devicePixelRatio, 2).
- 저장: 「PDF 저장」 → 바이트를 받아 `downloads.save({filename, data: Blob(application/pdf)})`, 「PDF를 저장했어요.」, 못 받으면 「PDF 파일을 불러오지 못했어요.」

#### 라.11.4 PDF 올리기/바꾸기(상세, 작성자만)
숨긴 `input#research-pdf-file`(라벨 「결과보고서 PDF 파일」) + 버튼 `#research-pdf-upload`(「PDF 올리기」 또는 「PDF 바꾸기」) + 상태 `#research-pdf-upload-status`. 검사 → 기존 보고서(PDF 또는 HTML)가 있으면 확인 「결과보고서를 이 PDF(<이름>)로 바꿀까요? 지금 공개된 결과보고서는 사라져요.」(버튼 「바꾸기」) → 「PDF를 올리는 중…」 → 업로드 → `research/{id}.update({reportAsset: 새것, report: null})`(실패하면 새 파일을 지우고 「결과보고서를 바꾸지 못했어요 (<code>).」) → 이전 PDF 삭제 → 「결과보고서 PDF를 올렸어요.」. 자산 삭제 실패는 콘솔 경고만(흐름을 막지 않음).

#### 라.11.5 프로젝트 홈 섹션 "연구 공개·추천"
`RN.projectSections`에 `{id:"research", label:"연구 공개"}`. `<h2>` 「연구 공개·추천」 + 쓸 수 있으면 「공개」(`#project-publish` → `publish{projectId}`). `#project-recommend`: 키워드가 없으면 「프로젝트에 키워드를 넣으면 관련된 연구·고충을 추천해 드려요.」, 있으면 `<h3>` 「내 키워드와 관련된 연구」(없으면 「아직 이 사이트에 등록된 관련 연구가 없어요.」) + `<h3>` 「관련 고충」(없으면 「관련된 고충 글이 없어요.」).
