/* 고충 게시판 (담당 B) — 화면 pains, pain, pain-edit · RN.markdown · RN.pains · 프로젝트 홈 "내 고충" 섹션.
   고충은 한 번에 쓰는 글이다(댓글 없음). 다른 사람은 "나도 겪었어요"(공감)와 신고만 할 수 있다.
   익명 보호: 익명 글의 공유 문서(pains/{id}, 그 아래 예전에 달린 댓글)에는 작성자 id가 어디에도 남지 않는다.
   "내 글" 표시는 개인 영역 RN.userColl("myPains").doc(painId) = { createdAt, projectId|null } 에 둔다. */
(function () {
  "use strict";
  const RN = window.RN;
  const { h } = RN;

  const LIMITS = { title: 200, body: 20000, field: 100, tag: 30, tags: 10, resolution: 5000, reason: 1000 };
  const PAGE_SIZE = 20;

  RN.css("pains", `
    .rn-md { overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 10px; }
    .rn-md h3 { font-size: 1.15rem; } .rn-md h4 { font-size: 1.05rem; } .rn-md h5, .rn-md h6 { font-size: 0.95rem; }
    .rn-md ul, .rn-md ol { margin: 0; padding-left: 1.4em; }
    .rn-md li > .rn-md-block { margin-top: 4px; }
    .rn-md blockquote { margin: 0; padding: 2px 0 2px 12px; border-left: 3px solid var(--line); color: var(--muted); display: flex; flex-direction: column; gap: 8px; }
    .rn-md code { font-family: var(--font-mono); font-size: 0.88em; background: var(--surface-2); padding: 1px 4px; border-radius: 4px; }
    .rn-md pre { margin: 0; background: var(--surface-2); padding: 10px 12px; border-radius: var(--radius); overflow-x: auto; }
    .rn-md pre code { background: none; padding: 0; white-space: pre; }
    .rn-md hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
    .rn-md-img { color: var(--muted); font-size: 0.9em; }
    .rn-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    /* 목록: 카드 대신 구분선 */
    .rn-pain-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .rn-pain-card { padding: 14px 0; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .rn-pain-card + .rn-pain-card { border-top: 1px solid var(--line); }
    .rn-pain-card h2, .rn-pain-card h3 { font-size: 1rem; font-weight: 700; overflow-wrap: anywhere; }
    .rn-pain-card h2 a, .rn-pain-card h3 a { color: var(--fg); text-decoration: none; }
    .rn-pain-card h2 a:hover, .rn-pain-card h3 a:hover { color: var(--accent); text-decoration: underline; }
    .rn-pain-excerpt { color: var(--muted); font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .rn-pain-meta { color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
    .rn-pain-solved { color: var(--ok); font-weight: 600; }
    .rn-pain-tiny { font-size: 0.75rem; }
    /* 목록 도구 */
    .rn-pain-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .rn-pain-tools input[type="search"] { flex: 1 1 140px; width: auto; }
    .rn-pain-seg { display: inline-flex; }
    .rn-pain-seg .rn-btn { border-radius: 0; }
    .rn-pain-seg .rn-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
    .rn-pain-seg .rn-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; margin-left: -1px; }
    .rn-pain-filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr)); gap: 10px; align-items: end; }
    /* 상세 */
    .rn-pain-resolution { background: var(--ok-soft); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
    .rn-pain-resolution > strong { color: var(--ok); }
    .rn-pain-title { overflow-wrap: anywhere; }
    .rn-pain-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rn-pain-actions .rn-pain-menu-wrap { margin-left: auto; }
    .rn-pain-preview { border-left: 3px solid var(--line); padding: 4px 12px; }
    .rn-pain-dialog textarea { min-height: 120px; }
    .rn-pain-dialog { width: min(520px, calc(100vw - 32px)); }
    .rn-pain-more > summary { cursor: pointer; font-weight: 500; padding: 4px 0; }
    .rn-pain-more[open] > summary { margin-bottom: 10px; }
    .rn-pain-more > .rn-stack { padding-left: 2px; }
    /* ⋯ 메뉴 */
    .rn-pain-menu-wrap { position: relative; display: inline-block; }
    .rn-pain-menu-btn { min-width: 36px; font-weight: 700; letter-spacing: 1px; }
    .rn-pain-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 6; min-width: 9.5rem; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 4px; display: flex; flex-direction: column; box-shadow: 0 6px 18px color-mix(in srgb, var(--fg) 16%, transparent); }
    .rn-pain-menu[hidden] { display: none; }
    .rn-pain-menu-item { font: inherit; font-size: 0.9rem; text-align: left; background: none; border: 0; padding: 7px 10px; border-radius: 4px; color: var(--fg); cursor: pointer; white-space: nowrap; }
    .rn-pain-menu-item:hover, .rn-pain-menu-item:focus { background: var(--surface-2); outline: none; }
    .rn-pain-menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .rn-pain-menu-item:disabled { opacity: 0.5; cursor: not-allowed; }
    .rn-pain-menu-item.rn-pain-danger { color: var(--danger); }
  `);

  /** "⋯" 메뉴: 버튼(aria-haspopup) + role=menu. 화살표·Home·End로 이동, Esc로 닫고 버튼으로 돌아간다. → { el, open, close, isOpen } */
  function moreMenu(id, items, label) {
    const list = items.filter(Boolean);
    const btn = h("button", { type: "button", id, class: "rn-btn rn-ghost rn-pain-menu-btn", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": id + "-menu", "aria-label": label || "더 보기", title: label || "더 보기" }, "⋯");
    const menu = h("div", { class: "rn-pain-menu", role: "menu", id: id + "-menu", "aria-labelledby": id, hidden: true });
    const els = list.map((it) => h("button", { type: "button", role: "menuitem", id: it.id, tabIndex: -1, disabled: !!it.disabled,
      class: "rn-pain-menu-item" + (it.danger ? " rn-pain-danger" : ""),
      onclick: () => { close(true); it.onSelect(); } }, it.label));
    menu.append(...els);
    const wrap = h("div", { class: "rn-pain-menu-wrap" }, btn, menu);
    const usable = () => els.filter((e) => !e.disabled);
    function outside(e) {
      if (!wrap.isConnected) { document.removeEventListener("pointerdown", outside, true); return; }
      if (!wrap.contains(e.target)) close(false);
    }
    function open(focus) {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside, true);
      const u = usable();
      if (focus === "last") { if (u.length) u[u.length - 1].focus(); } else if (focus !== false && u.length) u[0].focus();
    }
    function close(refocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      if (refocus) btn.focus();
    }
    btn.addEventListener("click", () => (menu.hidden ? open() : close(true)));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); open(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); open("last"); }
      else if (e.key === "Escape") close(true);
    });
    menu.addEventListener("keydown", (e) => {
      const u = usable();
      const i = u.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); if (u.length) u[(i + 1) % u.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (u.length) u[(i - 1 + u.length) % u.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); if (u.length) u[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); if (u.length) u[u.length - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === "Tab") close(false);
    });
    return { el: wrap, open, close, isOpen: () => !menu.hidden };
  }

  // =====================================================================
  // 안전한 마크다운 렌더러 (DOM 노드를 직접 만든다. innerHTML 없음)
  // =====================================================================
  const RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const RE_QUOTE = /^ {0,3}>/;
  const RE_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+(.*))?$/;
  const MAX_DEPTH = 12;

  function isBlockStart(line) {
    return RE_FENCE.test(line) || RE_HEADING.test(line) || RE_HR.test(line) || RE_QUOTE.test(line) || listMatch(line);
  }
  function listMatch(line) {
    const m = RE_LIST.exec(line);
    if (!m) return null;
    if (m[3] === undefined && line.trim() !== m[2]) return null;
    return { indent: m[1].length, marker: m[2], ordered: /\d/.test(m[2]), text: m[4] || "", width: m[1].length + m[2].length + (m[3] ? Math.min(m[3].length - (m[4] || "").length, 4) : 1) };
  }
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;

  function parseBlocks(lines, depth) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (depth > MAX_DEPTH) { out.push(h("p", {}, lines.slice(i).join("\n"))); break; }
      let m;
      if ((m = RE_FENCE.exec(line))) {
        const fence = m[1];
        const body = [];
        i++;
        while (i < lines.length) {
          const t = lines[i].trim();
          if (t.length >= fence.length && t[0] === fence[0] && /^(`+|~+)$/.test(t)) { i++; break; }
          body.push(lines[i]);
          i++;
        }
        out.push(h("pre", {}, h("code", {}, body.join("\n"))));
        continue;
      }
      if ((m = RE_HEADING.exec(line))) {
        const level = m[1].length;
        out.push(h("h" + Math.min(6, level + 2), {}, inline(m[2] || "", 0)));
        i++;
        continue;
      }
      if (RE_HR.test(line)) { out.push(h("hr")); i++; continue; }
      if (RE_QUOTE.test(line)) {
        const inner = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) { inner.push(lines[i].replace(/^ {0,3}> ?/, "")); i++; }
        out.push(h("blockquote", {}, parseBlocks(inner, depth + 1)));
        continue;
      }
      const lm = listMatch(line);
      if (lm) {
        const res = parseList(lines, i, lm, depth);
        out.push(res.node);
        i = res.next;
        continue;
      }
      // 문단
      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) { para.push(lines[i].trim()); i++; }
      out.push(h("p", {}, inline(para.join("\n"), 0)));
    }
    return out;
  }

  function parseList(lines, start, first, depth) {
    const list = h(first.ordered ? "ol" : "ul");
    if (first.ordered) { const n = parseInt(first.marker, 10); if (n !== 1) list.setAttribute("start", String(n)); }
    let i = start;
    let loose = false;
    const items = [];
    while (i < lines.length) {
      const lm = listMatch(lines[i]);
      if (!lm || lm.ordered !== first.ordered || lm.indent > first.indent + 3) break;
      const content = [lm.text];
      const width = lm.width;
      i++;
      let sawBlank = false;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // 빈 줄 다음이 들여쓴 줄이면 같은 항목, 아니면 항목 끝
          let j = i; while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && indentOf(lines[j]) >= Math.max(2, width)) { content.push(""); sawBlank = true; i++; continue; }
          break;
        }
        const ind = indentOf(l);
        if (ind >= Math.max(2, width)) { content.push(l.slice(Math.min(ind, width))); i++; continue; }
        if (listMatch(l) || isBlockStart(l)) break;
        if (sawBlank) break;
        content.push(l); // 느슨한 이어 쓰기
        i++;
      }
      if (sawBlank) loose = true;
      items.push(content);
      // 항목 사이 빈 줄
      if (i < lines.length && !lines[i].trim()) {
        let j = i; while (j < lines.length && !lines[j].trim()) j++;
        const nm = j < lines.length ? listMatch(lines[j]) : null;
        if (nm && nm.ordered === first.ordered && nm.indent <= first.indent + 3) { loose = true; i = j; continue; }
        break;
      }
    }
    for (const content of items) {
      const blocks = parseBlocks(content, depth + 1);
      const li = h("li");
      for (const b of blocks) {
        if (!loose && b.tagName === "P") li.append(...b.childNodes);
        else li.append(b);
      }
      list.append(li);
    }
    return { node: list, next: i };
  }

  /** http/https/mailto 만 허용. 그 밖은 null(링크로 만들지 않는다). */
  function safeHref(raw) {
    const s = String(raw || "").replace(/[\u0000- \u007f-\u009f]/g, "");
    if (!/^(https?:\/\/|mailto:)/i.test(s)) return null;
    try {
      const u = new URL(s);
      return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : null;
    } catch { return null; }
  }
  function linkNode(href, children) {
    return h("a", { href, rel: "nofollow noopener noreferrer ugc", target: "_blank" }, children);
  }

  /** [텍스트](주소 "제목") — 성공하면 { label, dest, end } */
  function parseLink(src, i) {
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "\\") { j++; continue; }
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) break; }
      else if (c === "\n" && src[j + 1] === "\n") return null;
    }
    if (j >= src.length || src[j + 1] !== "(") return null;
    const label = src.slice(i + 1, j);
    let k = j + 2;
    while (src[k] === " ") k++;
    let dest = "";
    if (src[k] === "<") {
      const close = src.indexOf(">", k);
      if (close < 0) return null;
      dest = src.slice(k + 1, close);
      k = close + 1;
    } else {
      let p = 0;
      const s0 = k;
      for (; k < src.length; k++) {
        const c = src[k];
        if (c === "\\") { k++; continue; }
        if (/\s/.test(c)) break;
        if (c === "(") p++;
        else if (c === ")") { if (p === 0) break; p--; }
      }
      dest = src.slice(s0, k);
    }
    while (src[k] === " ") k++;
    if (src[k] === '"' || src[k] === "'") {
      const q = src[k];
      const close = src.indexOf(q, k + 1);
      if (close < 0) return null;
      k = close + 1;
      while (src[k] === " ") k++;
    }
    if (src[k] !== ")") return null;
    return { label, dest, end: k + 1 };
  }

  const WORD = /[\p{L}\p{N}]/u;
  function findClose(src, from, delim) {
    for (let j = from; j <= src.length - delim.length; j++) {
      if (src[j] === "\\") { j++; continue; }
      if (src[j] === "`") { // 코드 구간은 건너뛴다
        let n = 0; while (src[j + n] === "`") n++;
        const close = src.indexOf("`".repeat(n), j + n);
        if (close > 0) { j = close + n - 1; continue; }
      }
      if (src.startsWith(delim, j) && !/\s/.test(src[j - 1] || " ")) {
        if (delim.length === 1 && (src[j + 1] === delim || src[j - 1] === delim)) continue;
        if (delim[0] === "_" && WORD.test(src[j + delim.length] || "")) continue;
        return j;
      }
    }
    return -1;
  }

  function inline(src, depth, noLinks) {
    const out = [];
    let buf = "";
    const flush = () => { if (buf) { out.push(document.createTextNode(buf)); buf = ""; } };
    if (depth > MAX_DEPTH) return [document.createTextNode(src)];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\" && i + 1 < src.length && /[!-/:-@[-`{-~]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
      if (c === "\\" && src[i + 1] === "\n") { flush(); out.push(h("br")); i += 2; continue; }
      if (c === "\n") { buf = buf.replace(/ +$/, ""); flush(); out.push(h("br")); i++; while (src[i] === " ") i++; continue; }
      if (c === "`") {
        let n = 0; while (src[i + n] === "`") n++;
        const tick = "`".repeat(n);
        let close = src.indexOf(tick, i + n);
        while (close >= 0 && src[close + n] === "`") { let m = close; while (src[m] === "`") m++; close = src.indexOf(tick, m); }
        if (close >= 0) {
          let code = src.slice(i + n, close).replace(/\n/g, " ");
          if (code.length > 2 && code[0] === " " && code[code.length - 1] === " " && code.trim()) code = code.slice(1, -1);
          flush(); out.push(h("code", {}, code)); i = close + n; continue;
        }
        buf += tick; i += n; continue;
      }
      if (c === "!" && src[i + 1] === "[") {
        const r = parseLink(src, i + 1);
        if (r) { flush(); out.push(h("span", { class: "rn-md-img" }, "(이미지" + (r.label.trim() ? ": " + r.label.trim() : "") + ")")); i = r.end; continue; }
        buf += c; i++; continue;
      }
      if (c === "[" && !noLinks) {
        const r = parseLink(src, i);
        if (r) {
          flush();
          const href = safeHref(r.dest);
          const kids = inline(r.label, depth + 1, true);
          out.push(href ? linkNode(href, kids) : h("span", {}, kids));
          i = r.end;
          continue;
        }
        buf += c; i++; continue;
      }
      if (c === "<" && !noLinks) {
        const m = /^<((?:https?|mailto):[^\s<>]*)>/i.exec(src.slice(i, i + 2100));
        const href = m && safeHref(m[1]);
        if (href) { flush(); out.push(linkNode(href, m[1])); i += m[0].length; continue; }
        buf += c; i++; continue;
      }
      if (c === "*" || c === "_" || c === "~") {
        let n = 0; while (src[i + n] === c) n++;
        const prev = src[i - 1] || " ";
        const intraword = c === "_" && WORD.test(prev);
        const next = src[i + n] || " ";
        if (!intraword && !/\s/.test(next)) {
          if (c === "~" && n >= 2) {
            const j = findClose(src, i + 2, "~~");
            if (j > i + 2) { flush(); out.push(h("s", {}, inline(src.slice(i + 2, j), depth + 1, noLinks))); i = j + 2; continue; }
          } else if (c !== "~") {
            if (n >= 2) {
              const d = c + c;
              const j = findClose(src, i + 2, d);
              if (j > i + 2) { flush(); out.push(h("strong", {}, inline(src.slice(i + 2, j), depth + 1, noLinks))); i = j + 2; continue; }
            }
            if (n === 1 || n >= 3) {
              const j = findClose(src, i + 1, c);
              if (j > i + 1) { flush(); out.push(h("em", {}, inline(src.slice(i + 1, j), depth + 1, noLinks))); i = j + 1; continue; }
            }
          }
        }
        buf += src.slice(i, i + n); i += n; continue;
      }
      if ((c === "h" || c === "H") && !noLinks && !WORD.test(src[i - 1] || " ")) {
        const m = /^https?:\/\/[^\s<>]+/i.exec(src.slice(i, i + 2100));
        if (m) {
          const url = m[0].replace(/[.,;:!?'")\]]+$/, "");
          const href = safeHref(url);
          if (href) { flush(); out.push(linkNode(href, url)); i += url.length; continue; }
        }
      }
      buf += c; i++;
    }
    flush();
    return out;
  }

  /** 마크다운 → DOM 노드(div.rn-md). 원시 HTML은 글자로, 이미지는 그리지 않고, 링크는 http/https/mailto만. */
  function markdown(source) {
    const text = String(source == null ? "" : source).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/\u0000/g, "\uFFFD");
    return h("div", { class: "rn-md" }, parseBlocks(text.split("\n"), 0));
  }
  RN.markdown = markdown;

  /** 목록용 한 줄 요약 */
  function excerpt(source, max = 160) {
    const t = String(source || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
  }

  // =====================================================================
  // 저장 도우미 — 문서당 한 번에 하나씩, 일시 오류는 한 번 재시도
  // =====================================================================
  const queues = new Map();
  function write(ref, op, data) {
    const key = ref.path;
    const prev = queues.get(key) || Promise.resolve();
    const run = async () => {
      const call = () => (op === "delete" ? ref.delete() : ref[op](data));
      try { return await call(); }
      catch (e) {
        if (e && e.code === "unavailable") { await new Promise((r) => setTimeout(r, 300 + Math.random() * 700)); return call(); }
        throw e;
      }
    };
    const p = prev.then(run, run);
    const tail = p.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return p;
  }
  function errMsg(e, what) {
    const code = e && e.code;
    const head = (what || "저장") + "하지 못했어요. ";
    if (code === "quota_exceeded") return head + "저장 공간이 가득 찼어요.";
    if (code === "invalid_argument" || code === "not_granted") return head + "쓰기 권한이 없거나 내용이 너무 길어요.";
    if (code === "resource_exhausted") return head + "요청이 너무 많아요. 잠시 뒤 다시 시도하세요.";
    if (code === "revoked") return head + "접근 권한이 바뀌었어요.";
    return head + "잠시 뒤 다시 시도하세요.";
  }
  const db = () => RN.caps.db;
  const painRef = (id) => db().doc("pains/" + id);
  const myRef = (id) => { const c = RN.userColl && RN.userColl("myPains"); return c ? c.doc(id) : null; };

  // =====================================================================
  // 내 글 표시(개인 영역) — 모듈 전체에서 한 번만 구독
  // =====================================================================
  const mine = { map: new Map(), loaded: false, listeners: new Set() };
  const emitMine = () => mine.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  function onMine(fn) { mine.listeners.add(fn); return () => mine.listeners.delete(fn); }
  RN.ready.then(() => {
    const col = RN.caps.db && RN.caps.uid && RN.userColl ? RN.userColl("myPains") : null;
    if (!col) { mine.loaded = true; emitMine(); return; }
    const timer = setTimeout(() => { if (!mine.loaded) { mine.loaded = true; emitMine(); } }, 10000);
    col.limit(1000).onSnapshot(
      (snap) => { clearTimeout(timer); mine.map = new Map(snap.docs.map((d) => [d.id, d.data() || {}])); mine.loaded = true; emitMine(); },
      () => { clearTimeout(timer); mine.loaded = true; emitMine(); },
    );
  });
  function isMine(p) {
    if (!p || !RN.caps.uid) return false;
    return mine.map.has(p.id) || (!!p.authorId && p.authorId === RN.caps.uid);
  }

  // =====================================================================
  // 공통 조각
  // =====================================================================
  const nameCache = {};
  /** 작성자 표시: 예시 → "예시 데이터", 익명 → "익명", 그 밖 → 이름(나중에 채움) */
  function authorLabel(p) {
    if (p.isExample) return h("span", {}, "예시 데이터");
    if (p.isAnonymous || !p.authorId) return h("span", {}, "익명");
    return h("span", { "data-rn-uid": p.authorId }, nameCache[p.authorId] || "…");
  }
  async function fillNames(root) {
    const spans = [...root.querySelectorAll("[data-rn-uid]")];
    const ids = [...new Set(spans.map((s) => s.dataset.rnUid))].filter((id) => !(id in nameCache));
    if (ids.length) Object.assign(nameCache, await RN.names(ids));
    for (const s of spans) s.textContent = nameCache[s.dataset.rnUid] || "이름 없음";
  }
  const stageLabel = (s) => RN.STAGES[s] || RN.STAGES.OTHER;
  const goPain = (id) => (e) => { if (e) e.preventDefault(); RN.go("pain", { id }); };

  /** 메타 한 줄: "실험 · 물리 · 공감 3 · 해결됨" (+ 끝에 작은 "예시"/"내 글") */
  function painMeta(p) {
    const parts = [stageLabel(p.stage), p.field || null, "공감 " + (p.meTooCount || 0)].filter(Boolean);
    return h("p", { class: "rn-pain-meta" },
      parts.join(" · "),
      p.resolved ? [" · ", h("span", { class: "rn-pain-solved" }, "해결됨")] : null,
      isMine(p) ? " · 내 글" : null,
      p.isExample ? [" · ", h("span", { class: "rn-pain-tiny" }, "예시")] : null);
  }

  function painCard(p, { compact } = {}) {
    return h("li", { class: "rn-pain-card", dataset: { painId: p.id } },
      h(compact ? "h3" : "h2", {}, h("a", { href: "#pains", onclick: goPain(p.id) }, p.title || "(제목 없음)")),
      h("p", { class: "rn-pain-excerpt" }, excerpt(p.body)),
      painMeta(p),
    );
  }

  function renderList(items) {
    const list = items || [];
    if (!list.length) return RN.notice("연결된 고충이 아직 없어요.");
    return h("ul", { class: "rn-pain-list" }, list.map((p) => painCard(p, { compact: true })));
  }

  function listFor({ researchId, projectId } = {}) {
    let list = RN.shared.pains.slice();
    if (researchId) list = list.filter((p) => p.researchId === researchId && !p.isAnonymous);
    if (projectId) list = list.filter((p) => (mine.map.get(p.id) || {}).projectId === projectId);
    if (!researchId && !projectId) list = list.filter((p) => !p.isAnonymous);
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  RN.pains = { listFor, renderList };

  function dataNotice(shared, emptyText) {
    if (shared.error === "signed_out") return RN.notice(RN.writeBlockedReason() || "로그인한 뒤에 볼 수 있어요.", "warn");
    if (shared.error === "timeout") return RN.notice("고충 목록을 아직 불러오지 못했어요. 연결 상태를 확인해 주세요.", "error");
    if (shared.error) return RN.notice("고충 목록을 불러오지 못했어요.", "error");
    return RN.notice(emptyText);
  }

  // =====================================================================
  // 화면: 목록
  // =====================================================================
  RN.view("pains", {
    title: "고충 게시판",
    mount(root) {
      const state = { sort: "latest", stage: "", field: "", tag: "", q: "", page: 1 };
      const blocked = RN.writeBlockedReason();
      const sel = (id, label, options, key) => {
        const s = h("select", { id, onchange: () => { state[key] = s.value; state.page = 1; syncFilterBtn(); draw(); } }, options.map(([v, t]) => h("option", { value: v }, t)));
        return { el: s, field: RN.field(label, s) };
      };
      const stage = sel("pains-stage", "연구 단계", [["", "전체"], ...Object.entries(RN.STAGES)], "stage");
      const field = sel("pains-field", "분야", [["", "전체"]], "field");
      const tag = sel("pains-tag", "태그", [["", "전체"]], "tag");
      const q = h("input", { type: "search", id: "pains-q", placeholder: "제목·본문 검색", autocomplete: "off",
        oninput: () => { state.q = q.value; state.page = 1; draw(); } });

      // 정렬: 두 버튼 전환
      const sortBtn = (value, label) => h("button", { type: "button", id: "pains-sort-" + value, class: "rn-btn", "aria-pressed": String(state.sort === value),
        onclick: () => { state.sort = value; state.page = 1; syncSort(); draw(); } }, label);
      const sortLatest = sortBtn("latest", "최신순"), sortPopular = sortBtn("popular", "공감순");
      const syncSort = () => { sortLatest.setAttribute("aria-pressed", String(state.sort === "latest")); sortPopular.setAttribute("aria-pressed", String(state.sort === "popular")); };

      // 필터: 버튼을 눌러야 펼쳐진다
      const filterBox = h("div", { class: "rn-stack", id: "pains-filters", hidden: true });
      const filterBtn = h("button", { type: "button", id: "pains-filter-toggle", class: "rn-btn", "aria-expanded": "false", "aria-controls": "pains-filters",
        onclick: () => { filterBox.hidden = !filterBox.hidden; filterBtn.setAttribute("aria-expanded", String(!filterBox.hidden)); } }, "필터");
      const clearBtn = h("button", { type: "button", id: "pains-filter-clear", class: "rn-btn rn-ghost", onclick: () => {
        state.stage = state.field = state.tag = ""; stage.el.value = field.el.value = tag.el.value = ""; state.page = 1; syncFilterBtn(); draw(); filterBtn.focus();
      } }, "필터 지우기");
      function syncFilterBtn() {
        const n = [state.stage, state.field, state.tag].filter(Boolean).length;
        filterBtn.textContent = n ? `필터 ${n}` : "필터";
        filterBtn.setAttribute("aria-label", n ? `필터 (${n}개 적용됨)` : "필터");
        clearBtn.hidden = !n;
      }
      filterBox.append(h("div", { class: "rn-pain-filters" }, stage.field, field.field, tag.field, h("div", {}, clearBtn)));
      syncFilterBtn();

      const status = h("p", { class: "rn-small rn-muted", role: "status", "aria-live": "polite" });
      const results = h("div", { class: "rn-stack" });

      root.append(
        h("div", { class: "rn-row rn-between" },
          h("h1", {}, "고충 게시판"),
          blocked ? null : h("button", { type: "button", id: "pains-new", class: "rn-btn rn-primary", onclick: () => RN.go("pain-edit", {}) }, "글쓰기")),
        blocked && RN.caps.db ? RN.notice("읽기 전용: " + blocked, "warn") : null,
        h("form", { class: "rn-stack", role: "search", onsubmit: (e) => e.preventDefault() },
          h("div", { class: "rn-pain-tools" },
            h("label", { for: "pains-q", class: "rn-sr" }, "검색"), q,
            h("div", { class: "rn-pain-seg", role: "group", "aria-label": "정렬" }, sortLatest, sortPopular),
            filterBtn),
          filterBox),
        status,
        results,
      );

      const fillOptions = (select, values, current) => {
        const want = ["", ...values];
        const have = [...select.options].map((o) => o.value);
        if (want.join("\u0001") === have.join("\u0001")) return;
        select.replaceChildren(...want.map((v) => h("option", { value: v }, v || "전체")));
        select.value = values.includes(current) ? current : "";
      };

      function filtered() {
        const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
        let list = RN.shared.pains.filter((p) =>
          (!state.stage || p.stage === state.stage) &&
          (!state.field || p.field === state.field) &&
          (!state.tag || (p.tags || []).includes(state.tag)) &&
          (!words.length || words.every((w) => ((p.title || "") + "\n" + (p.body || "")).toLowerCase().includes(w))));
        const byDate = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
        list.sort(state.sort === "popular" ? (a, b) => (b.meTooCount || 0) - (a.meTooCount || 0) || byDate(a, b) : byDate);
        return list;
      }

      function draw() {
        const sh = RN.shared;
        const fields = [...new Set(sh.pains.map((p) => p.field).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
        const tags = [...new Set(sh.pains.flatMap((p) => p.tags || []))].sort((a, b) => a.localeCompare(b, "ko"));
        fillOptions(field.el, fields, state.field);
        fillOptions(tag.el, tags, state.tag);
        state.field = field.el.value; state.tag = tag.el.value;
        syncFilterBtn();

        if (!sh.loaded.pains) { status.textContent = ""; results.replaceChildren(RN.notice("고충 목록을 불러오는 중…")); return; }
        const list = filtered();
        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        state.page = Math.min(Math.max(1, state.page), pages);
        if (!list.length) {
          status.textContent = "";
          const filteredOut = sh.pains.length > 0;
          results.replaceChildren(filteredOut ? RN.notice("조건에 맞는 고충이 없어요. 검색어나 필터를 바꿔 보세요.") : dataNotice(sh, "아직 올라온 고충이 없어요. 첫 글을 남겨 보세요."));
          return;
        }
        status.textContent = `${list.length}건 · ${state.page}/${pages}쪽`;
        const slice = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
        const ul = h("ul", { class: "rn-pain-list", id: "pains-list" }, slice.map((p) => painCard(p)));
        const pager = pages > 1 ? h("nav", { class: "rn-row rn-between", "aria-label": "쪽 이동" },
          h("button", { type: "button", id: "pains-prev", class: "rn-btn", disabled: state.page <= 1, onclick: () => { state.page--; draw(); window.scrollTo(0, 0); } }, "이전"),
          h("span", { class: "rn-small rn-muted" }, `${state.page} / ${pages}`),
          h("button", { type: "button", id: "pains-next", class: "rn-btn", disabled: state.page >= pages, onclick: () => { state.page++; draw(); window.scrollTo(0, 0); } }, "다음")) : null;
        results.replaceChildren(sh.error === "timeout" ? RN.notice("목록이 최신이 아닐 수 있어요.", "warn") : "", ul, pager || "");
      }

      const off1 = RN.onShared(draw);
      const off2 = onMine(draw);
      return () => { off1(); off2(); };
    },
  });

  // =====================================================================
  // 화면: 상세
  // =====================================================================
  function dialogForm({ title, label, id, required, maxLength, okLabel, initial }) {
    return new Promise((resolve) => {
      const ta = h("textarea", { id, maxLength, required: !!required }, initial || "");
      const err = h("p", { class: "rn-error rn-small", role: "alert" });
      const dlg = h("dialog", { class: "rn-dialog rn-pain-dialog", "aria-label": title });
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      dlg.append(h("form", { class: "rn-stack", novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        const v = ta.value.trim();
        if (required && !v) { err.textContent = label + "을(를) 입력해 주세요."; ta.focus(); return; }
        done(v);
      } },
      h("h2", {}, title), RN.field(label, ta), err,
      h("div", { class: "rn-row rn-end" },
        h("button", { type: "button", class: "rn-btn", onclick: () => done(null) }, "취소"),
        h("button", { type: "submit", class: "rn-btn rn-primary", id: id + "-ok" }, okLabel || "확인"))));
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });
      document.body.append(dlg);
      dlg.showModal();
      ta.focus();
    });
  }

  async function syncCount(painId, sub, field) {
    try {
      const snap = await db().collection(`pains/${painId}/${sub}`).limit(1000).get();
      await write(painRef(painId), "update", { [field]: snap.size });
    } catch { /* 글이 지워졌거나 권한이 없으면 숫자만 못 맞춘다 */ }
  }

  /* 상세 화면 구성: 뒤로 링크 → 제목 → 작성자·날짜·단계·분야·태그 → (해결됨이면) 해결 방법 → 본문 → 연결된 연구
     → 동작 한 줄("나도 겪었어요" + ⋯ 메뉴: 내 글이면 수정·해결됨 표시/취소·삭제, 남의 글이면 신고). 댓글 구역은 없다. */
  RN.view("pain", {
    title: "고충",
    nav: "pains",
    mount(root, params) {
      const id = params.id;
      const uid = RN.caps.uid;
      const blocked = RN.writeBlockedReason();
      const top = h("div", { class: "rn-stack" });
      const st = { reactions: null, busy: false, resolving: false };
      const subs = [];
      root.append(
        h("div", {}, h("button", { type: "button", class: "rn-link", onclick: () => RN.go("pains") }, "← 고충 목록")),
        top);

      const pain = () => RN.shared.pains.find((p) => p.id === id) || null;

      function drawTop() {
        const p = pain();
        const focusId = document.activeElement && document.activeElement.id;
        if (!id || (!p && RN.shared.loaded.pains)) {
          top.replaceChildren(h("h1", {}, "고충을 찾을 수 없어요"), RN.shared.error ? dataNotice(RN.shared, "") : RN.notice("지워졌거나 없는 글이에요."));
          return;
        }
        if (!p) { top.replaceChildren(h("h1", {}, "고충"), RN.notice("불러오는 중…")); return; }
        const own = isMine(p);
        const count = st.reactions ? st.reactions.size : p.meTooCount || 0;
        const reacted = !!(st.reactions && uid && st.reactions.has(uid));
        const research = p.researchId && !p.isAnonymous ? RN.shared.research.find((r) => r.id === p.researchId) : null;

        // 한 줄 동작: 주 동작은 "나도 겪었어요" 하나, 나머지는 ⋯ 메뉴 안
        const wasOpen = !!(st.menu && st.menu.isOpen());
        const actions = h("div", { class: "rn-pain-actions" });
        if (!blocked && !own) {
          actions.append(h("button", { type: "button", id: "pain-metoo", class: "rn-btn rn-primary", "aria-pressed": reacted ? "true" : "false", disabled: st.busy, onclick: toggleReaction },
            "나도 겪었어요 ", h("span", { id: "pain-metoo-count" }, String(count))));
        } else {
          actions.append(h("span", { class: "rn-small rn-muted", id: "pain-metoo-count-ro" }, "나도 겪었어요 " + count));
        }
        st.menu = null;
        if (!blocked) {
          const items = own ? [
            { id: "pain-edit", label: "수정", onSelect: () => RN.go("pain-edit", { id }) },
            p.resolved
              ? { id: "pain-unresolve", label: "해결 취소", disabled: st.busy, onSelect: unresolve }
              : { id: "pain-resolve", label: "해결됨으로 표시", disabled: st.busy, onSelect: resolve },
            { id: "pain-delete", label: "삭제", danger: true, disabled: st.busy, onSelect: remove },
          ] : [{ id: "pain-report", label: "신고", onSelect: report }];
          st.menu = moreMenu("pain-more", items, "글 메뉴");
          actions.append(st.menu.el);
        }

        const meta = [stageLabel(p.stage), p.field || null].filter(Boolean).join(" · ");
        top.replaceChildren(
          h("h1", { class: "rn-pain-title" }, p.title || "(제목 없음)"),
          h("p", { class: "rn-small rn-muted" }, authorLabel(p), " · ", RN.fmtDate(p.createdAt),
            p.updatedAt && p.updatedAt !== p.createdAt ? " (수정됨)" : "", " · ", meta,
            (p.tags || []).length ? " · " + p.tags.map((t) => "#" + t).join(" ") : "",
            own ? " · 내 글" : "", p.isExample ? " · 예시" : ""),
          p.resolved ? h("section", { class: "rn-pain-resolution", id: "pain-resolution-box", "aria-label": "해결 방법" },
            h("strong", {}, "해결됨 · 해결 방법"), markdown(p.resolution || "")) : null,
          h("article", { id: "pain-body" }, markdown(p.body || "")),
          p.researchId && !p.isAnonymous ? h("p", { class: "rn-small" }, "연결된 연구: ",
            h("button", { type: "button", id: "pain-research", class: "rn-link", onclick: () => RN.go("research", { id: p.researchId }) },
              research ? research.title : "연구 보기")) : null,
          blocked ? RN.notice("읽기 전용: " + blocked, "warn") : null,
          actions,
        );
        fillNames(top);
        if (wasOpen && st.menu) st.menu.open(false);
        if (focusId) { const el = document.getElementById(focusId); if (el && top.contains(el)) el.focus(); }
      }

      // --- 반응·신고·작성자 기능
      async function toggleReaction() {
        if (!uid || st.busy || !st.reactions) return;
        const had = st.reactions.has(uid);
        st.busy = true; drawTop();
        try {
          const ref = db().doc(`pains/${id}/reactions/${uid}`);
          if (had) await write(ref, "delete"); else await write(ref, "set", { createdAt: Date.now() });
          await syncCount(id, "reactions", "meTooCount");
        } catch (e) { RN.toast(errMsg(e, "반응을 저장"), "error"); }
        finally { st.busy = false; drawTop(); }
      }
      async function report() {
        const key = "pain-reported:" + id;
        if (RN.local.get(key, false)) { RN.toast("이미 신고한 글이에요."); return; }
        const reason = await dialogForm({ title: "이 글 신고하기", label: "신고 이유 (선택)", id: "pain-report-reason", maxLength: LIMITS.reason, okLabel: "신고" });
        if (reason == null) return;
        try {
          await write(db().collection("reports").doc(RN.newId()), "set", { painId: id, reason, createdAt: Date.now() });
          RN.local.set(key, true);
          RN.toast("신고했어요. 관리자가 검토합니다.");
        } catch (e) { RN.toast(errMsg(e, "신고를 저장"), "error"); }
      }
      async function resolve() {
        const p = pain();
        const text = await dialogForm({ title: "해결됨으로 표시", label: "해결 방법", id: "pain-resolution", required: true, maxLength: LIMITS.resolution, okLabel: "해결됨으로 표시", initial: p && p.resolution });
        if (!text) return;
        st.busy = true; drawTop();
        try { await write(painRef(id), "update", { resolved: true, resolution: text, updatedAt: Date.now() }); RN.toast("해결됨으로 표시했어요."); }
        catch (e) { RN.toast(errMsg(e), "error"); }
        finally { st.busy = false; drawTop(); }
      }
      async function unresolve() {
        if (!(await RN.confirm("해결됨 표시를 취소할까요? 해결 방법도 지워져요.", { okLabel: "해결 취소" }))) return;
        st.busy = true; drawTop();
        try { await write(painRef(id), "update", { resolved: false, resolution: null, updatedAt: Date.now() }); }
        catch (e) { RN.toast(errMsg(e), "error"); }
        finally { st.busy = false; drawTop(); }
      }
      async function remove() {
        if (!(await RN.confirm("이 고충을 지울까요? 공감 기록도 함께 지워져요.", { okLabel: "삭제", danger: true }))) return;
        st.busy = true; drawTop();
        try {
          await write(painRef(id), "delete");
        } catch (e) { st.busy = false; drawTop(); RN.toast(errMsg(e, "삭제"), "error"); return; }
        // 딸린 문서는 최대한 지운다(실패해도 글은 이미 지워졌다). comments는 예전에 달린 댓글 정리용
        for (const sub of ["comments", "reactions"]) {
          try {
            const snap = await db().collection(`pains/${id}/${sub}`).limit(1000).get();
            for (const d of snap.docs) { try { await write(db().doc(`pains/${id}/${sub}/${d.id}`), "delete"); } catch { /* 무시 */ } }
          } catch { /* 무시 */ }
        }
        const mr = myRef(id);
        if (mr) { try { await write(mr, "delete"); } catch { /* 무시 */ } }
        RN.toast("고충을 지웠어요.");
        RN.go("pains");
      }

      // --- 구독
      if (id && RN.caps.db) {
        subs.push(db().collection(`pains/${id}/reactions`).limit(1000).onSnapshot(
          (snap) => { st.reactions = new Set(snap.docs.map((d) => d.id)); drawTop(); },
          () => { st.reactions = null; drawTop(); }));
      }
      subs.push(RN.onShared(() => { drawTop(); }));
      subs.push(onMine(() => { drawTop(); }));
      return () => subs.forEach((f) => f());
    },
  });

  // =====================================================================
  // 화면: 작성·수정
  // =====================================================================
  function parseTags(raw) {
    const out = [];
    for (const t of String(raw || "").split(/[,\n]/)) {
      const v = t.trim().replace(/^#+/, "").trim();
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  }

  RN.view("pain-edit", {
    title: "고충 쓰기",
    nav: "pains",
    mount(root, params) {
      const editId = params.id || null;
      const uid = RN.caps.uid;
      const blocked = RN.writeBlockedReason();
      const heading = h("h1", {}, editId ? "고충 수정" : "고충 쓰기");
      const body = h("div", { class: "rn-stack" });
      root.append(h("div", {}, h("button", { type: "button", class: "rn-link", onclick: () => (editId ? RN.go("pain", { id: editId }) : RN.go("pains")) }, "← 돌아가기")), heading, body);
      if (blocked) { body.append(RN.notice(blocked, "warn")); return null; }

      let built = false;
      const subs = [];
      const tryBuild = () => {
        if (built) return;
        if (editId) {
          if (!RN.shared.loaded.pains || !mine.loaded) { body.replaceChildren(RN.notice("불러오는 중…")); return; }
          const p = RN.shared.pains.find((x) => x.id === editId);
          if (!p) { body.replaceChildren(RN.notice("지워졌거나 없는 글이에요.", "error")); return; }
          if (!isMine(p)) { body.replaceChildren(RN.notice("내가 쓴 글만 고칠 수 있어요.", "error")); return; }
          built = true; build(p);
        } else { built = true; build(null); }
      };

      function build(p) {
        const myEntry = p ? mine.map.get(p.id) || {} : {};
        const title = h("input", { type: "text", id: "pain-title", maxLength: LIMITS.title, required: true, value: p ? p.title : "", autocomplete: "off" });
        const text = h("textarea", { id: "pain-body", maxLength: LIMITS.body, required: true, rows: 10 }, p ? p.body : "");
        const preview = h("div", { class: "rn-pain-preview", id: "pain-preview", hidden: true, "aria-live": "polite" });
        const previewBtn = h("button", { type: "button", class: "rn-btn rn-ghost rn-small", id: "pain-preview-toggle", "aria-pressed": "false", onclick: () => {
          const on = preview.hidden;
          preview.hidden = !on;
          previewBtn.setAttribute("aria-pressed", on ? "true" : "false");
          if (on) preview.replaceChildren(text.value.trim() ? markdown(text.value) : RN.notice("미리 볼 내용이 없어요."));
        } }, "미리보기");
        text.addEventListener("input", () => { if (!preview.hidden) preview.replaceChildren(markdown(text.value)); });
        const stage = h("select", { id: "pain-stage" }, Object.entries(RN.STAGES).map(([k, v]) => h("option", { value: k, selected: (p ? p.stage : "OTHER") === k }, v)));
        const fields = [...new Set(RN.shared.pains.map((x) => x.field).filter(Boolean))];
        const field = h("input", { type: "text", id: "pain-field", maxLength: LIMITS.field, list: "pain-field-list", value: p ? p.field || "" : "", placeholder: "예: 물리, 생명과학" });
        const fieldList = h("datalist", { id: "pain-field-list" }, fields.map((f) => h("option", { value: f })));
        const tags = h("input", { type: "text", id: "pain-tags", value: p ? (p.tags || []).join(", ") : "", placeholder: "쉼표로 구분 (예: 통계, 설문)" });
        const anon = h("input", { type: "checkbox", id: "pain-anon", checked: p ? !!p.isAnonymous : false });
        const myResearch = RN.shared.research.filter((r) => uid && r.authorId === uid);
        const wantResearch = p ? p.researchId : params.researchId || null;
        const research = h("select", { id: "pain-research" },
          h("option", { value: "" }, "연결 안 함"),
          myResearch.map((r) => h("option", { value: r.id, selected: r.id === wantResearch }, r.title || "(제목 없음)")));
        const researchHint = h("small", { id: "pain-research-hint" });
        let projectSel = null;
        const projectWrap = h("div");
        const wantProject = p ? myEntry.projectId || null : params.projectId || null;
        if (RN.docs && typeof RN.docs.listProjects === "function") {
          Promise.resolve().then(() => RN.docs.listProjects()).then((list) => {
            const projects = (list || []).filter((x) => x && !x.deletedAt);
            projectSel = h("select", { id: "pain-project" }, h("option", { value: "" }, "연결 안 함"),
              projects.map((x) => h("option", { value: x.id, selected: x.id === wantProject }, x.title || "(제목 없음)")));
            if (wantProject && !projects.some((x) => x.id === wantProject)) projectSel.append(h("option", { value: wantProject, selected: true }, "현재 프로젝트"));
            projectWrap.replaceChildren(RN.field("연결할 내 프로젝트 (나만 보여요)", projectSel));
          }).catch(() => {});
        } else if (wantProject) {
          projectWrap.append(h("p", { class: "rn-small rn-muted" }, "이 고충은 내 프로젝트에 연결돼요(나만 보여요)."));
        }
        const syncAnon = () => {
          research.disabled = anon.checked || !myResearch.length;
          if (anon.checked) research.value = "";
          researchHint.textContent = anon.checked ? "익명 글은 공개 연구에 연결할 수 없어요(작성자가 드러나요)."
            : !myResearch.length ? "내가 공개한 연구가 없어요." : "내가 공개한 연구만 고를 수 있어요.";
        };
        anon.addEventListener("change", syncAnon);
        syncAnon();
        const err = h("p", { class: "rn-error", role: "alert", id: "pain-form-error" });
        const save = h("button", { type: "submit", class: "rn-btn rn-primary", id: "pain-save" }, editId ? "저장" : "올리기");

        // 필수(제목·본문·단계)만 먼저, 나머지는 "추가 설정" 안에
        const moreHint = h("span", { class: "rn-small rn-muted", id: "pain-more-hint" });
        const syncHint = () => {
          const set = [field.value.trim() ? "분야" : null, parseTags(tags.value).length ? "태그" : null, anon.checked ? "익명" : null,
            research.value ? "연구 연결" : null, (projectSel ? projectSel.value : wantProject) ? "프로젝트 연결" : null].filter(Boolean);
          moreHint.textContent = set.length ? " · " + set.join(", ") : "";
        };
        const more = h("details", { class: "rn-pain-more", id: "pain-more-settings",
          open: !!(p && (p.field || (p.tags || []).length || p.isAnonymous || p.researchId)) || !!params.researchId },
          h("summary", {}, "추가 설정", moreHint),
          h("div", { class: "rn-stack" },
            h("div", { class: "rn-pain-filters" }, RN.field("분야", field), RN.field("태그", tags, "쉼표로 구분, 최대 10개")),
            fieldList,
            h("div", { class: "rn-row" }, anon, h("label", { for: "pain-anon" }, "익명으로 올리기")),
            h("div", { class: "rn-field" }, h("label", { for: "pain-research" }, "연결할 연구"), research, researchHint),
            projectWrap));
        [field, tags].forEach((el) => el.addEventListener("input", syncHint));
        [anon, research].forEach((el) => el.addEventListener("change", syncHint));
        projectWrap.addEventListener("change", syncHint);
        const openMore = () => { more.open = true; };

        const form = h("form", { class: "rn-stack", novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
          RN.field("제목", title),
          h("div", { class: "rn-field" }, h("div", { class: "rn-row rn-between" }, h("label", { for: "pain-body" }, "본문"), previewBtn), text, preview),
          h("div", { class: "rn-pain-filters" }, RN.field("연구 단계", stage)),
          more,
          err,
          h("div", { class: "rn-row rn-end" }, save));
        body.replaceChildren(form);
        syncHint();
        title.focus();

        async function submit() {
          err.textContent = "";
          const t = title.value.trim(), b = text.value.trim();
          const tagList = parseTags(tags.value);
          if (!t) { err.textContent = "제목을 입력해 주세요."; title.focus(); return; }
          if (!b) { err.textContent = "본문을 입력해 주세요."; text.focus(); return; }
          if (tagList.length > LIMITS.tags) { err.textContent = `태그는 ${LIMITS.tags}개까지 넣을 수 있어요.`; openMore(); tags.focus(); return; }
          if (tagList.some((x) => x.length > LIMITS.tag)) { err.textContent = `태그 하나는 ${LIMITS.tag}자까지예요.`; openMore(); tags.focus(); return; }
          const isAnonymous = anon.checked;
          const researchId = isAnonymous ? null : research.value || null;
          if (researchId && !myResearch.some((r) => r.id === researchId)) { err.textContent = "내가 공개한 연구만 연결할 수 있어요."; openMore(); return; }
          const projectId = projectSel ? projectSel.value || null : wantProject;
          const now = Date.now();
          const data = { title: t, body: b, stage: stage.value, field: field.value.trim(), tags: tagList, isAnonymous, authorId: isAnonymous ? null : uid, researchId, updatedAt: now };
          save.disabled = true;
          try {
            if (!editId) {
              const id = RN.newId();
              // 개인 표시를 먼저: 익명 글도 나중에 내가 고칠 수 있게
              await write(myRef(id), "set", { createdAt: now, projectId });
              await write(painRef(id), "set", { ...data, resolved: false, resolution: null, createdAt: now, meTooCount: 0 });
              RN.toast("고충을 올렸어요.");
              RN.go("pain", { id });
            } else {
              const wasNamed = !p.isAnonymous;
              await write(painRef(editId), "update", data);
              if (isAnonymous && wasNamed) await scrubComments(editId);
              const mr = myRef(editId);
              if (mr && (!mine.map.has(editId) || (myEntry.projectId || null) !== projectId)) {
                await write(mr, "set", { createdAt: myEntry.createdAt || p.createdAt || now, projectId });
              }
              RN.toast("고친 내용을 저장했어요.");
              RN.go("pain", { id: editId });
            }
          } catch (e) {
            err.textContent = errMsg(e);
            RN.toast(errMsg(e), "error");
          } finally { save.disabled = false; }
        }
      }

      /** 실명 → 익명으로 바꿀 때 예전에 내가 단 댓글 문서의 작성자 id를 지운다(화면엔 안 보여도 db에 남아 있을 수 있다) */
      async function scrubComments(painId) {
        const snap = await db().collection(`pains/${painId}/comments`).limit(500).get();
        for (const d of snap.docs) {
          if ((d.data() || {}).authorId === uid) await write(db().doc(`pains/${painId}/comments/${d.id}`), "update", { authorId: null, isPostAuthor: true });
        }
      }

      subs.push(RN.onShared(tryBuild), onMine(tryBuild));
      tryBuild();
      return () => subs.forEach((f) => f());
    },
  });

  // =====================================================================
  // 프로젝트 홈 섹션: 내 고충
  // =====================================================================
  (RN.projectSections = RN.projectSections || []).push({
    id: "pains",
    label: "고충",
    mount(container, project) {
      const pid = project && project.id;
      const box = h("div", { class: "rn-stack" });
      const blocked = RN.writeBlockedReason();
      container.append(h("div", { class: "rn-stack", role: "region", "aria-label": "내 고충" },
        h("div", { class: "rn-row rn-between" },
          h("p", { class: "rn-small rn-muted" }, "이 프로젝트에 연결한 내 고충 (연결은 나만 보여요)"),
          blocked ? null : h("button", { type: "button", class: "rn-btn", id: "project-pain-new", onclick: () => RN.go("pain-edit", { projectId: pid }) }, "글쓰기")),
        box));
      let seen = false;
      const draw = () => {
        if (container.isConnected) seen = true;
        else if (seen) { offs.forEach((f) => f()); return; }
        if (!RN.shared.loaded.pains || !mine.loaded) { box.replaceChildren(RN.notice("불러오는 중…")); return; }
        const items = listFor({ projectId: pid });
        box.replaceChildren(items.length ? renderList(items) : RN.notice("이 프로젝트에 연결한 고충이 아직 없어요."));
      };
      const offs = [];
      offs.push(RN.onShared(draw), onMine(draw));
      return () => offs.forEach((f) => f());
    },
  });
})();
