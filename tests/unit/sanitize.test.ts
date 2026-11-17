import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import katex from "katex";
import { parseFragment } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ResearchPage from "@/app/research/[id]/page";
import { prisma } from "@/lib/db";
import type { DocContent } from "@/lib/editor/content";
import { documentBodyHtml, exportHtmlDocument } from "@/lib/export/html";
import { DEFAULT_RULES } from "@/lib/format/rules";
import { renderMarkdown } from "@/lib/markdown";
import { MATH_PALETTE } from "@/lib/math/palette";
import { createUser, resetDb } from "../setup/db";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

/**
 * SPEC 9장 "마크다운·HTML 출력은 sanitize" 점검 (P8-1).
 * 1) 코드베이스의 모든 `dangerouslySetInnerHTML`을 찾아, 허용 목록에 있는 것만 있는지와 각각의 입력이 안전한지 확인한다.
 * 2) 마크다운(고충 본문·댓글·해결 방법), 내보내기 HTML(수식 포함), 연구 요약·한계(React 이스케이프)에 공격 문자열을 넣어 본다.
 * 챗봇 답변은 `components/chat`에서 React 텍스트로만 그리므로 1)의 검사로 확인한다(HTML 주입 경로가 없음).
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const XSS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  "[링크](javascript:alert(1))",
  "<svg onload=alert(1)>",
  '<iframe src="https://evil.example"></iframe>',
  "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
].join("\n\n");

type El = { nodeName: string; attrs?: { name: string; value: string }[]; childNodes?: El[]; content?: El };

/** 실제로 만들어진 요소만 본다(이스케이프된 글자 `&lt;script&gt;`는 텍스트라 괜찮다). */
function expectNoActiveContent(html: string, opts: { allowIframeSrc?: RegExp } = {}) {
  const bad: string[] = [];
  const walk = (node: El) => {
    const name = node.nodeName;
    if (["script", "object", "embed", "img", "foreignobject"].includes(name)) bad.push(`<${name}>`);
    if (name === "iframe") {
      const src = node.attrs?.find((a) => a.name === "src")?.value ?? "";
      if (!opts.allowIframeSrc?.test(src)) bad.push(`<iframe src=${src}>`);
    }
    for (const a of node.attrs ?? []) {
      if (/^on/i.test(a.name)) bad.push(`${name}[${a.name}]`);
      if (["href", "src", "xlink:href", "action"].includes(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value)) {
        bad.push(`${name}[${a.name}=${a.value}]`);
      }
    }
    node.childNodes?.forEach(walk);
    if (node.content) walk(node.content);
  };
  walk(parseFragment(html) as unknown as El);
  expect(bad).toEqual([]);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "generated") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** dangerouslySetInnerHTML 사용처와, 그 입력이 안전한 이유(코드에서 확인할 문자열) */
const ALLOWED_INNER_HTML: Record<string, RegExp> = {
  // 사용자 마크다운: markdown-it(html:false) + sanitize-html 허용 목록
  "components/pains/markdown.tsx": /__html: renderMarkdown\(source\)/,
  // 수식 팔레트: 코드에 고정된 LaTeX 상수만 KaTeX(trust 꺼짐)로 그림
  "components/editor/math-panel.tsx": /MATH_PALETTE\.map[\s\S]*katex\.renderToString\(item\.preview \?\? item\.latex/,
  // AI·사용자가 낸 LaTeX 미리보기: KaTeX가 만든 HTML만 넣고, trust 옵션을 켜지 않는다(\href 등 비활성)
  "components/editor/math-ai-panel.tsx":
    /katex\.renderToString\(result\.latex, \{ displayMode: result\.display === "block", throwOnError: true \}\)/,
};

describe("dangerouslySetInnerHTML 사용처", () => {
  const files = ["app", "components", "lib", "server"].flatMap((d) => sourceFiles(path.join(ROOT, d)));
  const users = files
    .filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"))
    .map((f) => path.relative(ROOT, f));

  it("허용 목록에 있는 파일에서만 쓴다 (새로 쓰면 이 목록에 sanitize 근거와 함께 추가)", () => {
    expect(users.sort()).toEqual(Object.keys(ALLOWED_INNER_HTML).sort());
  });

  it.each(Object.entries(ALLOWED_INNER_HTML))("%s: 입력이 sanitize된 값이거나 고정 상수다", (file, pattern) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src).toMatch(pattern);
    // KaTeX의 trust 옵션을 켜면 \href·\htmlData 등으로 임의 HTML을 넣을 수 있다.
    expect(src).not.toMatch(/trust\s*:/);
  });

  it("챗봇 답변·제안은 HTML로 넣지 않는다 (React 텍스트 이스케이프)", () => {
    for (const f of sourceFiles(path.join(ROOT, "components/chat"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
    }
  });

  it("수식 팔레트의 KaTeX 출력에는 실행 가능한 내용이 없다", () => {
    for (const item of MATH_PALETTE.flatMap((g) => g.items)) {
      expectNoActiveContent(katex.renderToString(item.preview ?? item.latex, { throwOnError: false }));
    }
  });
});

describe("마크다운 출력 (고충 본문·댓글·해결 방법)", () => {
  it("스크립트·이벤트 속성·위험한 링크·외부 이미지/iframe을 모두 무력화한다", () => {
    const html = renderMarkdown(XSS);
    expectNoActiveContent(html);
    expect(html).toContain("&lt;script&gt;"); // 원문은 글자로 남는다
  });
});

describe("내보내기 HTML", () => {
  it("본문 텍스트·링크·수식에 넣은 공격 문자열이 실행 가능한 HTML이 되지 않는다", () => {
    const doc: DocContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
        {
          type: "paragraph",
          content: [{ type: "mathInline", attrs: { latex: "\\href{javascript:alert(1)}{x} \\htmlClass{a}{b}" } }],
        },
        { type: "mathBlock", attrs: { latex: '"><script>alert(1)</script>', id: "eq1" } },
      ],
    };
    const html = documentBodyHtml(doc);
    expectNoActiveContent(html);
    const full = exportHtmlDocument({ doc, rules: DEFAULT_RULES, title: "<script>alert(1)</script>" });
    expect(full).not.toContain("<script>");
    expect(full).toContain("<title>&lt;script&gt;");
  });
});

describe("연구 요약·한계 표시 (React 이스케이프)", () => {
  it("요약·한계·제목·키워드의 HTML은 글자로 보인다", async () => {
    await resetDb();
    const owner = await createUser();
    const r = await prisma.research.create({
      data: {
        authorId: owner.id,
        title: "<img src=x onerror=alert(1)>",
        summary: "<script>alert(1)</script>",
        limitations: '<a href="javascript:alert(1)">x</a>',
        keywords: ["<svg onload=alert(1)>"],
      },
    });
    const element = await ResearchPage({
      params: Promise.resolve({ id: r.id }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/research/[id]">);
    const html = renderToStaticMarkup(element);
    expectNoActiveContent(html, { allowIframeSrc: /^\/api\/research\/[a-z0-9]+\/report$/ });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
