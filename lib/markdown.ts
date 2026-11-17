import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

/**
 * 사용자 마크다운 → 안전한 HTML (SPEC 9장: 마크다운 출력은 sanitize).
 *
 * 1) markdown-it은 `html: false`라 원문 HTML을 글자로 이스케이프하고, `javascript:` 같은 링크는 링크로 만들지 않는다.
 * 2) 그 결과를 sanitize-html 허용 목록으로 한 번 더 거른다(이중 방어).
 * 외부 이미지는 열람자 IP 추적에 쓰일 수 있어 렌더링하지 않는다(docs/decisions.md pains-3).
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable("image");

const ALLOWED_TAGS = [
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "s", "code", "pre", "blockquote",
  "ul", "ol", "li", "a",
  "table", "thead", "tbody", "tr", "th", "td",
];

export function renderMarkdown(source: string): string {
  return sanitizeHtml(md.render(source), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href", "rel"], ol: ["start"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    disallowedTagsMode: "escape",
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer ugc" }),
    },
  });
}

/** 목록용 요약: 마크다운 기호를 대충 걷어 낸 한 줄 텍스트 */
export function markdownExcerpt(source: string, max = 160): string {
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
