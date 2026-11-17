import katex from "katex";
import { describe, expect, it } from "vitest";
import { applyEasyTemplate, EASY_MAIN, EASY_MORE, easyToLatex, latexToEasy } from "@/lib/easy-math";

// artifact/tests/c.spec.cjs의 "easyToLatex: 쉬운 표기 표" 사례를 그대로 옮겼다.
const TABLE: [string, string][] = [
  // 분수
  ["a/b", "\\frac{a}{b}"], ["(x+1)/(x-1)", "\\frac{x+1}{x-1}"], ["2x/3", "\\frac{2x}{3}"], ["x+1/2", "x+\\frac{1}{2}"], ["a/b/c", "\\frac{\\frac{a}{b}}{c}"],
  // 거듭제곱·첨자
  ["x^2", "x^2"], ["x^(n+1)", "x^{n+1}"], ["e^-x", "e^{-x}"], ["a_1", "a_1"], ["a_(ij)", "a_{ij}"], ["x^2^3", "{x^2}^3"],
  // 제곱근
  ["sqrt(x)", "\\sqrt{x}"], ["루트(x+1)", "\\sqrt{x+1}"], ["√x", "\\sqrt{x}"], ["√2/2", "\\frac{\\sqrt{2}}{2}"], ["root(3, x)", "\\sqrt[3]{x}"],
  // 곱셈·기호
  ["a*b", "a\\times b"], ["a·b", "a\\cdot b"], ["+-1", "\\pm1"], ["x<=1", "x\\le1"], ["a>=b", "a\\ge b"], ["a!=b", "a\\ne b"], ["a~=b", "a\\approx b"], ["x->0", "x\\to0"], ["inf", "\\infty"], ["무한대", "\\infty"], ["30°", "30^{\\circ}"],
  // 그리스 문자
  ["alpha+beta", "\\alpha+\\beta"], ["Delta x", "\\Delta x"], ["2pir^2", "2\\pi r^2"], ["알파 + 베타", "\\alpha + \\beta"], ["세타", "\\theta"], ["파이", "\\pi"], ["람다", "\\lambda"], ["시그마", "\\sigma"], ["오메가", "\\omega"], ["델타 t", "\\Delta t"],
  // 함수
  ["sin(x)", "\\sin(x)"], ["sinx", "\\sin x"], ["cos^2(x)+sin^2(x)=1", "\\cos^2(x)+\\sin^2(x)=1"], ["log_2(8)", "\\log_2(8)"], ["ln x", "\\ln x"], ["exp(x)", "\\exp(x)"],
  // 합·적분·극한
  ["sum(i=1, n, a_i)", "\\sum_{i=1}^{n} a_i"], ["int(a, b, f(x) dx)", "\\int_{a}^{b} f(x) \\,dx"], ["int(0, 1, x^2 dx)", "\\int_{0}^{1} x^2 \\,dx"], ["lim(x->0, sin(x)/x)", "\\lim_{x\\to0} \\frac{\\sin(x)}{x}"],
  // 벡터·평균·절댓값
  ["vec(a)", "\\vec{a}"], ["vec(AB)", "\\overrightarrow{AB}"], ["bar(x)", "\\bar{x}"], ["hat(y)", "\\hat{y}"], ["|x|", "\\left|x\\right|"], ["|x-1|<2", "\\left|x-1\\right|<2"],
  // 단위
  ["9.8 m/s^2", "9.8\\,\\mathrm{m/s^2}"], ["F = 10 N", "F = 10\\,\\mathrm{N}"], ["v = 3.0 × 10^8 m/s", "v = 3.0 \\times 10^8\\,\\mathrm{m/s}"], ["2 m + 3 x", "2\\,\\mathrm{m} + 3 x"],
  // 종합
  ["x = (-b +- sqrt(b^2-4ac))/(2a)", "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"],
  // 이미 LaTeX → 그대로
  ["\\frac{a}{b}", "\\frac{a}{b}"], ["\\alpha^{2} + x_{i}", "\\alpha^{2} + x_{i}"], ["E=mc^2", "E=mc^2"],
  // 한글 낱말은 글자로
  ["가속도 = 9.8 m/s^2", "\\text{가속도} = 9.8\\,\\mathrm{m/s^2}"],
  // 서버 앱 확인용 예
  ["x^2 + sqrt(y)/2", "x^2 + \\frac{\\sqrt{y}}{2}"],
];

const WEIRD = [
  "{{{", "}}}", "((((", "))))", "^^^", "___", "x/", "/x", "|||", "&#%$~", "\"'`", "sum", "int", "( )/( )", "int( ,  , dx)", "lim(x-> , )", "∫x dx", "", "   ",
  "a//b", "((a)/(b))^", "1,000", "이차방정식 근의 공식", "x^", "sqrt", "root(", "vec()", "√", "!", "°C 25",
  // 옮기며 덧붙인 경우: 옴 기호 두 가지, 제어 문자, null/undefined
  "R = 10 Ω", "R = 10 \u2126", "a\u0001b",
];

function renders(latex: string) {
  try {
    katex.renderToString(latex, { output: "mathml", throwOnError: true });
    return true;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("easyToLatex", () => {
  it.each(TABLE)("%s → %s (KaTeX로 그려진다)", (input, want) => {
    const got = easyToLatex(input);
    expect(got).toBe(want);
    expect(renders(got)).toBe(true);
  });

  it.each(WEIRD.map((w) => [w]))("이상한 입력 %j: 예외 없이 문자열, 그려지는 LaTeX", (input) => {
    const got = easyToLatex(input);
    expect(typeof got).toBe("string");
    if (got) expect(renders(got)).toBe(true);
  });

  it("빈 값·null·undefined는 빈 문자열", () => {
    expect(easyToLatex(null)).toBe("");
    expect(easyToLatex(undefined)).toBe("");
    expect(easyToLatex("  ")).toBe("");
  });

  it("옴 기호(Ω)와 그리스 문자 오메가(Ω)는 둘 다 단위 \\Omega", () => {
    expect(easyToLatex("R = 10 Ω")).toBe("R = 10\\,\\mathrm{\\Omega}");
    expect(easyToLatex("R = 10 \u2126")).toBe("R = 10\\,\\mathrm{\\Omega}");
  });
});

describe("latexToEasy", () => {
  it("다시 바꿔도 같은 수식일 때만 쉬운 표기로", () => {
    expect(latexToEasy("\\frac{x+1}{x-1}")).toBe("(x+1)/(x-1)");
    expect(latexToEasy("\\sqrt{x}")).toBe("sqrt(x)");
    expect(latexToEasy("\\alpha + \\beta")).toBe("alpha + beta");
    expect(latexToEasy("\\begin{pmatrix} a \\end{pmatrix}")).toBeNull();
    expect(latexToEasy("")).toBe("");
    expect(latexToEasy("x+1")).toBe("x+1");
  });
});

describe("applyEasyTemplate", () => {
  const frac = EASY_MAIN.find((t) => t.name === "분수")!;
  const sqrt = EASY_MAIN.find((t) => t.name === "제곱근")!;
  const square = EASY_MAIN.find((t) => t.name === "제곱")!;

  it("분수 틀: 첫 괄호 빈칸이 선택된다", () => {
    expect(applyEasyTemplate("", 0, 0, frac)).toEqual({ value: "( )/( )", selStart: 1, selEnd: 2 });
  });

  it("고른 글자를 첫 칸에 넣고 다음 빈칸을 고른다", () => {
    expect(applyEasyTemplate("ab", 0, 2, sqrt)).toEqual({ value: "sqrt(ab)", selStart: 8, selEnd: 8 });
    expect(applyEasyTemplate("x+1", 0, 3, frac)).toEqual({ value: "(x+1)/( )", selStart: 7, selEnd: 8 });
  });

  it("제곱: 고른 것을 밑으로 (여러 글자면 괄호)", () => {
    expect(applyEasyTemplate("y = x", 4, 5, square)).toEqual({ value: "y = x^2", selStart: 7, selEnd: 7 });
    expect(applyEasyTemplate("a+b", 0, 3, square)).toEqual({ value: "(a+b)^2", selStart: 7, selEnd: 7 });
  });

  it("모든 틀은 빈칸을 채우면 KaTeX로 그려진다", () => {
    for (const t of [...EASY_MAIN, ...EASY_MORE]) {
      const filled = t.base ? "x" + t.tpl : t.tpl.replace(/▢/g, "x");
      const latex = easyToLatex(filled);
      expect(renders(latex), `${t.label}: ${filled} → ${latex}`).toBe(true);
    }
  });
});
