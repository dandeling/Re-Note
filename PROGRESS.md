# PROGRESS.md

SPEC.md 12장의 Phase와 7장의 완료 기준을 체크리스트로 옮긴 것. 루프 1회에 맨 앞의 미완료 항목 하나만 처리한다.
`[x]` 완료(lint·typecheck·test 통과 후 커밋) · `[ ]` 미완료 · `[!]` BLOCKED (BLOCKED.md 참고)

## Phase 0 — 기반 + HWP 스파이크
- [x] P0-1 저장소 초기화 (Next.js App Router + TS + Tailwind, lint/typecheck/test 스크립트, messages/ko.json, .env.example)
- [x] P0-2 docker-compose.yml (web, db, redis, minio, worker) + Dockerfile — `docker compose config` 검증만 함. TODO: Docker 데몬 있는 환경에서 실제 기동 확인
- [x] P0-3 Prisma 스키마 (SPEC 6장) + 마이그레이션 (pg_trgm, pgvector)
- [x] P0-4 Auth.js 로그인 (이메일 매직링크 + Google OAuth), /login
- [x] P0-5 기본 레이아웃 (shadcn/ui, 헤더·내비게이션, 5장 페이지 골격)
- [x] P0-6 HWP 변환 스파이크 → docs/hwp-spike.md

## Phase 1 — 프로젝트 + 에디터 + 자동 저장
- [x] P1-1 공통 API 기반 (zod 검증, 에러 형식 `{error:{code,message}}`, 세션·소유자 검사 헬퍼)
- [x] P1-2 프로젝트 CRUD API + /projects, /projects/[id] 화면
- [x] P1-3 [7.6] 다른 사용자의 프로젝트·문서 ID로 요청하면 404 (테스트)
- [x] P1-4 [7.6] 보관·삭제(30일 휴지통): 삭제 시 하위 문서·자산이 함께 휴지통으로, 복구 가능
- [x] P1-5 문서 API + Tiptap 에디터 화면
- [x] P1-6 자동 저장 (2초 디바운스, 상태 표시, 낙관적 잠금 충돌 처리)
- [x] P1-7 [7.5] 입력 후 새로고침해도 내용 유지
- [x] P1-8 [7.5] IndexedDB 로컬 초안, 오프라인 작성 후 온라인 복귀 시 자동 동기화
- [x] P1-9 스냅샷 (10분 자동 + 수동, 복원, 문서당 최근 50개)

## Phase 2 — 보고서 도우미 I
- [x] P2-1 캡션 노드 + 번호 자동 부여·재정렬 (순수 함수 + 단위 테스트), 단축키
- [x] P2-2 [7.3] 상호 참조(@그림): 그림 3개 중 2번째 삭제 시 캡션·참조 번호 자동 변경
- [x] P2-3 그림 목차 / 표 목차 자동 생성
- [x] P2-4 수식: `$..$`·`$$..$$` KaTeX 렌더링, 팔레트, 블록 수식 번호
- [x] P2-5 서식 rulesJson zod 스키마, 프리셋 3종, 템플릿 API, CSS 변수 적용
- [x] P2-6 서식 검사 + "모두 고치기"
- [x] P2-7 내보내기: PDF(Playwright 인쇄), DOCX, Markdown
- [x] P2-8 [7.3] 서식 규칙 변경이 문서 전체에 즉시 반영되고 PDF에도 동일 적용

## Phase 3 — 변환·가져오기
- [x] P3-1 자산 업로드 (S3 presigned URL, 확장자+매직바이트 검증)
- [x] P3-2 변환 워커 (BullMQ, LibreOffice, 타임아웃 120초, 실패 사유)
- [x] P3-3 [7.3] /tools/convert: 샘플 HWP/HWPX가 PDF로 변환·다운로드
- [x] P3-4 가져오기: Markdown, DOCX → 새 문서 (덮어쓰기 금지)
- [x] P3-5 [7.5] 가져오기: PDF, HWP/HWPX → 편집 가능한 문서

## Phase 4 — CSV → 표·그래프
- [x] P4-1 CSV 파싱 (UTF-8/CP949 자동 감지, 열 타입 추론, 결측·단위) + Dataset API
- [x] P4-2 표 만들기 → 에디터 표 노드 삽입 (+캡션)
- [x] P4-3 그래프 만들기 (5유형, 오차막대, 로그 축, 추세선·R² 코드 계산) → 삽입, 재편집
- [x] P4-4 [7.3] CP949 한글 CSV가 깨지지 않고 표·그래프로 만들어진다

## Phase 5 — 고충 게시판
- [x] P5-1 [7.1] 로그인 사용자가 고충 작성·수정·삭제
- [x] P5-2 [7.1] 비로그인 사용자도 목록·상세 읽기 (정렬·필터·검색)
- [x] P5-3 [7.1] 익명 글 작성자 정보가 API 응답에 미포함 (테스트)
- [x] P5-4 댓글, "나도 겪었어요", 신고
- [x] P5-5 [7.1] 해결됨 처리 시 해결 방법 상단 강조

## Phase 6 — 연구 아카이브·검색
- [x] P6-1 연구 공개 흐름 (POST /api/research, 확인 모달)
- [x] P6-2 하이브리드 검색 (pg_trgm + 선택적 pgvector, EmbeddingProvider)
- [x] P6-3 [7.2] 검색 결과가 사이트 내부 데이터만으로 구성 (외부 호출 없음)
- [x] P6-4 [7.2] 결과 없음 화면 명확히 표시
- [x] P6-5 [7.2] 오타·띄어쓰기 변형 한국어 키워드 검색 (trigram 테스트)
- [x] P6-6 [7.2] /research/[id]: 고충·한계·결과보고서 한 화면, 비슷한 연구 추천
- [x] P6-7 시드 데이터 (연구 30건, 고충 60건), 프로젝트 홈 추천

## Phase 7 — AI 챗봇
- [x] P7-1 /api/chat SSE 스트리밍, 스레드 저장, 일일 한도·rate limit
- [x] P7-2 [7.4] search_site 도구: 내부 검색 결과와 출처 링크로 답변
- [x] P7-3 [7.4] 에디터에서 문단 선택 → 제안 → "삽입" 버튼으로만 반영
- [x] P7-4 AI 보조 API: latex(자연어·이미지), format, chart-suggest
- [x] P7-5 [7.3] `$$` 입력과 자연어 입력 모두로 수식 삽입
- [x] P7-6 [7.4] API 키가 클라이언트 번들에 노출되지 않는다 (테스트)
- [x] P7-7 전역 플로팅 챗봇 버튼 + 에디터 우측 패널

## Phase 8 — 마무리
- [x] P8-1 rate limit (인증·AI·업로드), sanitize, 구조화 로그, 계정 삭제
- [x] P8-2 접근성 점검 (키보드, 명도 대비)
- [x] P8-3 README (로컬 실행, 환경변수, 배포), 완료 기준 표

## SPEC 13장 E2E 시나리오 (Playwright)
- [x] E2E-1 가입 → 프로젝트 생성 → 문서 작성 → 새로고침 후 내용 유지
- [x] E2E-2 HWP 가져오기 → 서식 템플릿 적용 → 그림 캡션 → PDF 내보내기
- [x] E2E-3 CSV 업로드 → 산점도+추세선 → 문서 삽입 → 캡션 번호 자동 부여
- [x] E2E-4 고충 작성 → 다른 계정 댓글·공감 → 원 작성자 해결됨 처리
- [x] E2E-5 연구 공개 → 다른 계정 키워드 검색 → 연구 상세 확인
- [x] E2E-6 챗봇 "○○ 관련 연구 있어?" → 내부 링크 답변 / 없는 주제는 "없음"
- [x] E2E-7 타 사용자의 프로젝트 URL 직접 접근 → 404
