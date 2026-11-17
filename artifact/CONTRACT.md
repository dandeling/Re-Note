# Re;Note 아티팩트 판 — 모듈 계약

Next.js 앱(`/home/user`)과 같은 기능을, 서버 없이 브라우저에서만 도는 claude.ai 아티팩트로 다시 만든다. 요구사항은 `/home/user/SPEC.md`. 기존 앱의 로직(`/home/user/lib/**`)은 읽고 옮겨 써도 된다(브라우저용 순수 JS로).

## 파일
- `index.html`: 뼈대·토큰 CSS·스크립트 로드 순서. **수정 금지** (필요한 변경은 보고에 적는다).
- `core.js`: 전역 `RN` (아래). **수정 금지**.
- `mod-*.js`: 모듈 하나당 파일 하나, 담당 에이전트만 수정. 즉시 실행 함수로 감싸고 전역은 `RN`에만 붙인다. 빌드 도구·TypeScript·ES module import 없음(일반 `<script>`).
- `dev-mock.js`, `dev-server.mjs`: 로컬 테스트용(게시 안 함). `node dev-server.mjs 41xx` 후 `http://localhost:41xx/dev.html`. `?user=u2`(다른 사용자), `?anon=1`(비로그인), `?nosample=1`(AI 없음). 테스트에서 `window.__mockDb.reset()/seed({경로: 문서})`, `window.__mockSample = async (text, opts, input) => "응답"`, `window.__downloads`.
- 가짜 `sample`은 자동완성 프롬프트(`<before_cursor>` 태그)에 한 문장을 돌려준다(`window.__mockAutocompleteDelay` ms 뒤, `signal`을 따름, 호출 수 `window.__mockAutocompleteCalls`). `__mockSample`을 끼우면 그쪽이 우선. 빈 답은 실제처럼 `empty_completion`으로 거절. `?consent=prompt|denied`(AI 사용 동의 흉내, 답은 `window.__mockConsentAnswer` = grant|deny|dismiss, 묻는 횟수 `__mockConsentAsked`, 시도 수 `__mockSampleAttempts`), `?nopermissions=1`(permissions 없음).
- 테스트: `tests/<모듈>.spec.cjs` 를 Playwright로 (`require('playwright')`, `chromium.launch()`; `playwright install` 금지). 각자 다른 포트를 쓴다.

## 아티팩트 환경의 제약 (반드시 지킬 것)
- 외부 요청 불가: `fetch`/XHR/이미지/스타일시트는 같은 아티팩트의 파일(상대 경로)만. 외부 스크립트는 index.html에 이미 있는 것(KaTeX 0.16.9 전역 `katex`, PapaParse 5.4.1 전역 `Papa`)만 쓴다. KaTeX의 CSS는 못 불러오므로 **`katex.renderToString(latex, { output: "mathml", throwOnError: false })`** 로만 그린다(`trust` 옵션 금지).
- `alert/confirm/prompt` 없음 → `RN.toast`, `RN.confirm`. `window.print()` 없음(PDF 인쇄 불가). `<a download>` 무효 → 파일 저장은 `RN.caps.downloads.save({ filename, data })`(없으면 버튼 숨김, 거절 `declined`는 오류가 아님).
- 주소는 `#이름`만 전달된다 → 상세 화면 id는 `RN.go(name, params)`의 params로.
- 사용자 입력을 `innerHTML`로 넣지 않는다. `RN.h`의 문자열 자식은 텍스트로 들어간다. HTML이 꼭 필요하면(수식 MathML, 직접 만든 SVG) 입력을 이스케이프한 뒤에만.
- 색은 index.html의 CSS 토큰(`var(--bg)`, `--surface`, `--surface-2`, `--fg`, `--muted`, `--line`, `--accent`, `--accent-fg`, `--accent-soft`, `--ok(-soft)`, `--warn(-soft)`, `--danger(-soft)`, `--paper`, `--paper-fg`)만. 문서 "종이"는 `--paper`/`--paper-fg`(항상 흰 종이). 휴대폰 폭(400px)에서 가로 스크롤 없이 동작. 폼 컨트롤에는 고정 `id`와 라벨. 키보드 조작 가능.
- 공통 클래스: `rn-row rn-end rn-between rn-stack rn-grid rn-card rn-muted rn-small rn-btn(rn-primary|rn-danger|rn-ghost) rn-link rn-field rn-badge(-ok|-warn|-accent) rn-notice rn-table-wrap rn-table rn-dialog`. 모듈 전용 CSS는 `RN.css("모듈id", "…")`.
- UI 문구는 한국어. 서비스 이름을 문구에 직접 쓰지 않는다.

## RN (core.js)
`h(tag, attrs, ...children)`, `css(id, text)`, `toast(msg, "error"?)`, `confirm(msg, {okLabel, cancelLabel, danger}) → Promise<boolean>`, `fmtDate(ms)`, `fmtDateTime(ms)`, `newId()`, `local.get/set/remove`(localStorage, 실패해도 안전), `notice(text, "error"|"warn"?)`, `badge(text, "ok"|"warn"|"accent"?)`, `field(label, control, hint?)`, `writeBlockedReason() → string|null`, `STAGES`(고충 단계 코드→한국어).
- `RN.ready → caps`, `RN.caps = { db, user, sample, downloads, uid, me, canWrite }` — 각 기능은 **null일 수 있다**(비로그인, 권한 없음). null이면 그 기능만 숨기거나 안내하고 화면은 그려야 한다.
- `RN.userColl(name)` → 내 개인 컬렉션(`data/users/<내 id>/<name>/items`), `RN.userDoc(name)` → 내 개인 단일 문서. 로그인하지 않았으면 null. (`RN.userPath`는 쓰지 않는다.)
- `RN.names(ids) → Promise<{id: 이름}>`. 사용자 이름·이메일은 DB에 저장하지 않는다(id만).
- `RN.shared = { research: [], pains: [], loaded: {research, pains}, error }`, `RN.onShared(fn) → 해제함수` — 공유 컬렉션은 core가 한 번만 구독한다. 모듈이 `research`/`pains` 전체를 다시 구독하지 않는다.
- `RN.view(name, { title, nav?, mount(root, params) → 정리함수? })`, `RN.go(name, params)`. 최상위 화면 이름: `home explore pains projects convert`. 상세 화면은 `nav`에 속한 최상위 이름을 적는다(메뉴 강조용). `mount`는 `root`(비어 있는 `<main>`)에 `<h1>`을 포함해 그린다. 구독·타이머는 정리함수에서 해제.
- db 사용법은 `/tmp/claude-0/bundled-skills/2.1.325/e878b1e022950a3aacc41c1b4dcce211/artifact-capabilities/0.2.96/db.d.ts`(주석 포함)를 Read로 읽고 따른다. 문서 하나 256KiB 이하, 구독은 쿼리당 한 번, 한 문서에 동시에 한 번만 쓰기, 로딩은 10초 타임아웃. `sample`은 같은 폴더의 `sample.d.ts`, `downloads`는 `downloads.d.ts`.

## 데이터 (아티팩트 db)
공유(로그인한 사람 모두 읽기, 참여 권한 이상 쓰기 — 규칙은 메인 세션이 게시할 때 선언):
- `research/{id}`: `{ title, summary, field, keywords: string[], limitations, authorId, publishedAt(ms), report: { title, html }|null }` — `report.html`은 mod-editor의 `RN.docs.exportHtml()`이 만든 sanitize된 본문 HTML(200KiB 이하), 없으면 null.
- `pains/{id}`: `{ title, body(마크다운), stage(STAGES 키), field, tags: string[], isAnonymous, authorId(익명이면 null), researchId|null, resolved, resolution|null, createdAt(ms), updatedAt(ms), meTooCount }`
- 댓글 기능은 없앴다(사용자 요청). 예전에 달린 `pains/{id}/comments/{cid}` 문서가 db에 남아 있을 수 있어, 글 삭제·익명 전환 때의 정리 코드만 남겨 두었다.
- `pains/{id}/reactions/{userId}`: `{ createdAt }` (문서 id = 누른 사람 id, 한 사람 한 번)
- `reports/{id}`: `{ painId, reason, createdAt }` (신고 플래그만)
개인(본인만). **경로 규칙: 문서 경로는 세그먼트가 짝수, 컬렉션은 홀수여야 한다(어기면 실제 db에서 TypeError).** 그래서 개인 컬렉션은 반드시 `RN.userColl(name)`(= `data/users/<id>/<name>/items`)로 얻고, 단일 문서는 `RN.userDoc(name)`(= `data/users/<id>/<name>`)로 얻는다. `RN.userPath`로 경로를 직접 조립하지 않는다. 아래 `x/{id}`는 `RN.userColl("x").doc(id)`를 뜻하고, 하위 컬렉션은 `.doc(id).collection("snapshots")`:
- `myPains/{painId}`: `{ createdAt }` — 익명 글도 본인이 수정·삭제할 수 있게 "내 글" 표시를 개인 영역에 둔다(공유 문서에는 작성자 흔적 없음).
- `projects/{pid}`: `{ title, description, field, keywords[], archivedAt|null, deletedAt|null, createdAt, updatedAt }`
- `docs/{docId}`: `{ projectId, title, content(문서 JSON), formatRules, version, deletedAt|null, updatedAt }`, `docs/{docId}/snapshots/{sid}`: `{ content, version, reason: "AUTO"|"MANUAL"|"IMPORT", createdAt }`
- `datasets/{id}`: `{ projectId, name, columns: [{name,type,unit,missing}], rows: string[][](256KiB를 넘으면 앞에서부터 자르고 알림), rowCount, createdAt }`
- `chats/{tid}`: `{ title, messages: [{role, content, citations?}], updatedAt }`
- `aiUsage`(단일 문서, `RN.userDoc("aiUsage")`): `{ day("YYYY-MM-DD", 한국 시간), count(챗봇·의미 검색), autocomplete(글쓰기 자동완성), updatedAt }`. 읽기·쓰기는 mod-chat의 `RN.aiQuota`만 한다(set이 문서 전체를 덮으므로 두 필드를 항상 함께 쓴다).

## 모듈과 담당 (모듈 사이의 호출은 아래 이름으로만. 상대 모듈이 없을 수 있으니 `RN.x && RN.x.y` 로 확인)
- **mod-search.js** (A): `RN.search(query, {limit=10, kinds?}) → { research: [{id,title,summary,keywords,limitations,painCount,hasReport,score,…원본}], pains: [{id,title,excerpt,stage,tags,resolved,researchId,score,…}] }` — `RN.shared`를 대상으로 한 동기 함수. trigram + 자모 분해로 띄어쓰기·오타 허용(`/home/user/lib/search/` 참고). `RN.similarResearch(id, limit)`, `RN.recommend(keywords, limit)`.
- **mod-home.js**, **mod-research.js** (A): 화면 `home`(검색창 → explore), `explore`(params `{q}`), `research`(params `{id}`, nav explore), `publish`(params `{projectId}`, nav projects: 요약·키워드·한계 + 결과보고서로 쓸 내 문서 선택 → 확인 → `research` 생성).
- **mod-pains.js** (B): 화면 `pains`, `pain`(params `{id}`), `pain-edit`(params `{id?, projectId?, researchId?}`). `RN.pains = { listFor({researchId}) → 배열(익명 글 제외), renderList(items) → Node }` (연구 상세·프로젝트 홈이 씀), `RN.markdown(source) → Node`(안전한 마크다운 렌더러, 직접 구현).
- **mod-editor.js** (C): 화면 `projects`, `project`(params `{id}`), `editor`(params `{projectId, docId}`). `RN.docs = { listProjects(), listDocs(projectId), getDoc(docId), createDoc(projectId, {title, content, reason}) → docId, exportHtml(doc) → string, exportMarkdown(doc) → string }`. `RN.editor`(문서가 열려 있을 때만 non-null) `= { docId, projectId, insertText(text, {replaceSelection}), insertLatex(latex, {display}), insertTable({header: string[], rows: string[][], caption}), insertFigure({svg|dataUrl, caption, meta}), getSelectionText(), getDocText(), applyFormat(rules) }`. 에디터 오른쪽 패널에 다른 모듈이 탭을 붙일 수 있게 `RN.editorPanels = []`에 `{ id, label, mount(container, editorApi) }`를 push해 두면 에디터가 탭으로 보여 준다(mod-data의 "데이터", mod-chat의 "AI 도우미"). 프로젝트 홈에도 `RN.projectSections = []`에 `{ id, mount(container, project) }`를 push하면 섹션으로 보여 준다(mod-pains "내 고충", mod-data "데이터", mod-research "연구 공개·추천", mod-convert "가져오기").
- **mod-data.js**, **mod-convert.js** (D): CSV 업로드(UTF-8/CP949 감지)→`datasets`, 표·그래프 만들기(직접 그린 SVG, 추세선·R²는 코드 계산)→`RN.editor.insertTable/insertFigure`. 화면 `convert`: HWP/HWPX를 자체 JS 파서로 읽어 글자·표를 보여 주고 새 문서로 가져오기.
- **mod-autocomplete.js** (C, 3차): 에디터 글쓰기 자동완성. `index.html`에서 mod-editor.js 바로 뒤에 불러온다. 에디터가 문서를 열 때 `RN.autocomplete.attach(bridge)`를 부르고(bridge = `{ blocksEl, toolbar, blocked, context(), caretPoint(), caretDom(), isComposing(), commitComposition(), accept(text, ctx), setResetHandler(fn) }`, 에디터 안에서만 씀) 정리 함수를 받는다. `RN.autocomplete = { attach, cleanCompletion, buildPrompt }`, `RN.docs._cleanCompletion(raw, before)`(응답 후처리 순수 함수).
  - 제안은 캐럿이 있는 문단 끝의 `<span class="rn-ghost" contenteditable="false" aria-hidden="true" data-ac-ghost>`(흐린 글씨). 문서 데이터는 모델(블록 JSON)에서만 만들고, DOM을 다시 읽는 경로(`parseSlot`·`measureNode`·`locate`)는 `.rn-ghost`를 건너뛴다(`isSkipEl`). 키 입력(Tab 제외)·조합 시작·마우스·포커스 이탈·캐럿 이동·모델→DOM 다시 그리기 때 지운다. 받아들이기(Tab)는 모델 편집 한 번 = 실행 취소 한 단계.
  - 한글 조합(IME)이 열린 채 멈춰도 제안한다: 조합 중에는 본문(contenteditable) 안을 건드리지 않고 `.rn-paper`의 자식 `<div class="rn-ghost rn-ghost-ov" data-ac-ghost>`를 캐럿 자리 기준 절대 위치로 겹쳐 그린다(첫 줄 text-indent, 다음 줄은 문단 폭). 앞 글은 DOM의 그 줄(조합 글자 포함)에서 읽는다. 조합 글자가 바뀌면 버리고, 조합 중 Tab은 `commitComposition()`(포커스를 잠깐 뺐다 돌려 compositionend)으로 확정한 뒤 넣는다.
  - AI 사용 동의: `claude.use("permissions")`의 `state("sample")`이 "prompt"면 자동 요청을 보내지 않고 토글 옆 "AI 허용 필요" + "허용하기" 버튼(클릭에서 `request(["sample"])` 한 번). "denied"·`not_granted`면 "AI 허용 안 됨"(+ `manage()`가 있으면 "권한 설정"), 다시 묻지 않는다. permissions가 없으면 예전처럼 요청하고 거절이 오면 알린다. 토글 옆 상태 글자(`#tb-autocomplete-note`, role=status): 생각 중… / 제안 없음 / 오류 / 멈춤 / AI 허용 필요 / AI 허용 안 됨 / AI 없음. `empty_completion`·`refused`는 "제안 없음"(실패로 세지 않음).
  - 조건: 본문 문단·인용·목록 항목의 끝, 접힌 선택(조합 중에는 조합 글자를 잡은 짧은 선택도), 그 줄에 공백 빼고 10자 이상, 참조 팝업·표 칸·캡션·제목·코드·수식 아님. 멈춘 뒤 1.5초(Ctrl+Space는 즉시). `RN.caps.sample(…, {modelTier: "quick"})`만 쓴다. 앞 글 캐시 20개, 세대 번호로 옛 응답 버림, 연속 실패 3회·`rate_limited`·하루 한도(`RN.aiQuota.takeAutocomplete()`, 200회, `RN.aiAutocompleteLimit`로 바꿈)면 자동 요청을 멈추고 토글 옆에 "멈춤". 권한 거절 코드면 이 화면에서 끈다.
  - 도구 모음 토글 `#tb-autocomplete`(aria-pressed, `RN.local("autocomplete")`, 기본 켬, localStorage가 없으면 메모리). `sample`이 없거나 읽기 전용이면 비활성 + 이유 title. 첫 제안 때 한 번 "Tab으로 받아들이기" 힌트(`RN.local("autocompleteHint")`).
- **mod-chat.js** (A): 전역 플로팅 챗봇 + 에디터 패널 탭. `RN.caps.sample` + 도구 `search_site`(= `RN.search`). 출처 링크는 `RN.go("research"|"pain", {id})`. 문서 반영은 "삽입" 버튼을 눌렀을 때만 `RN.editor.insert*`.

## 끝날 때 보고
만든 파일, 구현한 것/못 한 것(SPEC 대비), 테스트 결과, index.html이나 core.js에 필요한 변경 요청, 다른 모듈에 기대하는 것.

## 2차 변경 (사용자 요청)
- `RN.caps.assets`(null일 수 있음): 파일 업로드. 사용법은 `…/0.2.96/assets.d.ts`. 로컬 mock은 blob: URL을 돌려준다(`?noassets=1`로 끔). 올린 파일은 db 문서에 `id`만 저장하고 표시할 때는 업로드가 돌려준 `url` 또는 `"/_blob/" + id`를 쓴다(로컬 mock에서는 `window.__mockAssets.get(id).url`).
- `RN.loadScript(url)`: cdnjs의 정확한 버전 스크립트를 필요할 때만 불러온다(예: pdf.js). 첫 화면에서 불러오지 않는다.
- 연구 문서에 `reportAsset: { id, filename, sizeBytes } | null` 추가(결과보고서 PDF 업로드). `report`(문서에서 만든 HTML)와 둘 중 하나.
- HWP 보기 엔진(rhwp WASM, `vendor/`)은 게시하지 않는다. `mod-convert.js`는 HWP 5.x(CFB+zlib 레코드)와 HWPX(zip+XML)를 직접 읽는 자체 파서로 글자·표를 뽑는다. 화면 이름은 그대로 `convert`, 메뉴 문구는 "한글 파일 열기".
- UI 단순화 원칙(모든 모듈): 한 화면에 한 가지 주된 일. 처음 보이는 컨트롤을 줄이고 나머지는 "더 보기"/메뉴/탭 뒤로. 배지는 꼭 필요한 것만(카드당 최대 2개), 테두리·카드 중첩을 줄이고 여백으로 구분. 설명 문장은 한 줄. 버튼 문구는 동사 하나("저장", "공개"). 색 강조는 화면당 주 버튼 하나.
