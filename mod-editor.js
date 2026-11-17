/* mod-editor.js — 담당 C: 내 프로젝트 · 문서 · 에디터 (CONTRACT.md, SPEC 7.3 (b)(c)(d), 7.5, 7.6)
   문서는 JSON(블록 배열)으로 저장하고, 화면은 그 JSON에서 그린다. 번호(그림·표·식)는 저장하지 않고 문서 순서로 계산한다.
   개인 데이터: RN.userColl("projects"|"docs"|"formatTemplates"), 스냅샷은 RN.userColl("docs").doc(id).collection("snapshots"). */
(function () {
  "use strict";
  const RN = window.RN;
  const { h } = RN;
  RN.editorPanels = RN.editorPanels || [];
  RN.projectSections = RN.projectSections || [];

  // =====================================================================
  // 1. 문서 모델 (순수)
  // =====================================================================
  const KINDS = ["figure", "table", "equation"];
  const KIND_LABEL = { figure: "그림", table: "표", equation: "식" };
  const TARGET_TYPE = { figure: "figure", table: "table", equation: "math" };
  const KIND_OF_TYPE = { figure: "figure", table: "table", math: "equation" };
  const TEXT_TYPES = ["paragraph", "heading", "quote", "caption"];
  const ATOM_TYPES = ["figure", "math", "table", "toc", "code"];
  const BLOCK_TYPES = ["heading", "paragraph", "list", "quote", "table", "figure", "caption", "math", "toc", "code"];
  const BROKEN_REF = "[참조 대상 없음]";
  const DOC_LIMIT = 256 * 1024;
  const REPORT_LIMIT = 200 * 1024;
  const MAX_AC_BEFORE = 1200; // 자동완성 프롬프트에 넣는 캐럿 앞 글자 수
  const DAY = 86400000;
  const TRASH_DAYS = 30;
  const MAX_SNAPSHOTS = 50;

  const genId = () => "b" + RN.newId();
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const jsonBytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  const para = (content) => ({ id: genId(), type: "paragraph", content: normInline(content || []) });

  function normInline(arr) {
    const out = [];
    for (const n of Array.isArray(arr) ? arr : []) {
      if (!isObj(n)) continue;
      if (n.t === "text") {
        const text = String(n.text == null ? "" : n.text);
        if (!text) continue;
        const node = { t: "text", text };
        if (n.b) node.b = true;
        if (n.i) node.i = true;
        const prev = out[out.length - 1];
        if (prev && prev.t === "text" && !!prev.b === !!node.b && !!prev.i === !!node.i) prev.text += text;
        else out.push(node);
      } else if (n.t === "math") out.push({ t: "math", latex: String(n.latex || "") });
      else if (n.t === "br") out.push({ t: "br" }); // 문단 안 줄바꿈 (Shift+Enter)
      else if (n.t === "ref") out.push({ t: "ref", target: String(n.target || "") });
    }
    return out;
  }
  const nodeLen = (n) => (n.t === "text" ? n.text.length : 1);
  const inlLen = (inl) => (inl || []).reduce((s, n) => s + nodeLen(n), 0);

  /** 인라인 배열을 글자 위치(원자 노드는 1칸)에서 둘로 나눈다. */
  function splitInline(inl, off) {
    const a = [], b = [];
    let pos = 0;
    for (const n of inl || []) {
      const len = nodeLen(n);
      if (pos + len <= off) a.push(n);
      else if (pos >= off) b.push(n);
      else {
        const k = off - pos;
        a.push({ ...n, text: n.text.slice(0, k) });
        b.push({ ...n, text: n.text.slice(k) });
      }
      pos += len;
    }
    return [normInline(a), normInline(b)];
  }

  /** 인라인 → 글자. atom을 주면 수식·참조 자리를 그 글자로 채운다(줄바꿈은 atom이 ""이면 빈칸). */
  function inlPlain(inl, numbering, atom) {
    return (inl || []).map((n) => {
      if (n.t === "text") return n.text;
      if (n.t === "br") return atom == null ? "\n" : atom === "" ? " " : atom;
      if (atom != null) return atom;
      if (n.t === "math") return "$" + n.latex + "$";
      return numbering ? resolveRef(numbering, n.target).label : "";
    }).join("");
  }

  function normalizeBlock(b) {
    if (!isObj(b) || !BLOCK_TYPES.includes(b.type)) return null;
    const id = typeof b.id === "string" && /^[\w-]{1,80}$/.test(b.id) ? b.id : genId();
    const type = b.type;
    switch (type) {
      case "heading": return { id, type, level: clampInt(b.level, 1, 3, 1), content: normInline(b.content) };
      case "paragraph": case "quote": return { id, type, content: normInline(b.content) };
      case "caption": return { id, type, kind: KINDS.includes(b.kind) ? b.kind : "figure", content: normInline(b.content) };
      case "list": {
        const items = (Array.isArray(b.items) && b.items.length ? b.items : [[]]).map(normInline);
        return { id, type, ordered: !!b.ordered, items };
      }
      case "table": {
        let rows = Array.isArray(b.rows) ? b.rows.filter(Array.isArray).map((r) => r.map((c) => String(c == null ? "" : c))) : [];
        if (!rows.length) rows = [[""]];
        const width = Math.max(1, ...rows.map((r) => r.length));
        rows = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
        return { id, type, header: b.header !== false, rows };
      }
      case "figure": {
        const out = { id, type, alt: String(b.alt || "") };
        if (typeof b.svg === "string" && b.svg) out.svg = b.svg;
        else if (typeof b.src === "string" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(b.src)) out.src = b.src;
        else return null;
        if (b.meta !== undefined) out.meta = b.meta;
        return out;
      }
      case "math": return { id, type, latex: String(b.latex || "") };
      case "toc": return { id, type, kind: b.kind === "table" ? "table" : "figure" };
      case "code": return { id, type, text: String(b.text || "") };
    }
    return null;
  }
  function normalizeDoc(c) {
    const blocks = (isObj(c) && Array.isArray(c.blocks) ? c.blocks : []).map(normalizeBlock).filter(Boolean);
    if (!blocks.length) blocks.push(para());
    return { blocks };
  }

  // =====================================================================
  // 2. 캡션 번호 · 상호 참조 · 목차 (순수) — lib/captions 를 블록 모델로 옮김
  // =====================================================================
  const refLabel = (kind, n) => (kind === "equation" ? `식 (${n})` : `${KIND_LABEL[kind]} ${n}`);
  const captionLabel = (kind, n) => (kind === "equation" ? refLabel(kind, n) : refLabel(kind, n) + ".");

  function captionPositions(rules) {
    const c = (rules && rules.caption) || {};
    return { figure: c.figurePosition || "below", table: c.tablePosition || "above", equation: "below" };
  }

  /** 캡션이 어느 그림·표·수식에 붙는지: 규칙 쪽 이웃을 먼저, 없으면 반대쪽 이웃. 한 대상에 캡션 하나. */
  function attachCaptions(blocks, positions) {
    const capToTarget = new Map(), targetToCap = new Map();
    blocks.forEach((b, i) => {
      if (b.type !== "caption") return;
      const want = TARGET_TYPE[b.kind];
      const order = (positions[b.kind] || "below") === "above" ? [i + 1, i - 1] : [i - 1, i + 1];
      for (const j of order) {
        const t = blocks[j];
        if (t && t.type === want && !targetToCap.has(t.id)) { capToTarget.set(b.id, t.id); targetToCap.set(t.id, b.id); break; }
      }
    });
    return { capToTarget, targetToCap };
  }

  /**
   * 번호 계산. 종류별로 문서 순서대로 1부터.
   * 그림·표: 캡션 하나가 번호 하나(캡션 없는 그림·표는 번호 없음). 수식: 블록 수식 하나가 번호 하나, 붙은 수식 캡션은 같은 번호.
   * byId: 캡션 id와 대상(그림·표·수식) id 모두 같은 항목을 가리킨다.
   */
  function computeNumbering(doc, positions) {
    const blocks = (doc && doc.blocks) || [];
    positions = positions || captionPositions(null);
    const { capToTarget, targetToCap } = attachCaptions(blocks, positions);
    const counters = { figure: 0, table: 0, equation: 0 };
    const entries = [], byId = new Map();
    const caps = new Map(blocks.filter((b) => b.type === "caption").map((b) => [b.id, b]));
    const add = (kind, id, ids, text, latex) => {
      const number = ++counters[kind];
      const e = { id, ids, kind, number, refLabel: refLabel(kind, number), captionLabel: captionLabel(kind, number), text };
      if (latex !== undefined) e.latex = latex;
      entries.push(e);
      for (const x of ids) if (x && !byId.has(x)) byId.set(x, e);
      return e;
    };
    for (const b of blocks) {
      if (b.type === "math") {
        const cid = targetToCap.get(b.id);
        const cap = cid && caps.get(cid);
        add("equation", b.id, cid ? [b.id, cid] : [b.id], cap ? inlPlain(cap.content, null, "").trim() : "", b.latex);
      } else if (b.type === "caption") {
        const target = capToTarget.get(b.id);
        if (b.kind === "equation" && target) continue;
        add(b.kind, b.id, target ? [b.id, target] : [b.id], inlPlain(b.content, null, "").trim());
      }
    }
    return { entries, byId, capToTarget, targetToCap };
  }

  function resolveRef(numbering, target) {
    const e = (target && numbering.byId.get(target)) || null;
    return e ? { label: e.refLabel, broken: false, entry: e } : { label: BROKEN_REF, broken: true, entry: null };
  }

  /** 커서 앞 글자에서 `@그림` 같은 참조 입력을 찾는다(lib/captions/cross-ref). */
  function parseRefTrigger(textBefore) {
    const start = textBefore.lastIndexOf("@");
    if (start < 0) return null;
    const query = textBefore.slice(start + 1);
    if (query.length > 30 || /[\s@￼]/.test(query)) return null;
    if (start > 0 && !/[\s([{"'“‘·,]/.test(textBefore[start - 1])) return null;
    return { query, start };
  }
  const compact = (s) => String(s).replace(/[\s().]/g, "").toLowerCase();
  function isKindQuery(query) {
    const q = compact(query);
    if (!q) return true;
    return Object.values(KIND_LABEL).some((l) => l.startsWith(q) || q.startsWith(l));
  }
  function filterRefTargets(entries, query) {
    const q = compact(query);
    const targets = entries.filter((e) => e.id);
    if (!q) return targets;
    return targets.filter((e) => { const l = compact(e.refLabel); return l.startsWith(q) || q.startsWith(l) || compact(e.text).includes(q); });
  }
  function captionList(numbering, kind) {
    return numbering.entries.filter((e) => e.kind === kind).map((e) => ({ id: e.id, label: e.captionLabel, text: e.text.trim() }));
  }
  const TOC_TITLE = { figure: "그림 목차", table: "표 목차" };
  const tocLine = (e) => (e.text ? `${e.label} ${e.text}` : e.label);

  // =====================================================================
  // 3. 서식 규칙 · 글꼴 · 프리셋 · CSS 변수 (순수) — lib/format
  // =====================================================================
  const FONTS = {
    "noto-sans-kr": { label: "Noto Sans KR (본고딕)", family: "Noto Sans KR", generic: "sans-serif" },
    "noto-serif-kr": { label: "Noto Serif KR (본명조)", family: "Noto Serif KR", generic: "serif" },
    "ibm-plex-sans-kr": { label: "IBM Plex Sans KR", family: "IBM Plex Sans KR", generic: "sans-serif" },
  };
  const FONT_IDS = Object.keys(FONTS);
  const fontStack = (id) => `"${FONTS[id].family}", ${FONTS[id].generic}`;
  const fkey = (name) => String(name).toLowerCase().replace(/[\s\-_"']/g, "");
  const SAME_FONT = {
    본고딕: "noto-sans-kr", 노토산스: "noto-sans-kr", 노토산스kr: "noto-sans-kr", notosanscjkkr: "noto-sans-kr",
    본명조: "noto-serif-kr", 노토세리프: "noto-serif-kr", 노토세리프kr: "noto-serif-kr", notoserifcjkkr: "noto-serif-kr",
    ibm플렉스산스: "ibm-plex-sans-kr", 플렉스산스: "ibm-plex-sans-kr", ibmplexsans: "ibm-plex-sans-kr",
  };
  for (const id of FONT_IDS) { SAME_FONT[fkey(id)] = id; SAME_FONT[fkey(FONTS[id].family)] = id; }
  const SUBST_FONT = {
    함초롬바탕: "noto-serif-kr", hcrbatang: "noto-serif-kr", 한컴바탕: "noto-serif-kr",
    함초롬돋움: "noto-sans-kr", hcrdotum: "noto-sans-kr", 한컴돋움: "noto-sans-kr",
    맑은고딕: "noto-sans-kr", malgungothic: "noto-sans-kr",
    바탕: "noto-serif-kr", 바탕체: "noto-serif-kr", batang: "noto-serif-kr", 궁서: "noto-serif-kr", gungsuh: "noto-serif-kr",
    굴림: "noto-sans-kr", 굴림체: "noto-sans-kr", gulim: "noto-sans-kr", 돋움: "noto-sans-kr", 돋움체: "noto-sans-kr", dotum: "noto-sans-kr",
    나눔고딕: "noto-sans-kr", nanumgothic: "noto-sans-kr", 나눔바른고딕: "noto-sans-kr", 나눔스퀘어: "ibm-plex-sans-kr",
    나눔명조: "noto-serif-kr", nanummyeongjo: "noto-serif-kr",
    신명조: "noto-serif-kr", hy신명조: "noto-serif-kr", 휴먼명조: "noto-serif-kr", hy견명조: "noto-serif-kr",
    hy중고딕: "noto-sans-kr", hy견고딕: "ibm-plex-sans-kr", 휴먼고딕: "noto-sans-kr",
    applesdgothicneo: "noto-sans-kr", applemyungjo: "noto-serif-kr",
    timesnewroman: "noto-serif-kr", times: "noto-serif-kr", georgia: "noto-serif-kr",
    arial: "noto-sans-kr", helvetica: "noto-sans-kr", calibri: "noto-sans-kr",
  };
  /** 자유 입력 글꼴 이름 → 제공 글꼴. 쓸 수 없는 글꼴은 가장 가까운 것으로 대체(substituted: true). */
  function resolveFont(name) {
    const requested = String(name || "").trim();
    const k = fkey(requested);
    if (SAME_FONT[k]) return { font: SAME_FONT[k], substituted: false, requested };
    if (SUBST_FONT[k]) return { font: SUBST_FONT[k], substituted: true, requested };
    const serif = /명조|바탕|궁서|myeongjo|myungjo|batang|mincho|serif|roman/.test(k) && !/sans|고딕|gothic/.test(k);
    return { font: serif ? "noto-serif-kr" : "noto-sans-kr", substituted: true, requested };
  }

  const HEADS = ["h1", "h2", "h3"];
  const PAPER_SIZES = { A4: { width: 210, height: 297 }, B5: { width: 182, height: 257 }, Letter: { width: 215.9, height: 279.4 } };
  const DEFAULT_RULES = {
    page: { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } },
    body: { font: "noto-sans-kr", sizePt: 11, lineHeight: 160, align: "justify" },
    paragraph: { indentPt: 0, spacingPt: 6 },
    headings: {
      h1: { font: "noto-sans-kr", sizePt: 18, bold: true, align: "left" },
      h2: { font: "noto-sans-kr", sizePt: 15, bold: true, align: "left" },
      h3: { font: "noto-sans-kr", sizePt: 13, bold: true, align: "left" },
    },
    caption: { sizePt: 10, bold: false, align: "center", figurePosition: "below", tablePosition: "above" },
    pageNumber: { enabled: true, position: "bottom-center", style: "n" },
  };
  const PRESETS = [
    { id: "preset-general", name: "일반 보고서", rules: DEFAULT_RULES },
    { id: "preset-academic", name: "학술 논문형", rules: {
      page: { size: "A4", orientation: "portrait", margin: { top: 30, right: 25, bottom: 25, left: 25 } },
      body: { font: "noto-serif-kr", sizePt: 10, lineHeight: 160, align: "justify" },
      paragraph: { indentPt: 10, spacingPt: 0 },
      headings: {
        h1: { font: "noto-serif-kr", sizePt: 16, bold: true, align: "center" },
        h2: { font: "noto-serif-kr", sizePt: 13, bold: true, align: "left" },
        h3: { font: "noto-serif-kr", sizePt: 11, bold: true, align: "left" },
      },
      caption: { sizePt: 9, bold: false, align: "center", figurePosition: "below", tablePosition: "above" },
      pageNumber: { enabled: true, position: "bottom-center", style: "dash" },
    } },
    { id: "preset-inquiry", name: "탐구 보고서형", rules: {
      page: { size: "A4", orientation: "portrait", margin: { top: 20, right: 20, bottom: 20, left: 20 } },
      body: { font: "noto-sans-kr", sizePt: 12, lineHeight: 180, align: "left" },
      paragraph: { indentPt: 0, spacingPt: 8 },
      headings: {
        h1: { font: "ibm-plex-sans-kr", sizePt: 20, bold: true, align: "center" },
        h2: { font: "ibm-plex-sans-kr", sizePt: 16, bold: true, align: "left" },
        h3: { font: "ibm-plex-sans-kr", sizePt: 14, bold: true, align: "left" },
      },
      caption: { sizePt: 10, bold: true, align: "center", figurePosition: "below", tablePosition: "above" },
      pageNumber: { enabled: true, position: "bottom-right", style: "total" },
    } },
  ];
  const RULE_ENUMS = {
    "page.size": ["A4", "B5", "Letter"], "page.orientation": ["portrait", "landscape"], "body.align": ["left", "justify"],
    "headings.*.align": ["left", "center", "right"], "caption.align": ["left", "center", "right"],
    "caption.figurePosition": ["above", "below"], "caption.tablePosition": ["above", "below"],
    "pageNumber.position": ["bottom-center", "bottom-right", "top-center", "top-right"], "pageNumber.style": ["n", "dash", "total"],
  };
  const RULE_RANGES = {
    "page.margin.*": [0, 60], "body.sizePt": [6, 48], "body.lineHeight": [100, 300], "paragraph.indentPt": [0, 60],
    "paragraph.spacingPt": [0, 40], "headings.*.sizePt": [6, 48], "caption.sizePt": [6, 48],
  };
  function ruleLeafOk(path, v) {
    const p = path.replace(/^headings\.h[1-3]\./, "headings.*.").replace(/^page\.margin\.\w+$/, "page.margin.*");
    if (RULE_ENUMS[p]) return RULE_ENUMS[p].includes(v);
    if (RULE_RANGES[p]) return typeof v === "number" && Number.isFinite(v) && v >= RULE_RANGES[p][0] && v <= RULE_RANGES[p][1];
    if (/\.(bold|enabled)$/.test(p)) return typeof v === "boolean";
    if (/\.font$/.test(p)) return FONT_IDS.includes(v);
    return false;
  }
  /**
   * 임의의 입력을 완전한 규칙으로 만든다(lib/format/rules normalizeRules). 순수 함수.
   * 제공하지 않는 글꼴은 가장 가까운 글꼴로 바꾸고 fontNotices에 적는다. 빠졌거나 틀린 값은 fallback 값.
   */
  function normalizeRules(input, fallback) {
    fallback = fallback || DEFAULT_RULES;
    const fontNotices = [], defaulted = [];
    const walk = (base, src, path) => {
      if (isObj(base)) {
        const out = {};
        for (const k of Object.keys(base)) out[k] = walk(base[k], isObj(src) ? src[k] : undefined, [...path, k]);
        return out;
      }
      const key = path.join(".");
      if (src === undefined || src === null || src === "") {
        if (!(key.startsWith("headings.") && key.endsWith(".font"))) defaulted.push(key);
        return base;
      }
      if (/\.font$/.test(key) && typeof src === "string" && !FONT_IDS.includes(src)) {
        const r = resolveFont(src);
        if (r.substituted) fontNotices.push({ path: key, requested: r.requested, font: r.font });
        return r.font;
      }
      if (typeof src === "string" && RULE_RANGES[key.replace(/^headings\.h[1-3]\./, "headings.*.").replace(/^page\.margin\.\w+$/, "page.margin.*")] && Number.isFinite(Number(src))) src = Number(src);
      if (!ruleLeafOk(key, src)) { defaulted.push(key); return base; }
      return src;
    };
    const rules = walk(fallback, input, []);
    const bodyFontGiven = isObj(input) && isObj(input.body) && typeof input.body.font === "string" && input.body.font;
    if (bodyFontGiven) {
      for (const hl of HEADS) {
        const given = isObj(input.headings) && isObj(input.headings[hl]) && typeof input.headings[hl].font === "string" && input.headings[hl].font;
        if (!given) rules.headings[hl].font = rules.body.font;
      }
    }
    return { rules, fontNotices, defaulted: isObj(input) ? defaulted.sort() : [] };
  }
  function pageDimensions(rules) {
    const { width, height } = PAPER_SIZES[rules.page.size] || PAPER_SIZES.A4;
    return rules.page.orientation === "landscape" ? { width: height, height: width } : { width, height };
  }
  /** 규칙 → CSS 변수 (종이와 내보내기 HTML이 같이 쓴다). */
  function formatCssVars(rules) {
    const page = pageDimensions(rules);
    const pt = (n) => `${n}pt`, mm = (n) => `${n}mm`;
    const v = {
      "--fmt-page-width": mm(page.width), "--fmt-page-height": mm(page.height),
      "--fmt-margin-top": mm(rules.page.margin.top), "--fmt-margin-right": mm(rules.page.margin.right),
      "--fmt-margin-bottom": mm(rules.page.margin.bottom), "--fmt-margin-left": mm(rules.page.margin.left),
      "--fmt-body-font": fontStack(rules.body.font), "--fmt-body-size": pt(rules.body.sizePt),
      "--fmt-line-height": String(rules.body.lineHeight / 100), "--fmt-body-align": rules.body.align,
      "--fmt-indent": pt(rules.paragraph.indentPt), "--fmt-para-spacing": pt(rules.paragraph.spacingPt),
      "--fmt-caption-size": pt(rules.caption.sizePt), "--fmt-caption-weight": rules.caption.bold ? "700" : "400",
      "--fmt-caption-align": rules.caption.align,
    };
    for (const hl of HEADS) {
      const s = rules.headings[hl];
      v[`--fmt-${hl}-font`] = fontStack(s.font);
      v[`--fmt-${hl}-size`] = pt(s.sizePt);
      v[`--fmt-${hl}-weight`] = s.bold ? "700" : "400";
      v[`--fmt-${hl}-align`] = s.align;
    }
    return v;
  }
  const PAGE_NUMBER_TEXT = { n: "3", dash: "- 3 -", total: "3 / 10" };
  const PAGE_NUMBER_POS = { "bottom-center": "아래 가운데", "bottom-right": "아래 오른쪽", "top-center": "위 가운데", "top-right": "위 오른쪽" };

  // =====================================================================
  // 4. 서식 검사 · 모두 고치기 (순수) — lib/format/check 를 블록 모델로
  // =====================================================================
  const WRITTEN_NUMBER = /^\s*\[?\s*(그림|표|식|Figure|Fig\.?|Table|Eq\.?)\s*\(?\s*(\d+)\s*\)?\s*\]?\s*[.:)\-–]?\s*/i;
  const KIND_WORDS = { 그림: "figure", figure: "figure", fig: "figure", "fig.": "figure", 표: "table", table: "table", 식: "equation", eq: "equation", "eq.": "equation" };
  const CHECK_MSG = {
    "heading-skip": (p) => `제목 단계를 건너뛰었어요: 제목 ${p.from} 다음에 제목 ${p.to} — “${p.text}”`,
    "caption-missing": (p) => `${KIND_LABEL[p.kind]}에 캡션이 없어요`,
    "caption-position": (p) => `${KIND_LABEL[p.kind]} 캡션은 ${p.expected === "above" ? "위" : "아래"}에 있어야 해요`,
    "caption-orphan": (p) => `붙을 ${KIND_LABEL[p.kind]}이(가) 없는 캡션 — “${p.text}”`,
    "caption-empty": (p) => `${p.label} 캡션 내용이 비어 있어요`,
    "number-mismatch": (p) => `캡션에 번호를 직접 썼어요(“${p.written}”) — 자동 번호는 ${p.expected}`,
    "number-duplicate": (p) => `캡션 앞의 “${p.written}”가 자동 번호와 겹쳐요`,
    "duplicate-id": () => "같은 식별자를 쓰는 블록이 있어요",
    "broken-ref": () => "대상이 사라진 상호 참조가 있어요(직접 지우거나 다시 고르세요)",
  };
  const snippet = (inl) => { const t = inlPlain(inl, null, "").replace(/\s+/g, " ").trim(); return t.length > 30 ? t.slice(0, 30) + "…" : t; };
  function forEachInline(b, fn) {
    if (b.content) b.content.forEach(fn);
    if (b.items) b.items.forEach((it) => it.forEach(fn));
  }

  function runCheck(doc, rules, fix, newId) {
    const blocks = doc.blocks;
    const issues = [];
    const push = (code, block, params, fixable) => issues.push({ code, block, params, fixable, message: CHECK_MSG[code](params) });
    // 1) 같은 id
    const seen = new Set();
    blocks.forEach((b, i) => {
      if (seen.has(b.id)) {
        push("duplicate-id", i, {}, true);
        if (fix) { let f = newId(); while (seen.has(f)) f = newId(); b.id = f; }
      }
      seen.add(b.id);
    });
    // 2) 손으로 쓴 번호 · 빈 캡션
    const numbering = computeNumbering(doc, captionPositions(rules));
    blocks.forEach((b, i) => {
      if (b.type !== "caption") return;
      const first = b.content[0];
      const m = first && first.t === "text" ? WRITTEN_NUMBER.exec(first.text) : null;
      const e = numbering.byId.get(b.id);
      if (m && e) {
        const kind = KIND_WORDS[m[1].toLowerCase()] || "figure";
        const same = kind === e.kind && Number(m[2]) === e.number;
        push(same ? "number-duplicate" : "number-mismatch", i, { written: m[0].trim(), expected: e.refLabel }, true);
        if (fix) { first.text = first.text.slice(m[0].length); b.content = normInline(b.content); }
      } else if (e && !inlPlain(b.content, null, "").trim()) push("caption-empty", i, { label: e.captionLabel }, false);
    });
    // 3) 깨진 참조
    blocks.forEach((b, i) => { let broken = false; forEachInline(b, (n) => { if (n.t === "ref" && !numbering.byId.has(n.target)) broken = true; }); if (broken) push("broken-ref", i, {}, false); });
    // 4) 제목 단계 건너뜀
    let prev = 0;
    blocks.forEach((b, i) => {
      if (b.type !== "heading") return;
      if (prev > 0 && b.level > prev + 1) {
        push("heading-skip", i, { from: String(prev), to: String(b.level), text: snippet(b.content) }, true);
        if (fix) { b.level = prev + 1; prev = b.level; return; }
      }
      prev = b.level;
    });
    // 5) 그림·표와 캡션의 짝
    const attached = new Set(), removed = new Set(), insBefore = new Map(), insAfter = new Map();
    const capKind = (n) => (n && n.type === "caption" ? n.kind : null);
    blocks.forEach((node, i) => {
      if (node.type === "math") { for (const s of [blocks[i - 1], blocks[i + 1]]) if (capKind(s) === "equation") attached.add(s); return; }
      const kind = node.type === "figure" ? "figure" : node.type === "table" ? "table" : null;
      if (!kind) return;
      const pos = kind === "figure" ? rules.caption.figurePosition : rules.caption.tablePosition;
      const prevB = blocks[i - 1], nextB = blocks[i + 1];
      const isMine = (n) => !!n && capKind(n) === kind && !attached.has(n);
      const expected = pos === "above" ? prevB : nextB;
      const other = pos === "above" ? nextB : prevB;
      if (isMine(expected)) { attached.add(expected); return; }
      const neighborOwns = !isMine(other) || (pos === "above" && blocks[i + 2] && blocks[i + 2].type === node.type);
      if (!neighborOwns) {
        attached.add(other);
        push("caption-position", i, { kind, expected: pos }, true);
        if (fix) { removed.add(other); (pos === "above" ? insBefore : insAfter).set(node, other); }
        return;
      }
      push("caption-missing", i, { kind }, true);
      if (fix) (pos === "above" ? insBefore : insAfter).set(node, { id: newId(), type: "caption", kind, content: [] });
    });
    blocks.forEach((node, i) => {
      if (node.type !== "caption" || attached.has(node)) return;
      push("caption-orphan", i, { kind: node.kind, text: snippet(node.content) }, false);
    });
    if (fix && (insBefore.size || insAfter.size)) {
      const out = [];
      for (const node of blocks) {
        if (removed.has(node)) continue;
        if (insBefore.has(node)) out.push(insBefore.get(node));
        out.push(node);
        if (insAfter.has(node)) out.push(insAfter.get(node));
      }
      doc.blocks = out;
    }
    return issues.sort((a, b) => a.block - b.block);
  }
  const defaultNewId = () => genId();
  function checkFormat(doc, rules, opts) { return runCheck(clone(normalizeDoc(doc)), rules || DEFAULT_RULES, false, (opts && opts.newId) || defaultNewId); }
  function fixFormat(doc, rules, opts) {
    const next = clone(normalizeDoc(doc));
    const issues = runCheck(next, rules || DEFAULT_RULES, true, (opts && opts.newId) || defaultNewId);
    return { doc: next, fixed: issues.filter((i) => i.fixable).length, remaining: checkFormat(next, rules, opts) };
  }

  // =====================================================================
  // 5. 내보내기 · 가져오기 · SVG 정리 (순수에 가까움)
  // =====================================================================
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  function mathHtml(latex, display) {
    if (!window.katex || typeof window.katex.renderToString !== "function") return null;
    try { return window.katex.renderToString(String(latex), { output: "mathml", throwOnError: false, displayMode: !!display }); } catch { return null; }
  }
  function utf8Base64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const svgDataUrl = (svg) => "data:image/svg+xml;base64," + utf8Base64(svg);
  const figureSrc = (b) => (b.svg ? svgDataUrl(b.svg) : b.src || "");

  // --- Markdown ---
  const mdEsc = (s) => s.replace(/([\\`*_[\]<>#|$])/g, "\\$1");
  /** brText: 문단 안 줄바꿈을 Markdown으로 (기본은 줄 끝 `\` — 제목·캡션처럼 줄을 나눌 수 없는 곳은 빈칸) */
  function inlineMd(inl, numbering, brText) {
    return (inl || []).map((n) => {
      if (n.t === "br") return brText == null ? "\\\n" : brText;
      if (n.t === "math") return `$${n.latex}$`;
      if (n.t === "ref") return resolveRef(numbering, n.target).label;
      let t = mdEsc(n.text);
      if (!t.trim()) return t;
      if (n.i) t = `*${t}*`;
      if (n.b) t = `**${t}**`;
      return t;
    }).join("");
  }
  function documentToMarkdown(content, rules) {
    const doc = normalizeDoc(content);
    const nb = computeNumbering(doc, captionPositions(rules));
    const out = [];
    for (const b of doc.blocks) {
      switch (b.type) {
        case "heading": out.push("#".repeat(b.level) + " " + inlineMd(b.content, nb, " ")); break;
        case "paragraph": { const s = inlineMd(b.content, nb); if (s) out.push(s); break; }
        case "quote": out.push(inlineMd(b.content, nb).split("\n").map((l) => "> " + l).join("\n")); break;
        case "list": out.push(b.items.map((it, i) => (b.ordered ? `${i + 1}. ` : "- ") + inlineMd(it, nb).replace(/\n/g, "\n   ")).join("\n")); break;
        case "code": out.push("```\n" + b.text + "\n```"); break;
        case "table": {
          const cell = (c) => mdEsc(c).replace(/\n/g, " ");
          const line = (r) => "| " + r.map(cell).join(" | ") + " |";
          const rows = b.rows;
          out.push([line(rows[0]), "| " + rows[0].map(() => "---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n"));
          break;
        }
        case "figure": out.push(`![${mdEsc(b.alt || "그림")}](${figureSrc(b)})`); break;
        case "caption": {
          const e = nb.byId.get(b.id);
          out.push(`*${e ? e.captionLabel + " " : ""}${inlineMd(b.content, nb, " ")}*`);
          break;
        }
        case "math": { const e = nb.byId.get(b.id); out.push(`$$\n${b.latex}\n$$${e ? ` (${e.number})` : ""}`); break; }
        case "toc": {
          const list = captionList(nb, b.kind);
          out.push(`**${TOC_TITLE[b.kind]}**\n\n` + (list.length ? list.map((e) => "- " + mdEsc(tocLine(e))).join("\n") : "(항목 없음)"));
          break;
        }
      }
    }
    return out.join("\n\n").trim() + "\n";
  }

  // --- 본문 HTML (sanitize된 조각) ---
  function inlineHtml(inl, nb) {
    return (inl || []).map((n) => {
      if (n.t === "br") return "<br>";
      if (n.t === "math") return `<span class="doc-math-inline">${mathHtml(n.latex, false) || esc("$" + n.latex + "$")}</span>`;
      if (n.t === "ref") { const r = resolveRef(nb, n.target); return `<span class="doc-xref${r.broken ? " doc-xref-broken" : ""}">${esc(r.label)}</span>`; }
      let t = esc(n.text);
      if (n.i) t = `<em>${t}</em>`;
      if (n.b) t = `<strong>${t}</strong>`;
      return t;
    }).join("");
  }
  function blockHtml(b, nb) {
    switch (b.type) {
      case "heading": return `<h${b.level}>${inlineHtml(b.content, nb)}</h${b.level}>`;
      case "paragraph": return `<p>${inlineHtml(b.content, nb)}</p>`;
      case "quote": return `<blockquote><p>${inlineHtml(b.content, nb)}</p></blockquote>`;
      case "list": { const t = b.ordered ? "ol" : "ul"; return `<${t}>${b.items.map((it) => `<li>${inlineHtml(it, nb)}</li>`).join("")}</${t}>`; }
      case "code": return `<pre><code>${esc(b.text)}</code></pre>`;
      case "table": {
        const rows = b.rows.map((r, i) => `<tr>${r.map((c) => (i === 0 && b.header ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("");
        return `<table class="doc-table"><tbody>${rows}</tbody></table>`;
      }
      case "figure": return `<figure class="doc-figure" data-figure-id="${esc(b.id)}"><img src="${esc(figureSrc(b))}" alt="${esc(b.alt || "그림")}"></figure>`;
      case "caption": {
        const e = nb.byId.get(b.id);
        const label = e ? `<span class="caption-label">${esc(e.captionLabel)}</span> ` : "";
        return `<p class="doc-caption" data-kind="${esc(b.kind)}">${label}${inlineHtml(b.content, nb)}</p>`;
      }
      case "math": {
        const e = nb.byId.get(b.id);
        return `<div class="doc-math-block">${mathHtml(b.latex, true) || esc("$$" + b.latex + "$$")}${e ? ` <span class="math-label">(${e.number})</span>` : ""}</div>`;
      }
      case "toc": {
        const list = captionList(nb, b.kind);
        return `<div class="doc-toc"><p><strong>${esc(TOC_TITLE[b.kind])}</strong></p>${(list.length ? list : [null]).map((e) => `<p>${esc(e ? tocLine(e) : "(항목 없음)")}</p>`).join("")}</div>`;
      }
    }
    return "";
  }

  const HTML_TAGS = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "em", "span", "div", "table", "tbody", "tr", "td", "th", "figure", "img", "br",
    "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "ms", "mtext", "mspace", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "mstyle", "mpadded", "mphantom",
    "menclose", "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mlabeledtr", "mmultiscripts", "mprescripts", "none", "merror"]);
  const HTML_ATTRS = new Set(["class", "data-kind", "data-figure-id", "alt", "colspan", "rowspan", "xmlns", "display", "encoding", "mathvariant", "stretchy", "fence", "separator",
    "lspace", "rspace", "width", "height", "depth", "columnalign", "rowalign", "rowspacing", "columnspacing", "columnlines", "rowlines", "scriptlevel", "displaystyle", "accent",
    "accentunder", "minsize", "maxsize", "movablelimits", "linethickness", "notation", "voffset", "mathsize", "symmetric", "largeop", "form", "frame", "framespacing", "side"]);
  /** 허용 목록 방식 정리: 모르는 태그는 글자만 남기고, 모르는 속성(on*, style 등)은 지운다. img는 data:image만. */
  function sanitizeHtml(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const walk = (node) => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 3) continue;
        if (c.nodeType !== 1) { c.remove(); continue; }
        const tag = c.localName.toLowerCase();
        if (!HTML_TAGS.has(tag)) {
          if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object") c.remove();
          else c.replaceWith(document.createTextNode(c.textContent || ""));
          continue;
        }
        for (const a of [...c.attributes]) {
          const n = a.name.toLowerCase();
          if (tag === "img" && n === "src") { if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(a.value)) c.removeAttribute(a.name); continue; }
          if (!HTML_ATTRS.has(n)) c.removeAttribute(a.name);
        }
        walk(c);
      }
    };
    walk(tpl.content);
    return tpl.innerHTML;
  }

  let lastExportInfo = { omitted: 0, bytes: 0 };
  /** 본문 HTML 조각(sanitize됨, 수식은 MathML, 번호·참조는 글자). maxBytes를 넘으면 큰 그림부터 빼고 알림 정보를 남긴다. */
  function bodyHtml(content, rules, opts) {
    const doc = normalizeDoc(content);
    const nb = computeNumbering(doc, captionPositions(rules));
    const maxBytes = opts && opts.maxBytes;
    const omit = new Set();
    const build = () => sanitizeHtml(doc.blocks.map((b) => (omit.has(b.id) ? `<p class="doc-figure-omitted">[그림 생략: 용량이 커서 넣지 못했어요]</p>` : blockHtml(b, nb))).join("\n"));
    let html = build();
    if (maxBytes) {
      const figs = doc.blocks.filter((b) => b.type === "figure").sort((a, b) => figureSrc(b).length - figureSrc(a).length);
      while (new TextEncoder().encode(html).length > maxBytes && figs.length) { omit.add(figs.shift().id); html = build(); }
    }
    lastExportInfo = { omitted: omit.size, bytes: new TextEncoder().encode(html).length };
    return html;
  }

  /** 서식이 반영된 독립 HTML 문서 (브라우저에서 열어 PDF로 인쇄할 수 있다) */
  function exportHtmlDocument(title, content, rules) {
    rules = normalizeRules(rules).rules;
    const vars = Object.entries(formatCssVars(rules)).map(([k, v]) => `${k}: ${v};`).join(" ");
    const page = pageDimensions(rules);
    const m = rules.page.margin;
    const pn = { n: "counter(page)", dash: '"- " counter(page) " -"', total: 'counter(page) " / " counter(pages)' }[rules.pageNumber.style];
    const pageNumber = rules.pageNumber.enabled ? ` @${rules.pageNumber.position} { content: ${pn}; font-size: 9pt; color: #111; }` : "";
    const hcss = HEADS.map((hl) => `.doc ${hl} { font-family: var(--fmt-${hl}-font); font-size: var(--fmt-${hl}-size); font-weight: var(--fmt-${hl}-weight); text-align: var(--fmt-${hl}-align); line-height: 1.35; margin: 1em 0 0.5em; text-indent: 0; }`).join("\n");
    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || "문서")}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;700&family=Noto+Sans+KR:wght@400;700&family=Noto+Serif+KR:wght@400;700&display=swap">
<style>
@page { size: ${page.width}mm ${page.height}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;${pageNumber} }
html, body { margin: 0; background: #fff; color: #111; }
.doc { ${vars} box-sizing: border-box; max-width: var(--fmt-page-width); margin: 0 auto; padding: var(--fmt-margin-top) var(--fmt-margin-right) var(--fmt-margin-bottom) var(--fmt-margin-left);
  font-family: var(--fmt-body-font); font-size: var(--fmt-body-size); line-height: var(--fmt-line-height); text-align: var(--fmt-body-align); }
@media print { .doc { padding: 0; max-width: none; } }
.doc p { margin: 0 0 var(--fmt-para-spacing); text-indent: var(--fmt-indent); }
.doc li, .doc blockquote p, .doc .doc-caption, .doc .doc-toc p { text-indent: 0; }
${hcss}
.doc h1:first-child { margin-top: 0; }
.doc ul, .doc ol, .doc table, .doc blockquote, .doc pre, .doc figure { margin: 0 0 var(--fmt-para-spacing); }
.doc ul, .doc ol { padding-left: 1.5em; }
.doc blockquote { border-left: 3px solid #bbb; padding-left: 1em; color: #444; margin-left: 0; }
.doc pre { background: #f4f4f5; padding: 0.6em 0.8em; white-space: pre-wrap; }
.doc figure { text-align: center; }
.doc img { max-width: 100%; height: auto; }
.doc table { border-collapse: collapse; width: 100%; }
.doc th, .doc td { border: 1px solid #555; padding: 0.3em 0.5em; vertical-align: top; text-align: left; }
.doc th { background: #f1f1f1; }
.doc .doc-caption { font-size: var(--fmt-caption-size); font-weight: var(--fmt-caption-weight); text-align: var(--fmt-caption-align); }
.doc .doc-math-block { display: flex; align-items: center; justify-content: center; gap: 1em; margin: 0 0 var(--fmt-para-spacing); overflow-x: auto; }
.doc .math-label { margin-left: auto; }
.doc .doc-xref-broken { color: #b42318; }
.doc h1, .doc h2, .doc h3 { break-after: avoid; } .doc tr, .doc img { break-inside: avoid; }
</style>
</head>
<body>
<article class="doc">
<h1>${esc(title || "")}</h1>
${bodyHtml(content, rules)}
</article>
</body>
</html>
`;
  }

  // --- DOCX: 라이브러리 없이 무압축 zip + WordprocessingML ---
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** 무압축(store) zip. files: [{ name, data: string | Uint8Array }] → Uint8Array. 파일 이름은 UTF-8(플래그 11). */
  function zipStore(files, date) {
    const enc = new TextEncoder();
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      local.set(name, 30);
      const cen = new Uint8Array(46 + name.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      chunks.push(local, data); central.push(cen);
      offset += local.length + data.length;
    }
    const cenSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  function dataUrlBytes(url) {
    const m = /^data:([^;,]+);base64,(.*)$/i.exec(String(url || ""));
    if (!m) return null;
    try {
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime: m[1].toLowerCase(), bytes };
    } catch { return null; }
  }
  /** PNG(IHDR)·JPEG(SOF) 머리에서 픽셀 크기를 읽는다. */
  function imageSize(bytes, mime) {
    if (mime === "image/png" && bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return { w: v.getUint32(16), h: v.getUint32(20) };
    }
    if (mime === "image/jpeg" || mime === "image/jpg") {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const mk = bytes[i + 1];
        if (mk === 0xd8 || mk === 0x01 || mk === 0xff || (mk >= 0xd0 && mk <= 0xd7)) { i += mk === 0xff ? 1 : 2; continue; }
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
        i += 2 + len;
      }
    }
    return null;
  }
  const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const DRAW_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const rFonts = (f) => `<w:rFonts w:ascii="${xmlEsc(f)}" w:hAnsi="${xmlEsc(f)}" w:eastAsia="${xmlEsc(f)}" w:cs="${xmlEsc(f)}"/>`;
  const DOCX_JC = { left: "left", justify: "both", center: "center", right: "right" };
  /** 글자 런. 글자 안의 \n은 <w:br/>. o: { b, i, font } */
  function docxRun(text, o) {
    o = o || {};
    const pr = o.b || o.i || o.font ? `<w:rPr>${o.font ? rFonts(o.font) : ""}${o.b ? "<w:b/>" : ""}${o.i ? "<w:i/>" : ""}</w:rPr>` : "";
    return String(text).split("\n").map((seg, k) => (k ? `<w:r>${pr}<w:br/></w:r>` : "") + (seg ? `<w:r>${pr}<w:t xml:space="preserve">${xmlEsc(seg)}</w:t></w:r>` : "")).join("");
  }
  function docxInline(inl, nb) {
    return (inl || []).map((n) => {
      if (n.t === "text") return docxRun(n.text, n);
      if (n.t === "br") return "<w:r><w:br/></w:r>";
      if (n.t === "math") return docxRun(n.latex, { font: "Cambria Math" }); // 수식은 LaTeX 원문을 글자로
      if (n.t === "ref") return docxRun(resolveRef(nb, n.target).label);
      return "";
    }).join("");
  }
  const docxP = (style, runs, extraPPr) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extraPPr || ""}</w:pPr>${runs || ""}</w:p>`;

  /**
   * 문서 → DOCX 바이트. 서식 규칙(용지·여백·글꼴·크기·줄 간격·캡션·쪽 번호)을 styles.xml과 sectPr에 반영한다.
   * 래스터 그림(PNG/JPEG data URL)은 word/media에 넣고, SVG 등 넣을 수 없는 그림은 안내 글자와 캡션만 남긴다.
   * → { bytes: Uint8Array, omittedFigures: number }
   */
  function documentToDocx(title, content, rules) {
    rules = normalizeRules(rules).rules;
    const doc = normalizeDoc(content);
    const nb = computeNumbering(doc, captionPositions(rules));
    const page = pageDimensions(rules), mg = rules.page.margin;
    const twip = (mm) => Math.round(mm * 1440 / 25.4);
    const textWidthMm = Math.max(20, page.width - mg.left - mg.right);
    const textWidthEmu = Math.round(textWidthMm * 36000);
    const media = [], orderedNums = [];
    let omitted = 0;
    const body = [];
    if (title) body.push(docxP("Title", docxRun(title)));
    for (const b of doc.blocks) {
      switch (b.type) {
        case "heading": body.push(docxP("Heading" + b.level, docxInline(b.content, nb))); break;
        case "paragraph": body.push(docxP(null, docxInline(b.content, nb))); break;
        case "quote": body.push(docxP("Quote", docxInline(b.content, nb))); break;
        case "code": body.push(docxP("Code", docxRun(b.text, { font: "Consolas" }))); break;
        case "list": {
          let numId = 1;
          if (b.ordered) { numId = 2 + orderedNums.length; orderedNums.push(numId); }
          for (const it of b.items) body.push(docxP("ListParagraph", docxInline(it, nb), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`));
          break;
        }
        case "table": {
          const cols = b.rows[0].length;
          const colW = Math.floor(twip(textWidthMm) / cols);
          const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="555555"/>`).join("");
          body.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>`
            + `<w:tblGrid>${Array(cols).fill(`<w:gridCol w:w="${colW}"/>`).join("")}</w:tblGrid>`
            + b.rows.map((r, i) => {
              const head = i === 0 && b.header;
              return `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/></w:tcPr>${docxP("TableText", docxRun(c, { b: head }))}</w:tc>`).join("")}</w:tr>`;
            }).join("") + "</w:tbl>");
          break;
        }
        case "figure": {
          const d = b.src ? dataUrlBytes(b.src) : null;
          if (d && (d.mime === "image/png" || d.mime === "image/jpeg")) {
            const size = imageSize(d.bytes, d.mime) || { w: 600, h: 400 };
            let cx = size.w * 9525, cy = size.h * 9525; // 96dpi 픽셀 → EMU
            if (cx > textWidthEmu) { cy = Math.round(cy * textWidthEmu / cx); cx = textWidthEmu; }
            const n = media.length + 1, ext = d.mime === "image/png" ? "png" : "jpeg", rid = "rIdImg" + n;
            media.push({ name: `word/media/image${n}.${ext}`, data: d.bytes, rid, target: `media/image${n}.${ext}` });
            const alt = xmlEsc(b.alt || "그림");
            body.push(docxP("Figure", `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="그림 ${n}" descr="${alt}"/>`
              + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
              + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${ext}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
              + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`));
          } else {
            omitted++;
            body.push(docxP("Figure", docxRun("[그림: DOCX에는 넣지 못했어요 — HTML로 저장하면 보여요]", { i: true })));
          }
          break;
        }
        case "caption": {
          const e = nb.byId.get(b.id);
          body.push(docxP("Caption", (e ? docxRun(e.captionLabel + " ") : "") + docxInline(b.content, nb)));
          break;
        }
        case "math": {
          const e = nb.byId.get(b.id);
          body.push(docxP("Equation", docxRun(b.latex, { font: "Cambria Math" }) + (e ? docxRun(`    (${e.number})`) : "")));
          break;
        }
        case "toc": {
          const list = captionList(nb, b.kind);
          body.push(docxP("TocHeading", docxRun(TOC_TITLE[b.kind], { b: true })));
          for (const e of list.length ? list : [null]) body.push(docxP("TocLine", docxRun(e ? tocLine(e) : "(항목 없음)")));
          break;
        }
      }
    }
    if (!body.length || body[body.length - 1].startsWith("<w:tbl>")) body.push(docxP(null, ""));

    // 쪽 번호: 머리말/꼬리말에 PAGE 필드
    const pn = rules.pageNumber;
    const fld = (code) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const pnRuns = pn.style === "dash" ? docxRun("- ") + fld("PAGE") + docxRun(" -") : pn.style === "total" ? fld("PAGE") + docxRun(" / ") + fld("NUMPAGES") : fld("PAGE");
    const pnTop = pn.position.startsWith("top");
    const pnXml = pn.enabled ? `<w:${pnTop ? "hdr" : "ftr"} ${W_NS}><w:p><w:pPr><w:jc w:val="${pn.position.endsWith("right") ? "right" : "center"}"/></w:pPr>${pnRuns}</w:p></w:${pnTop ? "hdr" : "ftr"}>` : null;
    const pnFile = pnTop ? "header1.xml" : "footer1.xml";

    const landscape = rules.page.orientation === "landscape";
    const sectPr = `<w:sectPr>${pnXml ? `<w:${pnTop ? "headerReference" : "footerReference"} w:type="default" r:id="rIdPn"/>` : ""}`
      + `<w:pgSz w:w="${twip(page.width)}" w:h="${twip(page.height)}"${landscape ? ' w:orient="landscape"' : ""}/>`
      + `<w:pgMar w:top="${twip(mg.top)}" w:right="${twip(mg.right)}" w:bottom="${twip(mg.bottom)}" w:left="${twip(mg.left)}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS} ${DRAW_NS}><w:body>${body.join("")}${sectPr}</w:body></w:document>`;

    // 스타일: 본문·제목 1~3·캡션 등 서식 규칙을 그대로
    const bodyFont = FONTS[rules.body.font].family;
    const sz = (pt) => Math.round(pt * 2);
    const line = Math.round(rules.body.lineHeight / 100 * 240);
    const after = Math.round(rules.paragraph.spacingPt * 20);
    const ind0 = '<w:ind w:firstLine="0"/>';
    const pStyle = (id, name, pPr, rPr, extra) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra || ""}<w:qFormat/><w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
    const heads = HEADS.map((hl, i) => {
      const s = rules.headings[hl];
      return pStyle("Heading" + (i + 1), "heading " + (i + 1), `<w:keepNext/><w:spacing w:before="${240 - i * 40}" w:after="120" w:line="276" w:lineRule="auto"/>${ind0}<w:jc w:val="${DOCX_JC[s.align]}"/><w:outlineLvl w:val="${i}"/>`,
        `${rFonts(FONTS[s.font].family)}${s.bold ? "<w:b/>" : '<w:b w:val="0"/>'}<w:sz w:val="${sz(s.sizePt)}"/><w:szCs w:val="${sz(s.sizePt)}"/>`);
    }).join("");
    const cap = rules.caption;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ${W_NS}>`
      + `<w:docDefaults><w:rPrDefault><w:rPr>${rFonts(bodyFont)}<w:sz w:val="${sz(rules.body.sizePt)}"/><w:szCs w:val="${sz(rules.body.sizePt)}"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>`
      + `<w:pPrDefault><w:pPr><w:spacing w:after="${after}" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="${after}" w:line="${line}" w:lineRule="auto"/><w:ind w:firstLine="${Math.round(rules.paragraph.indentPt * 20)}"/><w:jc w:val="${DOCX_JC[rules.body.align]}"/></w:pPr><w:rPr>${rFonts(bodyFont)}<w:sz w:val="${sz(rules.body.sizePt)}"/><w:szCs w:val="${sz(rules.body.sizePt)}"/></w:rPr></w:style>`
      + pStyle("Title", "Title", `<w:keepNext/><w:spacing w:after="240"/>${ind0}<w:jc w:val="center"/>`, `${rFonts(FONTS[rules.headings.h1.font].family)}<w:b/><w:sz w:val="${sz(rules.headings.h1.sizePt + 4)}"/>`)
      + heads
      + pStyle("Caption", "caption", `<w:spacing w:before="60" w:after="${Math.max(after, 120)}"/>${ind0}<w:jc w:val="${DOCX_JC[cap.align]}"/>`, `${cap.bold ? "<w:b/>" : ""}<w:sz w:val="${sz(cap.sizePt)}"/><w:szCs w:val="${sz(cap.sizePt)}"/>`)
      + pStyle("Quote", "Quote", '<w:ind w:left="567" w:firstLine="0"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BBBBBB"/></w:pBdr>', '<w:color w:val="444444"/>')
      + pStyle("ListParagraph", "List Paragraph", '<w:spacing w:after="40"/><w:ind w:left="720" w:hanging="360"/><w:jc w:val="left"/>', "")
      + pStyle("Code", "Code", `<w:spacing w:after="${after}" w:line="240" w:lineRule="auto"/>${ind0}<w:jc w:val="left"/><w:shd w:val="clear" w:color="auto" w:fill="F4F4F5"/>`, `${rFonts("Consolas")}<w:sz w:val="${sz(Math.max(6, rules.body.sizePt - 1))}"/>`)
      + pStyle("Equation", "Equation", `${ind0}<w:jc w:val="center"/>`, "")
      + pStyle("Figure", "Figure", `<w:keepNext/>${ind0}<w:jc w:val="center"/>`, "")
      + pStyle("TableText", "Table Text", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>${ind0}<w:jc w:val="left"/>`, "")
      + pStyle("TocHeading", "TOC Heading", `<w:keepNext/>${ind0}<w:jc w:val="left"/>`, "")
      + pStyle("TocLine", "TOC Line", `<w:spacing w:after="0"/>${ind0}<w:jc w:val="left"/>`, "")
      + "</w:styles>";
    const lvl = (fmt, text) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
    const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ${W_NS}>`
      + `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${lvl("bullet", "•")}</w:abstractNum>`
      + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl("decimal", "%1.")}</w:abstractNum>`
      + `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`
      + orderedNums.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join("")
      + "</w:numbering>";
    const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>`
      + (pnXml ? `<Relationship Id="rIdPn" Type="${REL}/${pnTop ? "header" : "footer"}" Target="${pnFile}"/>` : "")
      + media.map((m) => `<Relationship Id="${m.rid}" Type="${REL}/image" Target="${m.target}"/>`).join("") + "</Relationships>";
    const WML = "application/vnd.openxmlformats-officedocument.wordprocessingml";
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
      + `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/>`
      + `<Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/>`
      + (pnXml ? `<Override PartName="/word/${pnFile}" ContentType="${WML}.${pnTop ? "header" : "footer"}+xml"/>` : "")
      + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:title>${xmlEsc(title || "")}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`;
    const files = [
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rootRels },
      { name: "docProps/core.xml", data: core },
      { name: "word/document.xml", data: documentXml },
      { name: "word/styles.xml", data: stylesXml },
      { name: "word/numbering.xml", data: numberingXml },
      { name: "word/_rels/document.xml.rels", data: docRels },
      ...(pnXml ? [{ name: "word/" + pnFile, data: pnXml }] : []),
      ...media.map((m) => ({ name: m.name, data: m.data })),
    ];
    return { bytes: zipStore(files), omittedFigures: omitted };
  }
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  // --- 가져오기: Markdown · 텍스트 → 블록 ---
  function mdInline(s) {
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const out = [];
    const re = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])|(?<![\\$])\$([^$\n]+)\$|`([^`]+)`/g;
    const unesc = (t) => t.replace(/\\([\\`*_[\]<>#|$])/g, "$1");
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: "text", text: unesc(s.slice(last, m.index)) });
      if (m[1] || m[2]) out.push({ t: "text", text: unesc(m[1] || m[2]), b: true });
      else if (m[3] || m[4]) out.push({ t: "text", text: unesc(m[3] || m[4]), i: true });
      else if (m[5]) out.push({ t: "math", latex: m[5] });
      else out.push({ t: "text", text: m[6] });
      last = re.lastIndex;
    }
    if (last < s.length) out.push({ t: "text", text: unesc(s.slice(last)) });
    return normInline(out);
  }
  function markdownToBlocks(md) {
    const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let i = 0, buf = [];
    // 줄 끝 `\` 또는 두 칸 이상의 빈칸은 문단 안 줄바꿈
    const HARD = /(\\| {2,})$/;
    const flush = () => {
      if (!buf.length) return;
      const inl = [];
      buf.forEach((l, k) => {
        const hard = k < buf.length - 1 && HARD.test(l);
        inl.push(...mdInline((hard ? l.replace(HARD, "") : l).trim()));
        if (k < buf.length - 1) inl.push(hard ? { t: "br" } : { t: "text", text: " " });
      });
      blocks.push(para(inl)); buf = [];
    };
    const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        flush(); const code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++; blocks.push({ id: genId(), type: "code", text: code.join("\n") }); continue;
      }
      if (/^\s*\$\$/.test(line)) {
        flush();
        const one = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
        if (one) { blocks.push({ id: genId(), type: "math", latex: one[1].trim() }); i++; continue; }
        const body = [line.replace(/^\s*\$\$/, "")]; i++;
        while (i < lines.length && !/\$\$/.test(lines[i])) body.push(lines[i++]);
        if (i < lines.length) body.push(lines[i++].replace(/\$\$.*$/, ""));
        blocks.push({ id: genId(), type: "math", latex: body.join("\n").trim() }); continue;
      }
      const hm = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (hm) { flush(); blocks.push({ id: genId(), type: "heading", level: Math.min(3, hm[1].length), content: mdInline(hm[2]) }); i++; continue; }
      if (/^\s*>/.test(line)) {
        flush(); const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
        blocks.push({ id: genId(), type: "quote", content: mdInline(q.join(" ").trim()) }); continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush(); const ordered = /^\s*\d/.test(line); const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(mdInline(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, "")));
        blocks.push({ id: genId(), type: "list", ordered, items }); continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flush(); const rows = [cells(line)]; i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        blocks.push(normalizeBlock({ id: genId(), type: "table", header: true, rows })); continue;
      }
      const im = /^\s*!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)\s*$/.exec(line);
      if (im) {
        // 독립된 줄의 그림: 안전한 data: 래스터만 그림으로, 나머지 주소는 글자로 남긴다
        flush(); i++;
        const alt = im[1].replace(/\\([\\`*_[\]])/g, "$1").trim().slice(0, 200);
        if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(im[2])) blocks.push({ id: genId(), type: "figure", alt, src: im[2].replace(/\s+/g, "") });
        else blocks.push(para([{ t: "text", text: alt ? `(그림: ${alt})` : "(그림)" }]));
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); i++; continue; }
      if (!line.trim()) { flush(); i++; continue; }
      buf.push(line.replace(/^\s+/, "")); i++;
    }
    flush();
    return normalizeDoc({ blocks }).blocks;
  }
  function textToBlocks(text) {
    const parts = String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    return parts.length ? parts.map((p) => para([{ t: "text", text: p }])) : [para()];
  }
  const looksMarkdown = (s) => /^(#{1,6} |\s*[-*+] |\s*\d+\. |>|\|.*\|\s*$|```|\$\$)/m.test(s) || /\*\*[^*]+\*\*/.test(s);

  // --- SVG 정리 (허용 목록) ---
  const SVG_TAGS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "clippath", "title", "desc", "marker", "pattern", "use", "symbol", "mask"]);
  function sanitizeSvg(str) {
    let doc;
    try { doc = new DOMParser().parseFromString(String(str), "image/svg+xml"); } catch { return null; }
    const root = doc && doc.documentElement;
    if (!root || root.localName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
    const clean = (el) => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase(), v = a.value;
        if (n.startsWith("on")) { el.removeAttribute(a.name); continue; }
        if (n === "href" || n === "xlink:href" || n.endsWith(":href")) { if (!/^\s*#/.test(v)) el.removeAttribute(a.name); continue; }
        if (/javascript:|data:|expression\s*\(/i.test(v) || /url\(\s*['"]?(?!#)/i.test(v)) { el.removeAttribute(a.name); continue; }
      }
    };
    const walk = (el) => {
      for (const c of [...el.childNodes]) {
        if (c.nodeType === 3) continue;
        if (c.nodeType !== 1 || !SVG_TAGS.has(c.localName.toLowerCase())) { c.remove(); continue; }
        clean(c); walk(c);
      }
    };
    clean(root); walk(root);
    if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(root);
  }

  /** 큰 래스터 그림을 줄인다(긴 변 1400px, JPEG). 실패하면 원본. */
  function shrinkImage(dataUrl, maxChars) {
    maxChars = maxChars || 180000;
    if (dataUrl.length <= maxChars) return Promise.resolve(dataUrl);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          let best = dataUrl;
          for (const side of [1400, 1000, 700, 480]) {
            const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
            const c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            const out = c.toDataURL("image/jpeg", 0.82);
            if (out.length < best.length) best = out;
            if (best.length <= maxChars) break;
          }
          resolve(best);
        } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // =====================================================================
  // 6. 자동 저장 컨트롤러 · 초안 판단 (순수) — lib/editor/autosave.ts, draft.ts
  // =====================================================================
  class SaveConflictError extends Error { constructor(serverVersion) { super("conflict"); this.serverVersion = serverVersion; } }
  class SaveOfflineError extends Error { constructor() { super("offline"); } }
  class AutosaveController {
    constructor(o) {
      this.o = o; this.version = o.version; this.status = { kind: "saved", at: o.savedAt };
      this.timer = null; this.inFlight = null; this.dirty = false; this.disposed = false;
      this.debounceMs = o.debounceMs == null ? 2000 : o.debounceMs; this.retryMs = o.retryMs == null ? 10000 : o.retryMs;
    }
    getStatus() { return this.status; }
    hasUnsavedChanges() { return this.dirty || this.inFlight !== null; }
    markDirty() {
      this.dirty = true;
      if (this.status.kind === "conflict") return;
      if (this.status.kind !== "saving" && this.status.kind !== "offline") this.setStatus({ kind: "dirty" });
      this.schedule(this.debounceMs);
    }
    flush() {
      this.clearTimer();
      if (this.status.kind === "conflict") return Promise.resolve();
      if (this.inFlight) return this.inFlight;
      if (!this.dirty) return Promise.resolve();
      this.inFlight = this.run().finally(() => {
        this.inFlight = null;
        if (this.disposed) return;
        if (this.status.kind === "offline") this.schedule(this.retryMs);
        else if (this.dirty && this.status.kind !== "conflict") this.schedule(this.debounceMs);
      });
      return this.inFlight;
    }
    retry() { return this.status.kind === "offline" || this.status.kind === "error" ? this.flush() : Promise.resolve(); }
    setOffline() { if (this.status.kind !== "conflict" && this.status.kind !== "saving") this.setStatus({ kind: "offline" }); }
    resolveKeepMine() {
      if (this.status.kind !== "conflict") return Promise.resolve();
      this.version = this.status.serverVersion; this.dirty = true; this.setStatus({ kind: "dirty" });
      return this.flush();
    }
    resolveUseServer(version, savedAt) { this.clearTimer(); this.version = version; this.dirty = false; this.setStatus({ kind: "saved", at: savedAt }); }
    dispose() { this.disposed = true; this.clearTimer(); }
    async run() {
      this.dirty = false; this.setStatus({ kind: "saving" });
      try {
        const r = await this.o.save(this.o.getPayload(), this.version);
        this.version = r.version;
        this.setStatus(this.dirty ? { kind: "dirty" } : { kind: "saved", at: r.updatedAt });
      } catch (err) {
        this.dirty = true;
        if (err instanceof SaveConflictError) this.setStatus({ kind: "conflict", serverVersion: err.serverVersion });
        else if (err instanceof SaveOfflineError) this.setStatus({ kind: "offline" });
        else this.setStatus({ kind: "error", message: err && err.message ? err.message : String(err) });
      }
    }
    schedule(ms) { this.clearTimer(); if (this.disposed) return; this.timer = setTimeout(() => { this.timer = null; this.flush(); }, ms); }
    clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
    setStatus(s) { this.status = s; if (!this.disposed) this.o.onStatus(s); }
  }
  function jsonEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function decideDraft(draft, server) {
    if (!draft) return { action: "discard" };
    if (draft.title === server.title && jsonEqual(normalizeDoc(draft.content), normalizeDoc(server.content))) return { action: "discard" };
    return { action: "offer", serverChanged: server.version !== draft.baseVersion };
  }

  // =====================================================================
  // 7. 저장소 (개인 영역)
  // =====================================================================
  const P = { projects: "projects", docs: "docs", templates: "formatTemplates" };
  const db = () => RN.caps.db;
  const projCol = () => RN.userColl(P.projects);
  const docCol = () => RN.userColl(P.docs);
  const snapCol = (docId) => docCol().doc(docId).collection("snapshots");
  const tplCol = () => RN.userColl(P.templates);
  function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject({ code: "timeout", message: "응답이 없어요" }), ms || 10000);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
  const errText = (e) => (e && e.code === "timeout" ? "서버가 응답하지 않아요. 잠시 뒤 다시 해 보세요." : e && e.code === "quota_exceeded" ? "저장 공간이 가득 찼어요." : "처리하지 못했어요" + (e && (e.message || e.code) ? `: ${e.message || e.code}` : ""));
  const ensureDb = () => { if (!db() || !RN.caps.uid) throw new Error("로그인이 필요해요"); };

  async function addSnapshot(docId, content, version, reason, label) {
    const ref = snapCol(docId).doc(RN.newId());
    await ref.set({ content, version, reason, label: label || null, createdAt: Date.now() });
    try {
      const all = await snapCol(docId).orderBy("createdAt", "desc").get();
      for (const d of all.docs.slice(MAX_SNAPSHOTS)) await snapCol(docId).doc(d.id).delete();
    } catch (e) { console.warn(e); }
  }
  async function deleteDocDeep(docId) {
    try { const s = await snapCol(docId).get(); for (const d of s.docs) await snapCol(docId).doc(d.id).delete(); } catch (e) { console.warn(e); }
    await docCol().doc(docId).delete();
  }
  /** 30일이 지난 휴지통 항목을 영구 삭제한다 (목록을 열 때). */
  async function purgeExpiredProjects(projects) {
    const now = Date.now();
    for (const p of projects) {
      if (!p.deletedAt || now - p.deletedAt < TRASH_DAYS * DAY) continue;
      try {
        const docs = await docCol().where("projectId", "==", p.id).get();
        for (const d of docs.docs) await deleteDocDeep(d.id);
        await projCol().doc(p.id).delete();
      } catch (e) { console.warn("영구 삭제 실패", e); }
    }
  }
  async function purgeExpiredDocs(docs) {
    const now = Date.now();
    for (const d of docs) if (d.deletedAt && now - d.deletedAt >= TRASH_DAYS * DAY) { try { await deleteDocDeep(d.id); } catch (e) { console.warn(e); } }
  }
  async function setProjectDeleted(project, deleted) {
    const now = Date.now();
    const docs = await docCol().where("projectId", "==", project.id).get();
    if (deleted) {
      for (const d of docs.docs) if (!d.data().deletedAt) await docCol().doc(d.id).update({ deletedAt: now });
      await projCol().doc(project.id).update({ deletedAt: now, updatedAt: now });
    } else {
      const at = project.deletedAt;
      for (const d of docs.docs) if (d.data().deletedAt === at) await docCol().doc(d.id).update({ deletedAt: null });
      await projCol().doc(project.id).update({ deletedAt: null, updatedAt: now });
    }
  }
  function buildContent(opts) {
    if (opts.content) return normalizeDoc(opts.content);
    if (typeof opts.markdown === "string") return normalizeDoc({ blocks: markdownToBlocks(opts.markdown) });
    if (typeof opts.text === "string") return normalizeDoc({ blocks: textToBlocks(opts.text) });
    return normalizeDoc(null);
  }

  /**
   * Markdown에서 온 그림(markdownToBlocks가 만든 figure)을 차례로 줄여 넣는다. 문서가 256KiB를 넘을 것 같으면
   * 그 그림부터 남은 그림은 모두 "(그림 생략: 문서 크기 제한)" 문단으로 바꾼다. → { blocks, imagesKept, imagesSkipped }
   */
  async function fitMarkdownImages(blocks, recBase) {
    const SKIP = () => para([{ t: "text", text: "(그림 생략: 문서 크기 제한)" }]);
    // Markdown에서는 그림 줄만 figure가 된다(모두 data: 래스터)
    const out = blocks;
    const figs = out.map((b, i) => (b.type === "figure" && b.src ? i : -1)).filter((i) => i >= 0);
    if (!figs.length) return { blocks: out, imagesKept: 0, imagesSkipped: 0 };
    // 아직 처리하지 않은 그림은 작은 자리표시로 두고 크기를 잰다
    const holder = (i) => ({ id: out[i].id, type: "figure", alt: out[i].alt, src: "data:image/png;base64," });
    const cur = out.map((b, i) => (figs.includes(i) ? holder(i) : b));
    const size = () => jsonBytes({ ...recBase, content: { blocks: cur } });
    let kept = 0, skipped = 0, stop = false;
    for (const i of figs) {
      if (!stop) {
        let src = out[i].src;
        try { src = await shrinkImage(src); } catch { /* 원본 */ }
        cur[i] = { ...out[i], src };
        if (size() <= DOC_LIMIT - 2048) { kept++; continue; }
        stop = true;
      }
      cur[i] = SKIP(); skipped++;
    }
    return { blocks: cur, imagesKept: kept, imagesSkipped: skipped };
  }

  RN.docs = {
    lastImportInfo: null,
    async listProjects() {
      ensureDb();
      const s = await withTimeout(projCol().get());
      return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.deletedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async listDocs(projectId) {
      ensureDb();
      const s = await withTimeout(docCol().where("projectId", "==", projectId).get());
      return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => !d.deletedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async getDoc(docId) {
      if (!db() || !RN.caps.uid || !docId) return null;
      const s = await withTimeout(docCol().doc(String(docId)).get());
      return s.exists ? { id: s.id, ...s.data() } : null;
    },
    /** opts: { title, content | markdown | text, reason?: "IMPORT", formatRules? } → docId */
    async createDoc(projectId, opts) {
      ensureDb();
      opts = opts || {};
      let content = buildContent(opts);
      const now = Date.now();
      const rec = {
        projectId: String(projectId), title: String(opts.title || "제목 없는 문서").slice(0, 200), content,
        formatRules: opts.formatRules ? normalizeRules(opts.formatRules).rules : null, version: 1, deletedAt: null, createdAt: now, updatedAt: now,
      };
      if (typeof opts.markdown === "string" && !opts.content) {
        const fit = await fitMarkdownImages(markdownToBlocks(opts.markdown), rec);
        content = rec.content = normalizeDoc({ blocks: fit.blocks });
        RN.docs.lastImportInfo = { imagesKept: fit.imagesKept, imagesSkipped: fit.imagesSkipped };
      } else RN.docs.lastImportInfo = { imagesKept: 0, imagesSkipped: 0 };
      if (jsonBytes(rec) > DOC_LIMIT) throw new Error("문서가 256KiB를 넘어 저장할 수 없어요. 큰 그림이나 표를 줄여 주세요.");
      const id = RN.newId();
      await withTimeout(docCol().doc(id).set(rec));
      if (opts.reason === "IMPORT") { try { await addSnapshot(id, content, 1, "IMPORT", "가져오기"); } catch (e) { console.warn(e); } }
      try { await projCol().doc(String(projectId)).update({ updatedAt: now }); } catch { /* 프로젝트가 없을 수 있다 */ }
      return id;
    },
    /** 연구 결과보고서용 본문 HTML (200KiB 이하가 되게 큰 그림은 뺀다) */
    exportHtml(doc) {
      const content = doc && doc.blocks ? doc : doc && doc.content;
      const html = bodyHtml(content, doc && doc.formatRules ? normalizeRules(doc.formatRules).rules : DEFAULT_RULES, { maxBytes: REPORT_LIMIT });
      if (lastExportInfo.omitted) RN.toast(`보고서 HTML이 200KiB를 넘어 큰 그림 ${lastExportInfo.omitted}개를 뺐어요.`, "error");
      return html;
    },
    exportMarkdown(doc) {
      const content = doc && doc.blocks ? doc : doc && doc.content;
      return documentToMarkdown(content, doc && doc.formatRules ? normalizeRules(doc.formatRules).rules : DEFAULT_RULES);
    },
    /** (추가) DOCX Blob. SVG 그림은 캡션만 남는다. */
    exportDocx(doc) {
      const content = doc && doc.blocks ? doc : doc && doc.content;
      const r = documentToDocx(doc && doc.title, content, doc && doc.formatRules ? doc.formatRules : DEFAULT_RULES);
      return new Blob([r.bytes], { type: DOCX_MIME });
    },
  };

  // =====================================================================
  // 8. CSS
  // =====================================================================
  const shadow = (a, b) => `0 1px 2px color-mix(in srgb, var(--fg) ${a}%, transparent), 0 10px 28px color-mix(in srgb, var(--fg) ${b}%, transparent)`;
  RN.css("editor", `
.rn-tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--line); }
.rn-tabs::-webkit-scrollbar { display: none; }
.rn-tabs button { flex: none; font: inherit; font-size: 0.92rem; background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 8px 12px; color: var(--muted); cursor: pointer; white-space: nowrap; }
.rn-tabs button:hover { color: var(--fg); }
.rn-tabs button[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
.rn-pj-head { align-items: center; }
.rn-pj-form { display: flex; flex-direction: column; gap: 12px; max-width: 640px; }
.rn-pj-list { display: flex; flex-direction: column; }
.rn-pj-item { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 16px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.rn-pj-item:last-child { border-bottom: 0; }
.rn-pj-main { min-width: 0; flex: 1 1 260px; display: flex; flex-direction: column; gap: 3px; }
.rn-pj-item h2 { font-size: 1.05rem; }
.rn-pj-item h2 .rn-link { color: var(--fg); text-decoration: none; }
.rn-pj-item h2 .rn-link:hover { color: var(--accent); text-decoration: underline; }
.rn-pj-desc { color: var(--muted); font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rn-pj-links { color: var(--muted); }
.rn-pj-links .rn-link { color: var(--muted); }
.rn-proj-intro { display: flex; flex-direction: column; gap: 6px; }
.rn-proj-panel { padding-top: 18px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.rn-proj-danger { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-top: 1px solid var(--line); }
.rn-doc-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.rn-doc-row:last-child { border-bottom: 0; }
.rn-ed-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.rn-ed-titlebox { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex: 1 1 220px; }
.rn-ed-titlebox h1 { font-size: 1.05rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.rn-ed-status { font-size: 0.8rem; color: var(--muted); white-space: nowrap; }
.rn-ed-status[data-kind="offline"], .rn-ed-status[data-kind="error"], .rn-ed-status[data-kind="conflict"] { color: var(--warn); font-weight: 600; }
.rn-ed-panelbar { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; max-width: 100%; }
.rn-ed-panelbar .rn-btn { flex: none; font-size: 0.86rem; padding: 4px 10px; white-space: nowrap; }
.rn-ed-panelbar .rn-btn[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent); }
.rn-ed-toolbar { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; position: relative; max-width: var(--fmt-page-width); margin: 0 auto 8px; }
.rn-ed-bar:not(:has(> :not(:empty))) { display: none; }
.rn-ed-toolbar .rn-btn { padding: 4px 9px; font-size: 0.86rem; border-color: transparent; background: none; min-width: 32px; }
.rn-ed-toolbar .rn-btn:hover, .rn-ed-toolbar .rn-btn[aria-expanded="true"] { background: var(--surface-2); }
.rn-ed-toolbar select { width: auto; padding: 4px 8px; font-size: 0.86rem; background: transparent; }
.rn-ed-toolbar .sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
.rn-menu-wrap { position: relative; }
.rn-menu { position: absolute; z-index: 25; top: calc(100% + 4px); left: 0; min-width: 170px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: ${shadow(8, 14)}; padding: 4px; display: flex; flex-direction: column; }
.rn-menu button { text-align: left; font: inherit; font-size: 0.9rem; border: 0; background: none; color: var(--fg); padding: 6px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.rn-menu button:hover, .rn-menu button:focus { background: var(--accent-soft); outline: none; }
.rn-menu .rn-menu-sep { border-top: 1px solid var(--line); margin: 4px 0; }
.rn-mathdlg { width: min(600px, calc(100vw - 24px)); max-width: calc(100vw - 24px); padding: 18px; }
.rn-mathdlg form { gap: 12px; }
.rn-mathdlg p { margin-bottom: 0; }
.rn-mathdlg h2 { font-size: 1.05rem; }
.rn-mathdlg-tpls { display: flex; flex-wrap: wrap; gap: 4px; }
.rn-mathdlg-tpls .rn-btn { min-width: 36px; padding: 5px 8px; font-size: 0.9rem; }
.rn-mathdlg-cheat { flex-basis: 100%; margin-top: 2px; }
.rn-mathdlg #math-easy { font-family: var(--font-mono); font-size: 1.05rem; }
.rn-mathdlg #math-latex { font-family: var(--font-mono); font-size: 0.85rem; min-height: 56px; }
.rn-mathdlg-preview { background: var(--paper); color: var(--paper-fg); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 12px; min-height: 72px; font-size: 1.5rem; display: flex; align-items: center; justify-content: center; overflow-x: auto; max-width: 100%; }
.rn-mathdlg-preview > * { max-width: 100%; }
.rn-mathdlg-warn { color: var(--warn); }
.rn-mathdlg-latex > summary { font-size: 0.85rem; }
.rn-mathdlg-latex[open] > summary { margin-bottom: 8px; }
.rn-mathdlg-mode { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 0.9rem; }
.rn-mathdlg-mode legend { padding: 0 0 4px; color: var(--muted); font-weight: 600; }
.rn-mathdlg-ai { padding: 10px 12px; background: var(--surface-2); border-radius: var(--radius); }
.rn-ed-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
@media (min-width: 1000px) { .rn-ed-layout.has-side { grid-template-columns: minmax(0, 1fr) 360px; } .rn-ed-side { position: sticky; top: 64px; max-height: calc(100vh - 80px); overflow: auto; } }
@media (max-width: 999px) { .rn-ed-side { order: -1; } }
.rn-ed-side { background: var(--surface); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; box-shadow: ${shadow(6, 6)}; }
.rn-ed-side-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.rn-ed-side h3 { font-size: 0.92rem; }
.rn-ed-side fieldset { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; }
.rn-ed-side legend { font-size: 0.85rem; font-weight: 600; padding: 0 0 6px; }
.rn-ed-side .rn-field.full { grid-column: 1 / -1; }
.rn-ed-side .rn-check { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; }
.rn-fmt-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; }
.rn-fmt-more > summary { cursor: pointer; font-size: 0.88rem; color: var(--muted); padding: 4px 0; }
.rn-fmt-more[open] > summary { margin-bottom: 10px; }
.rn-fmt-more > fieldset + fieldset { margin-top: 16px; }
.rn-fmt-check { border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.rn-issue { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; padding: 5px 0; font-size: 0.86rem; }
.rn-paper-wrap { min-width: 0; padding: 4px 0 32px; }
.rn-paper { background: var(--paper); color: var(--paper-fg); box-sizing: border-box; width: 100%; max-width: var(--fmt-page-width); margin: 0 auto; padding: 28px 20px 48px; min-height: 70vh;
  border-radius: 3px; box-shadow: ${shadow(8, 7)}; font-family: var(--fmt-body-font); font-size: var(--fmt-body-size); line-height: var(--fmt-line-height); text-align: var(--fmt-body-align); position: relative; }
@media (min-width: 900px) { .rn-paper { padding: var(--fmt-margin-top) var(--fmt-margin-right) var(--fmt-margin-bottom) var(--fmt-margin-left); } }
.rn-paper input.rn-paper-title { font: inherit; font-size: 1.6em; font-weight: 700; width: 100%; border: 0; border-bottom: 1px solid transparent; background: transparent; color: var(--paper-fg); padding: 2px 0; margin-bottom: 0.8em; text-align: inherit; }
.rn-paper input.rn-paper-title:hover { border-bottom-color: var(--line); }
.rn-paper input.rn-paper-title:focus { outline: none; border-bottom-color: var(--accent); }
#ed-blocks { outline: none; min-height: 40vh; }
#ed-blocks .rn-slot { white-space: pre-wrap; overflow-wrap: anywhere; position: relative; min-height: 1.2em; }
#ed-blocks > p.rn-slot { margin: 0 0 var(--fmt-para-spacing); text-indent: var(--fmt-indent); }
#ed-blocks .rn-slot.rn-empty::before { content: attr(data-ph); color: var(--muted); position: absolute; left: 0; top: 0; pointer-events: none; text-indent: 0; user-select: none; }
${HEADS.map((hl, i) => `.rn-paper .rn-h${i + 1} { font-family: var(--fmt-${hl}-font); font-size: var(--fmt-${hl}-size); font-weight: var(--fmt-${hl}-weight); text-align: var(--fmt-${hl}-align); line-height: 1.35; margin: 0.9em 0 0.45em; }`).join("\n")}
.rn-paper blockquote.rn-slot { margin: 0 0 var(--fmt-para-spacing); padding-left: 1em; border-left: 3px solid var(--line); }
.rn-paper .rn-blk-list { margin: 0 0 var(--fmt-para-spacing); padding-left: 1.6em; }
.rn-paper pre.rn-slot { font-family: var(--font-mono); font-size: 0.9em; background: var(--surface-2); color: var(--fg); padding: 0.5em 0.7em; border-radius: 4px; margin: 0 0 var(--fmt-para-spacing); }
.rn-paper .rn-cap { font-size: var(--fmt-caption-size); font-weight: var(--fmt-caption-weight); text-align: var(--fmt-caption-align); margin: 0 0 var(--fmt-para-spacing); text-indent: 0; }
.rn-paper .rn-cap-label { user-select: none; }
.rn-paper .rn-cap-orphan .rn-cap-label { color: var(--danger); }
.rn-atom { position: relative; margin: 0 0 var(--fmt-para-spacing); border: 1px dashed transparent; border-radius: 4px; padding: 2px; user-select: none; }
.rn-atom:hover { border-color: var(--line); }
.rn-atom:focus, .rn-atom:focus-within { outline: none; border-color: var(--accent); }
.rn-atom.rn-sel { outline: 2px solid var(--accent); outline-offset: 1px; }
.rn-atom td, .rn-atom th, .rn-atom textarea { user-select: text; }
.rn-atom-bar { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; font-family: var(--font-body); font-size: 0.75rem; line-height: 1.4; text-align: right; opacity: 0; height: 0; overflow: visible; position: relative; z-index: 2; }
.rn-atom:hover .rn-atom-bar, .rn-atom:focus-within .rn-atom-bar, .rn-atom:focus .rn-atom-bar { opacity: 1; }
.rn-atom-bar button { font: inherit; font-size: 0.75rem; padding: 1px 7px; border-radius: 4px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); cursor: pointer; transform: translateY(-110%); }
.rn-fig { text-align: center; }
.rn-fig img { max-width: 100%; height: auto; display: inline-block; }
.rn-math { display: flex; align-items: center; gap: 1em; overflow-x: auto; }
.rn-math-view { flex: 1; text-align: center; min-width: 0; cursor: pointer; }
.rn-eqno { margin-left: auto; white-space: nowrap; }
.rn-math-edit { display: flex; flex-direction: column; gap: 6px; font-family: var(--font-body); font-size: 0.9rem; }
.rn-math-edit textarea { font-family: var(--font-mono); min-height: 64px; color: var(--fg); background: var(--surface); }
.rn-math-edit .preview { text-align: center; color: var(--paper-fg); min-height: 1.5em; }
.rn-tbl-wrap { overflow-x: auto; }
.rn-paper table { border-collapse: collapse; width: 100%; }
.rn-paper th, .rn-paper td { border: 1px solid var(--paper-fg); padding: 0.25em 0.5em; text-align: left; vertical-align: top; min-width: 3em; white-space: pre-wrap; }
.rn-paper th { font-weight: 700; }
.rn-paper th:focus, .rn-paper td:focus { outline: 2px solid var(--accent); outline-offset: -2px; }
.rn-toc p { margin: 0; text-indent: 0; }
.rn-im { display: inline-block; padding: 0 1px; border-radius: 3px; cursor: pointer; text-indent: 0; }
.rn-im:hover { background: var(--accent-soft); }
.rn-xref { color: var(--accent); border-bottom: 1px dotted var(--accent); cursor: pointer; }
.rn-xref.broken { color: var(--danger); border-bottom-color: var(--danger); }
.rn-pagenum { margin-top: 2em; font-size: 9pt; color: var(--muted); font-family: var(--font-body); }
.rn-refpop { position: fixed; z-index: 40; background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: ${shadow(8, 14)}; padding: 4px; max-height: 240px; overflow: auto; width: min(320px, calc(100vw - 24px)); font-family: var(--font-body); font-size: 0.88rem; }
.rn-refpop button { display: block; width: 100%; text-align: left; font: inherit; border: 0; background: none; color: inherit; padding: 5px 8px; border-radius: 4px; cursor: pointer; }
.rn-refpop button[aria-selected="true"] { background: var(--accent-soft); color: var(--accent); }
.rn-refpop p { padding: 5px 8px; color: var(--muted); }
.rn-snap { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 0.88rem; }
.rn-snap:last-child { border-bottom: 0; }
`);

  // =====================================================================
  // 9. 화면: 내 프로젝트 / 프로젝트 홈
  // =====================================================================
  const keywordsOf = (s) => String(s || "").split(/[,，、\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 12);
  const daysLeft = (deletedAt) => Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - Date.now()) / DAY));
  function signedOutNotice(body) {
    body.append(RN.notice("로그인하면 내 프로젝트를 만들고 문서를 쓸 수 있어요. 프로젝트와 문서는 나만 볼 수 있어요."));
  }
  /** 탭 목록 키보드 이동(←/→/Home/End) */
  function tabKeys(e, ids, select) {
    const i = ids.indexOf(e.currentTarget.dataset.tab);
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = ids.length - 1;
    if (j == null) return;
    e.preventDefault();
    select(ids[j], true);
  }

  RN.view("projects", {
    title: "내 프로젝트",
    mount(root) {
      let alive = true, unsub = null, purged = false;
      const head = h("div", { class: "rn-row rn-between rn-pj-head" }, h("h1", {}, "내 프로젝트"));
      const body = h("div", { class: "rn-stack" });
      root.append(head, body);
      RN.ready.then(() => {
        if (!alive) return;
        if (!db() || !RN.caps.uid) { signedOutNotice(body); return; }
        const blocked = RN.writeBlockedReason();
        // 만들기: 버튼을 누르면 폼이 펼쳐진다
        const fTitle = h("input", { type: "text", id: "proj-title", maxLength: 120, required: true });
        const fDesc = h("textarea", { id: "proj-desc", maxLength: 2000, rows: 3 });
        const fField = h("input", { type: "text", id: "proj-field", maxLength: 40, placeholder: "예: 물리, 생명과학" });
        const fKw = h("input", { type: "text", id: "proj-keywords", maxLength: 300, placeholder: "쉼표로 구분" });
        const createBtn = h("button", { type: "submit", class: "rn-btn rn-primary", id: "proj-create", disabled: !!blocked }, "만들기");
        const newBtn = h("button", { type: "button", class: "rn-btn rn-primary", id: "proj-new", "aria-expanded": "false", "aria-controls": "proj-form", disabled: !!blocked }, "새 프로젝트");
        const form = h("form", { class: "rn-pj-form", id: "proj-form", hidden: true, "aria-label": "새 프로젝트" },
          RN.field("제목", fTitle), RN.field("설명", fDesc),
          h("div", { class: "rn-grid" }, RN.field("분야", fField), RN.field("키워드", fKw, "쉼표(,)로 여러 개")),
          h("div", { class: "rn-row rn-end" }, h("button", { type: "button", class: "rn-btn rn-ghost", onclick: () => showForm(false) }, "취소"), createBtn));
        const showForm = (on) => {
          form.hidden = !on; newBtn.hidden = on; newBtn.setAttribute("aria-expanded", String(on));
          if (on) fTitle.focus(); else newBtn.focus();
        };
        newBtn.addEventListener("click", () => showForm(true));
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const title = fTitle.value.trim();
          if (!title) { RN.toast("제목을 입력하세요.", "error"); fTitle.focus(); return; }
          createBtn.disabled = true;
          try {
            const now = Date.now(), id = RN.newId();
            await withTimeout(projCol().doc(id).set({ title, description: fDesc.value.trim(), field: fField.value.trim(), keywords: keywordsOf(fKw.value), archivedAt: null, deletedAt: null, createdAt: now, updatedAt: now }));
            form.reset();
            RN.toast("프로젝트를 만들었어요.");
            RN.go("project", { id });
          } catch (err) { RN.toast(errText(err), "error"); } finally { createBtn.disabled = !!blocked; }
        });
        head.append(newBtn);

        let tab = "active", items = [];
        const TAB_LABEL = { active: "진행 중", archived: "보관함", trash: "휴지통" };
        const viewHead = h("div");
        const list = h("div", { class: "rn-pj-list", "aria-live": "polite" }, RN.notice("불러오는 중…"));
        const links = h("p", { class: "rn-pj-links rn-small" });
        const inTab = (p, k) => (k === "trash" ? !!p.deletedAt : k === "archived" ? !p.deletedAt && !!p.archivedAt : !p.deletedAt && !p.archivedAt);
        const count = (k) => items.filter((p) => inTab(p, k)).length;
        const setTab = (k) => { tab = k; draw(); const t = document.getElementById(k === "active" ? "proj-tab-archived" : "proj-tab-active"); if (t) t.focus(); };
        const tabLink = (k, label) => h("button", { type: "button", class: "rn-link", id: "proj-tab-" + k, onclick: () => setTab(k) }, label);
        const act = (label, fn, cls) => h("button", { type: "button", class: "rn-btn rn-small " + (cls || ""), onclick: async (e) => { e.currentTarget.disabled = true; try { await fn(); } catch (err) { RN.toast(errText(err), "error"); } } }, label);
        const draw = () => {
          viewHead.replaceChildren(tab === "active" ? "" : h("div", { class: "rn-row rn-between" }, h("h2", {}, TAB_LABEL[tab]), tabLink("active", "← 진행 중인 프로젝트")));
          links.replaceChildren(...["archived", "trash"].filter((k) => k !== tab).flatMap((k, i) => [i ? " · " : null, tabLink(k, `${TAB_LABEL[k]} (${count(k)})`)]));
          const rows = items.filter((p) => inTab(p, tab)).sort((a, b) => (tab === "trash" ? b.deletedAt - a.deletedAt : (b.updatedAt || 0) - (a.updatedAt || 0)));
          if (!rows.length) { list.replaceChildren(RN.notice(tab === "trash" ? "휴지통이 비어 있어요. 삭제한 프로젝트는 30일 동안 여기에 있어요." : tab === "archived" ? "보관한 프로젝트가 없어요." : "아직 프로젝트가 없어요. ‘새 프로젝트’로 시작하세요.")); return; }
          list.replaceChildren(...rows.map((p) => h("article", { class: "rn-pj-item", dataset: { projectId: p.id } },
            h("div", { class: "rn-pj-main" },
              h("h2", {}, tab === "trash" ? p.title : h("button", { type: "button", class: "rn-link", onclick: () => RN.go("project", { id: p.id }) }, p.title)),
              p.description ? h("p", { class: "rn-pj-desc", title: p.description }, p.description) : null,
              h("p", { class: "rn-small rn-muted" }, [p.field, tab === "trash" ? `삭제함 ${RN.fmtDate(p.deletedAt)} · ${daysLeft(p.deletedAt)}일 뒤 영구 삭제` : "수정 " + RN.fmtDateTime(p.updatedAt)].filter(Boolean).join(" · "))),
            tab === "trash" ? h("div", { class: "rn-row" },
              act("복구", async () => { await setProjectDeleted(p, false); RN.toast("프로젝트와 문서를 복구했어요."); }),
              act("영구 삭제", async () => {
                if (!(await RN.confirm(`“${p.title}”와 안의 문서를 영구 삭제할까요? 되돌릴 수 없어요.`, { okLabel: "영구 삭제", danger: true }))) return;
                const docs = await docCol().where("projectId", "==", p.id).get();
                for (const d of docs.docs) await deleteDocDeep(d.id);
                await projCol().doc(p.id).delete();
              }, "rn-danger"))
              : tab === "archived" ? act("보관 해제", () => projCol().doc(p.id).update({ archivedAt: null, updatedAt: Date.now() })) : null)));
        };
        body.append(form, blocked ? RN.notice(blocked, "warn") : null, viewHead, list, links);
        draw();
        const timer = setTimeout(() => { if (!items.length) list.replaceChildren(RN.notice("프로젝트를 불러오지 못하고 있어요. 연결을 확인해 주세요.", "warn")); }, 10000);
        unsub = projCol().onSnapshot((snap) => {
          clearTimeout(timer);
          items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (!purged) { purged = true; const exp = items.filter((p) => p.deletedAt && Date.now() - p.deletedAt >= TRASH_DAYS * DAY); if (exp.length) purgeExpiredProjects(exp); items = items.filter((p) => !exp.includes(p)); }
          draw();
        }, (err) => { clearTimeout(timer); list.replaceChildren(RN.notice(errText(err), "error")); });
      });
      return () => { alive = false; if (unsub) unsub(); };
    },
  });

  const SECTION_LABEL = { pains: "고충", data: "데이터", research: "연구 공개", import: "가져오기" };
  RN.view("project", {
    title: "프로젝트",
    nav: "projects",
    mount(root, params) {
      let alive = true;
      const unsubs = [], sectionCleanups = [];
      const h1 = h("h1", {}, "프로젝트");
      const back = h("button", { type: "button", class: "rn-link rn-small", onclick: () => RN.go("projects") }, "← 내 프로젝트");
      root.append(back, h1);
      const body = h("div", { class: "rn-stack" }, RN.notice("불러오는 중…"));
      root.append(body);
      (async () => {
        await RN.ready;
        if (!alive) return;
        if (!db() || !RN.caps.uid) { body.replaceChildren(); signedOutNotice(body); return; }
        const pid = params && params.id ? String(params.id) : "";
        let project = null;
        try { const s = pid ? await withTimeout(projCol().doc(pid).get()) : null; if (s && s.exists) project = { id: s.id, ...s.data() }; }
        catch (e) { body.replaceChildren(RN.notice(errText(e), "error")); return; }
        if (!alive) return;
        if (!project) { h1.textContent = "프로젝트를 찾을 수 없어요"; body.replaceChildren(RN.notice("없거나 내 프로젝트가 아니에요. 프로젝트는 만든 사람만 볼 수 있어요.")); return; }
        const blocked = RN.writeBlockedReason();
        const run = (fn) => async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { RN.toast(errText(err), "error"); } finally { b.disabled = false; } };

        // ---- 탭: 문서(기본) · 섹션들 · 설정 ----
        const intro = h("div", { class: "rn-proj-intro" });
        const tabList = h("div", { class: "rn-tabs", role: "tablist", "aria-label": "프로젝트" });
        const panelBox = h("div");
        body.replaceChildren(intro, h("div", {}, tabList, panelBox));
        const secs = RN.projectSections.filter((s) => s && typeof s.mount === "function");
        const tabs = [{ id: "docs", label: "문서" },
          ...secs.map((s, i) => ({ id: "s-" + String(s.id || i), label: s.label || SECTION_LABEL[s.id] || String(s.id || "더 보기"), sec: s })),
          { id: "settings", label: "설정" }];
        const panes = {};
        for (const t of tabs) {
          const pane = h(t.sec ? "section" : "div", { class: "rn-proj-panel", role: "tabpanel", id: "ppanel-" + t.id, "aria-labelledby": "ptab-" + t.id, hidden: true, dataset: t.sec ? { section: String(t.sec.id || "") } : {} });
          panes[t.id] = { el: pane, mounted: false, t };
          panelBox.append(pane);
          tabList.append(h("button", { type: "button", role: "tab", id: "ptab-" + t.id, "aria-controls": "ppanel-" + t.id, "aria-selected": "false", tabIndex: -1, dataset: { tab: t.id },
            onclick: () => select(t.id), onkeydown: (e) => tabKeys(e, tabs.map((x) => x.id), select) }, t.label));
        }
        function select(id, focus) {
          for (const t of tabs) {
            const on = t.id === id, btn = tabList.querySelector("#ptab-" + CSS.escape(t.id));
            btn.setAttribute("aria-selected", String(on)); btn.tabIndex = on ? 0 : -1; panes[t.id].el.hidden = !on;
            if (on && focus) btn.focus();
          }
          const p = panes[id];
          if (p.mounted) return;
          p.mounted = true;
          if (id === "settings") drawSettings();
          else if (p.t.sec) {
            try { const c = p.t.sec.mount(p.el, { ...project }); if (typeof c === "function") sectionCleanups.push(c); }
            catch (e) { console.error(e); p.el.replaceChildren(RN.notice("이 영역을 그리지 못했어요.", "error")); }
          }
        }

        const drawIntro = () => {
          h1.textContent = project.title;
          intro.replaceChildren(
            project.deletedAt ? h("div", { class: "rn-notice rn-warn", role: "status" }, `휴지통에 있는 프로젝트예요. ${daysLeft(project.deletedAt)}일 뒤 영구 삭제돼요. `,
              h("button", { type: "button", class: "rn-btn", id: "proj-restore", onclick: run(async () => { await setProjectDeleted(project, false); project.deletedAt = null; drawIntro(); drawSettings(); RN.toast("복구했어요."); }) }, "복구")) : null,
            project.description ? h("p", { class: "rn-muted" }, project.description) : null,
            project.archivedAt || project.field ? h("div", { class: "rn-row" }, project.archivedAt ? RN.badge("보관됨", "warn") : null, project.field ? RN.badge(project.field) : null) : null);
        };
        function drawSettings() {
          const pane = panes.settings.el;
          if (project.deletedAt || blocked) { pane.replaceChildren(RN.notice(blocked || "휴지통에 있는 프로젝트는 고칠 수 없어요. 먼저 복구하세요.")); return; }
          const t = h("input", { type: "text", id: "pe-title", value: project.title, maxLength: 120 });
          const d = h("textarea", { id: "pe-desc", rows: 3 }); d.value = project.description || "";
          const f = h("input", { type: "text", id: "pe-field", value: project.field || "", maxLength: 40 });
          const k = h("input", { type: "text", id: "pe-keywords", value: (project.keywords || []).join(", "), maxLength: 300 });
          const form = h("form", { class: "rn-pj-form", id: "proj-edit-form", onsubmit: async (e) => {
            e.preventDefault();
            if (!t.value.trim()) { RN.toast("제목을 입력하세요.", "error"); return; }
            const patch = { title: t.value.trim(), description: d.value.trim(), field: f.value.trim(), keywords: keywordsOf(k.value), updatedAt: Date.now() };
            try { await projCol().doc(project.id).update(patch); Object.assign(project, patch); drawIntro(); RN.toast("저장했어요."); } catch (err) { RN.toast(errText(err), "error"); }
          } }, RN.field("제목", t), RN.field("설명", d), h("div", { class: "rn-grid" }, RN.field("분야", f), RN.field("키워드", k, "쉼표로 구분")),
          h("div", { class: "rn-row rn-end" }, h("button", { type: "submit", class: "rn-btn rn-primary", id: "proj-save" }, "저장")));
          pane.replaceChildren(form,
            h("div", { class: "rn-proj-danger" }, h("span", { class: "rn-small rn-muted" }, project.archivedAt ? "보관함에서 꺼내 진행 중 목록으로 돌려요." : "끝난 프로젝트는 보관함으로 옮겨 목록을 가볍게 해요."),
              h("button", { type: "button", class: "rn-btn", id: "proj-archive", onclick: run(async () => {
                const archivedAt = project.archivedAt ? null : Date.now();
                await projCol().doc(project.id).update({ archivedAt, updatedAt: Date.now() }); project.archivedAt = archivedAt; drawIntro(); drawSettings();
                RN.toast(archivedAt ? "보관함으로 옮겼어요." : "보관을 해제했어요.");
              }) }, project.archivedAt ? "보관 해제" : "보관")),
            h("div", { class: "rn-proj-danger" }, h("span", { class: "rn-small rn-muted" }, "휴지통으로 옮기면 30일 뒤 문서와 함께 영구 삭제돼요."),
              h("button", { type: "button", class: "rn-btn rn-danger", id: "proj-delete", onclick: run(async () => {
                if (!(await RN.confirm(`“${project.title}”를 휴지통으로 옮길까요? 안의 문서도 함께 옮겨지고, 30일 안에 복구할 수 있어요.`, { okLabel: "휴지통으로", danger: true }))) return;
                await setProjectDeleted(project, true);
                RN.toast("휴지통으로 옮겼어요. 30일 안에 복구할 수 있어요.");
                RN.go("projects");
              }) }, "삭제")));
        }
        drawIntro();

        // ---- 문서 탭 ----
        const docsBox = h("div", {}, RN.notice("문서를 불러오는 중…"));
        const trashBox = h("div");
        panes.docs.el.append(
          h("div", { class: "rn-row rn-between" }, h("span", { class: "rn-small rn-muted", id: "proj-doc-count" }),
            h("button", { type: "button", id: "proj-new-doc", class: "rn-btn rn-primary", disabled: !!blocked || !!project.deletedAt, onclick: async (e) => {
              e.currentTarget.disabled = true;
              try { const id = await RN.docs.createDoc(project.id, { title: "제목 없는 문서" }); RN.go("editor", { projectId: project.id, docId: id }); }
              catch (err) { RN.toast(errText(err), "error"); e.currentTarget.disabled = false; }
            } }, "새 문서")),
          docsBox, trashBox);
        select("docs");

        let purgedDocs = false;
        const docTimer = setTimeout(() => docsBox.replaceChildren(RN.notice("문서를 불러오지 못하고 있어요.", "warn")), 10000);
        unsubs.push(docCol().where("projectId", "==", project.id).onSnapshot((snap) => {
          clearTimeout(docTimer);
          let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (!purgedDocs) { purgedDocs = true; purgeExpiredDocs(docs); docs = docs.filter((d) => !(d.deletedAt && Date.now() - d.deletedAt >= TRASH_DAYS * DAY)); }
          const live = docs.filter((d) => !d.deletedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const dead = project.deletedAt ? [] : docs.filter((d) => d.deletedAt);
          const cnt = document.getElementById("proj-doc-count");
          if (cnt) cnt.textContent = live.length ? `문서 ${live.length}개` : "";
          docsBox.replaceChildren(live.length ? h("div", {}, live.map((d) => h("div", { class: "rn-doc-row", dataset: { docId: d.id } },
            h("div", { class: "rn-stack", style: { gap: "2px" } },
              h("button", { type: "button", class: "rn-link", onclick: () => RN.go("editor", { projectId: project.id, docId: d.id }) }, d.title || "제목 없는 문서"),
              h("span", { class: "rn-small rn-muted" }, "수정 " + RN.fmtDateTime(d.updatedAt))),
            project.deletedAt || blocked ? null : h("button", { type: "button", class: "rn-btn rn-ghost rn-small", "aria-label": `“${d.title || "제목 없는 문서"}” 삭제`, onclick: async () => {
              if (!(await RN.confirm(`“${d.title}”를 휴지통으로 옮길까요? 30일 안에 복구할 수 있어요.`, { okLabel: "휴지통으로", danger: true }))) return;
              try { await docCol().doc(d.id).update({ deletedAt: Date.now() }); } catch (err) { RN.toast(errText(err), "error"); }
            } }, "삭제"))))
            : RN.notice(project.deletedAt ? "문서도 휴지통에 있어요." : "아직 문서가 없어요. ‘새 문서’로 시작하세요."));
          trashBox.replaceChildren(dead.length ? h("details", {}, h("summary", { class: "rn-small rn-muted", style: { cursor: "pointer" } }, `휴지통의 문서 (${dead.length})`),
            dead.map((d) => h("div", { class: "rn-doc-row" }, h("span", {}, d.title || "제목 없는 문서", h("span", { class: "rn-small rn-muted" }, ` · ${daysLeft(d.deletedAt)}일 뒤 영구 삭제`)),
              h("button", { type: "button", class: "rn-btn rn-small", onclick: async () => { try { await docCol().doc(d.id).update({ deletedAt: null }); } catch (err) { RN.toast(errText(err), "error"); } } }, "복구")))) : "");
        }, (err) => { clearTimeout(docTimer); docsBox.replaceChildren(RN.notice(errText(err), "error")); }));
      })();
      return () => { alive = false; unsubs.forEach((u) => u()); sectionCleanups.forEach((c) => { try { c(); } catch (e) { console.error(e); } }); };
    },
  });

  // =====================================================================
  // 10. 화면: 에디터
  //   본문 전체가 하나의 contenteditable(#ed-blocks)이다. 그림·표·수식·목차는 그 안의 contenteditable="false" 덩어리.
  //   편집은 beforeinput(inputType, getTargetRanges)에서 가로채 모델(블록 JSON)에 반영하고 바뀐 블록만 다시 그린다.
  //   한글 조합(IME) 중에는 브라우저에 맡기고 compositionend에서 DOM을 읽어 모델에 옮긴다.
  // =====================================================================

  // ---------- 10-1. 줄(편집 단위) 모델 (순수) ----------
  // 글 블록 하나 = 줄 하나, 목록은 항목마다 한 줄, 그림·표·수식·목차는 원자 줄(길이 1: 앞 0, 뒤 1).
  // 위치는 { line, off } — off는 글자 수(인라인 수식·참조·줄바꿈은 1칸).
  const LINE_ATOMS = ["figure", "math", "table", "toc"];
  const cmpPt = (a, b) => a.line - b.line || a.off - b.off;
  const lineLen = (l) => (l.k === "atom" ? 1 : inlLen(l.content));
  const textLine = (type, content, extra) => ({ k: "text", type, id: genId(), content: normInline(content || []), ...(extra || {}) });
  function flattenBlocks(blocks) {
    const lines = [];
    for (const b of blocks) {
      if (b.type === "list") b.items.forEach((it, i) => lines.push({ k: "text", type: "item", id: b.id, listId: b.id, ordered: b.ordered, item: i, content: it }));
      else if (b.type === "code") lines.push({ k: "text", type: "code", id: b.id, content: b.text ? [{ t: "text", text: b.text }] : [] });
      else if (TEXT_TYPES.includes(b.type)) lines.push({ k: "text", type: b.type, id: b.id, level: b.level, kind: b.kind, content: b.content });
      else lines.push({ k: "atom", type: b.type, id: b.id, block: b });
    }
    return lines;
  }
  function unflattenLines(lines) {
    const blocks = [], used = new Set();
    const take = (id) => { const v = id && !used.has(id) ? id : genId(); used.add(v); return v; };
    let run = null; // 이어지는 목록 항목 { lid, block }
    for (const l of lines) {
      if (l.k === "text" && l.type === "item") {
        if (run && run.lid === l.listId) { run.block.items.push(normInline(l.content)); continue; }
        const block = { id: take(l.listId), type: "list", ordered: !!l.ordered, items: [normInline(l.content)] };
        blocks.push(block); run = { lid: l.listId, block };
        continue;
      }
      run = null;
      if (l.k === "atom") { blocks.push({ ...l.block, id: take(l.block.id) }); continue; }
      const id = take(l.id);
      if (l.type === "code") blocks.push({ id, type: "code", text: inlPlain(l.content, null) });
      else if (l.type === "heading") blocks.push({ id, type: "heading", level: clampInt(l.level, 1, 3, 1), content: normInline(l.content) });
      else if (l.type === "caption") blocks.push({ id, type: "caption", kind: KINDS.includes(l.kind) ? l.kind : "figure", content: normInline(l.content) });
      else blocks.push({ id, type: l.type === "quote" ? "quote" : "paragraph", content: normInline(l.content) });
    }
    if (!blocks.length) blocks.push(para());
    return blocks;
  }
  const clampPt = (lines, p) => {
    const line = Math.max(0, Math.min(lines.length - 1, p.line | 0));
    return { line, off: Math.max(0, Math.min(lineLen(lines[line]), p.off | 0)) };
  };
  /** 범위를 지운다. 여러 줄이면 첫 줄 앞부분 + 끝 줄 뒷부분을 합친다(첫 줄의 종류를 따른다). → 커서 위치 */
  function linesDelete(lines, a, b) {
    if (cmpPt(a, b) > 0) [a, b] = [b, a];
    if (a.line === b.line) {
      const L = lines[a.line];
      if (L.k === "atom") {
        if (a.off === 0 && b.off >= 1) { lines.splice(a.line, 1, textLine("paragraph")); return { line: a.line, off: 0 }; }
        return a;
      }
      const [x] = splitInline(L.content, a.off), [, y] = splitInline(L.content, b.off);
      L.content = normInline([...x, ...y]);
      return { line: a.line, off: a.off };
    }
    const first = lines[a.line], last = lines[b.line];
    const out = [];
    let caret = null;
    if (first.k === "text") { out.push({ ...first, content: splitInline(first.content, a.off)[0] }); caret = { line: a.line, off: a.off }; }
    else if (a.off >= 1) out.push(first);
    if (last.k === "text") {
      const tail = splitInline(last.content, b.off)[1];
      if (first.k === "text") out[0].content = normInline([...out[0].content, ...(last.type === "code" ? [{ t: "text", text: inlPlain(tail, null) }] : tail)]);
      else out.push({ ...last, content: tail });
    } else if (b.off === 0) out.push(last);
    if (!caret) {
      const ti = out.findIndex((l) => l.k === "text");
      if (ti < 0) { const at = first.k === "atom" && a.off >= 1 ? 1 : 0; out.splice(at, 0, textLine("paragraph")); caret = { line: a.line + at, off: 0 }; }
      else caret = { line: a.line + ti, off: 0 };
    }
    lines.splice(a.line, b.line - a.line + 1, ...out);
    return caret;
  }
  /** 커서 앞 글자의 굵게·기울임 */
  function marksAt(content, off) {
    const [x] = splitInline(content, off);
    const n = x.length ? x[x.length - 1] : content[0];
    return n && n.t === "text" ? { b: !!n.b, i: !!n.i } : { b: false, i: false };
  }
  function linesInsertNodes(lines, p, nodes) {
    const L = lines[p.line];
    const len = inlLen(nodes);
    if (L.k === "atom") { const at = p.off >= 1 ? p.line + 1 : p.line; lines.splice(at, 0, textLine("paragraph", nodes)); return { line: at, off: len }; }
    const [x, y] = splitInline(L.content, p.off);
    L.content = normInline([...x, ...nodes, ...y]);
    return { line: p.line, off: p.off + len };
  }
  function linesInsertText(lines, p, text, marks) {
    if (!text) return p;
    const L = lines[p.line];
    const m = L.k === "text" && L.type !== "code" ? marks || marksAt(L.content, p.off) : {};
    return linesInsertNodes(lines, p, [{ t: "text", text, ...(m.b ? { b: true } : {}), ...(m.i ? { i: true } : {}) }]);
  }
  /** 여러 줄 글자 넣기(붙여넣기·바꾸기): 줄마다 새 문단(목록 안이면 새 항목). 가운데 빈 줄은 버린다. 코드 블록에는 그대로. */
  function linesInsertMulti(lines, p, text) {
    text = String(text).replace(/\r\n?/g, "\n");
    const L = lines[p.line];
    if (L.k === "text" && L.type === "code") return linesInsertText(lines, p, text);
    const parts = text.split("\n").filter((s, i, arr) => s.trim() || i === 0 || i === arr.length - 1);
    if (parts.length === 1) return linesInsertText(lines, p, parts[0]);
    const T = (s) => (s ? [{ t: "text", text: s }] : []);
    if (L.k === "atom") {
      const fresh = parts.filter((s) => s.trim()).map((s) => textLine("paragraph", T(s)));
      if (!fresh.length) return p;
      const at = p.off >= 1 ? p.line + 1 : p.line;
      lines.splice(at, 0, ...fresh);
      return { line: at + fresh.length - 1, off: lineLen(fresh[fresh.length - 1]) };
    }
    const [x, y] = splitInline(L.content, p.off);
    L.content = normInline([...x, ...T(parts[0])]);
    const fresh = parts.slice(1).map((s) => (L.type === "item" ? { k: "text", type: "item", id: L.listId, listId: L.listId, ordered: L.ordered, content: T(s) } : textLine(L.type === "quote" ? "quote" : "paragraph", T(s))));
    const lastL = fresh[fresh.length - 1];
    const off = inlLen(lastL.content);
    lastL.content = normInline([...lastL.content, ...y]);
    lines.splice(p.line + 1, 0, ...fresh);
    return { line: p.line + fresh.length, off };
  }
  /** Enter: 줄 나누기 */
  function linesSplit(lines, p) {
    const L = lines[p.line];
    if (L.k === "atom") { const at = p.off >= 1 ? p.line + 1 : p.line; lines.splice(at, 0, textLine("paragraph")); return { line: at, off: 0 }; }
    if (L.type === "code") return linesInsertText(lines, p, "\n");
    const len = inlLen(L.content);
    if (L.type === "item" && !len) { lines[p.line] = textLine("paragraph"); return { line: p.line, off: 0 }; } // 빈 항목에서 Enter → 목록 밖으로
    if (p.off === 0 && len > 0) {
      lines.splice(p.line, 0, L.type === "item" ? { ...L, content: [] } : textLine("paragraph"));
      return { line: p.line + 1, off: 0 };
    }
    const [x, y] = splitInline(L.content, p.off);
    L.content = x;
    lines.splice(p.line + 1, 0, L.type === "item" ? { ...L, content: y } : textLine(L.type === "quote" ? "quote" : "paragraph", y));
    return { line: p.line + 1, off: 0 };
  }
  /** 줄 맨 앞에서 Backspace → { caret } 또는 { atom: 줄 }(그 그림·표를 고른다) */
  function linesBackspaceAtStart(lines, li) {
    const L = lines[li];
    if (L.k === "atom") return { atom: li };
    if (L.type === "code") {
      if (!inlLen(L.content)) lines[li] = { k: "text", type: "paragraph", id: L.id, content: [] };
      return { caret: { line: li, off: 0 } };
    }
    if (L.type === "item") {
      const prev = lines[li - 1];
      if (prev && prev.type === "item" && prev.listId === L.listId) {
        const len = inlLen(prev.content);
        prev.content = normInline([...prev.content, ...L.content]); lines.splice(li, 1);
        return { caret: { line: li - 1, off: len } };
      }
      lines[li] = { k: "text", type: "paragraph", id: genId(), content: L.content };
      return { caret: { line: li, off: 0 } };
    }
    if (L.type === "heading" || L.type === "quote") { lines[li] = { k: "text", type: "paragraph", id: L.id, content: L.content }; return { caret: { line: li, off: 0 } }; }
    if (L.type === "caption") {
      if (inlLen(L.content)) return { caret: { line: li, off: 0 } };
      lines.splice(li, 1);
      if (!lines.length) lines.push(textLine("paragraph"));
      const pi = Math.max(0, li - 1);
      return lines[pi].k === "atom" ? { atom: pi } : { caret: { line: pi, off: lineLen(lines[pi]) } };
    }
    const prev = lines[li - 1];
    if (!prev) return { caret: { line: li, off: 0 } };
    if (prev.k === "atom") { if (!inlLen(L.content) && lines.length > 1) lines.splice(li, 1); return { atom: li - 1 }; }
    const len = inlLen(prev.content);
    prev.content = normInline([...prev.content, ...(prev.type === "code" ? [{ t: "text", text: inlPlain(L.content, null) }] : L.content)]);
    lines.splice(li, 1);
    return { caret: { line: li - 1, off: len } };
  }
  /** 줄 끝에서 Delete */
  function linesDeleteAtEnd(lines, li) {
    const L = lines[li], next = lines[li + 1];
    if (L.k === "atom") return { atom: li };
    if (!next) return { caret: { line: li, off: lineLen(L) } };
    if (next.k === "atom") {
      if (!inlLen(L.content) && L.type === "paragraph") { lines.splice(li, 1); return { atom: li }; }
      return { atom: li + 1 };
    }
    const len = inlLen(L.content);
    L.content = normInline([...L.content, ...(L.type === "code" || next.type === "code" ? [{ t: "text", text: inlPlain(next.content, null) }] : next.content)]);
    lines.splice(li + 1, 1);
    return { caret: { line: li, off: len } };
  }
  /** 굵게·기울임 켜고 끄기(범위의 글자가 모두 켜져 있으면 끈다). 바뀐 게 있으면 true */
  function linesToggleMark(lines, a, b, mark) {
    const each = (fn) => {
      for (let li = a.line; li <= b.line; li++) {
        const L = lines[li];
        if (L.k !== "text" || L.type === "code") continue;
        const s = li === a.line ? a.off : 0, e = li === b.line ? b.off : inlLen(L.content);
        if (e > s) fn(L, s, e);
      }
    };
    let all = true, any = false;
    each((L, s, e) => { const [, rest] = splitInline(L.content, s); const [mid] = splitInline(rest, e - s); for (const n of mid) if (n.t === "text") { any = true; if (!n[mark]) all = false; } });
    if (!any) return false;
    each((L, s, e) => {
      const [x, rest] = splitInline(L.content, s);
      const [mid, y] = splitInline(rest, e - s);
      L.content = normInline([...x, ...mid.map((n) => (n.t === "text" ? { ...n, [mark]: !all } : n)), ...y]);
    });
    return true;
  }
  /** 범위의 글 줄 종류 바꾸기. toggle이면 이미 그 종류인 줄은 본문으로. 바꾼 게 없으면 false */
  function linesSetType(lines, a, b, type, opt, toggle) {
    const idxs = [];
    for (let li = a.line; li <= b.line; li++) { const L = lines[li]; if (L.k === "text" && L.type !== "caption" && L.type !== "code") idxs.push(li); }
    if (!idxs.length) return false;
    const Ls = idxs.map((i) => lines[i]);
    const plain = (L) => ({ k: "text", type: "paragraph", id: L.type === "item" ? genId() : L.id, content: L.content });
    if (type === "list") {
      if (Ls.every((L) => L.type === "item")) {
        if (toggle && Ls.every((L) => !!L.ordered === !!opt)) { for (const i of idxs) lines[i] = plain(lines[i]); return true; }
        const ids = new Set(Ls.map((L) => L.listId));
        for (const L of lines) if (L.type === "item" && ids.has(L.listId)) L.ordered = !!opt;
        return true;
      }
      const lid = Ls[0].type === "item" ? Ls[0].listId : genId();
      for (const i of idxs) lines[i] = { k: "text", type: "item", id: lid, listId: lid, ordered: Ls[0].type === "item" ? Ls[0].ordered : !!opt, content: lines[i].content };
      if (Ls[0].type !== "item") return true;
      for (const L of lines) if (L.type === "item" && L.listId === lid) L.ordered = !!opt;
      return true;
    }
    const isOn = (L) => (type === "heading" ? L.type === "heading" && L.level === opt : L.type === type);
    const off = type === "paragraph" || (toggle && Ls.every(isOn));
    for (const i of idxs) {
      const L = lines[i];
      lines[i] = off ? plain(L) : { k: "text", type, id: L.type === "item" ? genId() : L.id, content: L.content, ...(type === "heading" ? { level: opt } : {}) };
    }
    return true;
  }
  /** 블록 하나의 글자(문서 글자 뽑기·복사용) */
  function blockText(b, nb) {
    if (b.type === "list") return b.items.map((it, i) => (b.ordered ? `${i + 1}. ` : "- ") + inlPlain(it, nb)).join("\n");
    if (b.type === "table") return b.rows.map((r) => r.join("\t")).join("\n");
    if (b.type === "figure") return `[그림: ${b.alt || ""}]`;
    if (b.type === "math") { const e = nb.byId.get(b.id); return `$$${b.latex}$$${e ? ` (${e.number})` : ""}`; }
    if (b.type === "code") return b.text;
    if (b.type === "toc") return captionList(nb, b.kind).map(tocLine).join("\n");
    if (b.type === "caption") { const e = nb.byId.get(b.id); return (e ? e.captionLabel + " " : "") + inlPlain(b.content, nb); }
    return inlPlain(b.content, nb);
  }
  /** 범위의 글자(복사·잘라내기). 줄 사이는 \n */
  function linesText(lines, a, b, nb) {
    if (cmpPt(a, b) > 0) [a, b] = [b, a];
    const out = [];
    for (let li = a.line; li <= b.line; li++) {
      const L = lines[li];
      if (L.k === "atom") { if ((li === a.line && a.off >= 1) || (li === b.line && b.off === 0)) continue; out.push(blockText(L.block, nb)); continue; }
      const s = li === a.line ? a.off : 0, e = li === b.line ? b.off : inlLen(L.content);
      const [, rest] = splitInline(L.content, s);
      const [mid] = splitInline(rest, Math.max(0, e - s));
      out.push(inlPlain(mid, nb));
    }
    return out.join("\n");
  }

  // ---------- 10-2. DOM ↔ 위치 ----------
  const isInlineAtom = (el) => el.nodeType === 1 && el.classList && (el.classList.contains("rn-im") || el.classList.contains("rn-xref"));
  // rn-ghost: 자동완성 제안(mod-autocomplete.js). 문서 글자가 아니므로 위치 계산·DOM 읽기에서 건너뛴다.
  const isSkipEl = (el) => el.nodeType === 1 && el.classList && (el.classList.contains("rn-cap-label") || el.classList.contains("rn-fill") || el.classList.contains("rn-ghost"));
  function measureNode(n) {
    if (n.nodeType === 3) return n.data.length;
    if (n.nodeType !== 1 && n.nodeType !== 11) return 0;
    if (n.nodeType === 1) { if (isSkipEl(n)) return 0; if (isInlineAtom(n) || n.tagName === "BR") return 1; }
    let s = 0;
    for (const c of n.childNodes) s += measureNode(c);
    return s;
  }
  /** slot 안 (container, offset)까지의 글자 수. 인라인 수식 안쪽이면 그 앞(side=end면 뒤). */
  function offsetIn(slot, container, offset, side) {
    const el = container.nodeType === 1 ? container : container.parentElement;
    const atom = el && el.closest(".rn-im, .rn-xref, .rn-cap-label");
    if (atom && slot.contains(atom)) {
      const idx = [...atom.parentNode.childNodes].indexOf(atom);
      container = atom.parentNode;
      offset = idx + (side === "end" || atom.classList.contains("rn-cap-label") ? 1 : 0);
    }
    const r = document.createRange();
    r.selectNodeContents(slot);
    try { r.setEnd(container, offset); } catch { return measureNode(slot); }
    return measureNode(r.cloneContents());
  }
  /** slot 안에서 글자 위치 off의 DOM 위치 [node, offset] */
  function locate(slot, off) {
    let remaining = Math.max(0, off), result = null;
    const visit = (node) => {
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType === 3) {
          if (remaining <= c.data.length) { result = [c, remaining]; return true; }
          remaining -= c.data.length;
        } else if (c.nodeType === 1) {
          if (isSkipEl(c)) continue;
          if (isInlineAtom(c) || c.tagName === "BR") {
            if (remaining === 0) { result = [node, i]; return true; }
            remaining -= 1;
            if (remaining === 0) { const nx = c.nextSibling; result = nx && nx.nodeType === 3 ? [nx, 0] : [node, i + 1]; return true; }
          } else if (visit(c)) return true;
        }
      }
      return false;
    };
    if (visit(slot)) return result;
    const fill = slot.querySelector(":scope > .rn-fill");
    return [slot, fill ? [...slot.childNodes].indexOf(fill) : slot.childNodes.length];
  }
  /** slot의 DOM → 인라인 (브라우저가 직접 고친 뒤 읽어 들일 때) */
  function parseSlot(el) {
    const out = [];
    const walk = (node, m) => {
      const kids = [...node.childNodes];
      kids.forEach((c, i) => {
        if (c.nodeType === 3) { const text = c.data.replace(/ /g, " "); if (text) out.push({ t: "text", text, ...m }); return; }
        if (c.nodeType !== 1 || isSkipEl(c)) return;
        if (c.classList.contains("rn-im")) out.push({ t: "math", latex: c.dataset.latex || "" });
        else if (c.classList.contains("rn-xref")) out.push({ t: "ref", target: c.dataset.target || "" });
        else if (c.tagName === "BR") { if (!(node === el && i === kids.length - 1)) out.push({ t: "br" }); } // 맨 끝 <br>은 빈 줄 표시일 뿐
        else {
          const nm = { ...m };
          if (c.tagName === "B" || c.tagName === "STRONG" || /bold|[6-9]00/.test(c.style.fontWeight)) nm.b = true;
          if (c.tagName === "I" || c.tagName === "EM" || c.style.fontStyle === "italic") nm.i = true;
          walk(c, nm);
        }
      });
    };
    walk(el, {});
    return normInline(out);
  }
  const INLINE_MATH_RE = /(?<![\\$])\$([^\s$](?:[^$]*?[^\s$\\])?)\$(?!\$)/;
  function convertInlineMath(inl) {
    const out = [];
    let changed = false;
    for (const n of inl) {
      if (n.t !== "text") { out.push(n); continue; }
      let s = n.text, m;
      while ((m = INLINE_MATH_RE.exec(s))) {
        changed = true;
        if (m.index) out.push({ ...n, text: s.slice(0, m.index) });
        out.push({ t: "math", latex: easyToLatex(m[1]) });
        s = s.slice(m.index + m[0].length);
      }
      if (s) out.push({ ...n, text: s });
    }
    return changed ? normInline(out) : null;
  }
  const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  // ---------- 쉬운 수식 표기 → LaTeX (순수 함수) ----------
  // 학생이 평소 쓰는 식(a/b, x^2, sqrt(x), 알파, <= …)을 LaTeX로 바꾼다. 백슬래시가 들어 있으면 이미 LaTeX로 보고 그대로 둔다.
  // 바꿀 수 없으면 원문을 그대로 돌려준다(예외를 던지지 않는다).
  const EZ_GREEK = "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega".split(" ");
  const EZ_FUNCS = "sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh log ln exp max min det gcd".split(" ");
  const EZ_SPECIAL = ["sqrt", "root", "sum", "prod", "int", "oint", "lim", "vec", "bar", "hat", "abs", "frac"];
  const EZ_WORDS = new Map([...EZ_GREEK.map((g) => [g, "\\" + g]), ...EZ_FUNCS.map((f) => [f, "\\" + f]), ["inf", "\\infty"], ["infty", "\\infty"], ["infinity", "\\infty"], ["partial", "\\partial"], ["deg", "^{\\circ}"]]);
  const EZ_KNOWN = [...EZ_WORDS.keys(), ...EZ_SPECIAL].sort((a, b) => b.length - a.length);
  const EZ_KO = {
    알파: "\\alpha", 베타: "\\beta", 감마: "\\gamma", 델타: "\\Delta", 엡실론: "\\epsilon", 입실론: "\\epsilon", 제타: "\\zeta", 에타: "\\eta", 세타: "\\theta", 쎄타: "\\theta",
    요타: "\\iota", 카파: "\\kappa", 람다: "\\lambda", 뮤: "\\mu", 크사이: "\\xi", 파이: "\\pi", 시그마: "\\sigma", 타우: "\\tau", 피: "\\phi", 카이: "\\chi", 프사이: "\\psi",
    오메가: "\\omega", 무한대: "\\infty", 무한: "\\infty", 도: "^{\\circ}",
  };
  const EZ_KO_CALL = { 루트: "sqrt", 제곱근: "sqrt", 벡터: "vec", 평균: "bar", 절댓값: "abs", 절대값: "abs", 적분: "int", 극한: "lim", 분수: "frac" };
  const EZ_SYM = {
    "π": "\\pi", "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\epsilon", "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda",
    "μ": "\\mu", "µ": "\\mu", "ν": "\\nu", "ξ": "\\xi", "ρ": "\\rho", "σ": "\\sigma", "τ": "\\tau", "υ": "\\upsilon", "φ": "\\phi", "ϕ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega",
    "Γ": "\\Gamma", "Δ": "\\Delta", "∆": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega", "Ω": "\\Omega",
    "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "∠": "\\angle", "△": "\\triangle", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∮": "\\oint", "℃": "{}^{\\circ}\\mathrm{C}", "ℏ": "\\hbar",
  };
  const EZ_OPS = {
    "*": "\\times", "×": "\\times", "·": "\\cdot", "∙": "\\cdot", "÷": "\\div", "+-": "\\pm", "±": "\\pm", "-+": "\\mp", "∓": "\\mp",
    "<=": "\\le", "≤": "\\le", ">=": "\\ge", "≥": "\\ge", "!=": "\\ne", "≠": "\\ne", "~=": "\\approx", "≈": "\\approx", "==": "=", "≡": "\\equiv",
    "->": "\\to", "→": "\\to", "<-": "\\leftarrow", "←": "\\leftarrow", "=>": "\\Rightarrow", "⇒": "\\Rightarrow", "<=>": "\\Leftrightarrow", "⇔": "\\Leftrightarrow", "<->": "\\leftrightarrow", "↔": "\\leftrightarrow",
    "~": "\\sim", "∝": "\\propto", "∈": "\\in", "⊥": "\\perp", "∥": "\\parallel", "∴": "\\therefore", "∵": "\\because", "%": "\\%", "#": "\\#", "&": "\\&", "$": "\\$", "}": "\\}",
    "+": "+", "-": "-", "−": "-", "=": "=", "<": "<", ">": ">", ",": ",", ";": ";", ":": ":", ".": ".", "/": "/", "?": "?", "@": "@", ")": ")", "]": "]",
  };
  const EZ_MULTI = ["<=>", "<->", "->", "<-", "=>", "<=", ">=", "!=", "~=", "==", "+-", "-+"];
  const EZ_UNITS = new Set("m cm mm km nm um s ms min h g kg mg N kN J kJ W kW Pa kPa hPa atm K mol L mL A mA V mV Hz kHz MHz C eV cal kcal T dB lx rad mmHg".split(" "));
  const KO_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣ]+/;

  /** 이어 붙일 때 `\le`+`x` → `\le x`처럼 명령 뒤에 글자가 오면 띄운다 */
  const ezCat = (a, b, sp) => {
    if (!a) return b; if (!b) return a;
    if (/\\[A-Za-z]+$/.test(a) && /^[A-Za-z]/.test(b)) return a + " " + b;
    return a + (sp ? " " : "") + b;
  };
  const ezBrace = (t) => (/^[A-Za-z0-9]$/.test(t) ? t : "{" + t + "}");
  /** 글자 덩어리를 아는 낱말과 한 글자로 나눈다: "2pir"의 "pir" → pi, r · "sinx" → sin, x */
  function ezSplitWord(w) {
    if (EZ_WORDS.has(w) || EZ_SPECIAL.includes(w)) return [w];
    const out = [];
    let i = 0, afterWord = true;
    while (i < w.length) {
      const hit = EZ_KNOWN.find((k) => w.startsWith(k, i) && (k.length > 2 || afterWord));
      if (hit) { out.push(hit); i += hit.length; afterWord = true; }
      else { out.push(w[i]); i++; afterWord = false; }
    }
    return out;
  }
  function ezTokenize(s) {
    const toks = [];
    let i = 0, sp = false, m;
    while (i < s.length) {
      const c = s[i], rest = s.slice(i);
      if (/\s/.test(c)) { sp = true; i++; continue; }
      if ((m = /^\d+(?:\.\d+)?/.exec(rest))) toks.push({ t: "num", v: m[0], sp });
      else if ((m = /^[A-Za-z]+/.exec(rest))) toks.push({ t: "id", v: m[0], sp });
      else if ((m = KO_RE.exec(rest))) toks.push({ t: "ko", v: m[0], sp });
      else if ((m = EZ_MULTI.find((o) => rest.startsWith(o)))) toks.push({ t: "ch", v: m, sp }), (m = [m]);
      else { const ch = String.fromCodePoint(s.codePointAt(i)); toks.push({ t: "ch", v: ch, sp }); m = [ch]; }
      i += m[0].length; sp = false;
    }
    return toks;
  }

  function easyToLatex(input) {
    const src = String(input == null ? "" : input).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
    if (!src) return "";
    if (/\\/.test(src) || src.length > 4000) return src; // 이미 LaTeX(또는 너무 긴 글) → 그대로
    try {
      const out = ezParse(src);
      // 마지막 안전 검사: 중괄호 짝
      let depth = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i] === "\\") { i++; continue; }
        if (out[i] === "{") depth++; else if (out[i] === "}" && --depth < 0) return src;
      }
      return depth === 0 ? out : src;
    } catch { return src; }
  }

  function ezParse(src) {
    const toks = ezTokenize(src);
    let pos = 0, sawInt = false;
    const peek = (k) => toks[pos + (k || 0)];
    const isCh = (t, v) => !!t && t.t === "ch" && (v === undefined || t.v === v);
    const POSTFIX = new Set(["^", "_", "!", "'", "°"]);

    /** 연산자 사이의 항들 → 분수(/)를 접어 한 줄 LaTeX로 */
    function parseSeq(stops) {
      const items = [];
      while (pos < toks.length) {
        const t = peek();
        if (isCh(t) && stops.has(t.v)) break;
        if (isCh(t) && EZ_OPS[t.v] !== undefined && !POSTFIX.has(t.v)) { pos++; items.push({ op: true, raw: t.v, tex: EZ_OPS[t.v], sp: t.sp }); continue; }
        let term = parsePostfix();
        if (!term) { pos++; items.push({ op: true, raw: t.v, tex: "\\text{" + t.v + "}", sp: t.sp }); continue; }
        if (term.isNum) { const u = tryUnits(); if (u) term = { ...term, tex: term.tex + "\\," + u, post: true }; }
        items.push(term);
      }
      return fold(items);
    }
    function fold(items) {
      const units = [];
      for (const it of items) {
        const last = units[units.length - 1];
        if (!it.op && last && !last.op && !it.sp) last.terms.push(it);
        else if (it.op) units.push(it);
        else units.push({ terms: [it], sp: it.sp });
      }
      const out = [];
      for (let k = 0; k < units.length; k++) {
        const u = units[k], L = out[out.length - 1], R = units[k + 1];
        if (u.op && u.raw === "/" && L && !L.op && R && !R.op) {
          out[out.length - 1] = { terms: null, tex: `\\frac{${operand(L)}}{${operand(R)}}`, sp: L.sp };
          k++; continue;
        }
        out.push(u);
      }
      let s = "";
      for (const u of out) s = ezCat(s, u.op ? u.tex : unitTex(u), u.sp && s !== "");
      return s;
    }
    const unitTex = (u) => (u.terms ? u.terms.reduce((s, t) => ezCat(s, t.tex, false), "") : u.tex);
    /** 분수의 분자·분모: 괄호 하나로 묶인 것이면 괄호를 벗긴다 */
    function operand(u) {
      if (u.terms && u.terms.length === 1 && (u.terms[0].group === "(" || u.terms[0].group === "{") && !u.terms[0].post) return u.terms[0].inner;
      return unitTex(u);
    }
    function parsePostfix() {
      const term = parsePrimary();
      if (!term) return null;
      for (;;) {
        const t = peek();
        if (!isCh(t)) break;
        if (t.v === "^" || t.v === "_" || t.v === "°") {
          pos++;
          const key = t.v === "_" ? "sub" : "sup";
          if (term[key]) { term.tex = "{" + term.tex + "}"; term.sup = term.sub = false; }
          term.tex = t.v === "°" ? ezCat(term.tex, "^{\\circ}") : term.tex + t.v + ezBrace(parseOperand());
          term[key] = true; term.post = true;
        } else if ((t.v === "!" || t.v === "'") && !t.sp) { pos++; term.tex += t.v; term.post = true; }
        else break;
      }
      return term;
    }
    /** ^, _ 뒤: 부호 하나 + 항 하나. 괄호면 벗긴다 */
    function parseOperand() {
      const t = peek();
      if (!t) return "";
      if (isCh(t, "-") || isCh(t, "+")) { pos++; return t.v + parseOperand(); }
      if (isCh(t, "(") || isCh(t, "{")) { const g = parsePrimary(); return g.inner; }
      const p = parsePrimary();
      return p ? p.tex : "";
    }
    function parseArgs() {
      pos++; // (
      const args = [];
      for (;;) {
        args.push(parseSeq(new Set([",", ")"])).trim());
        const t = peek();
        if (isCh(t, ",")) { pos++; continue; }
        if (isCh(t, ")")) pos++;
        break;
      }
      return args;
    }
    function special(name, sp) {
      const call = isCh(peek(), "(");
      const T = (tex, extra) => ({ tex, sp, ...extra });
      if (name === "int" || name === "oint") sawInt = true;
      if (name === "sqrt" || name === "root") {
        if (call) { const a = parseArgs(); return T(a.length >= 2 && name === "root" ? `\\sqrt[${a[0]}]{${a.slice(1).join(",")}}` : `\\sqrt{${a.join(",")}}`); }
        const p = parsePostfix();
        return T(`\\sqrt{${p ? (p.group === "(" && !p.post ? p.inner : p.tex) : ""}}`);
      }
      if (name === "vec" || name === "bar" || name === "hat") {
        let x;
        if (call) x = parseArgs().join(","); else { const p = parsePrimary(); x = p ? p.tex : ""; }
        const one = /^(\\[A-Za-z]+|[A-Za-z0-9])$/.test(x);
        const cmd = name === "vec" ? (one ? "\\vec" : "\\overrightarrow") : name === "bar" ? (one ? "\\bar" : "\\overline") : (one ? "\\hat" : "\\widehat");
        return T(`${cmd}{${x}}`);
      }
      if (name === "abs") { if (!call) return T("|"); return T(`\\left|${parseArgs().join(",")}\\right|`); }
      if (name === "frac") {
        if (!call) return T("\\frac{}{}");
        const a = parseArgs();
        return T(`\\frac{${a[0] || ""}}{${a.slice(1).join(",")}}`);
      }
      // sum, prod, int, lim
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
    function parsePrimary() {
      const t = peek();
      if (!t) return null;
      const sp = t.sp;
      if (t.t === "num") { pos++; return { tex: t.v, isNum: true, sp }; }
      if (t.t === "id") {
        if (sawInt && t.sp && /^d[A-Za-z]$/.test(t.v)) { pos++; return { tex: "\\," + t.v, sp }; }
        const parts = ezSplitWord(t.v);
        if (parts.length > 1) toks.splice(pos, 1, ...parts.map((v, k) => ({ t: "id", v, sp: k ? false : t.sp })));
        const w = toks[pos].v;
        pos++;
        if (EZ_SPECIAL.includes(w)) return special(w, sp);
        if (EZ_WORDS.has(w)) return { tex: EZ_WORDS.get(w), sp, fn: EZ_FUNCS.includes(w) };
        return { tex: w, sp };
      }
      if (t.t === "ko") {
        pos++;
        if (EZ_KO_CALL[t.v]) return special(EZ_KO_CALL[t.v], sp);
        if (EZ_KO[t.v]) return { tex: EZ_KO[t.v], sp };
        // 모르는 한글 낱말은 이어지는 낱말과 함께 글자로
        let words = t.v;
        while (peek() && peek().t === "ko" && !EZ_KO[peek().v] && !EZ_KO_CALL[peek().v]) { words += (peek().sp ? " " : "") + peek().v; pos++; }
        return { tex: `\\text{${words}}`, sp };
      }
      const v = t.v;
      if (v === "(" || v === "[" || v === "{") {
        pos++;
        const close = { "(": ")", "[": "]", "{": "}" }[v];
        const inner = parseSeq(new Set([close]));
        const closed = isCh(peek(), close);
        if (closed) pos++;
        let tex;
        if (v === "(") tex = closed ? (/\\(frac|sqrt|sum|int|prod)/.test(inner) ? `\\left(${inner}\\right)` : `(${inner})`) : "(" + inner;
        else if (v === "[") tex = "[" + inner + (closed ? "]" : "");
        else tex = "\\{" + inner + (closed ? "\\}" : "");
        return { tex, group: v, inner, sp };
      }
      if (v === "|") {
        pos++;
        const inner = parseSeq(new Set(["|"]));
        if (isCh(peek(), "|")) { pos++; return { tex: `\\left|${inner}\\right|`, sp }; }
        return { tex: "|" + inner, sp };
      }
      if (v === "√") {
        pos++;
        const p = parsePostfix();
        return { tex: `\\sqrt{${p ? (p.group === "(" && !p.post ? p.inner : p.tex) : ""}}`, sp };
      }
      if (EZ_SYM[v]) {
        pos++;
        if (v === "∫" || v === "∮") sawInt = true;
        return { tex: EZ_SYM[v], sp };
      }
      if (v === "^" || v === "_" || v === "°") return { tex: "{}", sp }; // 밑이 없는 첨자
      if (v === "'") { pos++; return { tex: "{}'", sp }; }
      if (v === "!") { pos++; return { tex: "!", sp }; }
      if (EZ_OPS[v] !== undefined) return null;
      if (/[\p{L}\p{N}]/u.test(v) || /[^\x00-\x7f]/.test(v)) { pos++; return { tex: `\\text{${v}}`, sp }; }
      pos++;
      return { tex: `\\text{${v === '"' ? "''" : v}}`, sp };
    }
    /** 수 뒤의 단위: "9.8 m/s^2" → \,\mathrm{m/s^{2}} (분명한 경우만) */
    function tryUnits() {
      const save = pos, first = peek();
      if (!first || !first.sp) return null;
      let s = "";
      const atom = (needGlue) => {
        const a = peek();
        if (!a || (needGlue && a.sp)) return false;
        if (a.t === "id" && EZ_UNITS.has(a.v)) { pos++; s += a.v; }
        else if (isCh(a, "℃")) { pos++; s += "{}^{\\circ}C"; }
        else if (isCh(a, "°") && peek(1) && peek(1).t === "id" && peek(1).v === "C" && !peek(1).sp) { pos += 2; s += "{}^{\\circ}C"; }
        else if (isCh(a, "Ω") || isCh(a, "Ω")) { pos++; s += "\\Omega"; }
        else if ((isCh(a, "μ") || isCh(a, "µ")) && peek(1) && peek(1).t === "id" && /^(m|s|g|A|L|mol)$/.test(peek(1).v) && !peek(1).sp) { pos += 2; s += "\\mu " + toks[pos - 1].v; }
        else return false;
        if (isCh(peek(), "^") && !peek().sp) {
          const save2 = pos; pos++;
          let sign = "";
          if (isCh(peek(), "-")) { sign = "-"; pos++; }
          const n = peek();
          if (n && n.t === "num" && !n.sp) { pos++; s += "^" + ezBrace(sign + n.v); } else pos = save2;
        }
        return true;
      };
      if (!atom(false)) { pos = save; return null; }
      for (;;) {
        const o = peek();
        if (o && !o.sp && (isCh(o, "/") || isCh(o, "*") || isCh(o, "·"))) {
          const save3 = pos, before = s;
          pos++; s += o.v === "/" ? "/" : "\\cdot ";
          if (!atom(true)) { pos = save3; s = before; break; }
        } else break;
      }
      const n = peek();
      const ok = !n || (isCh(n) && [",", ";", ")", "]"].includes(n.v)) ||
        (n.sp && (n.t === "ko" || (isCh(n) && ["=", "<", ">", "<=", ">=", "~=", "!=", "≈", "≤", "≥", "≠", "+", "-", "±", "+-", ",", "→", "->"].includes(n.v))));
      if (!ok) { pos = save; return null; }
      return `\\mathrm{${s}}`;
    }
    return parseSeq(new Set()).trim();
  }

  /** 저장된 LaTeX → 쉬운 표기(다시 바꿨을 때 같은 수식이 될 때만). 못 하면 null. */
  function latexToEasy(latex) {
    const orig = String(latex || "").trim();
    if (!orig) return "";
    if (!/[\\{}]/.test(orig)) return orig;
    let s = orig.replace(/\{\}\^\{\\circ\}/g, "°").replace(/\^\{\\circ\}/g, "°");
    const wrap = (a) => (/^[A-Za-z0-9.]+$/.test(a) || /^\\[A-Za-z]+$/.test(a) || /^\\?[A-Za-z]+\([^()]*\)$/.test(a) ? a : "(" + a + ")");
    for (let guard = 0; guard < 30; guard++) {
      const prev = s;
      s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => wrap(a) + "/" + wrap(b))
        .replace(/\\sqrt\[([^{}[\]]*)\]\{([^{}]*)\}/g, "root($1, $2)")
        .replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)")
        .replace(/\\(vec|bar|hat|overline|overrightarrow|widehat)\{([^{}]*)\}/g, (_, f, a) => ({ overline: "bar", overrightarrow: "vec", widehat: "hat" }[f] || f) + "(" + a + ")")
        .replace(/\\mathrm\{([^{}]*)\}/g, (_, a) => a.replace(/\\cdot\s*/g, "·").replace(/\\mu\s*/g, "μ").replace(/\\Omega/g, "Ω"))
        .replace(/\\text\{([^{}]*)\}/g, "$1")
        .replace(/([\^_])\{([^{}]*)\}/g, (_, op, a) => op + (/^[A-Za-z0-9]$/.test(a) ? a : "(" + a + ")"));
      if (s === prev) break;
    }
    s = s.replace(/\\left\s*\|/g, "|").replace(/\\right\s*\|/g, "|").replace(/\\left\s*\(/g, "(").replace(/\\right\s*\)/g, ")").replace(/\\,/g, " ");
    const REV = { times: "*", cdot: "·", div: "÷", pm: "+-", mp: "-+", le: "<=", leq: "<=", ge: ">=", geq: ">=", ne: "!=", neq: "!=", approx: "~=", to: "->", rightarrow: "->", Rightarrow: "=>", infty: "inf", sim: "~", partial: "partial" };
    s = s.replace(/\\([A-Za-z]+)/g, (m, name, off, str) => {
      if (REV[name]) return " " + REV[name] + " ";
      if (EZ_WORDS.has(name) || ["sum", "prod", "int", "oint", "lim"].includes(name)) return name + (/[A-Za-z0-9]/.test(str[off + m.length] || "") ? " " : "");
      return m;
    });
    s = s.replace(/[ ]{2,}/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
    if (/[\\{}]/.test(s)) return null;
    const norm = (x) => x.replace(/\\left|\\right/g, "").replace(/\\leq\b/g, "\\le").replace(/\\geq\b/g, "\\ge").replace(/\\neq\b/g, "\\ne").replace(/([_^])\{([A-Za-z0-9])\}/g, "$1$2").replace(/\s+/g, "");
    return norm(easyToLatex(s)) === norm(orig) ? s : null;
  }
  // 말로 설명해서 수식 만들기 (sample)
  let mathAiOff = false; // 이 화면에서 AI를 쓸 수 없다고 확인되면 버튼을 다시 보이지 않는다
  const MATH_AI_HIDE = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);
  const MATH_AI_PROMPT = (q) => "학생이 보고서에 넣을 수식을 말로 설명했어요. 그 수식을 LaTeX 한 줄로만 답하세요.\n" +
    "- KaTeX로 그릴 수 있는 명령만 쓰세요.\n- $ 기호, 코드 블록, 설명 문장 없이 수식만 쓰세요.\n- 여러 식이 떠오르면 가장 대표적인 하나만 쓰세요.\n\n설명: " + String(q).slice(0, 500);
  function cleanAiLatex(text) {
    let s = String(text || "").trim();
    const fence = /```[a-zA-Z]*\n?([\s\S]*?)```/.exec(s);
    if (fence) s = fence[1];
    s = s.trim().replace(/^\$\$([\s\S]*)\$\$$/, "$1").replace(/^\$([\s\S]*)\$$/, "$1").replace(/^\\\[([\s\S]*)\\\]$/, "$1").replace(/^\\\(([\s\S]*)\\\)$/, "$1");
    return s.split("\n").map((l) => l.trim()).filter(Boolean).join(" ").trim();
  }
  function mathAiError(code) {
    switch (code) {
      case "rate_limited": return "요청이 많아요. 잠시 뒤 다시 눌러 주세요.";
      case "session_expired": return "Claude에 다시 로그인해 주세요.";
      case "refused": return "이 설명으로는 만들 수 없어요. 다르게 설명해 주세요.";
      case "empty_completion": return "답이 비어 있어요. 더 짧게 설명해 보세요.";
      case "prompt_too_large": return "설명이 너무 길어요. 짧게 줄여 주세요.";
      case "invalid_request": case "transform_error": case "queue_overflow": return "요청을 만들지 못했어요 (" + code + ").";
      default: return "만들지 못했어요. 다시 눌러 보세요.";
    }
  }

  RN.view("editor", {
    title: "문서 편집",
    nav: "projects",
    mount(root, params) {
      const state = { alive: true, cleanups: [] };
      const h1 = h("h1", {}, "문서 불러오는 중…");
      root.append(h1);
      (async () => {
        await RN.ready;
        if (!state.alive) return;
        if (!db() || !RN.caps.uid) { h1.textContent = "문서 편집"; signedOutNotice(root); return; }
        const docId = params && params.docId ? String(params.docId) : "";
        let rec = null;
        try { const s = docId ? await withTimeout(docCol().doc(docId).get()) : null; if (s && s.exists) rec = s.data(); }
        catch (e) { h1.textContent = "문서 편집"; root.append(RN.notice(errText(e), "error")); return; }
        if (!state.alive) return;
        if (!rec || rec.deletedAt) {
          h1.textContent = "문서를 찾을 수 없어요";
          root.append(RN.notice(rec ? "휴지통에 있는 문서예요. 프로젝트 홈에서 복구할 수 있어요." : "없거나 내 문서가 아니에요."),
            h("button", { type: "button", class: "rn-btn", onclick: () => RN.go("projects") }, "내 프로젝트로"));
          return;
        }
        startEditor(root, h1, docId, rec, state);
      })();
      return () => { state.alive = false; state.cleanups.forEach((c) => { try { c(); } catch (e) { console.error(e); } }); };
    },
  });

  function startEditor(root, h1, docId, rec, state) {
    const projectId = rec.projectId;
    const blocked = RN.writeBlockedReason();
    let title = rec.title || "";
    let model = normalizeDoc(rec.content);
    let rules = normalizeRules(rec.formatRules || DEFAULT_RULES).rules;
    let numbering = computeNumbering(model, captionPositions(rules));
    let currentId = null, popup = null;
    let savedSel = null;   // 마지막 본문 선택(모델 위치) — 도구 모음·패널이 쓴다
    let pending = null;    // 접힌 커서에서 켠 굵게·기울임 { line, off, b, i }
    let composing = false;
    let acReset = null;    // 자동완성 제안 지우기(모델→DOM 다시 그리기 직전에 부른다)
    let lastSnapshotJson = JSON.stringify(model);
    const draftKey = `draft:${RN.caps.uid}:${docId}`;
    const docRef = docCol().doc(docId);
    const listen = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); state.cleanups.push(() => target.removeEventListener(ev, fn, opt)); };

    // ---------- 뼈대 ----------
    h1.textContent = title || "제목 없는 문서";
    const statusEl = h("span", { class: "rn-ed-status", id: "ed-status", role: "status", "aria-live": "polite", dataset: { kind: "saved" }, title: hhmm(rec.updatedAt || Date.now()) + "에 저장" }, "저장됨");
    const panelBar = h("div", { class: "rn-ed-panelbar", role: "group", "aria-label": "편집 패널" });
    const sizeWarn = h("div", { hidden: true });
    const bar = h("div", { class: "rn-stack rn-ed-bar", style: { gap: "6px" } });
    root.append(
      h("div", { class: "rn-ed-head" },
        h("button", { type: "button", class: "rn-link rn-small", onclick: () => RN.go("project", { id: projectId }) }, "← 프로젝트"),
        h("div", { class: "rn-ed-titlebox" }, h1, statusEl),
        panelBar),
      bar, sizeWarn);
    if (blocked) bar.append(RN.notice(blocked + " 바뀐 내용은 저장되지 않아요.", "warn"));

    const titleInput = h("input", { type: "text", id: "ed-title", class: "rn-paper-title", value: title, maxLength: 200, "aria-label": "문서 제목", placeholder: "제목", readOnly: !!blocked });
    const blocksEl = h("div", { class: "rn-blocks", id: "ed-blocks", contenteditable: blocked ? "false" : "true", role: "textbox", "aria-multiline": "true", "aria-label": "본문", spellcheck: "true" });
    const pageNumEl = h("p", { class: "rn-pagenum", "aria-hidden": "true" });
    const paper = h("div", { class: "rn-paper", id: "ed-paper", lang: "ko" }, titleInput, blocksEl, pageNumEl);
    const toolbar = h("div", { class: "rn-ed-toolbar", role: "toolbar", "aria-label": "서식 도구" });
    const side = h("aside", { class: "rn-ed-side", id: "ed-side", "aria-label": "편집 패널", hidden: true });
    const paperWrap = h("div", { class: "rn-paper-wrap" }, toolbar, paper);
    const layout = h("div", { class: "rn-ed-layout" }, paperWrap, side);
    root.append(layout);

    // ---------- 모델 도우미 ----------
    const idx = (id) => model.blocks.findIndex((b) => b.id === id);
    const find = (id) => model.blocks.find((b) => b.id === id) || null;
    const blkEl = (id) => { for (const el of blocksEl.children) if (el.dataset.id === id) return el; return null; };
    const getContent = (b, item) => (b.type === "list" ? b.items[item] || [] : b.content || []);
    const setContent = (b, item, inl) => { if (b.type === "list") b.items[item] = normInline(inl); else b.content = normInline(inl); };
    const linesNow = () => flattenBlocks(model.blocks);
    const linesEdit = () => flattenBlocks(clone(model.blocks));
    /** 줄 번호 → { b, item } */
    function lineInfo(li) {
      let n = 0;
      for (const b of model.blocks) {
        const c = b.type === "list" ? b.items.length : 1;
        if (li < n + c) return { b, item: b.type === "list" ? li - n : null };
        n += c;
      }
      return null;
    }
    function lineIndex(id, item) {
      let n = 0;
      for (const b of model.blocks) {
        if (b.id === id) return n + (b.type === "list" ? Math.max(0, Math.min(b.items.length - 1, item || 0)) : 0);
        n += b.type === "list" ? b.items.length : 1;
      }
      return -1;
    }
    const inSub = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest(".rn-cell, .rn-math-edit")); };

    // ---------- 그리기 ----------
    function setMath(el, latex, display) {
      const html = latex ? mathHtml(latex, display) : null;
      if (html) el.innerHTML = html; // KaTeX가 만든 MathML (입력은 KaTeX가 이스케이프한다)
      else el.textContent = latex ? (display ? `$$${latex}$$` : `$${latex}$`) : "";
    }
    function renderInline(el, inl) {
      for (const n of inl) {
        if (n.t === "text") { let node = document.createTextNode(n.text); if (n.i) node = h("em", {}, node); if (n.b) node = h("strong", {}, node); el.append(node); }
        else if (n.t === "br") el.append(h("br"));
        else if (n.t === "math") { const s = h("span", { class: "rn-im", contenteditable: "false", dataset: { latex: n.latex }, title: "수식: " + n.latex + " (눌러서 고치기)" }); setMath(s, n.latex, false); el.append(s); }
        else if (n.t === "ref") el.append(h("span", { class: "rn-xref", contenteditable: "false", dataset: { target: n.target }, title: "상호 참조 (눌러서 대상으로 이동)" }, "?"));
      }
      const last = inl[inl.length - 1];
      if (!last || last.t === "br") el.append(h("br", { class: "rn-fill" })); // 빈 줄·끝 줄바꿈이 보이게
    }
    const atomBar = (b, buttons) => h("div", { class: "rn-atom-bar" }, buttons.map(([label, fn, name]) => h("button", { type: "button", tabIndex: -1, "data-act": name, onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.stopPropagation(); fn(b.id); } }, label)));
    function renderBlock(b) {
      const ds = { id: b.id, type: b.type };
      switch (b.type) {
        case "paragraph": {
          const el = h("p", { class: "rn-blk rn-blk-paragraph rn-slot", dataset: ds });
          renderInline(el, b.content);
          if (model.blocks.length === 1 && !b.content.length) { el.classList.add("rn-empty"); el.dataset.ph = "여기에 내용을 입력하세요. $…$ 수식, @그림 상호 참조"; }
          return el;
        }
        case "heading": { const el = h("div", { class: `rn-blk rn-blk-heading rn-slot rn-h rn-h${b.level}`, role: "heading", "aria-level": String(b.level + 1), dataset: ds }); renderInline(el, b.content); return el; }
        case "quote": { const el = h("blockquote", { class: "rn-blk rn-blk-quote rn-slot", dataset: ds }); renderInline(el, b.content); return el; }
        case "code": { const el = h("pre", { class: "rn-blk rn-blk-code rn-slot", dataset: ds }, b.text); if (!b.text || /\n$/.test(b.text)) el.append(h("br", { class: "rn-fill" })); return el; }
        case "caption": {
          const el = h("p", { class: "rn-blk rn-blk-caption rn-cap rn-slot", dataset: { ...ds, kind: b.kind } }, h("span", { class: "rn-cap-label", contenteditable: "false" }));
          renderInline(el, b.content);
          return el;
        }
        case "list": {
          const el = h(b.ordered ? "ol" : "ul", { class: "rn-blk rn-blk-list", dataset: ds });
          b.items.forEach((it, i) => { const li = h("li", { class: "rn-slot", dataset: { item: String(i) } }); renderInline(li, it); el.append(li); });
          return el;
        }
      }
      const wrap = h("div", { class: "rn-blk rn-atom rn-blk-" + b.type, contenteditable: "false", tabIndex: 0, dataset: ds });
      switch (b.type) {
        case "table": {
          wrap.setAttribute("aria-label", "표 — Delete로 삭제, Ctrl+Shift+C로 캡션");
          const table = h("table", {}, h("tbody", {}, b.rows.map((r, ri) => h("tr", {}, r.map((c, ci) => {
            const cell = h(ri === 0 && b.header ? "th" : "td", { contenteditable: blocked ? "false" : "true", class: "rn-cell", "aria-label": `${ri + 1}행 ${ci + 1}열`, dataset: { r: String(ri), c: String(ci), cell: "1" } });
            cell.textContent = c; return cell;
          })))));
          wrap.append(atomBar(b, [["캡션", addCaption, "caption"], ["행 추가", addRow, "add-row"], ["열 추가", addCol, "add-col"], ["행 삭제", delRow, "del-row"], ["열 삭제", delCol, "del-col"], ["표 삭제", deleteBlock, "delete"]]), h("div", { class: "rn-tbl-wrap" }, table));
          break;
        }
        case "figure": {
          wrap.classList.add("rn-fig");
          wrap.setAttribute("aria-label", "그림 — Delete로 삭제, Ctrl+Shift+C로 캡션");
          wrap.addEventListener("dblclick", () => openFigureData(b.id));
          wrap.append(atomBar(b, [["캡션", addCaption, "caption"], ["삭제", deleteBlock, "delete"]]), h("img", { src: figureSrc(b), alt: b.alt || "그림", draggable: false }));
          break;
        }
        case "math": {
          wrap.setAttribute("aria-label", "블록 수식 — Enter로 고치기, Delete로 삭제");
          const view = h("div", { class: "rn-math-view", title: "눌러서 고치기", onclick: () => editMath(b.id) });
          wrap.addEventListener("dblclick", () => editMath(b.id));
          setMath(view, b.latex, true);
          if (!b.latex) view.textContent = "(빈 수식)";
          wrap.append(atomBar(b, [["편집", editMath, "edit"], ["캡션", addCaption, "caption"], ["삭제", deleteBlock, "delete"]]), h("div", { class: "rn-math" }, view, h("span", { class: "rn-eqno" })));
          break;
        }
        case "toc": {
          wrap.classList.add("rn-toc");
          wrap.setAttribute("aria-label", TOC_TITLE[b.kind]);
          wrap.append(atomBar(b, [["삭제", deleteBlock, "delete"]]), h("div", { class: "rn-toc-body" }));
          break;
        }
      }
      return wrap;
    }
    const blockKey = (b) => JSON.stringify(b) + (model.blocks.length === 1 ? "#solo" : "");
    /** 모델과 DOM 맞추기: 바뀐 블록만 다시 그리고 순서를 맞춘다. force면 전부 다시. */
    function syncDom(force) {
      if (acReset) acReset();
      const existing = new Map();
      for (const el of blocksEl.children) if (el.dataset.id && !existing.has(el.dataset.id)) existing.set(el.dataset.id, el);
      const placed = new Set();
      let cursor = blocksEl.firstChild;
      for (const b of model.blocks) {
        const key = blockKey(b);
        let el = existing.get(b.id);
        if (!el || force || placed.has(el) || el.__key !== key) { el = renderBlock(b); el.__key = key; }
        placed.add(el);
        if (el === cursor) cursor = cursor.nextSibling;
        else blocksEl.insertBefore(el, cursor);
      }
      while (cursor) { const n = cursor.nextSibling; cursor.remove(); cursor = n; }
      refreshNumbers();
    }
    const renderAll = () => syncDom();
    function refreshNumbers() {
      numbering = computeNumbering(model, captionPositions(rules));
      blocksEl.querySelectorAll(".rn-blk-caption").forEach((w) => {
        const e = numbering.byId.get(w.dataset.id);
        const lab = w.querySelector(".rn-cap-label");
        if (lab) lab.textContent = e ? e.captionLabel + " " : "";
        w.classList.toggle("rn-cap-orphan", !numbering.capToTarget.has(w.dataset.id));
      });
      blocksEl.querySelectorAll(".rn-blk-math").forEach((w) => { const no = w.querySelector(".rn-eqno"); const e = numbering.byId.get(w.dataset.id); if (no) no.textContent = e ? `(${e.number})` : ""; });
      blocksEl.querySelectorAll(".rn-xref").forEach((x) => { const r = resolveRef(numbering, x.dataset.target); x.textContent = r.label; x.classList.toggle("broken", r.broken); });
      blocksEl.querySelectorAll(".rn-blk-toc").forEach((w) => {
        const b = find(w.dataset.id); if (!b) return;
        const list = captionList(numbering, b.kind);
        w.querySelector(".rn-toc-body").replaceChildren(h("p", {}, h("strong", {}, TOC_TITLE[b.kind])), ...(list.length ? list.map((e) => h("p", {}, tocLine(e))) : [h("p", { class: "rn-muted" }, "(아직 항목이 없어요)")]));
      });
      const solo = model.blocks.length === 1 && model.blocks[0].type === "paragraph" ? blkEl(model.blocks[0].id) : null;
      if (solo && solo.dataset.ph) solo.classList.toggle("rn-empty", !model.blocks[0].content.length);
    }
    function applyPaperVars() {
      for (const [k, v] of Object.entries(formatCssVars(rules))) paperWrap.style.setProperty(k, v);
      pageNumEl.textContent = rules.pageNumber.enabled ? `쪽 번호: ${PAGE_NUMBER_POS[rules.pageNumber.position]} · 예) ${PAGE_NUMBER_TEXT[rules.pageNumber.style]} (DOCX·HTML로 저장하면 붙어요)` : "쪽 번호 없음";
    }

    // ---------- 위치 ↔ DOM ----------
    function startOfBlockEl(el) { const li = lineIndex(el.dataset.id, 0); return li < 0 ? null : { line: li, off: 0 }; }
    function endOfBlockEl(el) {
      const b = find(el.dataset.id); if (!b) return null;
      const li = lineIndex(b.id, b.type === "list" ? b.items.length - 1 : 0);
      const L = linesNow()[li];
      return { line: li, off: L ? lineLen(L) : 0 };
    }
    /** DOM 위치 → 모델 위치. side: 원자(그림 등) 안이면 start=앞, end=뒤 */
    function domToPoint(node, offset, side) {
      if (node === blocksEl) {
        const kids = blocksEl.children;
        if (!kids.length) return null;
        if (side === "end" && offset > 0) return endOfBlockEl(kids[Math.min(offset, kids.length) - 1]);
        return offset < kids.length ? startOfBlockEl(kids[offset]) : endOfBlockEl(kids[kids.length - 1]);
      }
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !blocksEl.contains(el)) return null;
      const blk = el.closest(".rn-blk");
      if (!blk || blk.parentElement !== blocksEl) return null;
      if (blk.classList.contains("rn-atom")) { const li = lineIndex(blk.dataset.id, 0); return li < 0 ? null : { line: li, off: side === "end" ? 1 : 0 }; }
      const slot = el.closest(".rn-slot");
      if (!slot || !blk.contains(slot)) {
        // 목록(ul/ol) 자체의 자리: 항목 사이
        const items = [...blk.querySelectorAll(":scope > .rn-slot")];
        if (!items.length) return startOfBlockEl(blk);
        const k = Math.min(offset, items.length);
        const li0 = lineIndex(blk.dataset.id, 0);
        if (side === "end" && k > 0) return { line: li0 + k - 1, off: measureNode(items[k - 1]) };
        return k < items.length ? { line: li0 + k, off: 0 } : { line: li0 + items.length - 1, off: measureNode(items[items.length - 1]) };
      }
      const li = lineIndex(blk.dataset.id, slot.dataset.item != null ? Number(slot.dataset.item) : 0);
      return li < 0 ? null : { line: li, off: offsetIn(slot, node, offset, side) };
    }
    /** 지금 브라우저 선택 → { a, b, collapsed } (본문 밖이거나 표 칸·수식 입력 안이면 null) */
    function readSel() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!blocksEl.contains(r.startContainer) || !blocksEl.contains(r.endContainer)) return null;
      if (inSub(r.startContainer) && inSub(r.endContainer)) return null;
      return rangeToSel(r);
    }
    function rangeToSel(r) {
      const a = domToPoint(r.startContainer, r.startOffset, "start");
      const b = r.collapsed ? a : domToPoint(r.endContainer, r.endOffset, "end");
      if (!a || !b) return null;
      return cmpPt(a, b) <= 0 ? { a, b, collapsed: cmpPt(a, b) === 0 } : { a: b, b: a, collapsed: false };
    }
    function domPoint(p) {
      const info = lineInfo(p.line); if (!info) return null;
      const el = blkEl(info.b.id); if (!el) return null;
      if (LINE_ATOMS.includes(info.b.type)) return [blocksEl, [...blocksEl.children].indexOf(el) + (p.off >= 1 ? 1 : 0)];
      const slot = info.b.type === "list" ? el.querySelector(`:scope > .rn-slot[data-item="${info.item}"]`) : el;
      return slot ? locate(slot, p.off) : null;
    }
    /** 모델 위치로 선택을 옮긴다. focus=false면 기억만 한다(패널에서 넣을 때 포커스를 빼앗지 않게). */
    function setSel(a, b, focus) {
      const lines = linesNow();
      a = clampPt(lines, a); b = clampPt(lines, b || a);
      savedSel = { a, b, collapsed: cmpPt(a, b) === 0 };
      const info = lineInfo(a.line); if (info) currentId = info.b.id;
      if (focus === false) return;
      const A = domPoint(a), B = domPoint(b);
      if (!A || !B) return;
      if (document.activeElement !== blocksEl) blocksEl.focus({ preventScroll: true });
      try { window.getSelection().setBaseAndExtent(A[0], A[1], B[0], B[1]); } catch { /* 자리가 사라졌으면 무시 */ }
    }
    function ensureVisible() {
      const sel = window.getSelection();
      if (!sel.rangeCount || !blocksEl.contains(sel.focusNode)) return;
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (!rect.height && !rect.width)) { const n = sel.focusNode; const el = n && (n.nodeType === 1 ? n : n.parentElement); if (el) rect = el.getBoundingClientRect(); }
      if (rect && rect.bottom > window.innerHeight - 24) window.scrollBy(0, rect.bottom - window.innerHeight + 64);
    }
    function focusAtom(li) {
      const info = lineInfo(li); if (!info) return;
      const w = blkEl(info.b.id);
      currentId = info.b.id;
      if (w) w.focus();
    }
    /** 블록으로 커서 옮기기. off: 숫자(null이면 끝) 또는 { item, off } */
    function focusBlock(id, off) {
      const b = find(id); if (!b) return;
      currentId = id;
      if (LINE_ATOMS.includes(b.type)) { const w = blkEl(id); if (w) w.focus(); return; }
      const item = off && typeof off === "object" ? off.item || 0 : 0;
      const o = off && typeof off === "object" ? off.off : off;
      const li = lineIndex(id, item);
      const L = linesNow()[li];
      setSel({ line: li, off: o == null ? lineLen(L) : o });
    }
    /** 줄 배열을 모델로 확정하고 다시 그린 뒤 커서를 둔다 */
    function commit(lines, a, b, kind) {
      model.blocks = unflattenLines(lines);
      syncDom();
      if (a) setSel(a, b || a);
      afterChange(kind || "struct");
      ensureVisible();
    }

    // ---------- 변경 처리 · 실행 취소 ----------
    const hist = { stack: [], idx: -1, lastAt: 0, lastKind: "" };
    const stateJson = () => JSON.stringify({ title, blocks: model.blocks });
    function pushHistory(kind) {
      const s = stateJson();
      const sel = savedSel ? { a: { ...savedSel.a }, b: { ...savedSel.b } } : null;
      if (hist.stack[hist.idx] && hist.stack[hist.idx].s === s) { hist.stack[hist.idx].sel = sel; return; }
      const now = Date.now();
      if (kind === "typing" && hist.lastKind === "typing" && now - hist.lastAt < 1000 && hist.idx > 0) hist.stack[hist.idx] = { s, sel };
      else { hist.stack.splice(hist.idx + 1); hist.stack.push({ s, sel }); if (hist.stack.length > 200) hist.stack.shift(); hist.idx = hist.stack.length - 1; }
      hist.lastAt = now; hist.lastKind = kind;
    }
    function loadState(entry) {
      const o = JSON.parse(entry.s);
      title = o.title; titleInput.value = title; h1.textContent = title || "제목 없는 문서";
      model = normalizeDoc({ blocks: o.blocks });
      syncDom();
      afterChange("history", { history: false });
      if (entry.sel) setSel(entry.sel.a, entry.sel.b);
    }
    function undo() { closePopup(); if (hist.idx > 0) { hist.idx--; hist.lastKind = ""; loadState(hist.stack[hist.idx]); } }
    function redo() { closePopup(); if (hist.idx < hist.stack.length - 1) { hist.idx++; hist.lastKind = ""; loadState(hist.stack[hist.idx]); } }

    let draftTimer = null, checkTimer = null;
    function saveDraftNow() { clearTimeout(draftTimer); draftTimer = null; RN.local.set(draftKey, { docId, title, content: model, baseVersion: ctrl.version, savedAt: Date.now() }); }
    function afterChange(kind, opts) {
      refreshNumbers();
      if (!opts || opts.history !== false) pushHistory(kind || "struct");
      if (blocked) return;
      ctrl.markDirty();
      clearTimeout(draftTimer); draftTimer = setTimeout(saveDraftNow, 300);
      clearTimeout(checkTimer); checkTimer = setTimeout(() => { checkSize(); if (activeTab === "format") drawCheck(); if (activeTab === "export") drawExport(); }, 600);
    }
    function payload() { return { title, content: clone(model), formatRules: clone(rules) }; }
    function checkSize() {
      const bytes = jsonBytes({ ...rec, ...payload() });
      const over = bytes > DOC_LIMIT, near = bytes > DOC_LIMIT * 0.85;
      sizeWarn.hidden = !near;
      sizeWarn.replaceChildren(near ? RN.notice(`문서 크기 ${Math.round(bytes / 1024)}KiB — 한 문서는 256KiB까지 저장할 수 있어요. ${over ? "지금은 저장할 수 없어요. " : ""}큰 그림을 줄이거나 지워 주세요.`, over ? "error" : "warn") : "");
      return bytes;
    }

    // ---------- 자동 저장 ----------
    async function saveFn(p, baseVersion) {
      if (navigator.onLine === false) throw new SaveOfflineError();
      if (jsonBytes({ ...rec, ...p }) > DOC_LIMIT) { checkSize(); throw new Error("문서가 256KiB를 넘어 저장할 수 없어요(큰 그림을 줄여 주세요)"); }
      const toErr = (e) => (e && (e.code === "timeout" || e.code === "unavailable")) || e instanceof TypeError ? new SaveOfflineError() : new Error(e && (e.message || e.code) ? e.message || e.code : "저장 실패");
      let snap;
      try { snap = await withTimeout(docRef.get()); } catch (e) { throw toErr(e); }
      if (!snap.exists) throw new Error("서버에서 문서를 찾을 수 없어요");
      const server = snap.data();
      const sv = server.version || 0;
      if (sv !== baseVersion) throw new SaveConflictError(sv);
      const next = { ...server, title: p.title, content: p.content, formatRules: p.formatRules, version: sv + 1, updatedAt: Date.now() };
      try { await withTimeout(docRef.set(next)); } catch (e) { throw toErr(e); }
      rec = next;
      return { version: next.version, updatedAt: next.updatedAt };
    }
    const conflictBox = h("div");
    bar.append(conflictBox);
    const STATUS_TEXT = { saved: "저장됨", saving: "저장 중…", dirty: "저장 대기", offline: "오프라인", conflict: "충돌", error: "저장 실패" };
    const ctrl = new AutosaveController({
      version: rec.version || 0, savedAt: rec.updatedAt || Date.now(), getPayload: payload, save: saveFn,
      onStatus: (s) => {
        statusEl.dataset.kind = s.kind;
        statusEl.textContent = STATUS_TEXT[s.kind] || s.kind;
        statusEl.title = s.kind === "saved" ? hhmm(s.at) + "에 저장" : s.kind === "offline" ? "연결되면 자동으로 저장해요" : s.kind === "error" ? s.message : s.kind === "conflict" ? "아래에서 남길 버전을 고르세요" : "";
        if (s.kind === "error") statusEl.textContent = "저장 실패: " + s.message;
        if (s.kind === "saved" && !ctrl.hasUnsavedChanges()) { clearTimeout(draftTimer); RN.local.remove(draftKey); }
        drawConflict(s);
      },
    });
    function drawConflict(s) {
      if (s.kind !== "conflict") { conflictBox.replaceChildren(); return; }
      conflictBox.replaceChildren(h("div", { class: "rn-notice rn-warn rn-stack", role: "alert", id: "ed-conflict" },
        h("p", {}, "다른 탭이나 기기에서 이 문서가 먼저 저장됐어요. 어느 쪽을 남길까요?"),
        h("div", { class: "rn-row" },
          h("button", { type: "button", class: "rn-btn rn-primary", id: "ed-keep-mine", onclick: () => ctrl.resolveKeepMine() }, "내 버전 유지"),
          h("button", { type: "button", class: "rn-btn", id: "ed-use-server", onclick: async () => {
            try {
              const snap = await withTimeout(docRef.get());
              if (!snap.exists) throw new Error("서버 문서가 없어요");
              rec = snap.data();
              title = rec.title || ""; titleInput.value = title; h1.textContent = title || "제목 없는 문서";
              model = normalizeDoc(rec.content); rules = normalizeRules(rec.formatRules || DEFAULT_RULES).rules; applyPaperVars(); fillForm();
              syncDom(); pushHistory("struct");
              ctrl.resolveUseServer(rec.version || 0, rec.updatedAt || Date.now());
              RN.local.remove(draftKey);
              RN.toast("서버 버전을 불러왔어요.");
            } catch (e) { RN.toast(errText(e), "error"); }
          } }, "서버 버전 불러오기"))));
    }
    listen(window, "online", () => ctrl.retry());
    listen(window, "offline", () => ctrl.setOffline());
    listen(window, "pagehide", () => { if (draftTimer) saveDraftNow(); ctrl.flush(); });
    if (navigator.onLine === false) ctrl.setOffline();

    // ---------- 스냅샷 ----------
    async function snapshot(reason, label) {
      const content = clone(model);
      await addSnapshot(docId, content, ctrl.version, reason, label);
      lastSnapshotJson = JSON.stringify(content);
    }
    const snapTimer = setInterval(() => {
      if (blocked || JSON.stringify(model) === lastSnapshotJson) return;
      snapshot("AUTO").then(() => { if (activeTab === "history") drawHistory(); }).catch((e) => console.warn(e));
    }, 10 * 60 * 1000);
    state.cleanups.push(() => clearInterval(snapTimer));

    // ---------- 선택 추적 ----------
    function markAtoms(s) {
      blocksEl.querySelectorAll(".rn-atom.rn-sel").forEach((el) => el.classList.remove("rn-sel"));
      if (!s || s.collapsed) return;
      for (let li = s.a.line; li <= s.b.line; li++) {
        const info = lineInfo(li);
        if (!info || !LINE_ATOMS.includes(info.b.type)) continue;
        if ((li === s.a.line && s.a.off >= 1) || (li === s.b.line && s.b.off === 0)) continue;
        const el = blkEl(info.b.id); if (el) el.classList.add("rn-sel");
      }
    }
    listen(document, "selectionchange", () => {
      if (composing) return;
      const s = readSel();
      if (!s) return;
      savedSel = s;
      const info = lineInfo(s.a.line);
      if (info) currentId = info.b.id;
      if (pending && (!s.collapsed || pending.line !== s.a.line || pending.off !== s.a.off)) pending = null;
      updateToolbarState();
      markAtoms(s);
      if (popup && (!s.collapsed || s.a.line !== popup.line || s.a.off < popup.start)) closePopup();
    });
    blocksEl.addEventListener("focusin", (e) => {
      const blk = e.target.closest && e.target.closest(".rn-blk");
      if (blk && e.target !== blocksEl) currentId = blk.dataset.id;
    });

    // ---------- 입력 (beforeinput으로 가로채기) ----------
    /** beforeinput의 대상 범위(getTargetRanges) → 모델 범위 */
    function targetSel(e) {
      const rs = typeof e.getTargetRanges === "function" ? e.getTargetRanges() : [];
      if (!rs || !rs.length) return null;
      const r = rs[0];
      if (!blocksEl.contains(r.startContainer) || !blocksEl.contains(r.endContainer)) return null;
      return rangeToSel(r);
    }
    blocksEl.addEventListener("beforeinput", (e) => {
      const t = e.inputType;
      const cell = e.target.closest && e.target.closest(".rn-cell");
      if (cell || inSub(e.target)) {
        if (t === "historyUndo") { e.preventDefault(); undo(); }
        else if (t === "historyRedo") { e.preventDefault(); redo(); }
        else if (cell && (t === "insertParagraph" || t === "insertLineBreak")) {
          e.preventDefault();
          const next = cell.closest("table").querySelector(`[data-r="${Number(cell.dataset.r) + 1}"][data-c="${cell.dataset.c}"]`);
          if (next) caretEnd(next);
        } else if (t === "insertFromDrop" || t === "deleteByDrag") e.preventDefault();
        return;
      }
      if (blocked) { e.preventDefault(); return; }
      if (t === "historyUndo") { e.preventDefault(); undo(); return; }
      if (t === "historyRedo") { e.preventDefault(); redo(); return; }
      // 한글 등 조합 입력은 브라우저에 맡기고 compositionend에서 모델로 옮긴다(가로채면 조합이 깨진다)
      if (composing || e.isComposing || t === "insertCompositionText" || t === "deleteCompositionText" || t === "insertFromComposition") return;
      e.preventDefault();
      const s = readSel() || savedSel;
      if (!s) return;
      const lines = linesEdit();
      if (t === "insertText" || t === "insertReplacementText") {
        const text = e.data != null ? e.data : e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
        const r = (t === "insertReplacementText" && targetSel(e)) || s;
        let p = r.collapsed ? r.a : linesDelete(lines, r.a, r.b);
        const marks = pending && pending.line === p.line && pending.off === p.off ? pending : null;
        p = /\n/.test(text) ? linesInsertMulti(lines, p, text) : linesInsertText(lines, p, text, marks);
        commit(lines, p, p, r.collapsed && text.length === 1 ? "typing" : "struct");
        if (marks) pending = { ...marks, line: p.line, off: p.off };
        afterTyped(p);
        return;
      }
      if (t === "insertParagraph") {
        if (popup) { choosePopup(); return; }
        let p = s.collapsed ? s.a : linesDelete(lines, s.a, s.b);
        const L = lines[p.line];
        // 빈 문단에서 "$$" 또는 "/수식" + Enter → 수식 입력 창
        if (L.k === "text" && L.type === "paragraph" && /^(\$\$|\/수식)$/.test(inlPlain(L.content, null, "￼").trim())) {
          L.content = [];
          commit(lines, { line: p.line, off: 0 }, null, "struct");
          openMathDialog({ mode: "display" });
          return;
        }
        p = linesSplit(lines, p);
        commit(lines, p, p, "struct");
        return;
      }
      if (t === "insertLineBreak") {
        let p = s.collapsed ? s.a : linesDelete(lines, s.a, s.b);
        const L = lines[p.line];
        p = L.k === "text" && L.type === "code" ? linesInsertText(lines, p, "\n") : linesInsertNodes(lines, p, [{ t: "br" }]);
        commit(lines, p, p, "struct");
        return;
      }
      if (t.startsWith("delete")) {
        if (t === "deleteByDrag" || t === "deleteByCut") return;
        if (!s.collapsed) { const p = linesDelete(lines, s.a, s.b); commit(lines, p, p, "struct"); return; }
        const back = /Backward/.test(t);
        const p = s.a, L = lines[p.line];
        const tr = targetSel(e);
        if (tr && !tr.collapsed && tr.a.line === tr.b.line && tr.a.line === p.line && L.k === "text") {
          const c = linesDelete(lines, tr.a, tr.b);
          commit(lines, c, c, tr.b.off - tr.a.off === 1 ? "typing" : "struct");
          return;
        }
        let res;
        if (L.k === "atom") res = { atom: p.line };
        else if (back && p.off === 0) res = linesBackspaceAtStart(lines, p.line);
        else if (!back && p.off >= lineLen(L)) res = linesDeleteAtEnd(lines, p.line);
        else {
          // 대상 범위를 못 받았으면 한 글자(서로게이트 쌍은 둘)
          const txt = inlPlain(L.content, null, "￼");
          let a = p.off, b = p.off;
          if (back) a = p.off - (p.off >= 2 && /[\udc00-\udfff]/.test(txt[p.off - 1]) && /[\ud800-\udbff]/.test(txt[p.off - 2]) ? 2 : 1);
          else b = p.off + (/[\ud800-\udbff]/.test(txt[p.off]) && /[\udc00-\udfff]/.test(txt[p.off + 1] || "") ? 2 : 1);
          const c = linesDelete(lines, { line: p.line, off: a }, { line: p.line, off: b });
          commit(lines, c, c, "typing");
          return;
        }
        if (res.caret) commit(lines, res.caret, res.caret, "struct");
        else { commit(lines, null, null, "struct"); focusAtom(res.atom); }
        return;
      }
      if (t === "formatBold") { toggleMark("b"); return; }
      if (t === "formatItalic") { toggleMark("i"); return; }
      // 그 밖의 서식 명령·끌어 놓기는 받지 않는다
    });
    /** 글자를 넣은 뒤: $$…$$ → 블록 수식, $…$ → 인라인 수식, @ → 참조 고르기 */
    function afterTyped(p) {
      const info = lineInfo(p.line);
      if (!info) return;
      const b = info.b;
      if (b.type === "code" || LINE_ATOMS.includes(b.type)) { closePopup(); return; }
      if (b.type === "paragraph") {
        const m = /^\$\$([^￼]+?)\$\$$/.exec(inlPlain(b.content, null, "￼").trim());
        if (m) { replaceWithMath(b, easyToLatex(m[1].trim())); return; }
      }
      const content = getContent(b, info.item);
      const [x, y] = splitInline(content, p.off);
      const cx = convertInlineMath(x), cy = convertInlineMath(y);
      if (cx || cy) {
        setContent(b, info.item, [...(cx || x), ...(cy || y)]);
        syncDom(); setSel({ line: p.line, off: inlLen(cx || x) }); afterChange("struct");
        closePopup();
        return;
      }
      updateRefPopup(p);
    }
    function replaceWithMath(b, latex) {
      const i = idx(b.id);
      model.blocks.splice(i, 1, { id: genId(), type: "math", latex });
      let next = model.blocks[i + 1];
      if (!next || !TEXT_TYPES.includes(next.type) || next.type === "caption") { next = para(); model.blocks.splice(i + 1, 0, next); }
      syncDom(); afterChange("struct");
      focusBlock(next.id, 0);
    }

    // ---------- 조합 입력(IME) ----------
    /** DOM의 글 블록을 읽어 모델에 옮긴다(조합 입력·가로채지 못한 브라우저 편집 뒤). 구조가 깨졌으면 모델로 다시 그린다. */
    function syncFromDom() {
      let changed = false, broken = false;
      for (const n of [...blocksEl.childNodes]) {
        if (n.nodeType === 1 && n.classList.contains("rn-blk")) continue;
        if (n.nodeType === 3 && !n.data.trim()) { n.remove(); continue; }
        broken = true;
      }
      for (const b of model.blocks) {
        const el = blkEl(b.id);
        if (!el) { broken = true; continue; }
        if (LINE_ATOMS.includes(b.type)) continue;
        if (b.type === "list") {
          const lis = el.querySelectorAll(":scope > li");
          if (lis.length !== b.items.length) { broken = true; continue; }
          lis.forEach((li, i) => { const v = parseSlot(li); if (!jsonEqual(v, b.items[i])) { b.items[i] = v; changed = true; } });
        } else if (b.type === "code") {
          const v = inlPlain(parseSlot(el), null);
          if (v !== b.text) { b.text = v; changed = true; }
        } else {
          const v = parseSlot(el);
          if (!jsonEqual(v, b.content)) { b.content = v; changed = true; }
        }
        el.__key = blockKey(b);
      }
      if (broken) {
        const keep = savedSel;
        syncDom(true);
        if (keep) setSel(keep.a);
        changed = true;
      }
      return changed;
    }
    blocksEl.addEventListener("compositionstart", (e) => {
      if (inSub(e.target) || blocked) return;
      composing = true;
      closePopup();
      const s = readSel();
      // 여러 줄에 걸친 선택이나 그림 옆에서 조합을 시작하면 먼저 모델에서 정리해 둔다
      if (s && (!s.collapsed && s.a.line !== s.b.line || lineInfo(s.a.line) && LINE_ATOMS.includes(lineInfo(s.a.line).b.type))) {
        const lines = linesEdit();
        let p = s.collapsed ? s.a : linesDelete(lines, s.a, s.b);
        if (lines[p.line].k === "atom") { const at = p.off >= 1 ? p.line + 1 : p.line; lines.splice(at, 0, textLine("paragraph")); p = { line: at, off: 0 }; }
        commit(lines, p, p, "struct");
      }
    });
    blocksEl.addEventListener("compositionend", (e) => {
      if (inSub(e.target)) return;
      composing = false;
      if (blocked) return;
      if (syncFromDom()) {
        const s = readSel();
        if (s) savedSel = s;
        afterChange("typing");
        if (s && s.collapsed) afterTyped(s.a);
      }
    });
    blocksEl.addEventListener("keydown", (e) => {
      // 조합을 시작하는 키(229)가 여러 줄 선택 위에서 눌리면 조합 전에 지워 둔다
      if (e.keyCode === 229 && !composing && !inSub(e.target) && !blocked) {
        const s = readSel();
        if (s && !s.collapsed && s.a.line !== s.b.line) { const lines = linesEdit(); const p = linesDelete(lines, s.a, s.b); commit(lines, p, p, "struct"); }
      }
    }, true);
    blocksEl.addEventListener("input", (e) => {
      const cell = e.target.closest && e.target.closest(".rn-cell");
      if (cell) {
        const blk = cell.closest(".rn-blk"), b = blk && find(blk.dataset.id);
        if (b) { b.rows[Number(cell.dataset.r)][Number(cell.dataset.c)] = cell.textContent.replace(/ /g, " "); blk.__key = blockKey(b); afterChange("typing"); }
        return;
      }
      if (inSub(e.target) || composing || e.isComposing || blocked) return;
      // beforeinput에서 막지 못한 브라우저 기본 편집(드물다): DOM을 읽어 모델에 옮긴다
      if (syncFromDom()) afterChange("typing");
    });

    // ---------- 키보드 ----------
    function paraAfter(id) {
      const lines = linesEdit();
      let li = lineIndex(id, 0);
      const capId = numbering.targetToCap.get(id);
      if (capId && idx(capId) === idx(id) + 1) li += 1;
      lines.splice(li + 1, 0, textLine("paragraph"));
      commit(lines, { line: li + 1, off: 0 }, null, "struct");
    }
    function moveFromAtom(li, dir) {
      const lines = linesNow();
      const t = lines[li + dir];
      if (!t) { setSel({ line: li, off: dir > 0 ? 1 : 0 }); return; }
      if (t.k === "atom") focusAtom(li + dir);
      else setSel({ line: li + dir, off: dir < 0 ? lineLen(t) : 0 });
    }
    blocksEl.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const cell = e.target.closest && e.target.closest(".rn-cell");
      if (cell) {
        if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
        if (mod && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); return; }
        if (e.key === "Tab") {
          const cells = [...cell.closest("table").querySelectorAll(".rn-cell")];
          const t = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
          if (t) { e.preventDefault(); caretEnd(t); }
        }
        if (e.key === "Escape") { e.preventDefault(); cell.closest(".rn-atom").focus(); }
        return;
      }
      if (inSub(e.target)) return;
      const atom = e.target.classList && e.target.classList.contains("rn-atom") ? e.target : null;
      if (atom) {
        const id = atom.dataset.id, li = lineIndex(id, 0);
        if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
        if (mod && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); return; }
        if (blocked) return;
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteBlock(id); }
        else if (e.key === "Enter" && atom.dataset.type === "math") { e.preventDefault(); editMath(id); }
        else if (e.key === "Enter" && atom.dataset.type === "figure" && find(id) && find(id).meta !== undefined) { e.preventDefault(); openFigureData(id); }
        else if (e.key === "Enter") { e.preventDefault(); paraAfter(id); }
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveFromAtom(li, -1); }
        else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); moveFromAtom(li, 1); }
        return;
      }
      if (e.isComposing || composing) return;
      if (popup) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); popup.active = (popup.active + (e.key === "ArrowDown" ? 1 : -1) + popup.items.length) % Math.max(1, popup.items.length); drawPopup(); return; }
        if ((e.key === "Enter" || e.key === "Tab") && popup.items.length) { e.preventDefault(); choosePopup(); return; }
        if (e.key === "Escape") { e.preventDefault(); closePopup(); return; }
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
      if (mod && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); return; }
      if (mod && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "b" || e.key.toLowerCase() === "i")) { e.preventDefault(); toggleMark(e.key.toLowerCase()); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); ctrl.flush(); }
    });
    function caretEnd(el) {
      el.focus();
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }

    // ---------- 복사 · 잘라내기 · 붙여넣기(글자만) ----------
    function onCopy(e, cut) {
      if (inSub(e.target)) return;
      const s = readSel();
      if (!s || s.collapsed) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", linesText(linesNow(), s.a, s.b, numbering));
      if (cut && !blocked) { const lines = linesEdit(); const p = linesDelete(lines, s.a, s.b); commit(lines, p, p, "struct"); }
    }
    blocksEl.addEventListener("copy", (e) => onCopy(e, false));
    blocksEl.addEventListener("cut", (e) => onCopy(e, true));
    blocksEl.addEventListener("paste", (e) => {
      const cell = e.target.closest && e.target.closest(".rn-cell");
      const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
      if (cell) { e.preventDefault(); if (text) document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " ")); return; }
      if (inSub(e.target)) return;
      e.preventDefault();
      if (blocked || !text) return;
      const s = readSel() || savedSel;
      if (!s) return;
      const lines = linesEdit();
      let p = s.collapsed ? s.a : linesDelete(lines, s.a, s.b);
      p = linesInsertMulti(lines, p, text);
      commit(lines, p, p, "struct");
    });
    blocksEl.addEventListener("drop", (e) => e.preventDefault());
    blocksEl.addEventListener("dragstart", (e) => { if (!inSub(e.target)) e.preventDefault(); });
    blocksEl.addEventListener("mousedown", (e) => {
      const atom = e.target.closest && e.target.closest(".rn-atom");
      if (!atom || e.target.closest(".rn-cell, .rn-math-edit, button")) return;
      e.preventDefault();
      atom.focus();
    });
    blocksEl.addEventListener("click", (e) => {
      const im = e.target.closest(".rn-im");
      if (im && blocksEl.contains(im)) { e.preventDefault(); if (!blocked) editInlineMath(im); return; }
      const xr = e.target.closest(".rn-xref");
      if (xr) { const r = resolveRef(numbering, xr.dataset.target); if (r.entry) { const w = blkEl(r.entry.ids[r.entry.ids.length - 1]) || blkEl(r.entry.id); if (w) w.scrollIntoView({ block: "center", behavior: "smooth" }); } else RN.toast("참조 대상이 지워졌어요. 참조를 지우고 다시 고르세요.", "error"); }
    });
    titleInput.addEventListener("input", () => { title = titleInput.value; h1.textContent = title || "제목 없는 문서"; afterChange("typing"); });
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); const L = linesNow()[0]; if (L && L.k === "atom") focusAtom(0); else setSel({ line: 0, off: 0 }); }
    });

    // ---------- @상호 참조 ----------
    const popEl = h("div", { class: "rn-refpop", role: "listbox", id: "ed-refpop", "aria-label": "참조할 대상", hidden: true });
    document.body.append(popEl);
    state.cleanups.push(() => popEl.remove());
    function updateRefPopup(p) {
      const L = linesNow()[p.line];
      if (!L || L.k !== "text" || L.type === "code") { closePopup(); return; }
      const [before] = splitInline(L.content, p.off);
      const trig = parseRefTrigger(inlPlain(before, null, "￼"));
      if (!trig) { closePopup(); return; }
      const items = filterRefTargets(numbering.entries, trig.query);
      if (!items.length && !isKindQuery(trig.query)) { closePopup(); return; }
      popup = { line: p.line, start: trig.start, end: p.off, items, active: popup && popup.line === p.line && popup.start === trig.start ? Math.min(popup.active, Math.max(0, items.length - 1)) : 0 };
      drawPopup();
    }
    function drawPopup() {
      if (!popup) return;
      popEl.hidden = false;
      popEl.replaceChildren(...(popup.items.length ? popup.items.map((e, i) => h("button", { type: "button", role: "option", "aria-selected": String(i === popup.active), onmousedown: (ev) => ev.preventDefault(), onclick: () => { popup.active = i; choosePopup(); } },
        h("strong", {}, e.refLabel), e.text ? " " + (e.text.length > 40 ? e.text.slice(0, 40) + "…" : e.text) : e.latex ? " " + e.latex.slice(0, 40) : "")) : [h("p", {}, "참조할 대상이 없어요. 그림·표에 캡션을 먼저 달거나 블록 수식을 넣으세요.")]));
      const sel = window.getSelection();
      let rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (!rect || (!rect.width && !rect.height && !rect.top)) rect = blocksEl.getBoundingClientRect();
      const w = Math.min(320, window.innerWidth - 24);
      popEl.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - w - 12)) + "px";
      popEl.style.top = Math.min(rect.bottom + 4, window.innerHeight - 120) + "px";
    }
    function closePopup() { popup = null; popEl.hidden = true; popEl.replaceChildren(); }
    function choosePopup() {
      const p = popup; closePopup();
      if (!p || !p.items.length) return;
      const entry = p.items[p.active];
      const lines = linesEdit();
      const cs = curSel();
      const end = cs && cs.collapsed && cs.a.line === p.line ? cs.a.off : p.end;
      const c = linesDelete(lines, { line: p.line, off: p.start }, { line: p.line, off: Math.max(p.start, end) });
      const q = linesInsertNodes(lines, c, [{ t: "ref", target: entry.id }]);
      commit(lines, q, q, "struct");
    }
    listen(document, "mousedown", (e) => { if (popup && !popEl.contains(e.target)) closePopup(); });

    // ---------- 블록 작업 ----------
    function curBlock() { return currentId ? find(currentId) : null; }
    function insertBlocks(newBlocks, opts) {
      let at;
      const cur = curBlock();
      if (opts && opts.at != null) at = opts.at;
      else if (cur) {
        at = idx(cur.id) + 1;
        // 그림·표·수식과 그 캡션 사이에 끼어들지 않게 한다
        const capId = numbering.targetToCap.get(cur.id);
        if (capId && idx(capId) === at) at += 1;
        const tgt = cur.type === "caption" ? numbering.capToTarget.get(cur.id) : null;
        if (tgt && idx(tgt) === at) at += 1;
        if (cur.type === "paragraph" && !inlLen(cur.content) && model.blocks.length > 0) { at -= 1; model.blocks.splice(at, 1); }
      } else {
        at = model.blocks.length;
        const last = model.blocks[at - 1];
        if (last && last.type === "paragraph" && !inlLen(last.content)) { at -= 1; model.blocks.splice(at, 1); }
      }
      model.blocks.splice(at, 0, ...newBlocks);
      const lastIdx = at + newBlocks.length - 1;
      if (lastIdx === model.blocks.length - 1 && model.blocks[lastIdx].type !== "paragraph") model.blocks.push(para());
      syncDom(); afterChange("struct");
      currentId = newBlocks[newBlocks.length - 1].id; // 이어서 넣으면 차례대로 쌓이게
      // 커서는 넣은 블록 바로 뒤로(본문에 포커스가 있을 때만 옮긴다)
      const after = model.blocks[lastIdx + 1];
      if (after && !LINE_ATOMS.includes(after.type) && document.activeElement === blocksEl) focusBlock(after.id, 0);
      return newBlocks;
    }
    function deleteBlock(id) {
      if (blocked) return;
      const i = idx(id); if (i < 0) return;
      const b = model.blocks[i];
      const capId = numbering.targetToCap.get(id);
      model.blocks = model.blocks.filter((x) => x.id !== id && !(capId && x.id === capId && ["figure", "table", "math"].includes(b.type)));
      if (!model.blocks.length) model.blocks.push(para());
      syncDom(); afterChange("struct");
      const n = model.blocks[Math.min(i, model.blocks.length - 1)] || model.blocks[0];
      focusBlock(n.id, LINE_ATOMS.includes(n.type) ? null : 0);
    }
    function captionTargetFor(id) {
      const b = id ? find(id) : curBlock();
      if (b && KIND_OF_TYPE[b.type]) return b;
      if (b && b.type === "caption") return null;
      const i = b ? idx(b.id) : -1;
      const prev = model.blocks[i - 1];
      if (prev && KIND_OF_TYPE[prev.type]) return prev;
      return null;
    }
    function addCaption(id) {
      if (blocked) return;
      const t = captionTargetFor(id);
      if (!t) { RN.toast("그림·표·수식을 먼저 고르세요(누르거나 Tab으로 이동).", "error"); return; }
      const existing = numbering.targetToCap.get(t.id);
      if (existing) { focusBlock(existing, null); RN.toast("이미 캡션이 있어요."); return; }
      const kind = KIND_OF_TYPE[t.type];
      const cap = { id: genId(), type: "caption", kind, content: [] };
      const i = idx(t.id);
      model.blocks.splice(captionPositions(rules)[kind] === "above" ? i : i + 1, 0, cap);
      syncDom(); afterChange("struct"); focusBlock(cap.id, 0);
    }
    /** 데이터 모듈이 만든 그래프(meta 있음)를 더블클릭·Enter → 데이터 패널을 열고 RN.data.editFigure(meta) */
    function openFigureData(id) {
      const b = find(id);
      if (!b || b.meta === undefined) return;
      if (panels["x-data"]) selectTab("x-data");
      try { if (RN.data && typeof RN.data.editFigure === "function") RN.data.editFigure(clone(b.meta)); } catch (e) { console.error(e); }
    }
    function tableOp(id, fn) { const b = find(id); if (!b) return; fn(b); syncDom(); afterChange("struct"); }
    function addRow(id) { tableOp(id, (b) => b.rows.push(Array(b.rows[0].length).fill(""))); }
    function addCol(id) { tableOp(id, (b) => b.rows.forEach((r) => r.push(""))); }
    function delRow(id) { tableOp(id, (b) => { if (b.rows.length > 1) b.rows.pop(); }); }
    function delCol(id) { tableOp(id, (b) => { if (b.rows[0].length > 1) b.rows.forEach((r) => r.pop()); }); }

    /** 선택한 줄들의 종류 바꾸기 (본문/제목/인용/목록). toggle=false면 그 종류로 맞추기만 */
    function setBlockType(type, opt, toggle) {
      if (blocked) return;
      const s = curSel();
      if (!s) { RN.toast("바꿀 문단을 먼저 누르세요.", "error"); return; }
      const lines = linesEdit();
      const a = clampPt(lines, s.a), b = clampPt(lines, s.b);
      if (!linesSetType(lines, a, b, type, opt, toggle !== false)) { RN.toast("본문 문단에서 쓸 수 있어요.", "error"); setSel(a, b); return; }
      commit(lines, a, b, "struct");
    }
    function toggleMark(mark) {
      if (blocked) return;
      const s = curSel();
      if (!s) return;
      const lines = linesEdit();
      const a = clampPt(lines, s.a), b = clampPt(lines, s.b);
      if (!cmpPt(a, b)) {
        const L = lines[a.line];
        if (L.k !== "text") return;
        const base = pending && pending.line === a.line && pending.off === a.off ? pending : marksAt(L.content, a.off);
        pending = { line: a.line, off: a.off, b: base.b, i: base.i, [mark]: !base[mark] };
        setSel(a);
        return;
      }
      if (linesToggleMark(lines, a, b, mark)) commit(lines, a, b, "struct"); else setSel(a, b);
    }
    function insertAtomAtCaret(node) {
      const s = curSel();
      const lines = linesEdit();
      const L = s && lines[clampPt(lines, s.a).line];
      if (!s || !L || L.k !== "text" || L.type === "code") { insertBlocks([para([node])]); return; }
      let p = clampPt(lines, s.a);
      if (!s.collapsed) p = linesDelete(lines, p, clampPt(lines, s.b));
      p = linesInsertNodes(lines, p, [node]);
      commit(lines, p, p, "struct");
    }
    // ---------- 수식 입력 창 (넣기·고치기 모두 여기서) ----------
    let mathDlg = null;
    /** 블록 수식 고치기 */
    function editMath(id) { const b = find(id); if (!b || blocked) return; openMathDialog({ edit: { kind: "block", id }, latex: b.latex }); }
    /** 본문 안 인라인 수식 고치기 */
    function editInlineMath(span) {
      const slot = span.closest(".rn-slot"), blk = span.closest(".rn-blk");
      if (!slot || !blk) return;
      const li = lineIndex(blk.dataset.id, slot.dataset.item != null ? Number(slot.dataset.item) : 0);
      const off = offsetIn(slot, span.parentNode, [...span.parentNode.childNodes].indexOf(span), "start");
      openMathDialog({ edit: { kind: "inline", li, off }, latex: span.dataset.latex || "" });
    }
    /**
     * opts: { edit?: {kind:"block", id} | {kind:"inline", li, off}, latex?, mode? }
     * 쉬운 표기를 치면 easyToLatex로 바꿔 미리 보여 주고, "넣기"를 눌러야 문서에 들어간다.
     */
    function openMathDialog(opts) {
      if (blocked || mathDlg) return;
      opts = opts || {};
      const edit = opts.edit || null;
      // 열 때의 본문 선택을 기억해 두었다가 그 자리에 넣는다
      const sel0 = edit ? null : curSel();
      let prefill = "", fromSel = false;
      let defaultMode = "display";
      if (sel0) {
        const L = linesNow()[sel0.a.line];
        if (L && L.k === "text") {
          let rest = L.content;
          if (!sel0.collapsed && sel0.a.line === sel0.b.line) {
            const [, r] = splitInline(L.content, sel0.a.off);
            const [mid] = splitInline(r, sel0.b.off - sel0.a.off);
            if (mid.length && mid.every((n) => n.t === "text")) { prefill = mid.map((n) => n.text).join("").trim(); fromSel = !!prefill; }
            rest = fromSel ? [...splitInline(L.content, sel0.a.off)[0], ...splitInline(L.content, sel0.b.off)[1]] : L.content;
          }
          defaultMode = L.type === "paragraph" && !inlLen(rest) ? "display" : "inline";
        }
      }
      const mode0 = opts.mode || (edit ? (edit.kind === "block" ? "display" : "inline") : defaultMode);
      const startLatex = opts.latex != null ? String(opts.latex) : "";
      const startEasy = prefill || (startLatex ? (latexToEasy(startLatex) ?? startLatex) : "");

      let latexOverride = false;
      let aiCtl = null;
      const isDisplay = () => modeDisplay.checked;
      const easy = h("input", { type: "text", id: "math-easy", value: startEasy, spellcheck: false, autocomplete: "off", placeholder: "예: (x+1)/2, x^2, sqrt(x), 알파", "aria-describedby": "math-easy-hint" });
      const latexTa = h("textarea", { id: "math-latex", spellcheck: false, rows: 2 });
      const preview = h("div", { class: "rn-mathdlg-preview", id: "math-preview", "aria-live": "polite", "aria-label": "미리보기" });
      const hint = h("p", { class: "rn-small rn-mathdlg-warn", id: "math-hint", role: "status", hidden: true });
      const overrideNote = h("small", { id: "math-latex-note", hidden: true }, "LaTeX를 직접 고쳤어요. 위 칸을 고치면 다시 바뀌어요.");
      const submitBtn = h("button", { type: "submit", class: "rn-btn rn-primary", id: "math-insert" }, edit ? "고치기" : "넣기");
      const modeInline = h("input", { type: "radio", name: "math-mode", id: "math-mode-inline", value: "inline", checked: mode0 === "inline" });
      const modeDisplay = h("input", { type: "radio", name: "math-mode", id: "math-mode-display", value: "display", checked: mode0 === "display" });
      const currentLatex = () => (latexOverride ? latexTa.value.trim() : easyToLatex(easy.value));

      function render() {
        const latex = currentLatex();
        if (!latexOverride) latexTa.value = latex;
        submitBtn.disabled = !latex;
        hint.hidden = true;
        if (!latex) { preview.replaceChildren(h("span", { class: "rn-muted rn-small" }, "여기에 수식이 보여요")); return; }
        let err = null;
        if (window.katex) { try { window.katex.renderToString(latex, { output: "mathml", throwOnError: true, displayMode: isDisplay() }); } catch (e) { err = e; } }
        setMath(preview, latex, isDisplay());
        if (err) {
          const p = typeof err.position === "number" ? err.position : -1;
          const shown = latexOverride || latex === easy.value.trim();
          hint.textContent = "이 부분을 이해하지 못했어요" + (shown && p >= 0 ? `: “${latex.slice(Math.max(0, p - 8), p + 8)}”` : ". 괄호 짝이나 기호를 확인해 주세요.");
          hint.hidden = false;
        }
      }
      easy.addEventListener("input", () => { latexOverride = false; overrideNote.hidden = true; render(); });
      latexTa.addEventListener("input", () => { latexOverride = true; overrideNote.hidden = false; render(); });
      latexTa.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
      modeInline.addEventListener("change", render);
      modeDisplay.addEventListener("change", render);

      /** 입력란 커서 자리에 쉬운 표기 넣기. "▢" 자리: 첫 자리에 선택한 글자(없으면 빈칸을 골라 둔다) */
      function insertTpl(t) {
        const s = easy.selectionStart ?? easy.value.length, e = easy.selectionEnd ?? s;
        const selected = easy.value.slice(s, e);
        let text, selFrom, selTo;
        if (t.base) { // 제곱처럼 고른 것을 밑으로
          const base = !selected ? "" : /^[A-Za-z0-9.]+$/.test(selected) ? selected : "(" + selected + ")";
          text = base + t.tpl; selFrom = selTo = text.length;
        } else {
          const slots = t.tpl.split("▢");
          text = slots[0];
          const marks = [];
          for (let k = 1; k < slots.length; k++) {
            const fill = k === 1 && selected ? selected : " ";
            marks.push([text.length, text.length + fill.length, k === 1 && !!selected]);
            text += fill + slots[k];
          }
          const target = marks.find((m) => !m[2]) || null;
          if (target) { selFrom = target[0]; selTo = target[1]; } else selFrom = selTo = text.length;
        }
        easy.focus();
        easy.setSelectionRange(s, e);
        let ok = false;
        try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
        if (!ok || easy.value.slice(s, s + text.length) !== text) { easy.setRangeText(text, s, e, "end"); }
        easy.setSelectionRange(s + selFrom, s + selTo);
        easy.dispatchEvent(new Event("input"));
      }
      const MAIN = [
        { label: "a/b", aria: "분수", tpl: "(▢)/(▢)" }, { label: "x²", aria: "제곱", tpl: "^2", base: true }, { label: "xₙ", aria: "아래 첨자", tpl: "_(▢)" },
        { label: "√", aria: "제곱근", tpl: "sqrt(▢)" }, { label: "Σ", aria: "합", tpl: "sum(i=1, n, ▢)" }, { label: "∫", aria: "적분", tpl: "int(▢, ▢, ▢ dx)" },
        { label: "lim", aria: "극한", tpl: "lim(x->▢, ▢)" }, { label: "v⃗", aria: "벡터", tpl: "vec(▢)" },
        { label: "π", tpl: "π" }, { label: "±", tpl: "±" }, { label: "≤", tpl: "≤" }, { label: "≥", tpl: "≥" }, { label: "≠", tpl: "≠" }, { label: "≈", tpl: "≈" },
        { label: "∞", tpl: "∞" }, { label: "×", tpl: "×" }, { label: "÷", tpl: "÷" }, { label: "°", aria: "도", tpl: "°" },
      ];
      const MORE = [
        ...[..."αβγδθλμρσφωΔΣΩ"].map((g) => ({ label: g, tpl: g })),
        { label: "|x|", aria: "절댓값", tpl: "|▢|" }, { label: "ⁿ√", aria: "n제곱근", tpl: "root(▢, ▢)" }, { label: "x̄", aria: "평균", tpl: "bar(▢)" }, { label: "ŷ", aria: "모자", tpl: "hat(▢)" },
        { label: "→", tpl: "→" }, { label: "·", aria: "곱하기 점", tpl: "·" }, { label: "∂", tpl: "∂" }, { label: "( )", aria: "괄호", tpl: "(▢)" },
        { label: "sin", tpl: "sin(▢)" }, { label: "cos", tpl: "cos(▢)" }, { label: "tan", tpl: "tan(▢)" }, { label: "log", tpl: "log(▢)" }, { label: "ln", tpl: "ln(▢)" },
        { label: "℃", aria: "섭씨", tpl: "℃" },
      ];
      const tplBtn = (t) => h("button", { type: "button", class: "rn-btn", tabIndex: -1, title: t.aria ? `${t.aria}: ${t.tpl.replace(/▢/g, "□")}` : t.tpl, "aria-label": t.aria || t.label, onmousedown: pd, onclick: () => insertTpl(t) }, t.label);
      const moreId = "math-more-row";
      const moreBtn = h("button", { type: "button", class: "rn-btn rn-ghost", id: "math-more", tabIndex: -1, "aria-expanded": "false", "aria-controls": moreId, onmousedown: pd }, "더 보기");
      const mainRow = h("div", { class: "rn-mathdlg-tpls", role: "toolbar", "aria-label": "자주 쓰는 수식 틀", id: "math-tpls" }, MAIN.map(tplBtn), moreBtn);
      const moreRow = h("div", { class: "rn-mathdlg-tpls", role: "toolbar", "aria-label": "그 밖의 기호", id: moreId, hidden: true },
        MORE.map(tplBtn),
        h("p", { class: "rn-small rn-muted rn-mathdlg-cheat" }, "직접 칠 때: 분수 a/b · 제곱 x^2 · 첨자 a_1 · 루트 sqrt(x) · 그리스 문자 alpha 또는 알파 · <= >= != · 합 sum(i=1, n, a_i)"));
      moreBtn.addEventListener("click", () => { const open = moreRow.hidden; moreRow.hidden = !open; moreBtn.setAttribute("aria-expanded", String(open)); moreBtn.textContent = open ? "접기" : "더 보기"; });
      // 도구 모음 안은 화살표로 옮겨 다닌다(Tab 한 번에 다음 칸으로)
      for (const row of [mainRow, moreRow]) {
        const btns = () => [...row.querySelectorAll("button")];
        btns()[0].tabIndex = 0;
        row.addEventListener("keydown", (e) => {
          const list = btns(), i = list.indexOf(document.activeElement);
          if (i < 0) return;
          const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : null;
          if (j == null) return;
          e.preventDefault();
          const k = (j + list.length) % list.length;
          list.forEach((b, n) => { b.tabIndex = n === k ? 0 : -1; });
          list[k].focus();
        });
      }

      // 말로 설명해서 만들기 (AI가 있을 때만)
      const sample = RN.caps.sample;
      let aiRow = null, aiToggle = null;
      if (sample && !mathAiOff) {
        const aiQ = h("input", { type: "text", id: "math-ai-q", placeholder: "예: 이차방정식 근의 공식", autocomplete: "off" });
        const aiGo = h("button", { type: "button", class: "rn-btn", id: "math-ai-go" }, "만들기");
        const aiStatus = h("p", { class: "rn-small rn-muted", id: "math-ai-status", role: "status" });
        aiRow = h("div", { class: "rn-stack rn-mathdlg-ai", id: "math-ai-box", hidden: true, style: { gap: "6px" } },
          h("div", { class: "rn-field" }, h("label", { for: "math-ai-q" }, "어떤 수식인가요?"), h("div", { class: "rn-row", style: { flexWrap: "nowrap" } }, aiQ, aiGo)), aiStatus);
        aiToggle = h("button", { type: "button", class: "rn-btn rn-ghost rn-small", id: "math-ai-toggle", "aria-expanded": "false", "aria-controls": "math-ai-box" }, "말로 설명해서 만들기");
        aiToggle.addEventListener("click", () => { const open = aiRow.hidden; aiRow.hidden = !open; aiToggle.setAttribute("aria-expanded", String(open)); if (open) aiQ.focus(); });
        const run = async () => {
          const q = aiQ.value.trim();
          if (!q) { aiStatus.textContent = "어떤 수식인지 먼저 적어 주세요."; aiQ.focus(); return; }
          if (RN.aiQuota && typeof RN.aiQuota.take === "function") {
            let okQ = true;
            try { okQ = await RN.aiQuota.take(); } catch { okQ = true; }
            if (!okQ) { aiStatus.textContent = "오늘 쓸 수 있는 AI 요청을 모두 썼어요. 내일 다시 써 주세요."; return; }
          }
          aiCtl = new AbortController();
          aiGo.disabled = true; aiStatus.textContent = "만드는 중…";
          try {
            const { text } = await sample(MATH_AI_PROMPT(q), { modelTier: "quick", signal: aiCtl.signal });
            const latex = cleanAiLatex(text);
            if (!latex) { aiStatus.textContent = "수식을 받지 못했어요. 다르게 설명해 보세요."; return; }
            easy.value = latexToEasy(latex) ?? latex;
            latexOverride = false; overrideNote.hidden = true;
            render();
            aiStatus.textContent = "만들었어요. 미리보기를 확인하고 ‘" + submitBtn.textContent + "’를 누르세요.";
            easy.focus();
          } catch (e) {
            const code = e && e.code;
            if (code === "cancelled") { aiStatus.textContent = ""; return; }
            if (MATH_AI_HIDE.has(code)) { mathAiOff = true; aiStatus.textContent = "이 화면에서는 AI 기능을 쓸 수 없어요."; aiToggle.hidden = true; return; }
            aiStatus.textContent = mathAiError(code);
          } finally { aiGo.disabled = false; aiCtl = null; }
        };
        aiGo.addEventListener("click", run);
        aiQ.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); run(); } });
      }

      const titleText = edit ? "수식 고치기" : "수식 넣기";
      const modeBox = h("fieldset", { class: "rn-mathdlg-mode", hidden: !!edit },
        h("legend", { class: "rn-small" }, "넣는 방식"),
        h("label", { class: "rn-row", style: { gap: "6px", flexWrap: "nowrap" } }, modeInline, "글 안에 넣기"),
        h("label", { class: "rn-row", style: { gap: "6px", flexWrap: "nowrap" } }, modeDisplay, "한 줄로 넣기 (번호 붙음)"));
      const form = h("form", { class: "rn-stack", onsubmit: (e) => { e.preventDefault(); apply("save"); } },
        h("h2", { id: "math-dlg-title" }, titleText),
        mainRow, moreRow,
        h("div", { class: "rn-field" },
          h("div", { class: "rn-row rn-between" }, h("label", { for: "math-easy" }, "수식"), aiToggle),
          easy,
          h("small", { id: "math-easy-hint" }, "평소 쓰는 대로 쳐요. 예: (x+1)/(x-1), x^2, 루트(x), 알파, <=  (LaTeX도 돼요)")),
        aiRow,
        preview, hint,
        h("details", { class: "rn-mathdlg-latex", id: "math-latex-more" }, h("summary", {}, "LaTeX 보기"),
          h("div", { class: "rn-field" }, h("label", { for: "math-latex" }, "LaTeX (직접 고칠 수 있어요)"), latexTa, overrideNote)),
        modeBox,
        h("div", { class: "rn-row rn-end" },
          edit ? h("button", { type: "button", class: "rn-btn rn-danger", id: "math-delete", onclick: () => apply("delete") }, "지우기") : null,
          h("button", { type: "button", class: "rn-btn", id: "math-cancel", onclick: () => apply("cancel") }, "닫기"),
          submitBtn));
      const dlg = h("dialog", { class: "rn-dialog rn-mathdlg", id: "math-dlg", "aria-labelledby": "math-dlg-title" }, form);
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); apply("cancel"); });
      mathDlg = dlg;

      function apply(action) {
        if (!mathDlg) return;
        const latex = currentLatex();
        if (aiCtl) { try { aiCtl.abort(); } catch { /* 무시 */ } }
        mathDlg = null;
        dlg.close(); dlg.remove();
        if (action === "save" && !latex) action = "cancel";
        if (edit && edit.kind === "block") {
          const b = find(edit.id);
          if (b && action === "delete") { deleteBlock(edit.id); return; }
          if (b && action === "save" && b.latex !== latex) { b.latex = latex; syncDom(); afterChange("struct"); }
          const w = blkEl(edit.id); if (w) w.focus(); else blocksEl.focus();
          return;
        }
        if (edit && edit.kind === "inline") {
          if (action === "cancel") { setSel({ line: edit.li, off: edit.off + 1 }); return; }
          const lines = linesEdit();
          const c = linesDelete(lines, { line: edit.li, off: edit.off }, { line: edit.li, off: edit.off + 1 });
          const p = action === "delete" ? c : linesInsertNodes(lines, c, [{ t: "math", latex }]);
          commit(lines, p, p, "struct");
          return;
        }
        // 새로 넣기: 연 자리로 돌아간다
        if (sel0) setSel(sel0.a, sel0.b); else blocksEl.focus();
        if (action !== "save") return;
        if (sel0 && !sel0.collapsed) {
          if (fromSel) { const lines = linesEdit(); const p = linesDelete(lines, sel0.a, sel0.b); commit(lines, p, p, "struct"); }
          else setSel(sel0.b);
        }
        if (isDisplay()) {
          const m = insertBlocks([{ id: genId(), type: "math", latex }])[0];
          if (!root.contains(document.activeElement) || document.activeElement === document.body) { const w = blkEl(m.id); if (w) w.focus(); }
        } else insertAtomAtCaret({ t: "math", latex });
      }

      document.body.append(dlg);
      dlg.showModal();
      render();
      easy.focus();
      if (fromSel) easy.select(); else easy.setSelectionRange(easy.value.length, easy.value.length);
    }

    // ---------- 도구 모음 (한 줄) ----------
    const pd = (e) => e.preventDefault();
    const tbBtn = (id, label, fn, o) => h("button", { type: "button", class: "rn-btn", id, title: (o && o.title) || label, "aria-label": (o && o.aria) || label, style: o && o.style, onmousedown: pd, onclick: fn, disabled: !!blocked }, label);
    const blockSel = h("select", { id: "tb-block", "aria-label": "문단 종류", title: "문단 종류", disabled: !!blocked },
      h("option", { value: "paragraph" }, "본문"), h("option", { value: "h1" }, "제목 1"), h("option", { value: "h2" }, "제목 2"), h("option", { value: "h3" }, "제목 3"),
      h("option", { value: "", disabled: true, hidden: true }, "—"));
    blockSel.addEventListener("change", () => {
      const v = blockSel.value;
      if (v === "paragraph") setBlockType("paragraph", null, false);
      else if (/^h[1-3]$/.test(v)) setBlockType("heading", Number(v[1]), false);
    });
    function updateToolbarState() {
      const info = savedSel && lineInfo(savedSel.a.line);
      blockSel.value = !info ? "" : info.b.type === "paragraph" ? "paragraph" : info.b.type === "heading" ? "h" + info.b.level : "";
    }
    const fileInput = h("input", { type: "file", id: "ed-img-file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml", hidden: true, onchange: () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      if (f.type === "image/svg+xml") reader.onload = () => api.insertFigure({ svg: String(reader.result), caption: "" }).catch((e) => RN.toast(e.message, "error"));
      else reader.onload = () => api.insertFigure({ dataUrl: String(reader.result), caption: "", alt: f.name }).catch((e) => RN.toast(e.message, "error"));
      if (f.type === "image/svg+xml") reader.readAsText(f); else reader.readAsDataURL(f);
      fileInput.value = "";
    } });
    // 삽입 메뉴
    const insertTable = () => {
      const t = insertBlocks([{ id: genId(), type: "table", header: true, rows: [["항목", "값", "비고"], ["", "", ""], ["", "", ""]] }])[0];
      const w = blkEl(t.id), c = w && w.querySelector(".rn-cell");
      if (c) caretEnd(c);
    };
    const MENU = [
      ["tb-table", "표", insertTable],
      ["tb-image", "그림…", () => fileInput.click()],
      ["tb-math", "수식", () => openMathDialog()],
      null,
      ["tb-caption", "캡션", () => addCaption()],
      ["tb-toc-fig", "그림 목차", () => insertBlocks([{ id: genId(), type: "toc", kind: "figure" }])],
      ["tb-toc-tab", "표 목차", () => insertBlocks([{ id: genId(), type: "toc", kind: "table" }])],
      null,
      ["tb-quote", "인용", () => setBlockType("quote")],
      ["tb-ol", "번호 목록", () => setBlockType("list", true)],
    ];
    const insertBtn = h("button", { type: "button", class: "rn-btn", id: "tb-insert", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "tb-insert-menu", disabled: !!blocked, onmousedown: pd }, "삽입 ▾");
    const menu = h("div", { class: "rn-menu", id: "tb-insert-menu", role: "menu", "aria-labelledby": "tb-insert", hidden: true });
    const menuButtons = [];
    for (const it of MENU) {
      if (!it) { menu.append(h("div", { role: "separator", class: "rn-menu-sep" })); continue; }
      const [id, label, fn] = it;
      const b = h("button", { type: "button", role: "menuitem", id, tabIndex: -1, onmousedown: pd });
      b.textContent = label;
      b.addEventListener("click", (e) => { const viaKey = e.detail === 0; closeMenu(false); if (!blocked) fn(viaKey); });
      menuButtons.push(b); menu.append(b);
    }
    function openMenu(focusIdx) {
      menu.hidden = false; insertBtn.setAttribute("aria-expanded", "true");
      menu.style.left = "0"; menu.style.right = "auto";
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) { menu.style.left = "auto"; menu.style.right = "0"; }
      if (focusIdx != null) menuButtons[(focusIdx + menuButtons.length) % menuButtons.length].focus();
    }
    function closeMenu(returnFocus) {
      if (menu.hidden) return;
      menu.hidden = true; insertBtn.setAttribute("aria-expanded", "false");
      if (returnFocus) insertBtn.focus();
    }
    insertBtn.addEventListener("click", (e) => { if (menu.hidden) openMenu(e.detail === 0 ? 0 : null); else closeMenu(false); });
    insertBtn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); openMenu(0); }
      else if (e.key === "ArrowUp") { e.preventDefault(); openMenu(-1); }
      else if (e.key === "Escape") closeMenu(true);
    });
    menu.addEventListener("keydown", (e) => {
      const i = menuButtons.indexOf(document.activeElement), n = menuButtons.length;
      if (e.key === "ArrowDown") { e.preventDefault(); menuButtons[(i + 1) % n].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); menuButtons[(i - 1 + n) % n].focus(); }
      else if (e.key === "Home") { e.preventDefault(); menuButtons[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); menuButtons[n - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
      else if (e.key === "Tab") closeMenu(false);
    });
    listen(document, "mousedown", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== insertBtn) closeMenu(false);
    });
    const sep = () => h("span", { class: "sep", "aria-hidden": "true" });
    toolbar.append(
      blockSel, sep(),
      tbBtn("tb-bold", "B", () => toggleMark("b"), { aria: "굵게", title: "굵게 (Ctrl+B)", style: { fontWeight: "700" } }),
      tbBtn("tb-italic", "I", () => toggleMark("i"), { aria: "기울임", title: "기울임 (Ctrl+I)", style: { fontStyle: "italic", fontFamily: "serif" } }),
      tbBtn("tb-ul", "목록", () => setBlockType("list", false), { title: "글머리 목록" }), sep(),
      tbBtn("tb-undo", "↶", undo, { aria: "실행 취소", title: "실행 취소 (Ctrl+Z)" }),
      tbBtn("tb-redo", "↷", redo, { aria: "다시 실행", title: "다시 실행 (Ctrl+Shift+Z)" }), sep(),
      h("span", { class: "rn-menu-wrap" }, insertBtn, menu), fileInput);
    listen(document, "keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c" && root.contains(document.activeElement)) { e.preventDefault(); addCaption(); }
      // Ctrl/Cmd+Shift+E: 수식 입력 창
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e" && !mathDlg && !blocked && (root.contains(document.activeElement) || document.activeElement === document.body)) { e.preventDefault(); openMathDialog(); }
    });

    // ---------- 오른쪽 패널 (기본 접힘, 위 버튼으로 연다) ----------
    const sideTitle = h("h2", { id: "ed-side-title", style: { fontSize: "1rem" } });
    const panelBox = h("div", { class: "rn-stack" });
    side.append(h("div", { class: "rn-ed-side-head" }, sideTitle, h("button", { type: "button", class: "rn-btn rn-ghost rn-small", id: "ed-panel-close", onclick: () => closePanel(true) }, "닫기")), panelBox);
    const builtin = [{ id: "format", label: "서식" }, { id: "export", label: "내보내기" }, { id: "history", label: "버전 기록" }];
    const ext = RN.editorPanels.filter((p) => p && p.id && typeof p.mount === "function");
    const allTabs = [...builtin, ...ext.map((p) => ({ id: "x-" + p.id, label: p.label || p.id, ext: p }))];
    const panels = {};
    let activeTab = null;
    for (const t of allTabs) {
      const panel = h("div", { role: "region", id: "edpanel-" + t.id, "aria-label": t.label, hidden: true, class: "rn-stack" });
      panels[t.id] = { el: panel, mounted: false, t };
      panelBox.append(panel);
      panelBar.append(h("button", { type: "button", class: "rn-btn rn-ghost", id: "edtab-" + t.id, "aria-controls": "edpanel-" + t.id, "aria-expanded": "false",
        onclick: () => (activeTab === t.id ? closePanel(false) : selectTab(t.id)) }, t.label));
    }
    side.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.target.closest("dialog")) { e.preventDefault(); closePanel(true); } });
    function selectTab(id) {
      const p = panels[id];
      if (!p) return;
      activeTab = id;
      side.hidden = false; layout.classList.add("has-side");
      sideTitle.textContent = p.t.label;
      for (const t of allTabs) {
        const on = t.id === id;
        panels[t.id].el.hidden = !on;
        panelBar.querySelector("#edtab-" + CSS.escape(t.id)).setAttribute("aria-expanded", String(on));
      }
      if (id === "format") { if (!p.mounted) { p.mounted = true; buildFormat(p.el); } drawCheck(); }
      else if (id === "export") drawExport();
      else if (id === "history") drawHistory();
      else if (p.t.ext && !p.mounted) {
        p.mounted = true;
        try { const c = p.t.ext.mount(p.el, api); if (typeof c === "function") state.cleanups.push(c); }
        catch (e) { console.error(e); p.el.replaceChildren(RN.notice("이 패널을 그리지 못했어요.", "error")); }
      }
    }
    function closePanel(focusBtn) {
      const was = activeTab;
      activeTab = null;
      side.hidden = true; layout.classList.remove("has-side");
      for (const t of allTabs) { panels[t.id].el.hidden = true; panelBar.querySelector("#edtab-" + CSS.escape(t.id)).setAttribute("aria-expanded", "false"); }
      if (focusBtn && was) { const b = panelBar.querySelector("#edtab-" + CSS.escape(was)); if (b) b.focus(); }
    }

    // --- 서식 패널: 자주 쓰는 것 + 자세히 + 서식 검사 ---
    const fmt = {};
    let fontNoticeEl = null, checkBox = null;
    function buildFormat(el) {
      const sel = (id, opts) => { const s = h("select", { id }, opts.map(([v, l]) => h("option", { value: v }, l))); fmt[id] = s; return s; };
      const num = (id, min, max, step) => { const i = h("input", { type: "number", id, min, max, step: step || 1, inputMode: "decimal" }); fmt[id] = i; return i; };
      const chk = (id, label) => { const i = h("input", { type: "checkbox", id }); fmt[id] = i; return h("label", { class: "rn-check", for: id }, i, label); };
      const fonts = FONT_IDS.map((f) => [f, FONTS[f].label]);
      const aligns = [["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]];
      const presetSel = h("select", { id: "fmt-preset" });
      const tplName = h("input", { type: "text", id: "fmt-tpl-name", maxLength: 60, placeholder: "예: 우리 학교 탐구 양식" });
      const fontName = h("input", { type: "text", id: "fmt-font-name", maxLength: 60, placeholder: "예: 함초롬바탕" });
      fontNoticeEl = h("div", { "aria-live": "polite" });
      let templates = [];
      const drawPresets = () => {
        presetSel.replaceChildren(h("option", { value: "" }, "고르기…"),
          h("optgroup", { label: "프리셋" }, PRESETS.map((p) => h("option", { value: p.id }, p.name))),
          templates.length ? h("optgroup", { label: "내 템플릿" }, templates.map((t) => h("option", { value: "tpl:" + t.id }, t.name))) : null);
      };
      const loadTemplates = async () => {
        try { const s = await withTimeout(tplCol().get()); templates = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); drawPresets(); } catch (e) { console.warn(e); }
      };
      drawPresets(); loadTemplates();
      presetSel.addEventListener("change", () => {
        const v = presetSel.value;
        if (!v) return;
        const p = v.startsWith("tpl:") ? templates.find((t) => "tpl:" + t.id === v) : PRESETS.find((x) => x.id === v);
        if (p) setRules(p.rules, `“${p.name}” 서식을 적용했어요.`);
        presetSel.value = "";
      });
      const form = h("form", { class: "rn-stack", id: "fmt-form", onsubmit: (e) => e.preventDefault() },
        h("div", { class: "rn-fmt-grid" },
          h("div", { class: "rn-field full", style: { gridColumn: "1 / -1" } }, h("label", { for: "fmt-preset" }, "프리셋 · 내 템플릿"), presetSel),
          RN.field("용지", sel("fmt-page-size", [["A4", "A4"], ["B5", "B5"], ["Letter", "Letter"]])),
          RN.field("본문 글꼴", sel("fmt-body-font", fonts)),
          RN.field("글자 크기(pt)", num("fmt-body-size", 6, 48, 0.5)), RN.field("줄 간격(%)", num("fmt-line-height", 100, 300, 5))),
        fontNoticeEl,
        h("details", { class: "rn-fmt-more", id: "fmt-more" }, h("summary", {}, "자세히"),
          h("fieldset", {}, h("legend", {}, "용지 · 문단"),
            RN.field("방향", sel("fmt-orient", [["portrait", "세로"], ["landscape", "가로"]])),
            RN.field("정렬", sel("fmt-body-align", [["justify", "양쪽"], ["left", "왼쪽"]])),
            RN.field("위 여백(mm)", num("fmt-m-top", 0, 60)), RN.field("아래 여백(mm)", num("fmt-m-bottom", 0, 60)),
            RN.field("왼쪽 여백(mm)", num("fmt-m-left", 0, 60)), RN.field("오른쪽 여백(mm)", num("fmt-m-right", 0, 60)),
            RN.field("첫 줄 들여쓰기(pt)", num("fmt-indent", 0, 60)), RN.field("문단 아래 간격(pt)", num("fmt-spacing", 0, 40))),
          ...HEADS.map((hl, i) => h("fieldset", {}, h("legend", {}, `제목 ${i + 1}`),
            h("div", { class: "rn-field full" }, h("label", { for: `fmt-${hl}-font` }, "글꼴"), sel(`fmt-${hl}-font`, fonts)),
            RN.field("크기(pt)", num(`fmt-${hl}-size`, 6, 48, 0.5)), RN.field("정렬", sel(`fmt-${hl}-align`, aligns)),
            chk(`fmt-${hl}-bold`, "굵게"))),
          h("fieldset", {}, h("legend", {}, "캡션"),
            RN.field("크기(pt)", num("fmt-cap-size", 6, 48, 0.5)), RN.field("정렬", sel("fmt-cap-align", aligns)),
            RN.field("그림 캡션", sel("fmt-cap-fig-pos", [["below", "아래"], ["above", "위"]])), RN.field("표 캡션", sel("fmt-cap-tab-pos", [["above", "위"], ["below", "아래"]])),
            chk("fmt-cap-bold", "굵게")),
          h("fieldset", {}, h("legend", {}, "쪽 번호"),
            h("div", { class: "full", style: { gridColumn: "1 / -1" } }, chk("fmt-pn-enabled", "쪽 번호 넣기")),
            RN.field("위치", sel("fmt-pn-pos", Object.entries(PAGE_NUMBER_POS))),
            RN.field("모양", sel("fmt-pn-style", [["n", "3"], ["dash", "- 3 -"], ["total", "3 / 10"]]))),
          h("fieldset", {}, h("legend", {}, "다른 글꼴 이름으로 지정"),
            h("div", { class: "rn-field full" }, h("label", { for: "fmt-font-name" }, "본문·제목 글꼴 이름"), fontName,
              h("small", {}, "없는 글꼴은 가장 비슷한 글꼴로 바꿔요.")),
            h("div", { class: "rn-row rn-end", style: { gridColumn: "1 / -1" } }, h("button", { type: "button", class: "rn-btn", id: "fmt-font-apply", disabled: !!blocked, onclick: () => {
              if (!fontName.value.trim()) return;
              api.applyFormat({ body: { font: fontName.value.trim() } }); fontName.value = "";
            } }, "적용"))),
          h("fieldset", {}, h("legend", {}, "내 템플릿으로 저장"),
            h("div", { class: "rn-field full" }, h("label", { for: "fmt-tpl-name" }, "템플릿 이름"), tplName),
            h("div", { class: "rn-row rn-end", style: { gridColumn: "1 / -1" } },
              h("button", { type: "button", class: "rn-btn", id: "fmt-tpl-save", disabled: !!blocked, onclick: async (e) => {
                const name = tplName.value.trim();
                if (!name) { RN.toast("템플릿 이름을 입력하세요.", "error"); tplName.focus(); return; }
                const b = e.currentTarget; b.disabled = true;
                try { await withTimeout(tplCol().doc(RN.newId()).set({ name, rules: clone(rules), createdAt: Date.now() })); tplName.value = ""; RN.toast("내 템플릿으로 저장했어요."); await loadTemplates(); }
                catch (err) { RN.toast(errText(err), "error"); } finally { b.disabled = false; }
              } }, "저장")))));
      form.addEventListener("change", (e) => { if (e.target === presetSel || e.target === fontName || e.target === tplName) return; readForm(); });
      form.addEventListener("input", (e) => { if (e.target.type === "number") readForm(); });
      if (blocked) form.querySelectorAll("input, select").forEach((c) => { c.disabled = true; });
      checkBox = h("section", { class: "rn-fmt-check", "aria-labelledby": "fmt-check-h" });
      el.append(form, checkBox);
      fillForm();
    }
    const FORM_MAP = [
      ["fmt-page-size", "page.size"], ["fmt-orient", "page.orientation"], ["fmt-m-top", "page.margin.top", 1], ["fmt-m-bottom", "page.margin.bottom", 1],
      ["fmt-m-left", "page.margin.left", 1], ["fmt-m-right", "page.margin.right", 1], ["fmt-body-font", "body.font"], ["fmt-body-size", "body.sizePt", 1],
      ["fmt-line-height", "body.lineHeight", 1], ["fmt-body-align", "body.align"], ["fmt-indent", "paragraph.indentPt", 1], ["fmt-spacing", "paragraph.spacingPt", 1],
      ...HEADS.flatMap((hl) => [[`fmt-${hl}-font`, `headings.${hl}.font`], [`fmt-${hl}-size`, `headings.${hl}.sizePt`, 1], [`fmt-${hl}-align`, `headings.${hl}.align`], [`fmt-${hl}-bold`, `headings.${hl}.bold`, 2]]),
      ["fmt-cap-size", "caption.sizePt", 1], ["fmt-cap-align", "caption.align"], ["fmt-cap-fig-pos", "caption.figurePosition"], ["fmt-cap-tab-pos", "caption.tablePosition"],
      ["fmt-cap-bold", "caption.bold", 2], ["fmt-pn-enabled", "pageNumber.enabled", 2], ["fmt-pn-pos", "pageNumber.position"], ["fmt-pn-style", "pageNumber.style"],
    ];
    const getP = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
    const setP = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) { x[k] = isObj(x[k]) ? x[k] : {}; x = x[k]; } x[ks[ks.length - 1]] = v; };
    function fillForm() {
      for (const [id, path, kind] of FORM_MAP) { const c = fmt[id]; if (!c) continue; const v = getP(rules, path); if (kind === 2) c.checked = !!v; else c.value = String(v); }
    }
    function readForm() {
      const input = {};
      for (const [id, path, kind] of FORM_MAP) {
        const c = fmt[id]; if (!c) continue;
        if (kind === 2) setP(input, path, c.checked);
        else if (kind === 1) { if (c.value === "" || !Number.isFinite(Number(c.value))) continue; setP(input, path, Number(c.value)); }
        else setP(input, path, c.value);
      }
      // 폼은 제목 글꼴을 항상 따로 보내므로 본문 글꼴 따라가기는 일어나지 않는다.
      const { rules: r } = normalizeRules(input, rules);
      rules = r; applyPaperVars();
      afterChange("format", { history: false });
    }
    function setRules(input, message) {
      const { rules: r, fontNotices } = normalizeRules(input, rules);
      rules = r; applyPaperVars(); fillForm(); refreshNumbers();
      afterChange("format", { history: false });
      const subs = fontNotices.map((n) => `“${n.requested}”은(는) 쓸 수 없어 ${FONTS[n.font].label}(으)로 대체했어요.`);
      const uniq = [...new Set(subs)];
      if (fontNoticeEl) fontNoticeEl.replaceChildren(uniq.length ? RN.notice(uniq.join(" "), "warn") : "");
      if (uniq.length) RN.toast(uniq[0]); else if (message) RN.toast(message);
      return { rules: clone(rules), fontNotices };
    }
    function drawCheck() {
      if (!checkBox) return;
      const issues = checkFormat(model, rules);
      const fixable = issues.filter((i) => i.fixable).length;
      checkBox.replaceChildren(
        h("div", { class: "rn-row rn-between" }, h("h3", { id: "fmt-check-h" }, "서식 검사"),
          issues.length ? h("button", { type: "button", class: "rn-btn rn-small", id: "fmt-fix-all", disabled: !fixable || !!blocked, onclick: () => {
            const r = fixFormat(model, rules);
            model = r.doc; syncDom(); afterChange("struct");
            RN.toast(`${r.fixed}곳을 고쳤어요.${r.remaining.length ? ` 직접 고칠 곳 ${r.remaining.length}개가 남았어요.` : ""}`);
            drawCheck();
          } }, `모두 고치기${fixable ? ` (${fixable})` : ""}`) : null),
        h("p", { class: "rn-small rn-muted" }, issues.length ? `고칠 곳 ${issues.length}개 — 캡션·제목 단계·참조를 봐요.` : "규칙에서 벗어난 곳이 없어요."),
        h("div", { id: "fmt-issues" }, issues.map((it) => h("div", { class: "rn-issue", dataset: { code: it.code } },
          h("span", {}, it.message, it.fixable ? "" : h("span", { class: "rn-muted" }, " (직접 고치기)")),
          h("button", { type: "button", class: "rn-btn rn-ghost rn-small", onclick: () => { const b = model.blocks[it.block]; if (b) { const w = blkEl(b.id); if (w) w.scrollIntoView({ block: "center" }); focusBlock(b.id, null); } } }, "이동")))));
    }

    // --- 내보내기 패널 ---
    function drawExport() {
      const el = panels.export.el;
      const dl = RN.caps.downloads;
      const safeName = (title || "문서").replace(/[\\/:*?"<>|\n\r\t]+/g, " ").trim().slice(0, 80) || "문서";
      const save = async (filename, data) => {
        try { await dl.save({ filename, data }); RN.toast("파일을 저장했어요."); }
        catch (e) { if (e && e.code === "declined") return; RN.toast("저장하지 못했어요" + (e && e.code ? ` (${e.code})` : ""), "error"); }
      };
      bodyHtml(model, rules, { maxBytes: REPORT_LIMIT });
      const info = lastExportInfo;
      const svgFigs = model.blocks.filter((b) => b.type === "figure" && !(b.src && /^data:image\/(png|jpeg);/i.test(b.src))).length;
      el.replaceChildren(
        dl ? h("div", { class: "rn-stack", style: { gap: "8px" } },
          h("button", { type: "button", class: "rn-btn", id: "exp-docx", onclick: () => {
            try {
              const r = documentToDocx(title, model, rules);
              save(safeName + ".docx", new Blob([r.bytes], { type: DOCX_MIME }));
              if (r.omittedFigures) RN.toast(`SVG 등 그림 ${r.omittedFigures}개는 DOCX에 넣지 못해 캡션만 남겼어요.`);
            } catch (e) { console.error(e); RN.toast("DOCX를 만들지 못했어요.", "error"); }
          } }, "DOCX로 저장 (워드)"),
          h("button", { type: "button", class: "rn-btn", id: "exp-html", onclick: () => save(safeName + ".html", exportHtmlDocument(title, model, rules)) }, "HTML로 저장 (서식 반영)"),
          h("button", { type: "button", class: "rn-btn", id: "exp-md", onclick: () => save(safeName + ".md", documentToMarkdown(model, rules)) }, "Markdown으로 저장"))
          : RN.notice("이 화면에서는 파일 저장을 쓸 수 없어요.", "warn"),
        svgFigs ? h("p", { class: "rn-small rn-muted", id: "exp-docx-note" }, `그림 ${svgFigs}개(SVG 등)는 DOCX에 넣을 수 없어 캡션만 남아요.`) : null,
        h("p", { class: "rn-small rn-muted", id: "exp-pdf-note" }, "PDF는 HTML로 저장해 브라우저에서 열고 ‘인쇄 → PDF로 저장’을 고르세요."),
        h("p", { class: "rn-small rn-muted" }, `결과보고서로 쓸 때 본문 크기: ${Math.ceil(info.bytes / 1024)}KiB / 200KiB` + (info.omitted ? ` — 큰 그림 ${info.omitted}개가 빠져요.` : "")));
    }

    // --- 버전 기록 패널 ---
    const REASON = { AUTO: "자동", MANUAL: "직접 저장", IMPORT: "가져오기" };
    async function manualSnapshot() {
      if (blocked) return;
      try { await snapshot("MANUAL"); RN.toast("버전을 저장했어요."); if (activeTab === "history") drawHistory(); }
      catch (e) { RN.toast(errText(e), "error"); }
    }
    async function drawHistory() {
      const el = panels.history.el;
      const list = h("div", { id: "ver-list" }, RN.notice("불러오는 중…"));
      el.replaceChildren(
        h("div", { class: "rn-row rn-between" }, h("span", { class: "rn-small rn-muted" }, "10분마다 자동으로, 최근 50개까지 남아요."),
          h("button", { type: "button", class: "rn-btn rn-small", id: "ver-save", disabled: !!blocked, onclick: manualSnapshot }, "버전 저장")),
        list);
      try {
        const s = await withTimeout(snapCol(docId).orderBy("createdAt", "desc").limit(MAX_SNAPSHOTS).get());
        if (!s.docs.length) { list.replaceChildren(RN.notice("아직 저장된 버전이 없어요.")); return; }
        list.replaceChildren(...s.docs.map((d) => { const v = d.data(); return h("div", { class: "rn-snap", dataset: { snapId: d.id } },
          h("span", {}, RN.fmtDateTime(v.createdAt), " ", RN.badge(v.label || REASON[v.reason] || v.reason, v.reason === "MANUAL" ? "accent" : null)),
          h("button", { type: "button", class: "rn-btn rn-small", disabled: !!blocked, onclick: () => restoreSnapshot(v) }, "복원")); }));
      } catch (e) { list.replaceChildren(RN.notice(errText(e), "error")); }
    }
    async function restoreSnapshot(v) {
      if (!(await RN.confirm(`${RN.fmtDateTime(v.createdAt)} 버전으로 되돌릴까요? 지금 내용은 버전 기록에 남겨 둬요.`, { okLabel: "복원" }))) return;
      try {
        await snapshot("AUTO", "복원 전");
        model = normalizeDoc(v.content); syncDom(); afterChange("struct");
        await ctrl.flush();
        RN.toast("복원했어요."); drawHistory();
      } catch (e) { RN.toast(errText(e), "error"); }
    }

    // ---------- RN.editor ----------
    /** 지금 선택(본문에 있으면 그것, 아니면 마지막 본문 선택). selectionchange는 키 입력보다 늦게 오므로 먼저 실제 선택을 읽는다. */
    function curSel() {
      const live = composing ? null : readSel();
      if (live) savedSel = live;
      if (!savedSel) return null;
      const lines = linesNow();
      const a = clampPt(lines, savedSel.a), b = clampPt(lines, savedSel.b);
      return { a, b, collapsed: !cmpPt(a, b) };
    }
    const validSel = curSel;
    const api = {
      docId, projectId,
      getDoc: () => ({ id: docId, projectId, title, content: clone(model), formatRules: clone(rules) }),
      insertText(text, opts) {
        if (blocked) return false;
        text = String(text == null ? "" : text);
        const s = validSel();
        if (opts && opts.replaceSelection && s && !s.collapsed) {
          const lines = linesEdit();
          let p = linesDelete(lines, s.a, s.b);
          p = linesInsertMulti(lines, p, text);
          commit(lines, p, p, "struct");
          return true;
        }
        insertBlocks(looksMarkdown(text) ? markdownToBlocks(text) : textToBlocks(text));
        return true;
      },
      insertLatex(latex, opts) {
        if (blocked) return false;
        latex = String(latex || "").trim().replace(/^\$\$?|\$\$?$/g, "").trim();
        if (!latex) return false;
        if (opts && opts.display) insertBlocks([{ id: genId(), type: "math", latex }]);
        else insertAtomAtCaret({ t: "math", latex });
        return true;
      },
      insertTable({ header, rows, caption } = {}) {
        if (blocked) return null;
        const t = normalizeBlock({ id: genId(), type: "table", header: !!(header && header.length), rows: [...(header && header.length ? [header] : []), ...(rows || [])] });
        const blocks = [t];
        if (caption != null && caption !== false) {
          const cap = { id: genId(), type: "caption", kind: "table", content: normInline([{ t: "text", text: String(caption) }]) };
          if (captionPositions(rules).table === "above") blocks.unshift(cap); else blocks.push(cap);
        }
        insertBlocks(blocks);
        return t.id;
      },
      async insertFigure({ svg, dataUrl, caption, meta, alt } = {}) {
        if (blocked) return null;
        const fig = { id: genId(), type: "figure", alt: String(alt || caption || "그림").slice(0, 200) };
        if (svg) { const clean = sanitizeSvg(svg); if (!clean) throw new Error("SVG를 읽지 못했어요."); fig.svg = clean; }
        else if (dataUrl) { if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(dataUrl)) throw new Error("PNG·JPEG·GIF·WebP 그림만 넣을 수 있어요."); fig.src = await shrinkImage(dataUrl); }
        else throw new Error("그림이 없어요.");
        if (meta !== undefined) { try { fig.meta = clone(meta); } catch { /* 직렬화할 수 없는 meta는 버린다 */ } }
        const blocks = [fig];
        if (caption != null && caption !== false) {
          const cap = { id: genId(), type: "caption", kind: "figure", content: normInline([{ t: "text", text: String(caption) }]) };
          if (captionPositions(rules).figure === "above") blocks.unshift(cap); else blocks.push(cap);
        }
        insertBlocks(blocks);
        if (jsonBytes(fig) > 100 * 1024) RN.toast("큰 그림이라 문서 용량(256KiB)을 많이 차지해요.", "error");
        return fig.id;
      },
      getSelectionText() { const s = validSel(); return s && !s.collapsed ? linesText(linesNow(), s.a, s.b, numbering) : ""; },
      getDocText() { return model.blocks.map((b) => blockText(b, numbering)).filter(Boolean).join("\n\n"); },
      applyFormat(input) { if (blocked) return null; return setRules(isObj(input) ? input : {}, "서식을 적용했어요."); },
    };
    RN.editor = api;

    // ---------- 글쓰기 자동완성 연결 (mod-autocomplete.js) ----------
    const AC_TYPES = ["paragraph", "quote", "item"]; // 제목·캡션·코드·표 칸·수식에서는 쓰지 않는다
    const acLinePlain = (L) => (L.k === "atom" ? ({ table: "[표]", figure: "[그림]", math: "[수식]" }[L.type] || "") : inlPlain(L.content, numbering));
    const acBridge = {
      blocksEl, toolbar, blocked: !!blocked,
      setResetHandler(fn) { acReset = typeof fn === "function" ? fn : null; },
      /** 본문에 캐럿(접힌 선택)이 있으면 그 모델 위치, 아니면 null */
      caretPoint() {
        if (composing) return null;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
        const r = sel.getRangeAt(0);
        if (!blocksEl.contains(r.startContainer) || inSub(r.startContainer)) return null;
        const s = rangeToSel(r);
        return s && s.collapsed ? s.a : null;
      },
      /** 자동완성을 띄울 자리면 { key, point, slot, lineChars, before, title, section }, 아니면 null */
      context() {
        if (blocked || composing || popup || document.activeElement !== blocksEl) return null;
        const p = acBridge.caretPoint();
        if (!p) return null;
        const lines = linesNow();
        const L = lines[p.line];
        if (!L || L.k !== "text" || !AC_TYPES.includes(L.type) || p.off !== lineLen(L)) return null;
        const info = lineInfo(p.line);
        const el = info && blkEl(info.b.id);
        const slot = el && (info.b.type === "list" ? el.querySelector(`:scope > .rn-slot[data-item="${info.item}"]`) : el);
        if (!slot) return null;
        const lineText = inlPlain(L.content, numbering);
        const parts = [lineText];
        let total = lineText.length, section = "";
        for (let i = p.line - 1; i >= 0; i--) {
          const M = lines[i];
          if (!section && M.k === "text" && M.type === "heading") section = inlPlain(M.content, numbering);
          if (total < MAX_AC_BEFORE) { const t = acLinePlain(M); if (t) { parts.unshift(t); total += t.length + 1; } }
          if (section && total >= MAX_AC_BEFORE) break;
        }
        const before = parts.join("\n").slice(-MAX_AC_BEFORE);
        return { key: JSON.stringify([title, section, before]), point: p, slot, lineChars: lineText.replace(/\s/g, "").length, before, title, section };
      },
      /** 제안 글자를 캐럿 자리에 넣는다(편집 한 번 = 실행 취소 한 단계) */
      accept(text, ctx) {
        if (blocked || !text) return false;
        const lines = linesEdit();
        const p = linesInsertText(lines, clampPt(lines, ctx.point), String(text));
        commit(lines, p, p, "struct");
        return true;
      },
    };
    if (RN.autocomplete && typeof RN.autocomplete.attach === "function") {
      try { const c = RN.autocomplete.attach(acBridge); if (typeof c === "function") state.cleanups.push(c); }
      catch (e) { console.error(e); }
    }
    state.cleanups.push(() => {
      if (RN.editor === api) RN.editor = null;
      if (draftTimer) saveDraftNow();
      closePopup();
      const p = ctrl.flush();
      Promise.resolve(p).finally(() => ctrl.dispose());
    });

    // ---------- 시작 ----------
    applyPaperVars();
    syncDom();
    pushHistory("struct");
    checkSize();
    // 로컬 초안 복구 제안
    const draft = RN.local.get(draftKey, null);
    const decision = decideDraft(draft, { title: rec.title || "", content: rec.content, version: rec.version || 0 });
    if (decision.action === "offer" && !blocked) {
      const box = h("div", { class: "rn-notice rn-warn rn-stack", id: "ed-draft", role: "status" },
        h("p", {}, `저장되지 않은 초안이 이 기기에 남아 있어요 (${RN.fmtDateTime(draft.savedAt)}).` + (decision.serverChanged ? " 그 뒤에 서버 문서도 바뀌었어요." : "") + " 복구할까요?"),
        h("div", { class: "rn-row" },
          h("button", { type: "button", class: "rn-btn rn-primary", id: "ed-draft-restore", onclick: () => {
            title = draft.title || ""; titleInput.value = title; h1.textContent = title || "제목 없는 문서";
            model = normalizeDoc(draft.content); syncDom(); afterChange("struct"); box.remove(); RN.toast("초안을 복구했어요.");
          } }, "초안 복구"),
          h("button", { type: "button", class: "rn-btn", id: "ed-draft-discard", onclick: () => { RN.local.remove(draftKey); box.remove(); } }, "버리기")));
      bar.append(box);
    } else RN.local.remove(draftKey);
    const font = normalizeRules(rec.formatRules || DEFAULT_RULES).fontNotices;
    if (font.length) RN.toast(`“${font[0].requested}” 글꼴은 쓸 수 없어 ${FONTS[font[0].font].label}(으)로 대체했어요.`);
  }

  // =====================================================================
  // 11. 테스트용 순수 함수 노출
  // =====================================================================
  RN._test = Object.assign(RN._test || {}, {
    editor: {
      normalizeDoc, normInline, splitInline, computeNumbering, resolveRef, parseRefTrigger, filterRefTargets, captionList,
      normalizeRules, resolveFont, formatCssVars, PRESETS, DEFAULT_RULES, checkFormat, fixFormat,
      documentToMarkdown, bodyHtml, exportHtmlDocument, markdownToBlocks, textToBlocks, sanitizeSvg, sanitizeHtml, convertInlineMath, easyToLatex, latexToEasy,
      AutosaveController, SaveConflictError, SaveOfflineError, decideDraft, paths: P,
      documentToDocx, zipStore, crc32, flattenBlocks, unflattenLines, linesDelete, linesSplit, linesInsertMulti, linesToggleMark, linesSetType, linesText,
    },
  });
})();
