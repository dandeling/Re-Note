import { describe, expect, it } from "vitest";
import { markdownExcerpt, renderMarkdown } from "@/lib/markdown";

describe("renderMarkdown", () => {
  it("기본 마크다운을 HTML로 바꾼다", () => {
    const html = renderMarkdown("# 제목\n\n**굵게** 그리고 `코드`\n\n- 하나\n- 둘\n\n[링크](https://example.com/a?b=1)");
    expect(html).toContain("<h1>제목</h1>");
    expect(html).toContain("<strong>굵게</strong>");
    expect(html).toContain("<code>코드</code>");
    expect(html).toContain("<li>하나</li>");
    expect(html).toContain('<a href="https://example.com/a?b=1" rel="nofollow noopener noreferrer ugc">링크</a>');
  });

  it("표와 줄바꿈을 지원한다", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n첫 줄\n둘째 줄");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("첫 줄<br />");
  });

  // SPEC 9장: 마크다운 출력은 sanitize
  const attacks: [string, string][] = [
    ["script 태그", "<script>alert(1)</script>"],
    ["script 태그(대소문자·공백)", "<ScRiPt >alert(1)</sCrIpT >"],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["svg onload", "<svg/onload=alert(1)>"],
    ["iframe", '<iframe src="javascript:alert(1)"></iframe>'],
    ["javascript: 링크", "[눌러보세요](javascript:alert(1))"],
    ["javascript: 링크(대소문자)", "[x](JaVaScRiPt:alert(1))"],
    ["javascript: 링크(엔티티)", "[x](&#106;avascript:alert(1))"],
    ["javascript: 링크(탭 섞기)", "[x](java\tscript:alert(1))"],
    ["vbscript: 링크", "[x](vbscript:msgbox(1))"],
    ["data: 링크", "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["자동 링크", "<javascript:alert(1)>"],
    ["참조 링크", "[x][1]\n\n[1]: javascript:alert(1)"],
    ["이미지 onerror 주입", '![x](x" onerror="alert(1))'],
    ["이미지 javascript", "![x](javascript:alert(1))"],
    ["링크 제목으로 속성 주입", '[x](https://example.com "a\\" onmouseover=\\"alert(1)")'],
    ["인라인 이벤트 속성", '<a href="https://example.com" onclick="alert(1)">x</a>'],
    ["style 속성", '<p style="background:url(javascript:alert(1))">x</p>'],
    ["style 태그", "<style>body{display:none}</style>"],
    ["form", '<form action="https://evil.example"><input name="pw"></form>'],
    ["코드 블록 안의 script", "```html\n<script>alert(1)</script>\n```"],
    ["인용 안의 HTML", "> <img src=x onerror=alert(1)>"],
    ["프로토콜 상대 링크", "[x](//evil.example/x)"],
  ];

  it.each(attacks)("XSS 차단: %s", (_name, source) => {
    const html = renderMarkdown(source);
    // 실행 가능한 태그가 태그로 남지 않는다(이스케이프된 글자 &lt;script&gt;는 안전하다).
    expect(html).not.toMatch(/<\s*(script|img|svg|iframe|style|form|input|object|embed|link|meta|base)\b/i);
    // 어떤 태그에도 이벤트 핸들러·style 속성이 없다.
    for (const tagText of html.match(/<[a-z][^>]*>/gi) ?? []) {
      expect(tagText).not.toMatch(/\son\w+\s*=/i);
      expect(tagText).not.toMatch(/\sstyle\s*=/i);
      expect(tagText).not.toMatch(/\ssrc\s*=/i);
      // 링크는 http(s)·mailto만 남는다.
      const href = /\shref="([^"]*)"/i.exec(tagText)?.[1];
      if (href !== undefined) expect(href).toMatch(/^(https?:\/\/|mailto:)/i);
    }
  });

  it("원문 HTML은 글자로 보인다", () => {
    expect(renderMarkdown("<b>굵게?</b>")).toContain("&lt;b&gt;굵게?&lt;/b&gt;");
  });

  it("외부 이미지는 렌더링하지 않는다", () => {
    expect(renderMarkdown("![추적](https://tracker.example/p.png)")).not.toMatch(/<img/i);
  });
});

describe("markdownExcerpt", () => {
  it("마크다운 기호를 걷어 내고 길이를 제한한다", () => {
    expect(markdownExcerpt("# 제목\n\n**굵게** [링크](https://a.b) `코드`\n- 항목")).toBe("제목 굵게 링크 코드 항목");
    const long = markdownExcerpt("가".repeat(500), 20);
    expect(long).toHaveLength(21);
    expect(long.endsWith("…")).toBe(true);
  });
});
