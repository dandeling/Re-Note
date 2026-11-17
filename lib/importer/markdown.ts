import { Lexer, marked, type Token } from "marked";

/**
 * Markdown → 중간 형식 HTML. marked는 원본에 든 HTML을 그대로 통과시키지만,
 * 그 결과는 htmlToDoc의 허용 목록을 거치므로 스크립트·이벤트 속성은 남지 않는다.
 * hadHtml: 원본에 HTML 태그가 있었는지 (품질 안내 MD_HTML)
 */
export function markdownToHtml(source: string): { html: string; hadHtml: boolean } {
  const text = source.replace(/^﻿/, "");
  const tokens = new Lexer({ gfm: true }).lex(text);
  let hadHtml = false;
  marked.walkTokens(tokens, (token: Token) => {
    if (token.type === "html") hadHtml = true;
  });
  const html = marked.parser(tokens, { gfm: true });
  return { html, hadHtml };
}
