import { fail } from "./errors";

/**
 * 작은 XML 파서. HWPX의 header.xml·sectionN.xml·content.hpf를 읽는 데 필요한 만큼만 한다
 * (요소·속성·글자·CDATA·문자 참조. DTD 내부 정의는 다루지 않는다).
 * DOMParser가 없는 곳(Node·Web Worker)에서도 같은 결과가 나오도록 DOM을 쓰지 않는다.
 * 잘못된 XML(닫는 태그 불일치, 끝나지 않은 태그)은 bad_file 오류.
 */

export type XmlElement = {
  /** 접두사가 붙은 이름(hp:p) */
  name: string;
  /** 접두사를 뺀 이름(p) */
  localName: string;
  attrs: Record<string, string>;
  /** 요소 또는 글자(string) */
  children: XmlNode[];
};
export type XmlNode = XmlElement | string;

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED[ref] ?? m;
  });
}

const NAME_CHAR = /[^\s/>=]/;

export function parseXml(text: string): XmlElement {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  const top: XmlElement = { name: "#document", localName: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [top];
  let root: XmlElement | null = null;

  const readName = (): string => {
    const start = i;
    while (i < n && NAME_CHAR.test(text[i])) i++;
    return text.slice(start, i);
  };
  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      const tail = text.slice(i);
      if (stack.length > 1) stack[stack.length - 1].children.push(decodeEntities(tail));
      else if (tail.trim()) fail("bad_file", "xml: text after root");
      break;
    }
    if (lt > i) {
      const chunk = text.slice(i, lt);
      if (stack.length > 1) stack[stack.length - 1].children.push(decodeEntities(chunk));
      else if (chunk.trim()) fail("bad_file", "xml: text outside root");
    }
    i = lt;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) fail("bad_file", "xml: comment");
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end < 0) fail("bad_file", "xml: cdata");
      if (stack.length > 1) stack[stack.length - 1].children.push(text.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) fail("bad_file", "xml: pi");
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!", i)) {
      // DOCTYPE 등: 대괄호 안의 내부 정의는 건너뛴다
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        const c = text[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (j >= n) fail("bad_file", "xml: declaration");
      i = j + 1;
      continue;
    }
    if (text[i + 1] === "/") {
      i += 2;
      const name = readName();
      skipSpace();
      if (text[i] !== ">") fail("bad_file", "xml: end tag");
      i++;
      const open = stack.pop();
      if (!open || open === top || open.name !== name) fail("bad_file", `xml: mismatched </${name}>`);
      continue;
    }
    // 시작 태그
    i++;
    const name = readName();
    if (!name) fail("bad_file", "xml: tag name");
    const attrs: Record<string, string> = {};
    let selfClose = false;
    for (;;) {
      skipSpace();
      if (i >= n) fail("bad_file", "xml: unterminated tag");
      const c = text[i];
      if (c === ">") {
        i++;
        break;
      }
      if (c === "/" && text[i + 1] === ">") {
        i += 2;
        selfClose = true;
        break;
      }
      const attrName = readName();
      if (!attrName) fail("bad_file", "xml: attribute");
      skipSpace();
      if (text[i] !== "=") fail("bad_file", "xml: attribute value");
      i++;
      skipSpace();
      const q = text[i];
      if (q !== '"' && q !== "'") fail("bad_file", "xml: attribute quote");
      const end = text.indexOf(q, i + 1);
      if (end < 0) fail("bad_file", "xml: attribute end");
      attrs[attrName] = decodeEntities(text.slice(i + 1, end));
      i = end + 1;
    }
    const colon = name.indexOf(":");
    const el: XmlElement = { name, localName: colon >= 0 ? name.slice(colon + 1) : name, attrs, children: [] };
    if (stack.length === 1) {
      if (root) fail("bad_file", "xml: two roots");
      root = el;
    }
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  if (stack.length !== 1 || !root) fail("bad_file", "xml: unclosed");
  return root;
}

export const isElement = (node: XmlNode): node is XmlElement => typeof node !== "string";

/** 자식 요소들 */
export const kids = (el: XmlElement | null | undefined): XmlElement[] => (el ? el.children.filter(isElement) : []);

/** 이름이 localName인 첫 자식 요소 */
export const child = (el: XmlElement | null | undefined, localName: string): XmlElement | null =>
  kids(el).find((c) => c.localName === localName) ?? null;

export const attr = (el: XmlElement | null | undefined, name: string): string | null => (el && Object.hasOwn(el.attrs, name) ? el.attrs[name] : null);

/** 숫자 속성(없거나 숫자가 아니면 d) */
export function num(el: XmlElement | null | undefined, name: string, d = 0): number {
  const v = attr(el, name);
  const x = v == null ? NaN : Number(v);
  return Number.isFinite(x) ? x : d;
}

/** 이름이 localName인 모든 후손 요소(문서 순서) — getElementsByTagNameNS("*", localName)와 같다 */
export function descendants(el: XmlElement, localName: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of kids(el)) {
    if (c.localName === localName) out.push(c);
    descendants(c, localName, out);
  }
  return out;
}

/** 모든 후손 글자를 이은 것(textContent) */
export function textContent(node: XmlNode): string {
  if (typeof node === "string") return node;
  let s = "";
  for (const c of node.children) s += textContent(c);
  return s;
}
