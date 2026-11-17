import type { Messages } from "@/lib/messages";

export type PaletteGroupKey = keyof Messages["math"]["groups"];
export type PaletteItemKey = keyof Messages["math"]["items"];

export type PaletteItem = {
  /** 넣을 LaTeX. `caret`은 넣은 뒤 커서를 둘 위치(조각 안에서의 오프셋, 기본은 끝) */
  latex: string;
  caret?: number;
  /** 버튼에 그릴 LaTeX (기본은 `latex`) */
  preview?: string;
  /** 이름이 있는 항목은 messages.math.items의 키. 없으면 `latex`가 이름을 대신한다. */
  name?: PaletteItemKey;
};

export type PaletteGroup = { key: PaletteGroupKey; items: PaletteItem[] };

const symbols = (list: string[]): PaletteItem[] => list.map((latex) => ({ latex: `${latex} `, preview: latex }));

export const MATH_PALETTE: PaletteGroup[] = [
  {
    key: "structure",
    items: [
      { name: "fraction", latex: "\\frac{}{}", caret: 6, preview: "\\frac{a}{b}" },
      { name: "sqrt", latex: "\\sqrt{}", caret: 6, preview: "\\sqrt{x}" },
      { name: "nthRoot", latex: "\\sqrt[n]{}", caret: 9, preview: "\\sqrt[n]{x}" },
      { name: "power", latex: "^{}", caret: 2, preview: "x^{n}" },
      { name: "subscript", latex: "_{}", caret: 2, preview: "x_{i}" },
      { name: "sum", latex: "\\sum_{i=1}^{n} ", preview: "\\sum" },
      { name: "product", latex: "\\prod_{i=1}^{n} ", preview: "\\prod" },
      { name: "vector", latex: "\\vec{}", caret: 5, preview: "\\vec{v}" },
      { name: "bar", latex: "\\bar{}", caret: 5, preview: "\\bar{x}" },
      { name: "text", latex: "\\text{}", caret: 6, preview: "\\text{가}" },
    ],
  },
  {
    key: "calculus",
    items: [
      { name: "integral", latex: "\\int ", preview: "\\int" },
      { name: "definiteIntegral", latex: "\\int_{a}^{b} ", preview: "\\int_a^b" },
      { name: "limit", latex: "\\lim_{x \\to 0} ", preview: "\\lim" },
      { name: "derivative", latex: "\\frac{d}{dx} ", preview: "\\frac{d}{dx}" },
      { name: "partial", latex: "\\frac{\\partial}{\\partial x} ", preview: "\\frac{\\partial}{\\partial x}" },
      { name: "nabla", latex: "\\nabla ", preview: "\\nabla" },
      { name: "infinity", latex: "\\infty ", preview: "\\infty" },
    ],
  },
  {
    key: "matrix",
    items: [
      { name: "pmatrix", latex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", preview: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" },
      { name: "bmatrix", latex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", preview: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
      { name: "determinant", latex: "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}", preview: "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}" },
      { name: "cases", latex: "\\begin{cases} a & (x > 0) \\\\ b & (x \\le 0) \\end{cases}", preview: "\\begin{cases} a \\\\ b \\end{cases}" },
      { name: "aligned", latex: "\\begin{aligned} a &= b \\\\ &= c \\end{aligned}", preview: "\\begin{aligned} a &= b \\\\ &= c \\end{aligned}" },
    ],
  },
  {
    key: "greek",
    items: symbols([
      "\\alpha", "\\beta", "\\gamma", "\\delta", "\\epsilon", "\\theta", "\\lambda", "\\mu", "\\pi", "\\rho",
      "\\sigma", "\\tau", "\\phi", "\\omega", "\\Delta", "\\Sigma", "\\Phi", "\\Omega",
    ]),
  },
  {
    key: "symbol",
    items: symbols([
      "\\pm", "\\times", "\\div", "\\cdot", "\\le", "\\ge", "\\ne", "\\approx", "\\propto", "\\to", "\\Rightarrow", "\\degree",
    ]),
  },
];

/** 입력란의 선택 영역을 조각으로 바꾸고, 새 값과 커서 위치를 돌려준다. */
export function insertSnippet(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  item: Pick<PaletteItem, "latex" | "caret">,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return {
    value: value.slice(0, start) + item.latex + value.slice(end),
    caret: start + (item.caret ?? item.latex.length),
  };
}
