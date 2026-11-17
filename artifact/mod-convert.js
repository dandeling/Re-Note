/* mod-convert.js (담당 D) — 한글 파일(.hwp, .hwpx) 열기·가져오기, 프로젝트 홈 "가져오기" 섹션. 계약: CONTRACT.md
   외부 엔진 없이 브라우저에서 직접 읽는다.
   - HWP 5.x: Compound File(CFB/OLE2) → FileHeader → DocInfo(스타일·문단 모양) → BodyText/SectionN(raw deflate) → 레코드 트리 → 문단·표
   - HWPX: zip(중앙 디렉터리 → 로컬 헤더, 저장/deflate) → Contents/header.xml(스타일) + Contents/sectionN.xml → 문단·표
   글자·표·그림을 뽑는다(쪽 배치·글꼴은 다루지 않는다). 그림은 HWP의 BinData 스트림 / HWPX의 BinData/ 항목에서
   그림 개체가 가리키는 것만, 머리 바이트로 확인한 래스터 형식(PNG·JPEG·GIF·WebP, BMP는 PNG로 바꿈)만 쓴다.
   순수 함수는 RN._convert 로 노출. */
(function () {
  "use strict";
  const RN = window.RN;
  if (!RN) return;
  const h = RN.h;
  const MAX_FILE = 50 * 1024 * 1024;
  const MAX_INFLATED = 400 * 1024 * 1024; // 압축 폭탄 방지(풀린 크기 합)
  const MAX_IMAGES = 200; // 파일 하나에서 꺼내는 그림 수
  const MAX_IMAGE_BYTES = 60 * 1024 * 1024; // 꺼내는 그림 크기 합

  // =====================================================================
  // 오류
  // =====================================================================
  const MESSAGES = {
    not_hwp: "HWP나 HWPX 파일이 아니에요. 한글(.hwp, .hwpx) 파일을 골라 주세요.",
    old_hwp: "한글 97 이전(HWP 3.0 이하)의 옛 형식이라 열 수 없어요. 한글에서 .hwp(5.0)나 .hwpx로 다시 저장해 주세요.",
    bad_file: "파일이 손상되어 열 수 없어요. 원본 프로그램에서 다시 저장해 보세요.",
    encrypted: "암호가 걸린 문서라 열 수 없어요. 한글에서 암호를 풀고 다시 저장해 주세요.",
    distribution: "배포용 문서라 열 수 없어요. 한글에서 일반 문서로 저장해 주세요.",
    too_large: "파일이 너무 커서 열 수 없어요(50MB까지).",
    unsupported: "이 브라우저에서는 압축된 한글 파일을 열 수 없어요. 최신 브라우저에서 다시 해 보세요.",
  };
  function fail(code, detail) {
    const e = new Error(MESSAGES[code] || MESSAGES.bad_file);
    e.code = code;
    if (detail) e.detail = detail;
    throw e;
  }

  // =====================================================================
  // 바이트 도우미
  // =====================================================================
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
  const utf16 = new TextDecoder("utf-16le");
  const utf8 = new TextDecoder("utf-8");
  const fourCC = (b, o) => String.fromCharCode(b[o + 3], b[o + 2], b[o + 1], b[o]); // HWP 컨트롤 id는 거꾸로 저장된다
  const ascii = (b, o, n) => { let s = ""; for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
  const toBytes = (x) => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(0));

  /** 머리 바이트로 형식 판별: "hwp"(CFB), "hwpx"(zip), "hwp3"(HWP 3.0 이하), 그 밖은 null */
  function sniff(input) {
    const b = toBytes(input);
    if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1) return "hwp";
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "hwpx";
    if (b.length >= 17 && ascii(b, 0, 17) === "HWP Document File") return "hwp3";
    return null;
  }

  // 화면을 멈추지 않게 오래 걸리는 반복 중간에 양보한다
  function makeTicker(onProgress) {
    let last = (typeof performance !== "undefined" ? performance.now() : Date.now());
    return async (fraction) => {
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      if (now - last < 24) return;
      if (onProgress && fraction != null) { try { onProgress(Math.max(0, Math.min(1, fraction))); } catch { /* 무시 */ } }
      await new Promise((r) => setTimeout(r, 0));
      last = (typeof performance !== "undefined" ? performance.now() : Date.now());
    };
  }

  /**
   * raw deflate 풀기 → { data, complete }.
   * 한글이 저장한 스트림은 deflate 끝 뒤에 8바이트(체크섬 4 + 풀린 크기 4)가 더 붙어 있다. 브라우저는 그 군더더기를
   * 오류로 보고 마지막 출력까지 버리므로, 꼬리 8바이트를 떼고 먼저 풀어 본다(풀린 크기가 꼬리의 값과 같으면 성공).
   */
  async function inflateRaw(bytes, budget) {
    if (bytes.length > 8) {
      const tailSize = u32(bytes, bytes.length - 4);
      if (tailSize > 0 && (!budget || tailSize <= budget.left)) {
        const r = await inflateOnce(bytes.subarray(0, bytes.length - 8), budget);
        if (r.complete && r.data.length === tailSize) return r;
        if (budget) budget.left += r.data.length;
      }
    }
    const r = await inflateOnce(bytes, budget);
    if (r.complete || bytes.length <= 8) return r;
    // 꼬리 크기를 모르는 군더더기: 떼고 다시 풀어 더 많이 나온 쪽을 쓴다
    if (budget) budget.left += r.data.length;
    const r2 = await inflateOnce(bytes.subarray(0, bytes.length - 8), budget);
    if (r2.complete || r2.data.length >= r.data.length) return r2;
    if (budget) budget.left += r2.data.length - r.data.length;
    return r;
  }
  async function inflateOnce(bytes, budget) {
    if (typeof DecompressionStream === "undefined") fail("unsupported");
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0, complete = true;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (budget && total > budget.left) { try { reader.cancel(); } catch { /* 무시 */ } fail("too_large"); }
      }
    } catch (e) {
      if (e && e.code === "too_large") throw e;
      complete = false;
    }
    if (budget) budget.left -= total;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return { data: out, complete };
  }

  // =====================================================================
  // Compound File Binary (OLE2) 읽기
  // =====================================================================
  const ENDCHAIN = 0xfffffffa; // 이 값 이상은 특수 표시(끝·빈 칸 등)
  function readCfb(b) {
    if (b.length < 512 || sniff(b) !== "hwp") fail("bad_file", "cfb header");
    const shift = u16(b, 0x1e), miniShift = u16(b, 0x20);
    if ((shift !== 9 && shift !== 12) || miniShift !== 6) fail("bad_file", "sector size");
    const ss = 1 << shift, mss = 1 << miniShift;
    const maxSectors = Math.ceil((b.length - 512) / ss) + 1;
    const nFat = u32(b, 0x2c), dirStart = u32(b, 0x30), cutoff = u32(b, 0x38);
    const miniFatStart = u32(b, 0x3c), nMiniFat = u32(b, 0x40);
    let difat = u32(b, 0x44);
    if (nFat > maxSectors || nMiniFat > maxSectors) fail("bad_file", "fat count");
    const sectorOff = (n) => (n + 1) * ss; // v3: 512바이트 헤더, v4: 4096바이트 헤더 = 한 섹터

    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(u32(b, 0x4c + i * 4));
    let guard = 0;
    while (fatSectors.length < nFat && difat < ENDCHAIN) {
      if (++guard > maxSectors || sectorOff(difat) + ss > b.length) fail("bad_file", "difat");
      const o = sectorOff(difat);
      for (let k = 0; k < ss / 4 - 1 && fatSectors.length < nFat; k++) fatSectors.push(u32(b, o + k * 4));
      difat = u32(b, o + ss - 4);
    }
    const per = ss / 4;
    const fat = new Uint32Array(fatSectors.length * per);
    fatSectors.forEach((s, i) => {
      const o = sectorOff(s);
      if (s >= ENDCHAIN || o + ss > b.length) fail("bad_file", "fat sector");
      for (let k = 0; k < per; k++) fat[i * per + k] = u32(b, o + k * 4);
    });

    function chain(start, table, limit) {
      const out = [];
      let s = start;
      while (s < ENDCHAIN) {
        if (s >= table.length || out.length > limit) fail("bad_file", "chain");
        out.push(s);
        s = table[s];
      }
      return out;
    }
    function readBig(start, size) {
      const secs = chain(start, fat, maxSectors);
      const want = size == null ? secs.length * ss : size;
      if (secs.length * ss < want) fail("bad_file", "short stream");
      const out = new Uint8Array(want);
      let o = 0;
      for (const s of secs) {
        if (o >= want) break;
        const from = sectorOff(s), n = Math.min(ss, want - o);
        if (from + n > b.length) fail("bad_file", "sector past end");
        out.set(b.subarray(from, from + n), o);
        o += n;
      }
      return out;
    }

    const dir = readBig(dirStart, null);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nameLen = Math.min(64, u16(dir, o + 0x40));
      entries.push({
        name: nameLen >= 2 ? utf16.decode(dir.subarray(o, o + nameLen - 2)) : "",
        type: dir[o + 0x42], left: u32(dir, o + 0x44), right: u32(dir, o + 0x48), child: u32(dir, o + 0x4c),
        start: u32(dir, o + 0x74), size: u32(dir, o + 0x78),
      });
    }
    const root = entries[0];
    if (!root || root.type !== 5) fail("bad_file", "root");
    let mini = null, miniFat = null;
    const getMini = () => {
      if (!mini) {
        mini = root.start < ENDCHAIN ? readBig(root.start, root.size) : new Uint8Array(0);
        const raw = nMiniFat && miniFatStart < ENDCHAIN ? readBig(miniFatStart, null) : new Uint8Array(0);
        miniFat = new Uint32Array(raw.length >> 2);
        for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32(raw, i * 4);
      }
    };

    // 디렉터리 트리(형제는 좌우 트리, 하위는 child) → "BodyText/Section0" 같은 경로
    const streams = new Map();
    const seen = new Set();
    const walk = (idx, prefix) => {
      const stack = [idx];
      while (stack.length) {
        const i = stack.pop();
        if (i >= entries.length || seen.has(i)) continue;
        seen.add(i);
        const e = entries[i];
        stack.push(e.left, e.right);
        if (e.type === 2) streams.set(prefix + e.name, e);
        else if (e.type === 1) walk(e.child, prefix + e.name + "/");
      }
    };
    walk(root.child, "");

    return {
      has: (path) => streams.has(path),
      names: () => [...streams.keys()],
      read(path) {
        const e = streams.get(path);
        if (!e) return null;
        if (e.size > b.length * 2 + 4096) fail("bad_file", "size");
        if (e.size >= cutoff) return readBig(e.start, e.size);
        getMini();
        const secs = chain(e.start, miniFat, miniFat.length + 1);
        const out = new Uint8Array(e.size);
        let o = 0;
        for (const s of secs) {
          if (o >= e.size) break;
          const from = s * mss, n = Math.min(mss, e.size - o);
          if (from + n > mini.length) fail("bad_file", "mini past end");
          out.set(mini.subarray(from, from + n), o);
          o += n;
        }
        if (o < e.size) fail("bad_file", "mini short");
        return out;
      },
    };
  }

  // =====================================================================
  // HWP 5.x 레코드
  // =====================================================================
  const TAG = {
    BIN_DATA: 18, PARA_SHAPE: 25, STYLE: 26,
    PARA_HEADER: 66, PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72,
    SHAPE_COMPONENT: 76, TABLE: 77, PICTURE: 85, OLE: 84, EQEDIT: 88,
  };
  // 1글자(WCHAR 하나)짜리 제어 문자. 나머지 0x01~0x1f는 8 WCHAR(인라인·확장 컨트롤)
  const CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
  const EXT_CTRL = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

  /** 레코드 목록 → { list, truncated } (헤더: 태그 10비트·레벨 10비트·크기 12비트, 0xFFF면 다음 4바이트) */
  function readRecords(d) {
    const list = [];
    let o = 0, truncated = false;
    while (o + 4 <= d.length) {
      const hd = u32(d, o);
      o += 4;
      let size = hd >>> 20;
      if (size === 0xfff) {
        if (o + 4 > d.length) { truncated = true; break; }
        size = u32(d, o);
        o += 4;
      }
      if (o + size > d.length) { truncated = true; break; }
      list.push({ tag: hd & 0x3ff, level: (hd >>> 10) & 0x3ff, data: d.subarray(o, o + size), children: null });
      o += size;
    }
    return { list, truncated };
  }
  /** 레벨로 트리를 만든다. 반환: 최상위 노드 배열 */
  function buildTree(list) {
    const top = [];
    const stack = [];
    for (const r of list) {
      r.children = [];
      while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
      (stack.length ? stack[stack.length - 1].children : top).push(r);
      stack.push(r);
    }
    return top;
  }
  const chidOf = (node) => (node.data.length >= 4 ? fourCC(node.data, 0) : "");
  /** 컨트롤 안의 문단(PARA_HEADER)을 차례로 모은다(문단 안으로는 들어가지 않는다) */
  function collectParas(node, out = []) {
    for (const c of node.children) {
      if (c.tag === TAG.PARA_HEADER) out.push(c);
      else collectParas(c, out);
    }
    return out;
  }
  const hasTag = (node, tag) => node.children.some((c) => c.tag === tag || hasTag(c, tag));
  /** 컨트롤 아래의 그림 개체 레코드(문단 안으로는 들어가지 않는다 — 그 안의 그림은 그 문단이 처리한다) */
  function findPictures(node, out = []) {
    for (const c of node.children) {
      if (c.tag === TAG.PARA_HEADER) continue;
      if (c.tag === TAG.PICTURE) out.push(c);
      findPictures(c, out);
    }
    return out;
  }
  // 그림 개체(HWPTAG_SHAPE_COMPONENT_PICTURE): 테두리 12 + 좌표 32 + 자르기 16 + 여백 8 + 밝기·명암·효과 3 → BinData id(UINT16, 1부터)
  const pictureBinId = (rec) => (rec.data.length >= 73 ? u16(rec.data, 71) : 0);

  // ---------- 공통: 문서를 모으는 상태 ----------
  function newCtx(headingOf) {
    return {
      headingOf,
      footnotes: [], endnotes: [],
      spill: [], // 표 칸·각주처럼 글자로만 모으는 곳에서 나온 그림: 바깥 문단 뒤에 놓는다
      stats: { pictures: 0, images: 0, imgMissing: 0, imgUnsupported: 0, imgUnsupportedKinds: [], imgLimit: 0, shapes: 0, textboxes: 0, equations: 0, headers: 0, comments: 0, multicol: false, partial: false, ole: 0 },
    };
  }
  // U+F53A: 한컴 글꼴의 "한" 로고 글자(사용자 영역). 다른 글꼴에서는 네모로 보여 "한"으로 바꾼다.
  const cleanText = (s) => s.replace(/\r/g, "").replace(/\uf53a/g, "한").replace(/[ \t\u00a0]+$/gm, "");
  function pushPara(out, text, heading) {
    const t = cleanText(text);
    if (!t.trim()) return;
    const one = t.trim();
    if (heading && one.length <= 80 && !/\n/.test(one) && !/[.!?。:;,]$/.test(one)) out.push({ type: "heading", level: Math.min(6, heading), text: one });
    else out.push({ type: "paragraph", text: t.replace(/^\n+|\n+$/g, "") });
  }
  function tableText(t) {
    const rows = [];
    for (const c of t.cells) { (rows[c.row] = rows[c.row] || []).push(c.text.replace(/\s*\n\s*/g, " ")); }
    return [t.caption || "", ...rows.filter(Boolean).map((r) => r.join(" "))].filter(Boolean).join("\n");
  }
  /** 블록 → 글자. 그림 블록은 글자가 없으므로 ctx.spill로 옮겨 바깥 문단 뒤에 놓이게 한다 */
  const flatten = (blocks, ctx) => blocks.map((b) => {
    if (b.type === "image") { if (ctx) ctx.spill.push(b); return ""; }
    return b.type === "table" ? tableText(b) : b.text;
  }).filter(Boolean).join("\n");
  /** 셀 목록을 정리해 표 블록으로: 행·열 수는 실제 셀 주소로 다시 계산하고 병합 span을 범위 안으로 자른다 */
  function makeTable(declRows, declCols, cells, caption) {
    let rows = 0, cols = 0;
    for (const c of cells) {
      c.row = Math.max(0, c.row | 0); c.col = Math.max(0, c.col | 0);
      c.rowSpan = Math.max(1, c.rowSpan | 0); c.colSpan = Math.max(1, c.colSpan | 0);
      if (declRows > c.row) c.rowSpan = Math.min(c.rowSpan, declRows - c.row);
      if (declCols > c.col) c.colSpan = Math.min(c.colSpan, declCols - c.col);
      rows = Math.max(rows, c.row + c.rowSpan);
      cols = Math.max(cols, c.col + c.colSpan);
    }
    if (rows * cols > 200000) { // 비정상 주소: 병합을 버리고 순서대로
      for (const c of cells) { c.rowSpan = 1; c.colSpan = 1; }
      rows = Math.min(rows, 2000); cols = Math.min(cols, 100);
    }
    cells = cells.filter((c) => c.row < rows && c.col < cols).sort((a, z) => a.row - z.row || a.col - z.col);
    return { type: "table", rows, cols, cells, caption: caption || "" };
  }
  function finish(ctx, sections) {
    const blocks = [].concat(...sections);
    const notes = [];
    if (ctx.footnotes.length) {
      blocks.push({ type: "heading", level: 2, text: "각주", extra: true });
      for (const f of ctx.footnotes) blocks.push({ type: "paragraph", text: `(${f.n}) ${f.text.trim()}`, note: true });
    }
    if (ctx.endnotes.length) {
      blocks.push({ type: "heading", level: 2, text: "미주", extra: true });
      for (const f of ctx.endnotes) blocks.push({ type: "paragraph", text: `(${f.n}) ${f.text.trim()}`, note: true });
    }
    const s = ctx.stats;
    if (s.partial) notes.push("파일 일부가 손상되어 읽을 수 있는 부분만 가져왔어요.");
    if (s.imgUnsupported) notes.push(`그림 ${s.imgUnsupported}개는 형식(${s.imgUnsupportedKinds.join(", ") || "알 수 없음"})을 지원하지 않아 가져오지 않았어요.`);
    if (s.imgMissing) notes.push(`그림 ${s.imgMissing}개는 파일 안에서 찾지 못해 가져오지 않았어요.`);
    if (s.imgLimit) notes.push(`그림 ${s.imgLimit}개는 한 파일에서 가져올 수 있는 양(${MAX_IMAGES}개, ${MAX_IMAGE_BYTES / 1024 / 1024}MB)을 넘어 건너뛰었어요.`);
    if (s.shapes + s.ole) notes.push(`도형·개체 ${s.shapes + s.ole}개는 가져오지 않았어요.`);
    if (s.textboxes) notes.push(`글상자 ${s.textboxes}개의 글자는 그 자리 아래에 문단으로 넣었어요.`);
    if (s.equations) notes.push(`수식 ${s.equations}개는 "[수식: …]" 글자로 넣었어요.`);
    if (ctx.footnotes.length || ctx.endnotes.length) notes.push(`각주·미주 ${ctx.footnotes.length + ctx.endnotes.length}개는 문서 끝에 모았어요.`);
    if (s.headers) notes.push(`머리말·꼬리말 ${s.headers}개는 건너뛰었어요.`);
    if (s.comments) notes.push(`숨은 설명 ${s.comments}개는 건너뛰었어요.`);
    if (s.multicol) notes.push("여러 단은 한 단으로 이어 붙였어요.");
    return { blocks, notes, stats: Object.assign({}, s, { footnotes: ctx.footnotes.length, endnotes: ctx.endnotes.length }) };
  }
  const headingFromStyle = (name, eng) => {
    const m = /^개요\s*(\d{1,2})$/.exec(String(name || "").trim()) || /^outline\s*(\d{1,2})$/i.exec(String(eng || "").trim());
    return m ? Number(m[1]) : 0;
  };

  // ---------- HWP 문단 ----------
  function hwpParagraph(node, out, ctx) {
    const d = node.data;
    const heading = ctx.headingOf(d.length > 10 ? d[10] : -1, d.length > 9 ? u16(d, 8) : -1);
    let textRec = null;
    const ctrls = [];
    for (const c of node.children) {
      if (c.tag === TAG.PARA_TEXT && !textRec) textRec = c;
      else if (c.tag === TAG.CTRL_HEADER) ctrls.push(c);
    }
    let buf = "";
    const after = [];
    const used = new Set();
    const flush = () => { pushPara(out, buf, heading); buf = ""; };
    const take = (chid) => {
      for (let k = 0; k < ctrls.length; k++) if (!used.has(k) && (!chid || chidOf(ctrls[k]) === chid)) { used.add(k); return ctrls[k]; }
      return null;
    };
    const subText = (ctrl) => { const sub = []; for (const p of collectParas(ctrl)) hwpParagraph(p, sub, ctx); return flatten(sub, ctx); };
    const handle = (ctrl) => {
      const chid = chidOf(ctrl);
      switch (chid) {
        case "tbl ": flush(); out.push(hwpTable(ctrl, ctx)); break;
        case "eqed": {
          const eq = ctrl.children.find((c) => c.tag === TAG.EQEDIT);
          let script = "";
          if (eq && eq.data.length >= 6) {
            const n = u16(eq.data, 4);
            script = utf16.decode(eq.data.subarray(6, Math.min(eq.data.length, 6 + n * 2)));
          }
          ctx.stats.equations++;
          buf += `[수식: ${script.replace(/\s+/g, " ").trim()}]`;
          break;
        }
        case "gso ": {
          const sub = [];
          for (const p of collectParas(ctrl)) hwpParagraph(p, sub, ctx);
          const pics = findPictures(ctrl);
          // 그림은 이 컨트롤이 속한 문단 바로 뒤에(캡션 문단보다 앞에) 자리 표시로 넣고, 읽은 뒤 실제 그림으로 바꾼다
          for (const pic of pics) { ctx.stats.pictures++; after.push({ type: "image", ref: pictureBinId(pic) }); }
          if (pics.length || hasTag(ctrl, TAG.PICTURE)) { /* 그림 */ }
          else if (hasTag(ctrl, TAG.OLE)) ctx.stats.ole++;
          else if (sub.some((b) => b.type !== "image")) ctx.stats.textboxes++;
          else ctx.stats.shapes++;
          for (const b of sub) after.push(b);
          break;
        }
        case "head": case "foot": ctx.stats.headers++; break;
        case "fn  ": case "en  ": {
          const list = chid === "fn  " ? ctx.footnotes : ctx.endnotes;
          const n = list.length + 1;
          buf += chid === "fn  " ? `[각주 ${n}]` : `[미주 ${n}]`;
          list.push({ n, text: subText(ctrl) });
          break;
        }
        case "tcmt": ctx.stats.comments++; break;
        case "cold": if (ctrl.data.length >= 6 && ((u16(ctrl.data, 4) >> 2) & 0xff) > 1) ctx.stats.multicol = true; break;
        default: {
          // 덧말·필드·책갈피 등은 본문 글자에 이미 들어 있다. 그 밖에 문단을 품은 컨트롤은 아래에 문단으로.
          if (chid === "tdut" || chid.startsWith("%")) break;
          for (const p of collectParas(ctrl)) hwpParagraph(p, after, ctx);
        }
      }
    };
    if (textRec) {
      const t = textRec.data;
      const n = t.length >> 1;
      let i = 0;
      while (i < n) {
        const c = u16(t, i * 2);
        if (c >= 32) {
          let j = i + 1;
          while (j < n && u16(t, j * 2) >= 32) j++;
          buf += utf16.decode(t.subarray(i * 2, j * 2));
          i = j;
          continue;
        }
        if (CHAR_CTRL.has(c)) {
          if (c === 10) buf += "\n";
          else if (c === 24) buf += "-";
          else if (c === 30 || c === 31) buf += " ";
          i++;
          continue;
        }
        if (c === 9) buf += "\t";
        else if (EXT_CTRL.has(c)) {
          const chid = i * 2 + 6 <= t.length ? fourCC(t, i * 2 + 2) : "";
          const ctrl = take(chid);
          if (ctrl) handle(ctrl);
        }
        i += 8;
      }
    }
    // 글자 안에 자리가 없는(남은) 컨트롤도 놓치지 않는다
    for (let k = 0; k < ctrls.length; k++) if (!used.has(k)) handle(ctrls[k]);
    flush();
    for (const b of ctx.spill.splice(0)) after.push(b);
    for (const b of after) out.push(b);
  }
  function hwpTable(ctrl, ctx) {
    let declRows = 0, declCols = 0, seenTable = false, cur = null;
    const cells = [], captionParas = [];
    for (const c of ctrl.children) {
      if (c.tag === TAG.TABLE && c.data.length >= 8) { declRows = u16(c.data, 4); declCols = u16(c.data, 6); seenTable = true; }
      else if (c.tag === TAG.LIST_HEADER) {
        if (seenTable && c.data.length >= 16) {
          cur = { col: u16(c.data, 8), row: u16(c.data, 10), colSpan: u16(c.data, 12), rowSpan: u16(c.data, 14), paras: [] };
          cells.push(cur);
        } else cur = { paras: captionParas };
      } else if (c.tag === TAG.PARA_HEADER && cur) cur.paras.push(c);
    }
    const text = (paras) => { const sub = []; for (const p of paras) hwpParagraph(p, sub, ctx); return flatten(sub, ctx); };
    const out = cells.map((c) => ({ row: c.row, col: c.col, rowSpan: c.rowSpan, colSpan: c.colSpan, text: text(c.paras) }));
    return makeTable(declRows, declCols, out, text(captionParas).replace(/\s+/g, " ").trim());
  }

  /** HWP 5.x 바이트 → Promise<{ blocks, notes, stats }> */
  async function parseHwp(input, opts = {}) {
    const bytes = toBytes(input);
    if (bytes.length > MAX_FILE) fail("too_large");
    const kind = sniff(bytes);
    if (kind === "hwp3") fail("old_hwp");
    if (kind !== "hwp") fail(kind === "hwpx" ? "bad_file" : "not_hwp");
    const tick = makeTicker(opts.onProgress);
    const cfb = readCfb(bytes);
    const fh = cfb.read("FileHeader");
    if (!fh) {
      if (cfb.names().length) fail("not_hwp", "no FileHeader"); // 다른 프로그램의 OLE 파일(.doc 등)
      fail("bad_file", "empty cfb");
    }
    if (fh.length < 40 || ascii(fh, 0, 17) !== "HWP Document File") fail("not_hwp", "signature");
    const version = u32(fh, 32);
    const flags = u32(fh, 36);
    const major = version >>> 24;
    if (major && major < 5) fail("old_hwp");
    if (flags & 2) fail("encrypted");
    if (flags & 16) fail("encrypted", "drm");
    if (flags & 4 || (!cfb.has("BodyText/Section0") && cfb.has("ViewText/Section0"))) fail("distribution");
    const compressed = !!(flags & 1);
    const budget = { left: MAX_INFLATED };
    let partial = false;
    const unpack = async (raw) => {
      if (!compressed) return raw;
      // 끝까지 풀리지 않았어도 풀린 만큼은 쓰고, 실제로 잘렸는지는 레코드가 중간에 끊기는지로 판단한다.
      const r = await inflateRaw(raw, budget);
      if (!r.complete && !r.data.length) fail("bad_file", "inflate");
      return r.data;
    };

    // DocInfo: 스타일 이름과 문단 모양(개요 수준)
    const styles = [], paraShapes = [], binData = [];
    const di = cfb.read("DocInfo");
    if (di) {
      try {
        const { list } = readRecords(await unpack(di));
        for (const r of list) {
          if (r.tag === TAG.PARA_SHAPE && r.data.length >= 4) paraShapes.push(u32(r.data, 0));
          else if (r.tag === TAG.BIN_DATA) binData.push(readBinDataRecord(r.data));
          else if (r.tag === TAG.STYLE && r.data.length >= 2) {
            const d = r.data;
            const n1 = u16(d, 0);
            const name = utf16.decode(d.subarray(2, Math.min(d.length, 2 + n1 * 2)));
            const o2 = 2 + n1 * 2;
            const n2 = o2 + 2 <= d.length ? u16(d, o2) : 0;
            const eng = utf16.decode(d.subarray(o2 + 2, Math.min(d.length, o2 + 2 + n2 * 2)));
            styles.push({ name, eng });
          }
        }
      } catch (e) { if (e && e.code === "too_large") throw e; /* 스타일 없이도 본문은 읽는다 */ }
    }
    const headingOf = (styleId, psId) => {
      const st = styles[styleId];
      let lvl = st ? headingFromStyle(st.name, st.eng) : 0;
      if (!lvl && paraShapes[psId] != null) {
        const f = paraShapes[psId];
        if (((f >>> 23) & 3) === 1) lvl = ((f >>> 25) & 7) + 1; // 문단 머리 모양 = 개요
      }
      return lvl;
    };

    const names = [];
    for (let i = 0; cfb.has("BodyText/Section" + i); i++) names.push("BodyText/Section" + i);
    if (!names.length) fail("bad_file", "no sections");
    const ctx = newCtx(headingOf);
    const sections = [];
    for (let si = 0; si < names.length; si++) {
      await tick(si / names.length);
      let data;
      try { data = await unpack(cfb.read(names[si])); }
      catch (e) { if (e && (e.code === "too_large" || e.code === "unsupported")) throw e; if (si === 0) fail("bad_file", "section"); partial = true; break; }
      const { list, truncated } = readRecords(data);
      if (truncated) partial = true;
      if (!list.length && si === 0 && data.length) fail("bad_file", "no records");
      const top = buildTree(list);
      const out = [];
      for (let k = 0; k < top.length; k++) {
        if (top[k].tag === TAG.PARA_HEADER) hwpParagraph(top[k], out, ctx);
        if ((k & 63) === 0) await tick((si + k / top.length) / names.length);
      }
      sections.push(out);
    }
    ctx.stats.partial = partial;
    await resolveImages(sections, ctx, (ref) => loadHwpBin(cfb, binData, ref, compressed, budget));
    if (opts.onProgress) opts.onProgress(1);
    return finish(ctx, sections);
  }

  /** DocInfo의 HWPTAG_BIN_DATA → { type: 0 연결|1 포함|2 OLE 저장소, comp: 0 문서 설정|1 압축|2 압축 안 함, storageId, ext } */
  function readBinDataRecord(d) {
    if (d.length < 2) return { type: -1 };
    const f = u16(d, 0);
    const e = { type: f & 0xf, comp: (f >> 4) & 3, storageId: 0, ext: "" };
    if ((e.type === 1 || e.type === 2) && d.length >= 4) e.storageId = u16(d, 2);
    if (e.type === 1 && d.length >= 6) {
      const n = u16(d, 4);
      e.ext = utf16.decode(d.subarray(6, Math.min(d.length, 6 + n * 2))).trim().toLowerCase();
    }
    return e;
  }
  /** HWP 그림 개체의 BinData id(1부터, DocInfo 순서) → { bytes, ext, source } | { missing } | { unsupported } */
  async function loadHwpBin(cfb, binData, ref, docCompressed, budget) {
    const e = ref > 0 ? binData[ref - 1] : null;
    if (!e || e.type === 0) return { missing: true }; // 연결된(밖에 있는) 그림
    if (e.type !== 1) return { unsupported: "OLE" };
    const base = "BinData/BIN" + e.storageId.toString(16).toUpperCase().padStart(4, "0");
    let path = base + "." + e.ext;
    if (!cfb.has(path)) {
      const want = path.toLowerCase();
      path = cfb.names().find((n) => n.toLowerCase() === want) || "";
      if (!path) return { missing: true };
    }
    const raw = cfb.read(path);
    if (!raw || !raw.length) return { missing: true };
    const compressed = e.comp === 1 || (e.comp === 0 && docCompressed);
    // 압축 표시가 있어도 실제로는 안 된 경우가 있어, 풀린 쪽이 알아볼 수 있는 형식일 때만 바꾼다
    let bytes = raw;
    const rawKnown = !!imageInfo(raw).kind;
    if (compressed || !rawKnown) {
      try {
        const r = await inflateRaw(raw, budget);
        if (r.data.length && (imageInfo(r.data).kind || !rawKnown)) bytes = r.data;
      } catch (err) { if (err && err.code === "too_large") throw err; /* 그대로 써 본다 */ }
    }
    return { bytes, ext: e.ext, source: path };
  }

  // =====================================================================
  // 그림: 형식 확인·크기·자리 표시 → 그림 블록
  // =====================================================================
  const RASTER = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
  const EXT_OF = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
  const be16 = (b, o) => (b[o] << 8) | b[o + 1];
  const be32 = (b, o) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  /**
   * 머리 바이트로 그림 형식 판별 → { kind, mime, supported, label, width, height }.
   * 브라우저가 그릴 수 있는 래스터(PNG·JPEG·GIF·WebP·BMP)만 supported. SVG·XML 등 글자로 된 형식은 절대 받지 않는다.
   */
  function imageInfo(input) {
    const b = toBytes(input);
    const out = (kind, w, hgt) => ({ kind, mime: RASTER[kind] || "", supported: !!RASTER[kind], label: kind.toUpperCase(), width: w || 0, height: hgt || 0 });
    if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return out("png", be32(b, 16), be32(b, 20));
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      let w = 0, hgt = 0;
      for (let o = 2; o + 9 < b.length;) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1];
        if (m === 0xff) { o++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { hgt = be16(b, o + 5); w = be16(b, o + 7); break; }
        if (m === 0xd9 || m === 0xda) break;
        o += 2 + be16(b, o + 2);
      }
      return out("jpeg", w, hgt);
    }
    if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return out("gif", u16(b, 6), u16(b, 8));
    if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
      const c = ascii(b, 12, 4);
      if (c === "VP8 ") return out("webp", u16(b, 26) & 0x3fff, u16(b, 28) & 0x3fff);
      if (c === "VP8L") { const v = u32(b, 21); return out("webp", (v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1); }
      if (c === "VP8X") return out("webp", 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
      return out("webp");
    }
    if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d && [12, 40, 52, 56, 64, 108, 124].includes(u32(b, 14))) {
      if (u32(b, 14) === 12) return out("bmp", u16(b, 18), u16(b, 20));
      const hh = u32(b, 22);
      return out("bmp", u32(b, 18), hh > 0x7fffffff ? 0x100000000 - hh : hh);
    }
    const no = (label) => ({ kind: label.toLowerCase(), mime: "", supported: false, label, width: 0, height: 0 });
    if (b.length >= 4 && u32(b, 0) === 0x9ac6cdd7) return no("WMF");
    if (b.length >= 18 && (u16(b, 0) === 1 || u16(b, 0) === 2) && u16(b, 2) === 9) return no("WMF");
    if (b.length >= 44 && u32(b, 0) === 1 && ascii(b, 40, 4) === " EMF") return no("EMF");
    if (b.length >= 4 && (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*")) return no("TIFF");
    if (sniff(b) === "hwp") return no("OLE");
    if (b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b) return no("ZIP");
    let i = 0;
    while (i < b.length && i < 64 && (b[i] <= 0x20 || b[i] === 0xef || b[i] === 0xbb || b[i] === 0xbf)) i++;
    if (b[i] === 0x3c) return no(/svg/i.test(ascii(b, i, 512)) ? "SVG" : "XML");
    return { kind: "", mime: "", supported: false, label: "", width: 0, height: 0 };
  }
  /** 캔버스로 PNG로 바꾼다(BMP처럼 저장·문서에 넣을 수 없는 래스터) → { bytes, width, height } | null */
  async function toPng(bytes, mime) {
    try {
      if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height } : null;
    } catch { return null; }
  }
  /**
   * 자리 표시 { type: "image", ref } 를 실제 그림 블록 { type, mime, bytes, name, n, source, width, height } 로 바꾸거나 빼고,
   * 못 가져온 수를 ctx.stats에 적는다. 같은 BinData를 여러 곳에서 쓰면 바이트를 함께 쓴다(개수·크기 제한은 한 번만 센다).
   */
  async function resolveImages(sections, ctx, loader) {
    const cache = new Map();
    const s = ctx.stats;
    let used = 0, usedBytes = 0, n = 0;
    const kinds = new Set();
    for (const list of sections) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.type !== "image" || b.bytes) continue;
        let r = cache.get(b.ref);
        if (!r) {
          r = await (async () => {
            if (b.ref == null || b.ref === 0 || b.ref === "") return { missing: true };
            let got;
            try { got = await loader(b.ref); } catch (e) { if (e && e.code === "too_large") throw e; return { missing: true }; }
            if (!got || got.missing || got.unsupported) return got || { missing: true };
            const info = imageInfo(got.bytes);
            if (!info.supported) return { unsupported: info.label || (got.ext ? got.ext.toUpperCase() : "알 수 없음") };
            if (used + 1 > MAX_IMAGES || usedBytes + got.bytes.length > MAX_IMAGE_BYTES) return { limit: true };
            used++; usedBytes += got.bytes.length;
            let { mime, width, height } = info, bytes = got.bytes;
            if (info.kind === "bmp") {
              const png = await toPng(bytes, mime);
              if (!png) return { unsupported: "BMP" };
              bytes = png.bytes; mime = "image/png"; width = png.width; height = png.height;
            }
            if (bytes.byteLength !== bytes.buffer.byteLength) bytes = bytes.slice(); // 파일 전체 버퍼를 붙잡지 않게
            return { ok: true, mime, bytes, width, height, source: got.source || "" };
          })();
          cache.set(b.ref, r);
        }
        if (r.ok) {
          n++;
          const img = { type: "image", mime: r.mime, bytes: r.bytes, name: `그림 ${n}.${EXT_OF[r.mime]}`, n, source: r.source };
          if (r.width && r.height) { img.width = r.width; img.height = r.height; }
          list[i] = img;
          continue;
        }
        if (r.unsupported) { s.imgUnsupported++; kinds.add(r.unsupported); }
        else if (r.limit) s.imgLimit++;
        else s.imgMissing++;
        list.splice(i, 1);
        i--;
      }
    }
    s.images = n;
    s.imgUnsupportedKinds = [...kinds];
  }

  // =====================================================================
  // HWPX (zip + XML)
  // =====================================================================
  async function readZip(b) {
    const entries = new Map();
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b[i] === 0x50 && u32(b, i) === 0x06054b50) { eocd = i; break; }
    let partial = false;
    if (eocd >= 0) {
      const n = u16(b, eocd + 10);
      let o = u32(b, eocd + 16);
      for (let k = 0; k < n; k++) {
        if (o + 46 > b.length || u32(b, o) !== 0x02014b50) fail("bad_file", "central dir");
        const nl = u16(b, o + 28), xl = u16(b, o + 30), cl = u16(b, o + 32);
        const name = utf8.decode(b.subarray(o + 46, o + 46 + nl));
        entries.set(name, { method: u16(b, o + 10), csize: u32(b, o + 20), usize: u32(b, o + 24), at: u32(b, o + 42) });
        o += 46 + nl + xl + cl;
      }
    } else {
      // 중앙 디렉터리가 없으면(잘린 파일) 로컬 헤더를 앞에서부터 따라가 본다
      partial = true;
      let o = 0;
      while (o + 30 <= b.length && u32(b, o) === 0x04034b50) {
        const fl = u16(b, o + 6), nl = u16(b, o + 26), xl = u16(b, o + 28), csize = u32(b, o + 18);
        if (fl & 8) break; // 크기를 뒤에 적는 형식은 따라갈 수 없다
        const name = utf8.decode(b.subarray(o + 30, Math.min(b.length, o + 30 + nl)));
        entries.set(name, { method: u16(b, o + 8), csize, usize: u32(b, o + 22), at: o });
        o += 30 + nl + xl + csize;
      }
      if (!entries.size) fail("bad_file", "no entries");
    }
    const budget = { left: MAX_INFLATED };
    return {
      partial,
      names: () => [...entries.keys()],
      has: (n) => entries.has(n),
      async read(name) {
        const e = entries.get(name);
        if (!e) return null;
        if (e.at + 30 > b.length || u32(b, e.at) !== 0x04034b50) fail("bad_file", "local header");
        const start = e.at + 30 + u16(b, e.at + 26) + u16(b, e.at + 28);
        const end = start + e.csize;
        if (end > b.length) fail("bad_file", "entry past end");
        const raw = b.subarray(start, end);
        if (e.method === 0) return raw;
        if (e.method !== 8) fail("bad_file", "method " + e.method);
        const r = await inflateRaw(raw, budget);
        if (!r.complete) fail("bad_file", "inflate");
        return r.data;
      },
    };
  }

  const kids = (el) => Array.from(el.children || []);
  const child = (el, name) => kids(el).find((c) => c.localName === name) || null;
  const num = (el, attr, d = 0) => { const v = el && el.getAttribute(attr); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
  function parseXml(bytes) {
    const text = utf8.decode(bytes);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (!doc.documentElement || doc.getElementsByTagName("parsererror").length) fail("bad_file", "xml");
    return doc;
  }
  function collectXParas(el, out = []) {
    for (const c of kids(el)) {
      if (c.localName === "p") out.push(c);
      else collectXParas(c, out);
    }
    return out;
  }
  const SHAPES = new Set(["container", "rect", "ellipse", "arc", "polygon", "curve", "line", "connectLine", "textart", "ole", "chart", "video", "pic"]);

  function xText(node) {
    let s = "";
    for (const n of node.childNodes) {
      if (n.nodeType === 3 || n.nodeType === 4) s += n.data;
      else if (n.nodeType === 1) {
        switch (n.localName) {
          case "tab": s += "\t"; break;
          case "lineBreak": s += "\n"; break;
          case "hyphen": s += "-"; break;
          case "nbSpace": case "fwSpace": s += " "; break;
          default: s += xText(n);
        }
      }
    }
    return s;
  }
  function xParagraph(p, out, ctx) {
    const heading = ctx.headingOf(p.getAttribute("styleIDRef"), p.getAttribute("paraPrIDRef"));
    let buf = "";
    const after = [];
    const flush = () => { pushPara(out, buf, heading); buf = ""; };
    const subText = (el) => { const sub = []; for (const q of collectXParas(el)) xParagraph(q, sub, ctx); return flatten(sub, ctx); };
    const item = (c) => {
      const name = c.localName;
      if (name === "t") buf += xText(c);
      else if (name === "tbl") { flush(); out.push(xTable(c, ctx)); }
      else if (name === "equation") {
        const sc = child(c, "script");
        ctx.stats.equations++;
        buf += `[수식: ${(sc ? sc.textContent : "").replace(/\s+/g, " ").trim()}]`;
      } else if (name === "ctrl") {
        for (const cc of kids(c)) {
          const k = cc.localName;
          if (k === "header" || k === "footer") ctx.stats.headers++;
          else if (k === "footNote" || k === "endNote") {
            const list = k === "footNote" ? ctx.footnotes : ctx.endnotes;
            const n = list.length + 1;
            buf += k === "footNote" ? `[각주 ${n}]` : `[미주 ${n}]`;
            list.push({ n, text: subText(cc) });
          } else if (k === "hiddenComment") ctx.stats.comments++;
          else if (k === "colPr" && num(cc, "colCount", 1) > 1) ctx.stats.multicol = true;
        }
      } else if (name === "secPr" || name === "linesegarray") { /* 쪽 설정·줄 배치 */ }
      else if (SHAPES.has(name)) {
        const sub = [];
        for (const q of collectXParas(c)) xParagraph(q, sub, ctx);
        const pics = xPictures(c);
        for (const pic of pics) {
          ctx.stats.pictures++;
          const img = xPicImage(pic);
          after.push({ type: "image", ref: img ? img.getAttribute("binaryItemIDRef") || "" : "" });
        }
        if (pics.length) { /* 그림 */ }
        else if (name === "ole" || name === "chart" || name === "video") ctx.stats.ole++;
        else if (sub.some((b) => b.type !== "image")) ctx.stats.textboxes++;
        else ctx.stats.shapes++;
        for (const b of sub) after.push(b);
      } else if (name === "compose" || name === "dutmal") buf += xText(c);
      else for (const q of collectXParas(c)) xParagraph(q, after, ctx);
    };
    for (const c of kids(p)) {
      if (c.localName === "run") kids(c).forEach(item);
      else if (c.localName !== "linesegarray") item(c);
    }
    flush();
    for (const b of ctx.spill.splice(0)) after.push(b);
    for (const b of after) out.push(b);
  }
  /** 도형 안의 그림 개체(hp:pic). 묶음(container) 안도 찾되 글상자 문단(hp:p) 안으로는 들어가지 않는다 */
  function xPictures(el, out = []) {
    if (el.localName === "pic") { out.push(el); return out; }
    for (const c of kids(el)) if (c.localName !== "p") xPictures(c, out);
    return out;
  }
  /** hp:pic 아래 hc:img(binaryItemIDRef). 채우기 무늬(fillBrush) 속 그림은 배경이라 보지 않는다 */
  function xPicImage(pic) {
    const stack = kids(pic);
    while (stack.length) {
      const c = stack.shift();
      if (c.localName === "img" && c.getAttribute("binaryItemIDRef")) return c;
      if (c.localName !== "p" && c.localName !== "fillBrush" && c.localName !== "pic") stack.push(...kids(c));
    }
    return null;
  }
  function xTable(tbl, ctx) {
    const cells = [];
    const text = (el) => { const sub = []; for (const q of collectXParas(el)) xParagraph(q, sub, ctx); return flatten(sub, ctx); };
    let r = 0;
    for (const tr of kids(tbl).filter((x) => x.localName === "tr")) {
      let c = 0;
      for (const tc of kids(tr).filter((x) => x.localName === "tc")) {
        const addr = child(tc, "cellAddr"), span = child(tc, "cellSpan");
        const sub = child(tc, "subList") || tc;
        cells.push({ row: num(addr, "rowAddr", r), col: num(addr, "colAddr", c), rowSpan: num(span, "rowSpan", 1), colSpan: num(span, "colSpan", 1), text: text(sub) });
        c++;
      }
      r++;
    }
    const cap = child(tbl, "caption");
    return makeTable(num(tbl, "rowCnt", 0), num(tbl, "colCnt", 0), cells, cap ? text(cap).replace(/\s+/g, " ").trim() : "");
  }

  /** HWPX 바이트 → Promise<{ blocks, notes, stats }> */
  async function parseHwpx(input, opts = {}) {
    const bytes = toBytes(input);
    if (bytes.length > MAX_FILE) fail("too_large");
    const kind = sniff(bytes);
    if (kind === "hwp3") fail("old_hwp");
    if (kind !== "hwpx") fail(kind === "hwp" ? "bad_file" : "not_hwp");
    const tick = makeTicker(opts.onProgress);
    const zip = await readZip(bytes);
    const sectionNames = zip.names()
      .map((n) => ({ n, m: /^Contents\/section(\d+)\.xml$/i.exec(n) }))
      .filter((x) => x.m).sort((a, z) => Number(a.m[1]) - Number(z.m[1])).map((x) => x.n);
    let mime = "";
    if (zip.has("mimetype")) { try { mime = utf8.decode(await zip.read("mimetype")).trim(); } catch { mime = ""; } }
    if (!sectionNames.length) {
      if (zip.partial || /hwp/i.test(mime) || zip.has("Contents/header.xml") || zip.has("Contents/content.hpf")) fail("bad_file", "no sections");
      fail("not_hwp", "zip without sections");
    }
    if (zip.has("META-INF/manifest.xml")) {
      try { if (/encryption-data|EncryptionData/i.test(utf8.decode(await zip.read("META-INF/manifest.xml")))) fail("encrypted"); }
      catch (e) { if (e && e.code === "encrypted") throw e; }
    }

    // 스타일(이름 "개요 N")과 문단 모양(heading OUTLINE)
    const styles = new Map(), paraHeads = new Map();
    if (zip.has("Contents/header.xml")) {
      try {
        const hd = parseXml(await zip.read("Contents/header.xml"));
        for (const st of hd.getElementsByTagNameNS("*", "style")) styles.set(st.getAttribute("id"), headingFromStyle(st.getAttribute("name"), st.getAttribute("engName")));
        for (const pp of hd.getElementsByTagNameNS("*", "paraPr")) {
          const hdg = child(pp, "heading");
          if (hdg && hdg.getAttribute("type") === "OUTLINE") paraHeads.set(pp.getAttribute("id"), num(hdg, "level", 0) + 1);
        }
      } catch (e) { if (e && e.code === "too_large") throw e; /* 스타일 없이 */ }
    }
    const headingOf = (styleId, paraPrId) => styles.get(styleId) || paraHeads.get(paraPrId) || 0;

    const ctx = newCtx(headingOf);
    const sections = [];
    for (let si = 0; si < sectionNames.length; si++) {
      await tick(si / sectionNames.length);
      let doc;
      try { doc = parseXml(await zip.read(sectionNames[si])); }
      catch (e) { if (e && (e.code === "too_large" || e.code === "unsupported")) throw e; if (si === 0) throw e; ctx.stats.partial = true; break; }
      const out = [];
      const paras = kids(doc.documentElement).filter((c) => c.localName === "p");
      for (let k = 0; k < paras.length; k++) {
        xParagraph(paras[k], out, ctx);
        if ((k & 31) === 0) await tick((si + k / paras.length) / sectionNames.length);
      }
      sections.push(out);
    }
    if (zip.partial) ctx.stats.partial = true;
    if (sections.some((list) => list.some((b) => b.type === "image"))) {
      const manifest = await readHpfManifest(zip);
      await resolveImages(sections, ctx, (ref) => loadHwpxBin(zip, manifest, ref));
    }
    if (opts.onProgress) opts.onProgress(1);
    return finish(ctx, sections);
  }

  /** Contents/content.hpf(OPF manifest) → Map(id → { href, mediaType, embedded }) */
  async function readHpfManifest(zip) {
    const map = new Map();
    const name = zip.has("Contents/content.hpf") ? "Contents/content.hpf" : zip.names().find((n) => /(^|\/)content\.hpf$/i.test(n));
    if (!name) return map;
    try {
      const doc = parseXml(await zip.read(name));
      for (const it of doc.getElementsByTagNameNS("*", "item")) {
        const id = it.getAttribute("id");
        if (id) map.set(id, { href: it.getAttribute("href") || "", mediaType: it.getAttribute("media-type") || "", embedded: it.getAttribute("isEmbeded") !== "0" });
      }
    } catch (e) { if (e && e.code === "too_large") throw e; /* manifest 없이 BinData/<id>.* 로 찾아 본다 */ }
    return map;
  }
  /** HWPX 그림 id → { bytes, ext, source } | { missing } */
  async function loadHwpxBin(zip, manifest, id) {
    const names = zip.names();
    const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
    const m = manifest.get(id);
    let path = "";
    if (m) {
      if (!m.embedded) return { missing: true };
      let href = m.href.replace(/^\.?\//, "");
      try { href = decodeURIComponent(href); } catch { /* 그대로 */ }
      for (const cand of [href, "Contents/" + href]) { const hit = lower.get(cand.toLowerCase()); if (hit) { path = hit; break; } }
    }
    if (!path) {
      const want = String(id).toLowerCase();
      path = names.find((n) => /^bindata\//i.test(n) && n.slice(8).replace(/\.[^.]*$/, "").toLowerCase() === want) || "";
    }
    if (!path || !/^(Contents\/)?BinData\//i.test(path)) return { missing: true };
    const bytes = await zip.read(path);
    if (!bytes || !bytes.length) return { missing: true };
    return { bytes, ext: (/\.([^.\/]+)$/.exec(path) || [])[1] || "", source: path };
  }

  /** 형식을 보고 알맞은 파서로 */
  function parseAny(bytes, opts) {
    const kind = sniff(bytes);
    if (kind === "hwp") return parseHwp(bytes, opts);
    if (kind === "hwpx") return parseHwpx(bytes, opts);
    return Promise.reject(Object.assign(new Error(MESSAGES[kind === "hwp3" ? "old_hwp" : "not_hwp"]), { code: kind === "hwp3" ? "old_hwp" : "not_hwp" }));
  }

  // =====================================================================
  // 블록 → Markdown (mod-editor의 markdownToBlocks가 읽는 범위)
  // =====================================================================
  const WJ = "\u2060"; // 줄머리 "1. ", "- "가 목록으로 바뀌지 않게 끼우는 보이지 않는 글자
  const mdInline = (s) => String(s).replace(/[\\`*_[\]$|<>]/g, "\\$&").replace(/\t/g, " ");
  function mdLine(s) {
    let t = mdInline(s.trim());
    t = t.replace(/^#/, "\\#").replace(/^(\d+[.)])(\s)/, "$1" + WJ + "$2").replace(/^([-+])(\s)/, "$1" + WJ + "$2");
    if (/^([-_])(\s*\1){2,}\s*$/.test(t)) t = t.replace(/^(.)/, "$1" + WJ);
    if (/^(```|\$\$)/.test(t)) t = WJ + t;
    return t;
  }
  function tableGrid(b) {
    const grid = Array.from({ length: b.rows }, () => Array(b.cols).fill(""));
    for (const c of b.cells) if (grid[c.row]) grid[c.row][c.col] = c.text;
    return grid;
  }
  const MD_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
  function base64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  /**
   * 블록 → Markdown. 그림 블록은 독립된 줄 "![그림 1](data:image/png;base64,…)"(PNG·JPEG·GIF·WebP만).
   * opts.images === "placeholder"이면(텍스트로 저장) 그림 대신 "(그림 1)"만 적는다.
   */
  function toMarkdown(blocks, opts = {}) {
    const out = [];
    for (const b of blocks || []) {
      if (b.type === "image") {
        const label = `그림 ${b.n || ""}`.trim();
        if (opts.images !== "placeholder" && b.bytes && b.bytes.length && MD_IMAGE.test(b.mime)) out.push(`![${label}](data:${b.mime};base64,${base64(b.bytes)})`);
        else out.push(`(${label})`);
        continue;
      }
      if (b.type === "heading") out.push("#".repeat(Math.max(1, Math.min(6, b.level))) + " " + mdInline(b.text.replace(/\s+/g, " ").trim()));
      else if (b.type === "paragraph") {
        const lines = b.text.split("\n").map((l) => l.trim()).filter(Boolean).map(mdLine);
        if (lines.length) out.push(lines.join("\n\n"));
      } else if (b.type === "table" && b.rows && b.cols) {
        const cell = (s) => mdInline(String(s).replace(/\s*\n\s*/g, " ").trim()) || " ";
        const grid = tableGrid(b).map((r) => "| " + r.map(cell).join(" | ") + " |");
        const md = [grid[0], "|" + " --- |".repeat(b.cols), ...grid.slice(1)].join("\n");
        out.push(b.caption ? mdLine(b.caption) + "\n\n" + md : md);
      }
    }
    return out.join("\n\n");
  }
  /** 블록 → 사람이 읽는 글자(가져오기 미리보기·검사용) */
  const toText = (blocks) => (blocks || []).map((b) => (b.type === "table" ? tableText(b) : b.type === "image" ? `(그림 ${b.n})` : b.text)).join("\n\n");

  // =====================================================================
  // 가져오기 전에 그림 줄이기: 긴 변 1200px·JPEG 0.8(투명하면 PNG·800px), 한 장 60KB 넘으면 더 줄인다
  // =====================================================================
  const SHRINK = { maxBytes: 60 * 1024, maxSide: 1200, maxSideAlpha: 800, quality: 0.8 };
  const canvasBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
  /** 그림 블록 → Promise<{ mime, bytes, width, height } | null>(그릴 수 없으면 null) */
  async function shrinkImage(img, opt = {}) {
    const o = Object.assign({}, SHRINK, opt);
    if (!img || !img.bytes || !RASTER[imageInfo(img.bytes).kind]) return null;
    let bmp;
    try { bmp = await createImageBitmap(new Blob([img.bytes], { type: img.mime })); } catch { return null; }
    const W = bmp.width, H = bmp.height;
    if (!W || !H) return null;
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d");
    // 투명한 곳이 있는지: 작게 그려 알파를 본다(JPEG는 투명이 없다)
    let alpha = false;
    if (img.mime !== "image/jpeg") {
      const k = Math.min(1, 256 / Math.max(W, H));
      canvas.width = Math.max(1, Math.round(W * k)); canvas.height = Math.max(1, Math.round(H * k));
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
    }
    const fits = (side) => Math.max(W, H) <= side;
    if (img.bytes.length <= o.maxBytes && fits(alpha ? o.maxSideAlpha : o.maxSide) && MD_IMAGE.test(img.mime)) {
      if (bmp.close) bmp.close();
      return { mime: img.mime, bytes: img.bytes, width: W, height: H };
    }
    const draw = (scale, white) => {
      canvas.width = Math.max(1, Math.round(W * scale)); canvas.height = Math.max(1, Math.round(H * scale));
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (white) { g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height); }
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    };
    let best = null;
    const attempt = async (type, q) => {
      const blob = await canvasBlob(canvas, type, q);
      if (!blob) return false;
      if (!best || blob.size < best.size) best = { blob, mime: blob.type || type, width: canvas.width, height: canvas.height, size: blob.size };
      return blob.size <= o.maxBytes;
    };
    let done = false;
    if (alpha) {
      for (let scale = Math.min(1, o.maxSideAlpha / Math.max(W, H)); !done && Math.max(W, H) * scale >= 48; scale *= 0.75) {
        draw(scale, false);
        done = await attempt("image/png");
      }
      if (!done) best = null; // 투명을 지키며 줄일 수 없으면 흰 바탕 JPEG로
    }
    if (!done) {
      let scale = Math.min(1, o.maxSide / Math.max(W, H)), q = o.quality;
      for (let k = 0; k < 30 && !done; k++) {
        draw(scale, true);
        done = await attempt("image/jpeg", q);
        if (q > 0.55) q = Math.round((q - 0.1) * 100) / 100;
        else scale *= 0.8;
        if (Math.max(W, H) * scale < 16) break;
      }
    }
    if (bmp.close) bmp.close();
    if (!best) return null;
    return { mime: best.mime, bytes: new Uint8Array(await best.blob.arrayBuffer()), width: best.width, height: best.height };
  }
  /** 가져오기용 Markdown: 그림을 줄여 data URL로 넣는다. 그릴 수 없는 그림은 "(그림 N)" 자리 표시 */
  async function toImportMarkdown(blocks, opt) {
    const cache = new Map();
    const out = [];
    for (const b of blocks || []) {
      if (b.type !== "image") { out.push(b); continue; }
      if (!cache.has(b.bytes)) cache.set(b.bytes, await shrinkImage(b, opt).catch(() => null));
      const r = cache.get(b.bytes);
      out.push(r ? Object.assign({}, b, { mime: r.mime, bytes: r.bytes, width: r.width, height: r.height }) : Object.assign({}, b, { bytes: null }));
    }
    return toMarkdown(out);
  }
  /** 가져온 뒤 문서 크기 제한으로 빠진 그림 안내(mod-editor가 RN.docs.lastImportInfo.imagesSkipped에 적는다) */
  function skippedImagesMessage() {
    const info = RN.docs && RN.docs.lastImportInfo;
    const n = info && Number(info.imagesSkipped);
    return n > 0 ? ` 그림 ${n}개는 문서 크기 제한으로 빠졌어요.` : "";
  }
  /** 문서를 열어(파싱) 그림 블록만 → { images, notes } */
  async function extractImages(input, opts) {
    const res = await parseAny(toBytes(input), opts);
    return { images: res.blocks.filter((b) => b.type === "image"), notes: res.notes };
  }

  // =====================================================================
  // 화면 공통
  // =====================================================================
  const fmtSize = (n) => (n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${Math.round(n / 1024)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);
  const baseName = (name) => String(name || "문서").replace(/\.[^.]+$/, "").slice(0, 120) || "문서";
  const errMessage = (e) => (e && e.code && MESSAGES[e.code]) || (e && e.message && /[가-힣]/.test(e.message) ? e.message : MESSAGES.bad_file);

  async function listMyProjects() {
    if (RN.docs && typeof RN.docs.listProjects === "function") {
      const list = await RN.docs.listProjects();
      return (list || []).filter((p) => !p.deletedAt && !p.archivedAt);
    }
    const coll = RN.userColl ? RN.userColl("projects") : null;
    if (!coll) return [];
    const snap = await coll.get();
    return snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((p) => !p.deletedAt && !p.archivedAt);
  }
  /** 항상 새 문서를 만든다(기존 문서를 덮어쓰지 않는다) */
  async function createImportedDoc(projectId, input) {
    if (!RN.docs || typeof RN.docs.createDoc !== "function") throw new Error("문서 기능을 아직 쓸 수 없어요. 잠시 뒤 다시 해 보세요.");
    return RN.docs.createDoc(projectId, Object.assign({ reason: "IMPORT" }, input));
  }

  RN.css("convert", `
    .cv-drop { display: flex; flex-direction: column; gap: 6px; padding: 18px; border: 1.5px dashed var(--line); border-radius: var(--radius); background: var(--surface); }
    .cv-drop[data-over="1"] { border-color: var(--accent); background: var(--accent-soft); }
    .cv-drop input[type="file"] { max-width: 100%; font: inherit; }
    .cv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
    .cv-bar .cv-name { font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
    .cv-notes { margin: 0; padding: 0; list-style: none; color: var(--muted); font-size: 0.85rem; }
    .cv-paper { background: var(--paper); color: var(--paper-fg); border-radius: 4px; box-shadow: 0 1px 3px color-mix(in srgb, var(--fg) 18%, transparent);
      padding: clamp(18px, 6vw, 56px); max-width: 1080px; width: 100%; margin: 0 auto; font-family: var(--font-body); font-size: 1rem; line-height: 1.75;
      overflow-wrap: anywhere; min-width: 0; }
    .cv-paper > * + * { margin-top: 0.8em; }
    .cv-paper h2 { font-size: 1.35rem; margin-top: 1.4em; } .cv-paper h3 { font-size: 1.12rem; margin-top: 1.2em; } .cv-paper h4 { font-size: 1rem; margin-top: 1em; }
    .cv-paper > :first-child { margin-top: 0; }
    .cv-paper p { white-space: pre-wrap; }
    .cv-paper .cv-note { font-size: 0.88rem; }
    .cv-paper .cv-tw { overflow-x: auto; max-width: 100%; }
    .cv-paper table { border-collapse: collapse; font-size: 0.92rem; min-width: 60%; }
    .cv-paper th, .cv-paper td { border: 1px solid color-mix(in srgb, var(--paper-fg) 40%, transparent); padding: 4px 9px; vertical-align: top; text-align: left; white-space: pre-wrap; min-width: 3em; }
    .cv-paper caption { caption-side: top; text-align: left; font-size: 0.88rem; padding-bottom: 4px; }
    .cv-paper .cv-eq { font-family: var(--font-mono); font-size: 0.9em; background: color-mix(in srgb, var(--paper-fg) 7%, transparent); border-radius: 3px; padding: 0 3px; }
    .cv-paper .cv-fig { margin-left: 0; margin-right: 0; }
    .cv-paper .cv-fig img { display: block; max-width: 100%; height: auto; }
    .cv-unsaved { margin: 0; }
    .cv-imgs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .cv-imgs li { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .cv-imgs .cv-thumb { width: 48px; height: 48px; object-fit: contain; flex: none; background: var(--paper); border-radius: 3px; border: 1px solid var(--line); }
    .cv-imgs .cv-imgname { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .cv-dialog .rn-field { margin-bottom: 12px; }
  `);

  /** 문단 글자 안의 "[수식: …]"은 구분해 보이게 */
  function inlineNodes(text) {
    const parts = [];
    const re = /\[수식: [^\n]*?\]/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(h("span", { class: "cv-eq" }, m[0]));
      last = re.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }
  /** urlOf(block) → blob: URL(그림 미리보기). 없으면 그림은 건너뛴다 */
  function renderBlocks(blocks, urlOf) {
    const frag = document.createDocumentFragment();
    for (const b of blocks) {
      if (b.type === "image") {
        const src = urlOf && urlOf(b);
        if (src) frag.append(h("figure", { class: "cv-fig" }, h("img", { src, alt: `그림 ${b.n}`, width: b.width || null, height: b.height || null, decoding: "async" })));
      } else if (b.type === "heading") frag.append(h(b.level <= 1 ? "h2" : b.level === 2 ? "h3" : "h4", {}, b.text));
      else if (b.type === "paragraph") frag.append(h("p", { class: b.note ? "cv-note" : null }, inlineNodes(b.text)));
      else if (b.type === "table") {
        const covered = new Set();
        const at = new Map(b.cells.map((c) => [c.row + ":" + c.col, c]));
        for (const c of b.cells) for (let r = c.row; r < c.row + c.rowSpan; r++) for (let k = c.col; k < c.col + c.colSpan; k++) if (r !== c.row || k !== c.col) covered.add(r + ":" + k);
        const trs = [];
        for (let r = 0; r < b.rows; r++) {
          const tds = [];
          for (let k = 0; k < b.cols; k++) {
            if (covered.has(r + ":" + k)) continue;
            const c = at.get(r + ":" + k);
            tds.push(h("td", { rowSpan: c && c.rowSpan > 1 ? c.rowSpan : null, colSpan: c && c.colSpan > 1 ? c.colSpan : null }, c ? inlineNodes(c.text) : ""));
          }
          trs.push(h("tr", {}, tds));
        }
        frag.append(h("div", { class: "cv-tw" }, h("table", {}, b.caption ? h("caption", {}, b.caption) : null, h("tbody", {}, trs))));
      }
    }
    return frag;
  }

  /** 파일 → { kind, result } (진행 표시는 say로) */
  async function readHwpFile(file, say) {
    if (file.size > MAX_FILE) fail("too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (kind === "hwp3") fail("old_hwp");
    if (!kind) fail("not_hwp");
    const result = await parseAny(bytes, { onProgress: (f) => say && say(`읽는 중… ${Math.round(f * 100)}%`) });
    return result;
  }

  // =====================================================================
  // 화면 convert — 한글 파일 열기
  // =====================================================================
  RN.view("convert", {
    title: "한글 파일 열기",
    mount(root) {
      let alive = true, current = null, busy = 0;
      // 그림 미리보기 blob: URL — 같은 바이트는 한 URL, 다른 파일을 열거나 화면을 떠나면 놓아 준다
      let urls = new Map();
      const urlOf = (b) => {
        if (!b.bytes) return null;
        let u = urls.get(b.bytes);
        if (!u) { u = URL.createObjectURL(new Blob([b.bytes], { type: b.mime })); urls.set(b.bytes, u); }
        return u;
      };
      const dropUrls = () => { for (const u of urls.values()) { try { URL.revokeObjectURL(u); } catch { /* 무시 */ } } urls = new Map(); };
      const fileInput = h("input", { type: "file", id: "convert-file", accept: ".hwp,.hwpx" });
      const status = h("div", { id: "convert-status", "aria-live": "polite", hidden: true });
      const out = h("div", { class: "rn-stack", id: "convert-out" });
      const drop = h("div", { class: "cv-drop" },
        h("label", { for: "convert-file" }, "한글 파일(.hwp, .hwpx)을 고르거나 여기에 끌어다 놓으세요."),
        fileInput);
      root.append(
        h("h1", {}, "한글 파일 열기"),
        h("p", { class: "rn-muted", id: "convert-hint" }, "글자·표·그림을 읽어 옵니다. 쪽 배치와 글꼴은 원본과 다릅니다."),
        drop, status, out);

      const say = (t, kind) => { status.hidden = !t; status.replaceChildren(t ? RN.notice(t, kind) : ""); };
      async function openFile(file) {
        if (!file) return;
        const my = ++busy;
        out.replaceChildren();
        dropUrls();
        current = null;
        say("읽는 중…");
        try {
          const res = await readHwpFile(file, (t) => { if (alive && my === busy) say(t); });
          if (!alive || my !== busy) return;
          current = { name: file.name, res, markdown: toMarkdown(res.blocks, { images: "placeholder" }) };
          say("");
          draw();
        } catch (e) {
          if (!alive || my !== busy) return;
          if (!(e && e.code)) console.warn(e);
          say(errMessage(e), "error");
        }
      }
      fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; openFile(f).finally(() => { fileInput.value = ""; }); });
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.dataset.over = "1"; });
      drop.addEventListener("dragleave", () => { delete drop.dataset.over; });
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        delete drop.dataset.over;
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) openFile(f);
      });

      function draw() {
        const s = current;
        const blocks = s.res.blocks;
        const paras = blocks.filter((b) => b.type !== "table" && b.type !== "image").length, tables = blocks.filter((b) => b.type === "table").length;
        const images = blocks.filter((b) => b.type === "image");
        dropUrls();
        const blocked = RN.writeBlockedReason();
        const importBtn = blocked ? null : h("button", { type: "button", class: "rn-btn rn-primary", id: "convert-import", onclick: () => importDialog() }, "내 프로젝트로 가져오기");
        const saveBtn = RN.caps.downloads ? h("button", { type: "button", class: "rn-btn", id: "convert-save", onclick: async () => {
          saveBtn.disabled = true;
          try {
            const r = await RN.caps.downloads.save({ filename: baseName(s.name) + ".md", data: s.markdown });
            if (r && r.status === "saved") RN.toast("텍스트 파일을 저장했어요.");
          } catch (e) {
            if (!(e && e.code === "declined")) RN.toast("저장하지 못했어요.", "error");
          } finally { saveBtn.disabled = false; }
        } }, "텍스트로 저장") : null;
        // 그림 저장: 같은 BinData를 여러 곳에 쓴 그림은 한 번만 보인다. 저장마다 사용자 확인이 뜨므로 한꺼번에 받기는 없다.
        const uniq = [];
        const seenBytes = new Map();
        for (const b of images) {
          const u = seenBytes.get(b.bytes);
          if (u) u.also.push(b.n); else { const it = { b, also: [] }; seenBytes.set(b.bytes, it); uniq.push(it); }
        }
        const imgPanel = RN.caps.downloads && uniq.length ? h("ul", { class: "cv-imgs", id: "convert-images", hidden: true, "aria-label": "그림 목록" },
          uniq.map(({ b, also }, i) => {
            const label = `그림 ${b.n}` + (also.length ? `(${also.map((k) => "그림 " + k).join(", ")}와 같음)` : "");
            const btn = h("button", { type: "button", class: "rn-btn", id: `convert-img-save-${i}`, "aria-label": `그림 ${b.n} 저장`, onclick: async () => {
              btn.disabled = true;
              try {
                const r = await RN.caps.downloads.save({ filename: `${baseName(s.name)}-그림${b.n}.${EXT_OF[b.mime] || "png"}`, data: new Blob([b.bytes], { type: b.mime }) });
                if (r && r.status === "saved") RN.toast(`그림 ${b.n}을 저장했어요.`);
              } catch (e) {
                if (!(e && e.code === "declined")) RN.toast("저장하지 못했어요.", "error");
              } finally { btn.disabled = false; }
            } }, "저장");
            return h("li", {},
              h("img", { class: "cv-thumb", src: urlOf(b), alt: "" }),
              h("span", { class: "cv-imgname" }, label, h("br"), h("span", { class: "rn-muted rn-small" }, [b.width && b.height ? `${b.width}×${b.height} · ` : "", fmtSize(b.bytes.length)].join(""))),
              btn);
          })) : null;
        const imgBtn = imgPanel ? h("button", { type: "button", class: "rn-btn", id: "convert-images-btn", "aria-expanded": "false", "aria-controls": "convert-images", onclick: () => {
          imgPanel.hidden = !imgPanel.hidden;
          imgBtn.setAttribute("aria-expanded", String(!imgPanel.hidden));
        } }, "그림 저장") : null;
        const paper = h("article", { class: "cv-paper", id: "convert-paper", "aria-label": s.name + " 미리보기", tabIndex: 0 });
        if (blocks.length) paper.append(renderBlocks(blocks, urlOf));
        else paper.append(h("p", {}, "읽어 올 글자가 없어요."));
        out.replaceChildren(
          h("div", { class: "cv-bar" },
            h("p", { id: "convert-summary", role: "status" }, h("span", { class: "cv-name" }, s.name), h("span", { class: "rn-muted rn-small" }, ` · 문단 ${paras}개 · 표 ${tables}개` + (images.length ? ` · 그림 ${images.length}개` : ""))),
            h("div", { class: "rn-row" }, saveBtn, imgBtn, importBtn)),
          // 연 파일은 어디에도 저장되지 않는다는 한 줄 안내(쓸 수 없는 화면에서는 그 이유)
          h("p", { class: "rn-small rn-muted cv-unsaved", id: "convert-unsaved" },
            blocked || "아직 저장되지 않았어요. ‘내 프로젝트로 가져오기’를 누르면 문서로 저장되고, 그 뒤로는 자동 저장돼요."),
          imgPanel,
          s.res.notes.length ? h("ul", { class: "cv-notes", id: "convert-notes" }, s.res.notes.map((n) => h("li", {}, n))) : null,
          paper);
      }

      async function importDialog() {
        const s = current;
        if (!s) return;
        if (!s.res.blocks.length) { RN.toast("가져올 글자가 없어요.", "error"); return; }
        const proj = h("select", { id: "convert-project" }, h("option", { value: "" }, "불러오는 중…"));
        const title = h("input", { type: "text", id: "convert-title", value: baseName(s.name), maxLength: 200 });
        const msg = h("div", { "aria-live": "polite" });
        const ok = h("button", { type: "submit", class: "rn-btn rn-primary", id: "convert-import-ok", disabled: true }, "가져오기");
        const cancel = h("button", { type: "button", class: "rn-btn", onclick: () => close() }, "취소");
        const form = h("form", { method: "dialog" },
          h("h2", { style: { marginBottom: "14px" } }, "내 프로젝트로 가져오기"),
          RN.field("프로젝트", proj), RN.field("새 문서 제목", title), msg,
          h("div", { class: "rn-row rn-end" }, cancel, ok));
        const dlg = h("dialog", { class: "rn-dialog cv-dialog", id: "convert-dialog", "aria-label": "내 프로젝트로 가져오기" }, form);
        const close = () => { try { dlg.close(); } catch { /* 무시 */ } dlg.remove(); };
        dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!proj.value) return;
          ok.disabled = true;
          try {
            const pid = proj.value;
            if (s.res.blocks.some((b) => b.type === "image")) msg.replaceChildren(RN.notice("그림을 줄이는 중…"));
            if (s.importMarkdown == null) s.importMarkdown = await toImportMarkdown(s.res.blocks);
            const docId = await createImportedDoc(pid, { title: title.value.trim() || baseName(s.name), markdown: s.importMarkdown, sourceName: s.name });
            close();
            RN.toast("새 문서로 가져왔어요." + skippedImagesMessage());
            if (docId) RN.go("editor", { projectId: pid, docId });
          } catch (err) {
            msg.replaceChildren(RN.notice((err && err.message) || "가져오지 못했어요.", "error"));
            ok.disabled = false;
          }
        });
        document.body.append(dlg);
        dlg.showModal();
        try {
          const list = await listMyProjects();
          if (!dlg.isConnected) return;
          if (!list.length) {
            proj.replaceChildren(h("option", { value: "" }, "프로젝트 없음"));
            msg.replaceChildren(RN.notice("먼저 '내 프로젝트'에서 프로젝트를 만드세요.", "warn"));
            return;
          }
          proj.replaceChildren(...list.map((p) => h("option", { value: p.id }, p.title || "제목 없음")));
          ok.disabled = false;
        } catch {
          proj.replaceChildren(h("option", { value: "" }, "불러오지 못함"));
          msg.replaceChildren(RN.notice("프로젝트 목록을 불러오지 못했어요.", "error"));
        }
      }

      return () => { alive = false; dropUrls(); const d = document.getElementById("convert-dialog"); if (d) { try { d.close(); } catch { /* 무시 */ } d.remove(); } };
    },
  });

  // =====================================================================
  // 프로젝트 홈 섹션 "가져오기": .md, .txt, .hwp, .hwpx → 새 문서
  // =====================================================================
  function decodeText(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes.subarray(3));
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("euc-kr").decode(bytes); }
  }
  function mountImportSection(container, project) {
    const pid = project && (project.id || project.projectId);
    const blocked = RN.writeBlockedReason();
    const input = h("input", { type: "file", id: "import-file", accept: ".md,.markdown,.txt,.hwp,.hwpx,text/markdown,text/plain" });
    const status = h("div", { id: "import-status", "aria-live": "polite" });
    container.append(h("section", { class: "rn-stack", "aria-labelledby": "import-sec-h" },
      h("h2", { id: "import-sec-h" }, "가져오기"),
      h("p", { class: "rn-small rn-muted" }, "Markdown·텍스트·한글(.hwp, .hwpx) 파일을 이 프로젝트의 새 문서로 만들어요."),
      blocked ? RN.notice(blocked, "warn") : RN.field("가져올 파일", input),
      status));
    if (blocked) return;
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const say = (t, kind) => status.replaceChildren(RN.notice(t, kind));
      say("파일을 읽는 중…");
      try {
        if (file.size > MAX_FILE) fail("too_large");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const title = baseName(file.name);
        const kind = sniff(bytes);
        let payload;
        if (kind === "hwp" || kind === "hwpx" || kind === "hwp3" || /\.(hwp|hwpx)$/i.test(file.name)) {
          const res = await parseAny(bytes, { onProgress: (f) => say(`읽는 중… ${Math.round(f * 100)}%`) });
          if (!res.blocks.length) throw new Error("가져올 글자가 없어요.");
          if (res.blocks.some((b) => b.type === "image")) say("그림을 줄이는 중…");
          payload = { title, markdown: await toImportMarkdown(res.blocks), sourceName: file.name };
        } else if (/\.(md|markdown)$/i.test(file.name)) payload = { title, markdown: decodeText(bytes), sourceName: file.name };
        else if (/\.txt$/i.test(file.name) || file.type === "text/plain") payload = { title, text: decodeText(bytes), sourceName: file.name };
        else throw new Error("가져올 수 없는 파일이에요. .md, .txt, .hwp, .hwpx만 돼요.");
        say("새 문서를 만드는 중…");
        const docId = await createImportedDoc(pid, payload);
        status.replaceChildren(h("p", { role: "status" }, `"${title}" 문서를 만들었어요. `,
          docId ? h("button", { type: "button", class: "rn-link", onclick: () => RN.go("editor", { projectId: pid, docId }) }, "열기") : null));
        RN.toast("새 문서로 가져왔어요." + (payload.markdown != null ? skippedImagesMessage() : ""));
      } catch (e) {
        say(errMessage(e), "error");
      } finally { input.value = ""; }
    });
  }

  RN.projectSections = RN.projectSections || [];
  RN.projectSections.push({ id: "import", label: "가져오기", mount: mountImportSection });
  RN._convert = { parseHwp, parseHwpx, parseAny, toMarkdown, toText, sniff, decodeText, MESSAGES, extractImages, imageInfo, shrinkImage, toImportMarkdown, LIMITS: { MAX_IMAGES, MAX_IMAGE_BYTES, SHRINK } };
})();
