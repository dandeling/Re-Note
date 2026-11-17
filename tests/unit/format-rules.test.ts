import { describe, expect, it } from "vitest";
import { FORMAT_CSS, formatCssVars, formatDataAttrs, formatPageCss, usedFonts } from "@/lib/format/css";
import { FONT_IDS, resolveFont } from "@/lib/format/fonts";
import { FORMAT_PRESETS } from "@/lib/format/presets";
import { validateRulesPatch } from "@/lib/format/patch";
import { DEFAULT_RULES, formatRulesSchema, normalizeRules, pageDimensions } from "@/lib/format/rules";

describe("validateRulesPatch (AI 자유 텍스트 → 서식 규칙 조각)", () => {
  it("입력에 있고 올바른 항목만 남긴다", () => {
    expect(
      validateRulesPatch({
        page: { margin: { top: 30, left: -5 }, orientation: "landscape" },
        paragraph: { indentPt: "10" },
        pageNumber: { enabled: false, style: "dash" },
        caption: { bold: true },
      }),
    ).toEqual({ page: { margin: { top: 30 }, orientation: "landscape" }, pageNumber: { enabled: false, style: "dash" }, caption: { bold: true } });
  });

  it("제공 글꼴은 ID로, 대체 글꼴은 요청 이름 그대로 두어 폼 채우기에서 알림이 나온다", () => {
    const patch = validateRulesPatch({ body: { font: "나눔명조" }, headings: { h2: { font: "함초롬돋움" } } });
    expect(patch).toEqual({ body: { font: "nanum-myeongjo" }, headings: { h2: { font: "함초롬돋움" } } });
    const filled = normalizeRules(patch, DEFAULT_RULES);
    expect(filled.rules.headings.h2.font).toBe("noto-sans-kr");
    expect(filled.rules.headings.h1.font).toBe("nanum-myeongjo");
    expect(filled.fontNotices).toEqual([{ path: "headings.h2.font", requested: "함초롬돋움", font: "noto-sans-kr" }]);
  });

  it("객체가 아니거나 올바른 항목이 없으면 예외", () => {
    expect(() => validateRulesPatch(["x"])).toThrow();
    expect(() => validateRulesPatch({ body: { sizePt: 999 } })).toThrow();
    expect(() => validateRulesPatch({ body: { font: 3 } })).toThrow();
  });
});

describe("서식 규칙 스키마 (SPEC 7.3 (d))", () => {
  it("프리셋 3종(일반 보고서 / 학술 논문형 / 탐구 보고서형)이 모두 스키마를 통과한다", () => {
    expect(FORMAT_PRESETS.map((p) => p.name)).toEqual(["일반 보고서", "학술 논문형", "탐구 보고서형"]);
    for (const preset of FORMAT_PRESETS) expect(formatRulesSchema.safeParse(preset.rules).success).toBe(true);
    expect(new Set(FORMAT_PRESETS.map((p) => p.id)).size).toBe(3);
  });

  it("캡션 위치의 기본은 그림 아래·표 위", () => {
    for (const preset of FORMAT_PRESETS) {
      expect(preset.rules.caption.figurePosition).toBe("below");
      expect(preset.rules.caption.tablePosition).toBe("above");
    }
  });

  it("범위를 벗어난 값과 모르는 글꼴 id는 거부한다", () => {
    const bad = (patch: (r: typeof DEFAULT_RULES) => void) => {
      const rules = structuredClone(DEFAULT_RULES);
      patch(rules);
      return formatRulesSchema.safeParse(rules).success;
    };
    expect(bad((r) => (r.body.sizePt = 200))).toBe(false);
    expect(bad((r) => (r.page.margin.top = -1))).toBe(false);
    expect(bad((r) => (r.body.lineHeight = 20))).toBe(false);
    expect(bad((r) => ((r.body as { font: string }).font = "함초롬바탕"))).toBe(false);
    expect(bad((r) => ((r.page as { size: string }).size = "A3"))).toBe(false);
  });

  it("가로 방향이면 용지의 가로·세로가 바뀐다", () => {
    expect(pageDimensions(DEFAULT_RULES)).toEqual({ width: 210, height: 297 });
    const landscape = { ...DEFAULT_RULES, page: { ...DEFAULT_RULES.page, orientation: "landscape" as const } };
    expect(pageDimensions(landscape)).toEqual({ width: 297, height: 210 });
  });
});

describe("글꼴 매핑 (순수 함수)", () => {
  it("제공 글꼴은 이름·별칭·id 어느 쪽으로 들어와도 그대로 쓴다", () => {
    expect(resolveFont("Noto Sans KR")).toEqual({ font: "noto-sans-kr", substituted: false, requested: "Noto Sans KR" });
    expect(resolveFont("본명조").font).toBe("noto-serif-kr");
    expect(resolveFont(" 나눔 고딕 ")).toMatchObject({ font: "nanum-gothic", substituted: false });
    expect(resolveFont("nanum-myeongjo")).toMatchObject({ font: "nanum-myeongjo", substituted: false });
  });

  it("임베드할 수 없는 글꼴(함초롬바탕 등)은 가장 가까운 글꼴로 대체하고 대체 사실을 알린다", () => {
    expect(resolveFont("함초롬바탕")).toEqual({ font: "noto-serif-kr", substituted: true, requested: "함초롬바탕" });
    expect(resolveFont("함초롬돋움")).toMatchObject({ font: "noto-sans-kr", substituted: true });
    expect(resolveFont("맑은 고딕")).toMatchObject({ font: "noto-sans-kr", substituted: true });
    expect(resolveFont("바탕체")).toMatchObject({ font: "nanum-myeongjo", substituted: true });
    expect(resolveFont("굴림")).toMatchObject({ font: "nanum-gothic", substituted: true });
    expect(resolveFont("Times New Roman")).toMatchObject({ font: "noto-serif-kr", substituted: true });
  });

  it("모르는 글꼴은 이름으로 명조/고딕 계열을 추정해 대체한다", () => {
    expect(resolveFont("어떤명조체")).toMatchObject({ font: "noto-serif-kr", substituted: true });
    expect(resolveFont("Some Unknown Font")).toMatchObject({ font: "noto-sans-kr", substituted: true });
    for (const name of ["함초롬바탕", "아무거나", "", "Comic Sans"]) expect(FONT_IDS).toContain(resolveFont(name).font);
  });
});

describe("normalizeRules: 임의의 rulesJson을 폼에 채울 수 있는 완전한 규칙으로", () => {
  it("일부만 있는 규칙(AI 변환 결과)을 채우고, 대체한 글꼴을 알림으로 돌려준다", () => {
    // "본문 함초롬바탕 10pt, 줄간격 160%, 제목은 가운데 정렬 16pt 굵게"
    const { rules, fontNotices, defaulted } = normalizeRules({
      body: { font: "함초롬바탕", sizePt: 10, lineHeight: 160 },
      headings: { h1: { sizePt: 16, bold: true, align: "center" } },
    });
    expect(formatRulesSchema.safeParse(rules).success).toBe(true);
    expect(rules.body).toMatchObject({ font: "noto-serif-kr", sizePt: 10, lineHeight: 160 });
    expect(rules.headings.h1).toEqual({ font: "noto-serif-kr", sizePt: 16, bold: true, align: "center" });
    // 제목 글꼴을 따로 주지 않았으므로 본문 글꼴을 따른다.
    expect(rules.headings.h3.font).toBe("noto-serif-kr");
    expect(fontNotices).toEqual([{ path: "body.font", requested: "함초롬바탕", font: "noto-serif-kr" }]);
    expect(defaulted).toContain("page.size");
    expect(defaulted).not.toContain("body.sizePt");
    expect(rules.page).toEqual(DEFAULT_RULES.page);
  });

  it("올바르지 않은 값은 그 자리만 기본값으로 되돌린다", () => {
    const { rules, defaulted } = normalizeRules({ ...DEFAULT_RULES, body: { ...DEFAULT_RULES.body, sizePt: 500 } });
    expect(rules.body.sizePt).toBe(DEFAULT_RULES.body.sizePt);
    expect(defaulted).toEqual(["body.sizePt"]);
  });

  it("완전한 규칙은 그대로 통과하고, 객체가 아닌 입력은 기본 규칙이 된다", () => {
    const preset = FORMAT_PRESETS[1].rules;
    expect(normalizeRules(preset)).toEqual({ rules: preset, fontNotices: [], defaulted: [] });
    expect(normalizeRules(null).rules).toEqual(DEFAULT_RULES);
    expect(normalizeRules("본문 10pt").rules).toEqual(DEFAULT_RULES);
  });
});

describe("규칙 → CSS", () => {
  it("규칙을 CSS 변수로 바꾼다", () => {
    const vars = formatCssVars(FORMAT_PRESETS[1].rules);
    expect(vars["--fmt-body-font"]).toBe('"Noto Serif KR", serif');
    expect(vars["--fmt-body-size"]).toBe("10pt");
    expect(vars["--fmt-line-height"]).toBe("1.6");
    expect(vars["--fmt-indent"]).toBe("10pt");
    expect(vars["--fmt-h1-align"]).toBe("center");
    expect(vars["--fmt-h1-size"]).toBe("16pt");
    expect(vars["--fmt-page-width"]).toBe("210mm");
    expect(vars["--fmt-margin-top"]).toBe("30mm");
    // 스타일시트는 변수만 참조한다.
    for (const name of Object.keys(vars)) expect(FORMAT_CSS + "--fmt-page-width --fmt-page-height --fmt-margin").toContain(name.replace(/-(top|right|bottom|left)$/, ""));
  });

  it("캡션 위치 규칙은 data 속성으로 노출한다", () => {
    expect(formatDataAttrs(DEFAULT_RULES)).toMatchObject({ "data-caption-figure": "below", "data-caption-table": "above" });
  });

  it("인쇄 CSS에 용지 크기·여백·쪽 번호가 들어간다", () => {
    const css = formatPageCss(FORMAT_PRESETS[1].rules);
    expect(css).toContain("size: 210mm 297mm");
    expect(css).toContain("margin: 30mm 25mm 25mm 25mm");
    expect(css).toContain("@bottom-center");
    expect(css).toContain('"- " counter(page) " -"');
    const off = formatPageCss({ ...DEFAULT_RULES, pageNumber: { ...DEFAULT_RULES.pageNumber, enabled: false } });
    expect(off).not.toContain("counter(page)");
  });

  it("규칙이 쓰는 글꼴 목록", () => {
    expect(usedFonts(DEFAULT_RULES)).toEqual(["noto-sans-kr"]);
    const mixed = structuredClone(DEFAULT_RULES);
    mixed.headings.h1.font = "nanum-myeongjo";
    expect(usedFonts(mixed)).toEqual(["noto-sans-kr", "nanum-myeongjo"]);
  });
});
