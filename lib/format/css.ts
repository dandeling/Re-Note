import { fontStack, type FontId } from "@/lib/format/fonts";
import { HEADING_LEVELS, pageDimensions, type FormatRules } from "@/lib/format/rules";

/**
 * 서식 규칙 → CSS (SPEC 7.3 (d): "문서 전체에 CSS 변수 + 노드 속성으로 적용").
 * 에디터와 내보내기(PDF) HTML이 같은 변수·같은 스타일시트를 쓰므로 화면과 PDF가 같은 규칙으로 그려진다.
 *
 * 사용법: 문서를 감싸는 요소에 class="doc-format doc-content", style=formatCssVars(rules),
 * 그리고 formatDataAttrs(rules)를 주고, 그 안에 .tiptap 요소를 둔다.
 */

/** 서식 CSS가 적용되는 범위 (기본 문서 스타일 `.doc-content …`보다 우선하도록 클래스를 겹친다) */
export const FORMAT_SCOPE = ".doc-format.doc-content .tiptap";

const pt = (n: number) => `${n}pt`;
const mm = (n: number) => `${n}mm`;

/** 규칙을 CSS 변수로 바꾼다. 순수 함수. */
export function formatCssVars(rules: FormatRules): Record<string, string> {
  const page = pageDimensions(rules);
  const vars: Record<string, string> = {
    "--fmt-page-width": mm(page.width),
    "--fmt-page-height": mm(page.height),
    "--fmt-margin-top": mm(rules.page.margin.top),
    "--fmt-margin-right": mm(rules.page.margin.right),
    "--fmt-margin-bottom": mm(rules.page.margin.bottom),
    "--fmt-margin-left": mm(rules.page.margin.left),
    "--fmt-body-font": fontStack(rules.body.font),
    "--fmt-body-size": pt(rules.body.sizePt),
    "--fmt-line-height": String(rules.body.lineHeight / 100),
    "--fmt-body-align": rules.body.align,
    "--fmt-indent": pt(rules.paragraph.indentPt),
    "--fmt-para-spacing": pt(rules.paragraph.spacingPt),
    "--fmt-caption-size": pt(rules.caption.sizePt),
    "--fmt-caption-weight": rules.caption.bold ? "700" : "400",
    "--fmt-caption-align": rules.caption.align,
  };
  for (const h of HEADING_LEVELS) {
    const style = rules.headings[h];
    vars[`--fmt-${h}-font`] = fontStack(style.font);
    vars[`--fmt-${h}-size`] = pt(style.sizePt);
    vars[`--fmt-${h}-weight`] = style.bold ? "700" : "400";
    vars[`--fmt-${h}-align`] = style.align;
  }
  return vars;
}

/** 감싸는 요소에 붙이는 data 속성 (캡션 위치 규칙 등, 다른 기능이 읽을 수 있게 노출) */
export function formatDataAttrs(rules: FormatRules): Record<string, string> {
  return {
    "data-page-size": rules.page.size,
    "data-page-orientation": rules.page.orientation,
    "data-caption-figure": rules.caption.figurePosition,
    "data-caption-table": rules.caption.tablePosition,
  };
}

/** style 속성 문자열 (내보내기 HTML용) */
export function formatStyleAttr(rules: FormatRules): string {
  return Object.entries(formatCssVars(rules))
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

const S = FORMAT_SCOPE;
const CAPTION = ["[data-type='caption']", "figcaption", ".doc-caption"].map((c) => `${S} ${c}`).join(", ");

/** 변수만 참조하는 고정 스타일시트. 규칙이 바뀌어도 이 문자열은 그대로고 변수 값만 바뀐다. */
export const FORMAT_CSS = `
${S} {
  font-family: var(--fmt-body-font);
  font-size: var(--fmt-body-size);
  line-height: var(--fmt-line-height);
  text-align: var(--fmt-body-align);
  color: #111;
}
${S} > * + * { margin-top: 0; }
${S} p { margin: 0 0 var(--fmt-para-spacing); text-indent: var(--fmt-indent); }
${S} li p, ${S} td p, ${S} th p, ${S} blockquote p { text-indent: 0; }
${S} li p, ${S} td p, ${S} th p { margin-bottom: 0; }
${S} ul, ${S} ol, ${S} table, ${S} blockquote, ${S} pre, ${S} img { margin-bottom: var(--fmt-para-spacing); }
${HEADING_LEVELS.map(
  (h) => `${S} ${h} {
  font-family: var(--fmt-${h}-font);
  font-size: var(--fmt-${h}-size);
  font-weight: var(--fmt-${h}-weight);
  text-align: var(--fmt-${h}-align);
  line-height: 1.35;
  margin: 1em 0 0.5em;
  text-indent: 0;
}`,
).join("\n")}
${S} > :first-child { margin-top: 0; }
${CAPTION} {
  font-size: var(--fmt-caption-size);
  font-weight: var(--fmt-caption-weight);
  text-align: var(--fmt-caption-align);
  text-indent: 0;
}
`;

/** 화면(에디터) 전용: 본문을 용지 폭·여백에 맞춰 종이처럼 보여 준다. */
export const FORMAT_SCREEN_CSS = `
@media (min-width: 768px) {
  ${S} {
    box-sizing: border-box;
    width: 100%;
    max-width: var(--fmt-page-width);
    margin-inline: auto;
    padding: var(--fmt-margin-top) var(--fmt-margin-right) var(--fmt-margin-bottom) var(--fmt-margin-left);
  }
}
`;

const PAGE_NUMBER_CONTENT: Record<FormatRules["pageNumber"]["style"], string> = {
  n: "counter(page)",
  dash: '"- " counter(page) " -"',
  total: 'counter(page) " / " counter(pages)',
};

/** 인쇄(PDF) 전용: 용지 크기·여백·쪽 번호. 순수 함수. */
export function formatPageCss(rules: FormatRules): string {
  const page = pageDimensions(rules);
  const m = rules.page.margin;
  const number = rules.pageNumber.enabled
    ? `
  @${rules.pageNumber.position} {
    content: ${PAGE_NUMBER_CONTENT[rules.pageNumber.style]};
    font-family: ${fontStack(rules.body.font)};
    font-size: 9pt;
    color: #111;
  }`
    : "";
  return `
@page {
  size: ${mm(page.width)} ${mm(page.height)};
  margin: ${mm(m.top)} ${mm(m.right)} ${mm(m.bottom)} ${mm(m.left)};${number}
}
html, body { margin: 0; padding: 0; background: #fff; }
`;
}

/** 규칙이 쓰는 글꼴 목록 (PDF에 넣을 @font-face를 고를 때 쓴다) */
export function usedFonts(rules: FormatRules): FontId[] {
  return [...new Set<FontId>([rules.body.font, ...HEADING_LEVELS.map((h) => rules.headings[h].font)])];
}
