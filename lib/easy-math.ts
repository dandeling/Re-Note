/**
 * 쉬운 수식 표기 → LaTeX (순수 함수, 아티팩트판 `artifact/mod-editor.js`의 easyToLatex를 옮김).
 *
 * 학생이 평소 쓰는 식(a/b, x^2, sqrt(x), 알파, <= …)을 LaTeX로 바꾼다.
 * - 백슬래시가 들어 있으면 이미 LaTeX로 보고 그대로 둔다.
 * - 바꿀 수 없으면 원문을 그대로 돌려준다(예외를 던지지 않는다).
 * 문서에는 늘 결과 LaTeX만 저장한다.
 */

const EZ_GREEK =
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega".split(
    " ",
  );
const EZ_FUNCS = "sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh log ln exp max min det gcd".split(" ");
const EZ_SPECIAL = ["sqrt", "root", "sum", "prod", "int", "oint", "lim", "vec", "bar", "hat", "abs", "frac"];
const EZ_WORDS = new Map<string, string>([
  ...EZ_GREEK.map((g): [string, string] => [g, "\\" + g]),
  ...EZ_FUNCS.map((f): [string, string] => [f, "\\" + f]),
  ["inf", "\\infty"],
  ["infty", "\\infty"],
  ["infinity", "\\infty"],
  ["partial", "\\partial"],
  ["deg", "^{\\circ}"],
]);
const EZ_KNOWN = [...EZ_WORDS.keys(), ...EZ_SPECIAL].sort((a, b) => b.length - a.length);
const EZ_KO: Record<string, string> = {
  알파: "\\alpha", 베타: "\\beta", 감마: "\\gamma", 델타: "\\Delta", 엡실론: "\\epsilon", 입실론: "\\epsilon", 제타: "\\zeta", 에타: "\\eta", 세타: "\\theta", 쎄타: "\\theta",
  요타: "\\iota", 카파: "\\kappa", 람다: "\\lambda", 뮤: "\\mu", 크사이: "\\xi", 파이: "\\pi", 시그마: "\\sigma", 타우: "\\tau", 피: "\\phi", 카이: "\\chi", 프사이: "\\psi",
  오메가: "\\omega", 무한대: "\\infty", 무한: "\\infty", 도: "^{\\circ}",
};
const EZ_KO_CALL: Record<string, string> = { 루트: "sqrt", 제곱근: "sqrt", 벡터: "vec", 평균: "bar", 절댓값: "abs", 절대값: "abs", 적분: "int", 극한: "lim", 분수: "frac" };
const OHM = "Ω"; // 옴 기호(Ω). 그리스 대문자 오메가(Ω)와 같은 뜻으로 쓴다.
const EZ_SYM: Record<string, string> = {
  "π": "\\pi", "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\epsilon", "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda",
  "μ": "\\mu", "µ": "\\mu", "ν": "\\nu", "ξ": "\\xi", "ρ": "\\rho", "σ": "\\sigma", "τ": "\\tau", "υ": "\\upsilon", "φ": "\\phi", "ϕ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega",
  "Γ": "\\Gamma", "Δ": "\\Delta", "∆": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega", [OHM]: "\\Omega",
  "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "∠": "\\angle", "△": "\\triangle", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∮": "\\oint", "℃": "{}^{\\circ}\\mathrm{C}", "ℏ": "\\hbar",
};
const EZ_OPS: Record<string, string> = {
  "*": "\\times", "×": "\\times", "·": "\\cdot", "∙": "\\cdot", "÷": "\\div", "+-": "\\pm", "±": "\\pm", "-+": "\\mp", "∓": "\\mp",
  "<=": "\\le", "≤": "\\le", ">=": "\\ge", "≥": "\\ge", "!=": "\\ne", "≠": "\\ne", "~=": "\\approx", "≈": "\\approx", "==": "=", "≡": "\\equiv",
  "->": "\\to", "→": "\\to", "<-": "\\leftarrow", "←": "\\leftarrow", "=>": "\\Rightarrow", "⇒": "\\Rightarrow", "<=>": "\\Leftrightarrow", "⇔": "\\Leftrightarrow", "<->": "\\leftrightarrow", "↔": "\\leftrightarrow",
  "~": "\\sim", "∝": "\\propto", "∈": "\\in", "⊥": "\\perp", "∥": "\\parallel", "∴": "\\therefore", "∵": "\\because", "%": "\\%", "#": "\\#", "&": "\\&", "$": "\\$", "}": "\\}",
  "+": "+", "-": "-", "−": "-", "=": "=", "<": "<", ">": ">", ",": ",", ";": ";", ":": ":", ".": ".", "/": "/", "?": "?", "@": "@", ")": ")", "]": "]",
};
const EZ_MULTI = ["<=>", "<->", "->", "<-", "=>", "<=", ">=", "!=", "~=", "==", "+-", "-+"];
const EZ_UNITS = new Set("m cm mm km nm um s ms min h g kg mg N kN J kJ W kW Pa kPa hPa atm K mol L mL A mA V mV Hz kHz MHz C eV cal kcal T dB lx rad mmHg".split(" "));
const KO_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣ]+/;

type Tok = { t: "num" | "id" | "ko" | "ch"; v: string; sp: boolean };
type Term = {
  tex: string;
  sp: boolean;
  isNum?: boolean;
  fn?: boolean;
  group?: string;
  inner?: string;
  post?: boolean;
  sup?: boolean;
  sub?: boolean;
};
type OpItem = { op: true; raw: string; tex: string; sp: boolean };
type Item = OpItem | (Term & { op?: false });
type Unit = OpItem | { op?: false; terms: Term[] | null; tex?: string; sp: boolean };

const has = (o: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** 이어 붙일 때 `\le`+`x` → `\le x`처럼 명령 뒤에 글자가 오면 띄운다 */
function ezCat(a: string, b: string, sp?: boolean) {
  if (!a) return b;
  if (!b) return a;
  if (/\\[A-Za-z]+$/.test(a) && /^[A-Za-z]/.test(b)) return a + " " + b;
  return a + (sp ? " " : "") + b;
}
const ezBrace = (t: string) => (/^[A-Za-z0-9]$/.test(t) ? t : "{" + t + "}");

/** 글자 덩어리를 아는 낱말과 한 글자로 나눈다: "2pir"의 "pir" → pi, r · "sinx" → sin, x */
function ezSplitWord(w: string) {
  if (EZ_WORDS.has(w) || EZ_SPECIAL.includes(w)) return [w];
  const out: string[] = [];
  let i = 0;
  let afterWord = true;
  while (i < w.length) {
    const hit = EZ_KNOWN.find((k) => w.startsWith(k, i) && (k.length > 2 || afterWord));
    if (hit) {
      out.push(hit);
      i += hit.length;
      afterWord = true;
    } else {
      out.push(w[i]);
      i++;
      afterWord = false;
    }
  }
  return out;
}

function ezTokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let sp = false;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);
    if (/\s/.test(c)) {
      sp = true;
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    let len: number;
    if ((m = /^\d+(?:\.\d+)?/.exec(rest))) {
      toks.push({ t: "num", v: m[0], sp });
      len = m[0].length;
    } else if ((m = /^[A-Za-z]+/.exec(rest))) {
      toks.push({ t: "id", v: m[0], sp });
      len = m[0].length;
    } else if ((m = KO_RE.exec(rest))) {
      toks.push({ t: "ko", v: m[0], sp });
      len = m[0].length;
    } else {
      const multi = EZ_MULTI.find((o) => rest.startsWith(o));
      const ch = multi ?? String.fromCodePoint(s.codePointAt(i) ?? 0);
      toks.push({ t: "ch", v: ch, sp });
      len = ch.length;
    }
    i += len;
    sp = false;
  }
  return toks;
}

/** 쉬운 표기를 LaTeX로. 빈 입력은 "", 바꿀 수 없으면 원문(앞뒤 공백 제거)을 돌려준다. */
export function easyToLatex(input: unknown): string {
  const src = String(input == null ? "" : input).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!src) return "";
  if (/\\/.test(src) || src.length > 4000) return src; // 이미 LaTeX(또는 너무 긴 글) → 그대로
  try {
    const out = ezParse(src);
    // 마지막 안전 검사: 중괄호 짝
    let depth = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === "\\") {
        i++;
        continue;
      }
      if (out[i] === "{") depth++;
      else if (out[i] === "}" && --depth < 0) return src;
    }
    return depth === 0 ? out : src;
  } catch {
    return src;
  }
}

function ezParse(src: string): string {
  const toks = ezTokenize(src);
  let pos = 0;
  let sawInt = false;
  const peek = (k = 0): Tok | undefined => toks[pos + k];
  const isCh = (t: Tok | undefined, v?: string): t is Tok => !!t && t.t === "ch" && (v === undefined || t.v === v);
  const POSTFIX = new Set(["^", "_", "!", "'", "°"]);

  /** 연산자 사이의 항들 → 분수(/)를 접어 한 줄 LaTeX로 */
  function parseSeq(stops: Set<string>): string {
    const items: Item[] = [];
    while (pos < toks.length) {
      const t = peek()!;
      if (isCh(t) && stops.has(t.v)) break;
      if (isCh(t) && has(EZ_OPS, t.v) && !POSTFIX.has(t.v)) {
        pos++;
        items.push({ op: true, raw: t.v, tex: EZ_OPS[t.v], sp: t.sp });
        continue;
      }
      let term = parsePostfix();
      if (!term) {
        pos++;
        items.push({ op: true, raw: t.v, tex: "\\text{" + t.v + "}", sp: t.sp });
        continue;
      }
      if (term.isNum) {
        const u = tryUnits();
        if (u) term = { ...term, tex: term.tex + "\\," + u, post: true };
      }
      items.push(term);
    }
    return fold(items);
  }

  function fold(items: Item[]): string {
    const units: Unit[] = [];
    for (const it of items) {
      const last = units[units.length - 1];
      if (!it.op && last && !last.op && last.terms && !it.sp) last.terms.push(it);
      else if (it.op) units.push(it);
      else units.push({ terms: [it], sp: it.sp });
    }
    const out: Unit[] = [];
    for (let k = 0; k < units.length; k++) {
      const u = units[k];
      const L = out[out.length - 1];
      const R = units[k + 1];
      if (u.op && u.raw === "/" && L && !L.op && R && !R.op) {
        out[out.length - 1] = { terms: null, tex: `\\frac{${operand(L)}}{${operand(R)}}`, sp: L.sp };
        k++;
        continue;
      }
      out.push(u);
    }
    let s = "";
    for (const u of out) s = ezCat(s, u.op ? u.tex : unitTex(u), u.sp && s !== "");
    return s;
  }

  const unitTex = (u: Exclude<Unit, OpItem>) => (u.terms ? u.terms.reduce((s, t) => ezCat(s, t.tex, false), "") : (u.tex ?? ""));

  /** 분수의 분자·분모: 괄호 하나로 묶인 것이면 괄호를 벗긴다 */
  function operand(u: Exclude<Unit, OpItem>) {
    if (u.terms && u.terms.length === 1 && (u.terms[0].group === "(" || u.terms[0].group === "{") && !u.terms[0].post) return u.terms[0].inner ?? "";
    return unitTex(u);
  }

  function parsePostfix(): Term | null {
    const term = parsePrimary();
    if (!term) return null;
    for (;;) {
      const t = peek();
      if (!isCh(t)) break;
      if (t.v === "^" || t.v === "_" || t.v === "°") {
        pos++;
        const key = t.v === "_" ? "sub" : "sup";
        if (term[key]) {
          term.tex = "{" + term.tex + "}";
          term.sup = term.sub = false;
        }
        term.tex = t.v === "°" ? ezCat(term.tex, "^{\\circ}") : term.tex + t.v + ezBrace(parseOperand());
        term[key] = true;
        term.post = true;
      } else if ((t.v === "!" || t.v === "'") && !t.sp) {
        pos++;
        term.tex += t.v;
        term.post = true;
      } else break;
    }
    return term;
  }

  /** ^, _ 뒤: 부호 하나 + 항 하나. 괄호면 벗긴다 */
  function parseOperand(): string {
    const t = peek();
    if (!t) return "";
    if (isCh(t, "-") || isCh(t, "+")) {
      pos++;
      return t.v + parseOperand();
    }
    if (isCh(t, "(") || isCh(t, "{")) {
      const g = parsePrimary();
      return g?.inner ?? "";
    }
    const p = parsePrimary();
    return p ? p.tex : "";
  }

  function parseArgs(): string[] {
    pos++; // (
    const args: string[] = [];
    for (;;) {
      args.push(parseSeq(new Set([",", ")"])).trim());
      const t = peek();
      if (isCh(t, ",")) {
        pos++;
        continue;
      }
      if (isCh(t, ")")) pos++;
      break;
    }
    return args;
  }

  function special(name: string, sp: boolean): Term {
    const call = isCh(peek(), "(");
    const T = (tex: string): Term => ({ tex, sp });
    if (name === "int" || name === "oint") sawInt = true;
    if (name === "sqrt" || name === "root") {
      if (call) {
        const a = parseArgs();
        return T(a.length >= 2 && name === "root" ? `\\sqrt[${a[0]}]{${a.slice(1).join(",")}}` : `\\sqrt{${a.join(",")}}`);
      }
      const p = parsePostfix();
      return T(`\\sqrt{${p ? (p.group === "(" && !p.post ? p.inner : p.tex) : ""}}`);
    }
    if (name === "vec" || name === "bar" || name === "hat") {
      let x: string;
      if (call) x = parseArgs().join(",");
      else {
        const p = parsePrimary();
        x = p ? p.tex : "";
      }
      const one = /^(\\[A-Za-z]+|[A-Za-z0-9])$/.test(x);
      const cmd =
        name === "vec" ? (one ? "\\vec" : "\\overrightarrow") : name === "bar" ? (one ? "\\bar" : "\\overline") : one ? "\\hat" : "\\widehat";
      return T(`${cmd}{${x}}`);
    }
    if (name === "abs") {
      if (!call) return T("|");
      return T(`\\left|${parseArgs().join(",")}\\right|`);
    }
    if (name === "frac") {
      if (!call) return T("\\frac{}{}");
      const a = parseArgs();
      return T(`\\frac{${a[0] || ""}}{${a.slice(1).join(",")}}`);
    }
    // sum, prod, int, oint, lim
    const cmd = "\\" + name;
    if (!call) return T(cmd);
    const a = parseArgs();
    if (name === "lim") {
      if (a.length === 1) return T(/\\to/.test(a[0]) ? `\\lim_{${a[0]}}` : ezCat(cmd, a[0], true));
      return T(ezCat(`\\lim_{${a[0]}}`, a.slice(1).join(","), true));
    }
    if (a.length === 1) return T(ezCat(cmd, a[0], true));
    if (a.length === 2) return T(`${cmd}_{${a[0]}}^{${a[1]}}`);
    return T(ezCat(`${cmd}_{${a[0]}}^{${a[1]}}`, a.slice(2).join(","), true));
  }

  function parsePrimary(): Term | null {
    const t = peek();
    if (!t) return null;
    const sp = t.sp;
    if (t.t === "num") {
      pos++;
      return { tex: t.v, isNum: true, sp };
    }
    if (t.t === "id") {
      if (sawInt && t.sp && /^d[A-Za-z]$/.test(t.v)) {
        pos++;
        return { tex: "\\," + t.v, sp };
      }
      const parts = ezSplitWord(t.v);
      if (parts.length > 1) toks.splice(pos, 1, ...parts.map((v, k): Tok => ({ t: "id", v, sp: k ? false : t.sp })));
      const w = toks[pos].v;
      pos++;
      if (EZ_SPECIAL.includes(w)) return special(w, sp);
      const word = EZ_WORDS.get(w);
      if (word !== undefined) return { tex: word, sp, fn: EZ_FUNCS.includes(w) };
      return { tex: w, sp };
    }
    if (t.t === "ko") {
      pos++;
      if (has(EZ_KO_CALL, t.v)) return special(EZ_KO_CALL[t.v], sp);
      if (has(EZ_KO, t.v)) return { tex: EZ_KO[t.v], sp };
      // 모르는 한글 낱말은 이어지는 낱말과 함께 글자로
      let words = t.v;
      for (let n = peek(); n && n.t === "ko" && !has(EZ_KO, n.v) && !has(EZ_KO_CALL, n.v); n = peek()) {
        words += (n.sp ? " " : "") + n.v;
        pos++;
      }
      return { tex: `\\text{${words}}`, sp };
    }
    const v = t.v;
    if (v === "(" || v === "[" || v === "{") {
      pos++;
      const close = v === "(" ? ")" : v === "[" ? "]" : "}";
      const inner = parseSeq(new Set([close]));
      const closed = isCh(peek(), close);
      if (closed) pos++;
      let tex: string;
      if (v === "(") tex = closed ? (/\\(frac|sqrt|sum|int|prod)/.test(inner) ? `\\left(${inner}\\right)` : `(${inner})`) : "(" + inner;
      else if (v === "[") tex = "[" + inner + (closed ? "]" : "");
      else tex = "\\{" + inner + (closed ? "\\}" : "");
      return { tex, group: v, inner, sp };
    }
    if (v === "|") {
      pos++;
      const inner = parseSeq(new Set(["|"]));
      if (isCh(peek(), "|")) {
        pos++;
        return { tex: `\\left|${inner}\\right|`, sp };
      }
      return { tex: "|" + inner, sp };
    }
    if (v === "√") {
      pos++;
      const p = parsePostfix();
      return { tex: `\\sqrt{${p ? (p.group === "(" && !p.post ? p.inner : p.tex) : ""}}`, sp };
    }
    if (has(EZ_SYM, v)) {
      pos++;
      if (v === "∫" || v === "∮") sawInt = true;
      return { tex: EZ_SYM[v], sp };
    }
    if (v === "^" || v === "_" || v === "°") return { tex: "{}", sp }; // 밑이 없는 첨자
    if (v === "'") {
      pos++;
      return { tex: "{}'", sp };
    }
    if (v === "!") {
      pos++;
      return { tex: "!", sp };
    }
    if (has(EZ_OPS, v)) return null;
    if (/[\p{L}\p{N}]/u.test(v) || /[^\x00-\x7f]/.test(v)) {
      pos++;
      return { tex: `\\text{${v}}`, sp };
    }
    pos++;
    return { tex: `\\text{${v === '"' ? "''" : v}}`, sp };
  }

  /** 수 뒤의 단위: "9.8 m/s^2" → \,\mathrm{m/s^2} (분명한 경우만) */
  function tryUnits(): string | null {
    const save = pos;
    const first = peek();
    if (!first || !first.sp) return null;
    let s = "";
    const atom = (needGlue: boolean) => {
      const a = peek();
      if (!a || (needGlue && a.sp)) return false;
      const next = peek(1);
      if (a.t === "id" && EZ_UNITS.has(a.v)) {
        pos++;
        s += a.v;
      } else if (isCh(a, "℃")) {
        pos++;
        s += "{}^{\\circ}C";
      } else if (isCh(a, "°") && next && next.t === "id" && next.v === "C" && !next.sp) {
        pos += 2;
        s += "{}^{\\circ}C";
      } else if (isCh(a, "Ω") || isCh(a, OHM)) {
        pos++;
        s += "\\Omega";
      } else if ((isCh(a, "μ") || isCh(a, "µ")) && next && next.t === "id" && /^(m|s|g|A|L|mol)$/.test(next.v) && !next.sp) {
        pos += 2;
        s += "\\mu " + next.v;
      } else return false;
      const caret = peek();
      if (isCh(caret, "^") && !caret.sp) {
        const save2 = pos;
        pos++;
        let sign = "";
        if (isCh(peek(), "-")) {
          sign = "-";
          pos++;
        }
        const n = peek();
        if (n && n.t === "num" && !n.sp) {
          pos++;
          s += "^" + ezBrace(sign + n.v);
        } else pos = save2;
      }
      return true;
    };
    if (!atom(false)) {
      pos = save;
      return null;
    }
    for (;;) {
      const o = peek();
      if (o && !o.sp && (isCh(o, "/") || isCh(o, "*") || isCh(o, "·"))) {
        const save3 = pos;
        const before = s;
        pos++;
        s += o.v === "/" ? "/" : "\\cdot ";
        if (!atom(true)) {
          pos = save3;
          s = before;
          break;
        }
      } else break;
    }
    const n = peek();
    const ok =
      !n ||
      (isCh(n) && [",", ";", ")", "]"].includes(n.v)) ||
      (n.sp && (n.t === "ko" || (isCh(n) && ["=", "<", ">", "<=", ">=", "~=", "!=", "≈", "≤", "≥", "≠", "+", "-", "±", "+-", ",", "→", "->"].includes(n.v))));
    if (!ok) {
      pos = save;
      return null;
    }
    return `\\mathrm{${s}}`;
  }

  return parseSeq(new Set()).trim();
}

/**
 * 저장된 LaTeX → 쉬운 표기. 다시 easyToLatex로 바꿨을 때 같은 수식이 될 때만 돌려주고, 못 하면 null.
 * (LaTeX 직접 모드에서 쉬운 입력으로 바꿀 때 쓴다.)
 */
export function latexToEasy(latex: unknown): string | null {
  const orig = String(latex ?? "").trim();
  if (!orig) return "";
  if (!/[\\{}]/.test(orig)) return orig;
  let s = orig.replace(/\{\}\^\{\\circ\}/g, "°").replace(/\^\{\\circ\}/g, "°");
  const wrap = (a: string) => (/^[A-Za-z0-9.]+$/.test(a) || /^\\[A-Za-z]+$/.test(a) || /^\\?[A-Za-z]+\([^()]*\)$/.test(a) ? a : "(" + a + ")");
  const ACCENT: Record<string, string> = { overline: "bar", overrightarrow: "vec", widehat: "hat" };
  for (let guard = 0; guard < 30; guard++) {
    const prev = s;
    s = s
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => wrap(a) + "/" + wrap(b))
      .replace(/\\sqrt\[([^{}[\]]*)\]\{([^{}]*)\}/g, "root($1, $2)")
      .replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)")
      .replace(/\\(vec|bar|hat|overline|overrightarrow|widehat)\{([^{}]*)\}/g, (_, f: string, a: string) => (ACCENT[f] || f) + "(" + a + ")")
      .replace(/\\mathrm\{([^{}]*)\}/g, (_, a: string) => a.replace(/\\cdot\s*/g, "·").replace(/\\mu\s*/g, "μ").replace(/\\Omega/g, "Ω"))
      .replace(/\\text\{([^{}]*)\}/g, "$1")
      .replace(/([\^_])\{([^{}]*)\}/g, (_, op: string, a: string) => op + (/^[A-Za-z0-9]$/.test(a) ? a : "(" + a + ")"));
    if (s === prev) break;
  }
  s = s
    .replace(/\\left\s*\|/g, "|")
    .replace(/\\right\s*\|/g, "|")
    .replace(/\\left\s*\(/g, "(")
    .replace(/\\right\s*\)/g, ")")
    .replace(/\\,/g, " ");
  const REV: Record<string, string> = {
    times: "*", cdot: "·", div: "÷", pm: "+-", mp: "-+", le: "<=", leq: "<=", ge: ">=", geq: ">=", ne: "!=", neq: "!=", approx: "~=",
    to: "->", rightarrow: "->", Rightarrow: "=>", infty: "inf", sim: "~", partial: "partial",
  };
  s = s.replace(/\\([A-Za-z]+)/g, (m: string, name: string, off: number, str: string) => {
    if (has(REV, name)) return " " + REV[name] + " ";
    if (EZ_WORDS.has(name) || ["sum", "prod", "int", "oint", "lim"].includes(name)) return name + (/[A-Za-z0-9]/.test(str[off + m.length] || "") ? " " : "");
    return m;
  });
  s = s.replace(/[ ]{2,}/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
  if (/[\\{}]/.test(s)) return null;
  const norm = (x: string) =>
    x
      .replace(/\\left|\\right/g, "")
      .replace(/\\leq\b/g, "\\le")
      .replace(/\\geq\b/g, "\\ge")
      .replace(/\\neq\b/g, "\\ne")
      .replace(/([_^])\{([A-Za-z0-9])\}/g, "$1$2")
      .replace(/\s+/g, "");
  return norm(easyToLatex(s)) === norm(orig) ? s : null;
}

/** 쉬운 입력 틀 버튼 하나. `tpl` 안의 "▢"는 채울 자리, `base`면 고른 글자를 밑으로 삼는다(제곱 등). */
export type EasyTemplate = { label: string; tpl: string; name?: string; base?: boolean };

/** 자주 쓰는 틀·기호 (아티팩트판과 같은 구성) */
export const EASY_MAIN: EasyTemplate[] = [
  { label: "a/b", name: "분수", tpl: "(▢)/(▢)" },
  { label: "x²", name: "제곱", tpl: "^2", base: true },
  { label: "xₙ", name: "아래 첨자", tpl: "_(▢)" },
  { label: "√", name: "제곱근", tpl: "sqrt(▢)" },
  { label: "Σ", name: "합", tpl: "sum(i=1, n, ▢)" },
  { label: "∫", name: "적분", tpl: "int(▢, ▢, ▢ dx)" },
  { label: "lim", name: "극한", tpl: "lim(x->▢, ▢)" },
  { label: "vec", name: "벡터", tpl: "vec(▢)" },
  { label: "π", tpl: "π" },
  { label: "±", tpl: "±" },
  { label: "≤", tpl: "≤" },
  { label: "≥", tpl: "≥" },
  { label: "≠", tpl: "≠" },
  { label: "≈", tpl: "≈" },
  { label: "∞", tpl: "∞" },
  { label: "×", tpl: "×" },
  { label: "÷", tpl: "÷" },
  { label: "°", name: "도", tpl: "°" },
];

/** "더 보기"로 펼치는 그 밖의 기호 */
export const EASY_MORE: EasyTemplate[] = [
  ...[..."αβγδθλμρσφωΔΣΩ"].map((g) => ({ label: g, tpl: g })),
  { label: "|x|", name: "절댓값", tpl: "|▢|" },
  { label: "ⁿ√", name: "n제곱근", tpl: "root(▢, ▢)" },
  { label: "x̄", name: "평균", tpl: "bar(▢)" },
  { label: "ŷ", name: "모자", tpl: "hat(▢)" },
  { label: "→", tpl: "→" },
  { label: "·", name: "곱하기 점", tpl: "·" },
  { label: "∂", tpl: "∂" },
  { label: "( )", name: "괄호", tpl: "(▢)" },
  { label: "sin", tpl: "sin(▢)" },
  { label: "cos", tpl: "cos(▢)" },
  { label: "tan", tpl: "tan(▢)" },
  { label: "log", tpl: "log(▢)" },
  { label: "ln", tpl: "ln(▢)" },
  { label: "℃", name: "섭씨", tpl: "℃" },
];

/**
 * 입력란의 선택 영역 [start, end)에 틀을 넣는다. 첫 "▢"에는 고른 글자를 넣고,
 * 남은 빈칸(없으면 끝)을 선택해 둔다. 새 값과 선택 범위를 돌려준다.
 */
export function applyEasyTemplate(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  t: Pick<EasyTemplate, "tpl" | "base">,
): { value: string; selStart: number; selEnd: number } {
  const s = Math.max(0, Math.min(selectionStart, value.length));
  const e = Math.max(s, Math.min(selectionEnd, value.length));
  const selected = value.slice(s, e);
  let text: string;
  let selFrom: number;
  let selTo: number;
  if (t.base) {
    // 제곱처럼 고른 것을 밑으로
    const base = !selected ? "" : /^[A-Za-z0-9.]+$/.test(selected) ? selected : "(" + selected + ")";
    text = base + t.tpl;
    selFrom = selTo = text.length;
  } else {
    const slots = t.tpl.split("▢");
    text = slots[0];
    const marks: [number, number, boolean][] = [];
    for (let k = 1; k < slots.length; k++) {
      const fill = k === 1 && selected ? selected : " ";
      marks.push([text.length, text.length + fill.length, k === 1 && !!selected]);
      text += fill + slots[k];
    }
    const target = marks.find((m) => !m[2]);
    if (target) [selFrom, selTo] = target;
    else selFrom = selTo = text.length;
  }
  return { value: value.slice(0, s) + text + value.slice(e), selStart: s + selFrom, selEnd: s + selTo };
}
