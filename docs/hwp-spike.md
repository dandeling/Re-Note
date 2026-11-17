# HWP 변환 스파이크 (Phase 0)

- 수행일: 2026-11-16
- 환경: Ubuntu 24.04, LibreOffice 24.2.7, OpenJDK 21, Node 22, Chromium(Playwright 1.63)
- 재현: `worker/spike/fetch-samples.sh` → `worker/spike/run-spike.sh tests/fixtures/hwp/third-party <출력 디렉터리>`

## 1. 결론

**H2Orestart 단독으로는 부족하다.** 변환 워커는 한 엔진에 의존하지 않고 **엔진 체인(순서대로 시도, 실패·빈 결과면 다음 엔진)** 으로 구현한다.

| 입력 | 1순위 | 2순위 | 3순위 |
|---|---|---|---|
| `.hwp` (HWP 5.x) | pyhwp `hwp5odt` → ODT → LibreOffice → PDF | LibreOffice + H2Orestart | rhwp(WASM) + Chromium 인쇄 |
| `.hwpx` | LibreOffice + H2Orestart | rhwp(WASM) + Chromium 인쇄 | — |

- 각 단계는 별도 프로세스로 실행하고 타임아웃(전체 120초)과 **크래시(비정상 종료)를 실패로 처리**한다.
- "성공"은 종료 코드만으로 판단하지 않는다. PDF가 생성되고 쪽수 ≥ 1이며, 원본에 글자가 있는데 PDF 텍스트가 비어 있으면 실패로 보고 다음 엔진으로 넘어간다(아래 3.1의 빈 PDF 사례 때문).
- 가져오기(HWP → 에디터 문서, Phase 3)는 PDF가 아니라 구조가 필요하므로 `hwp5html`(pyhwp) 또는 `unhwp`(Markdown 추출)를 중간 포맷으로 쓴다. 두 도구 모두 샘플 9개에서 오류 없이 텍스트·표를 추출했다.
- 화면에는 SPEC대로 "레이아웃이 원본과 다를 수 있음" 안내를 항상 표시한다.

## 2. 샘플

요구된 5종(표, 수식, 그림, 다단, 각주) 가운데 **수식 샘플은 구하지 못했다.** 사용자 제공 샘플 없이 진행했기 때문에 공개 저장소(pyhwp 테스트 픽스처, HWP 5.0.1.7 시절 문서)를 사용했다.

| 샘플 | 포함 요소 |
|---|---|
| `sample-5017.hwp` | 표(병합·배경색), 그림, 머리말, 각주·미주 |
| `footnote-endnote.hwp` | 각주, 미주 |
| `multicolumns.hwp` | 다단(3단) |
| `shapepict-scaled.hwp` | 그림 |
| `matrix.hwp`, `textbox.hwp` | 도형(회전), 글상자 |
| `charshape.hwp`, `facename.hwp`, `pagedefs.hwp` | 글자 모양, 글꼴, 쪽 설정 |

HWPX는 한컴오피스로 저장한 원본을 구하지 못해, 위 HWP를 rhwp의 `exportHwpx()`로 변환한 파일 9개로 대신했다. **한컴이 직접 만든 HWPX가 아니므로 HWPX 결과는 참고용이다.**

## 3. 결과

### 3.1 성공 여부 (샘플 9개)

| 경로 | HWP 성공 | HWPX 성공 | 파일당 시간 | 비고 |
|---|---|---|---|---|
| A. LibreOffice + H2Orestart 0.6.1 | **6 / 9** | 8 / 9 | 1.3–2.9초 | 실패는 모두 `soffice` 비정상 종료(Signal 6, "Unspecified Application Error"). HWPX 8건 중 `sample-5017`, `shapepict-scaled`는 **종료 코드 0인데 내용이 빈 PDF** |
| B. pyhwp → ODT → LibreOffice | **9 / 9** | 지원 안 함 | 1.7–2.1초 | HWP 5.x 전용 |
| C. rhwp 0.9.0 + Chromium | **9 / 9** | 1 / 1 (1건만 시험) | 1.1–1.5초 | 쪽 단위 SVG 렌더링 후 인쇄 |

A에서 크래시한 HWP: `sample-5017`(표+그림), `footnote-endnote`(각주), `shapepict-scaled`(그림).

### 3.2 품질 (PDF 1쪽을 이미지로 떠서 눈으로 비교)

| 요소 | A. H2Orestart | B. pyhwp | C. rhwp |
|---|---|---|---|
| 표 | 크래시 | 양호 (병합·배경색 유지) | 표는 나오나 일부 셀이 본문과 겹침 |
| 그림 | 크래시 | 양호 | 양호 |
| 각주 | 크래시 | 양호 (쪽 아래 배치) | 양호 |
| 다단 | **양호 (3단 유지)** | 단 구성이 풀림(1단, 4쪽으로 늘어남) | 2단으로 나오고 첫 쪽이 빈 쪽 |
| 도형·글상자 | 일부 도형 누락 | 양호 | 양호 |
| 글꼴 | 대체 글꼴 | 대체 글꼴 | 일부 한글 글리프가 깨져 보임(글꼴 대체 문제) |
| 수식 | 미검증 | 미검증 | 미검증 |

원본 한글 프로그램의 출력물과 직접 대조하지는 못했다(한컴오피스가 없음). 위 평가는 세 결과물끼리의 비교와 문서 내용상의 타당성으로 판단한 것이다.

## 4. 한계와 남은 일

- **수식 미검증.** 수식이 들어간 HWP/HWPX 샘플이 필요하다.
- **한컴 원본 HWPX 미검증.** 실제 HWPX로 A·C 경로를 다시 확인해야 한다.
- **H2Orestart 최신판 미검증.** Ubuntu 24.04 패키지는 0.6.1이다. 개발 컨테이너에서 GitHub 릴리스 다운로드가 막혀 최신 0.7.x를 시험하지 못했다. 최신판에서 크래시가 사라지면 `.hwp`도 A를 1순위로 올릴 수 있다.
- **글꼴.** 한컴 전용 글꼴(함초롬바탕 등)은 워커 이미지에 없어 Noto CJK·나눔으로 대체된다. 줄바꿈·쪽수가 원본과 달라질 수 있다.
- **라이선스.** pyhwp는 AGPL-3.0이다. 워커 컨테이너에서 별도 CLI 프로세스로만 호출하고 코드에 링크하지 않는다. 배포 형태에 따라 고지 의무를 확인해야 한다. rhwp는 MIT, H2Orestart는 GPL-3.0(LibreOffice 확장으로 사용).
- **실제 샘플 5종**(표, 수식, 그림, 다단, 각주가 든 `.hwp`·`.hwpx`)을 `tests/fixtures/hwp/`에 넣어 주면 이 문서를 갱신한다.

## 5. 워커 이미지에 필요한 것

`libreoffice-writer`, `libreoffice-h2orestart`, JRE, `fonts-noto-cjk`, `fonts-nanum`, `poppler-utils`, Python + `pyhwp`(+`six`), `unhwp`, Node + `@rhwp/core`, Chromium(Playwright). `worker/Dockerfile`에 반영했다.
