/* mod-research.js (담당 A) — 화면 explore / research / publish + 프로젝트 홈 섹션 "연구 공개·추천"
   검색은 mod-search.js의 RN.search / RN.searchExpanded / RN.similarResearch / RN.recommend를 쓴다.
   결과보고서: 내 문서에서 만든 HTML(report) 또는 올린 PDF(reportAsset, RN.caps.assets) 둘 중 하나.
   PDF 미리보기는 pdf.js를 필요할 때만 RN.loadScript로 불러와 메인 스레드("가짜 워커")에서 그린다. */
(function () {
  "use strict";
  const RN = window.RN;
  if (!RN) return;
  const { h } = RN;
  const REPORT_MAX_BYTES = 200 * 1024;
  const PDF_MAX_BYTES = 20 * 1024 * 1024; // assets의 PDF 한도(20 MiB)
  const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const ASSET_ID = /^[A-Za-z0-9_-]{8,128}$/;
  const ASSET_OFF_CODES = new Set(["not_granted", "capability_disabled", "capability_removed"]);
  const SAMPLE_OFF_CODES = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);

  RN.css("research", `
    .rs-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .rs-search { display: flex; flex-wrap: wrap; gap: 8px; }
    .rs-search input { flex: 1 1 220px; }
    .rs-list { display: flex; flex-direction: column; list-style: none; margin: 0; padding: 0; }
    .rs-item { display: flex; flex-direction: column; gap: 4px; padding: 14px 0; border-bottom: 1px solid var(--line); min-width: 0; }
    .rs-item:last-child { border-bottom: 0; }
    .rs-title { font: inherit; font-family: var(--font-display); font-weight: 600; font-size: 1.05rem; color: var(--accent); background: none; border: 0; padding: 0; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .rs-title.rs-small-title { font-size: 0.98rem; }
    .rs-title:hover { text-decoration: underline; }
    .rs-summary { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .rs-meta { font-size: 0.85rem; color: var(--muted); overflow-wrap: anywhere; }
    .rs-ex { font-size: 0.75rem; color: var(--warn); }
    .rs-empty { font-weight: 600; color: var(--warn); }
    .rs-terms { font-size: 0.88rem; color: var(--muted); overflow-wrap: anywhere; }
    .rs-section { display: flex; flex-direction: column; gap: 10px; }
    .rs-detail { display: flex; flex-direction: column; gap: 30px; max-width: 860px; }
    .rs-detail-head { display: flex; flex-direction: column; gap: 8px; }
    .rs-detail-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .rs-paper { background: var(--paper); color: var(--paper-fg); border: 1px solid var(--line); border-radius: 4px; padding: clamp(16px, 5vw, 48px); overflow-x: auto; box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); font-family: "Noto Serif KR", serif; line-height: 1.7; }
    .rs-paper h1, .rs-paper h2, .rs-paper h3, .rs-paper h4 { color: var(--paper-fg); margin: 1em 0 0.5em; }
    .rs-paper p { margin: 0 0 0.8em; }
    .rs-paper table { border-collapse: collapse; margin: 0.8em 0; max-width: 100%; }
    .rs-paper th, .rs-paper td { border: 1px solid currentColor; padding: 4px 8px; }
    .rs-paper img, .rs-paper svg { max-width: 100%; height: auto; }
    .rs-paper figure { margin: 1em 0; text-align: center; }
    .rs-paper a { color: inherit; }
    .rs-pdf { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .rs-pdf-pages { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .rs-pdf-pages canvas { display: block; width: 100%; height: auto; background: var(--paper); border: 1px solid var(--line); box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
    .rs-form { display: flex; flex-direction: column; gap: 16px; max-width: 680px; }
    .rs-choice { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .rs-choice legend { font-size: 0.85rem; font-weight: 500; padding: 0; margin-bottom: 4px; }
    .rs-choice .rn-row label { display: inline-flex; align-items: center; gap: 6px; }
    .rs-choice input[type="file"] { max-width: 100%; font: inherit; font-size: 0.88rem; }
  `);

  // ---------- 공통 조각 ----------
  const excerpt = (t, n) => (RN.searchUtil ? RN.searchUtil.excerpt(t, n) : String(t || "").slice(0, n));
  const painCountOf = (id) => (RN.shared.pains || []).filter((p) => p.researchId === id && !p.isAnonymous).length;
  /** 저장된 reportAsset이 쓸 만한 모양이면 정리해서, 아니면 null */
  function validAsset(a) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !ASSET_ID.test(a.id)) return null;
    return { id: a.id, filename: String(a.filename || "결과보고서.pdf").slice(0, 160), sizeBytes: Number(a.sizeBytes) || 0 };
  }
  const hasReportOf = (r) => (r.hasReport != null ? r.hasReport : !!(r.report && r.report.html) || !!validAsset(r.reportAsset));
  const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB");
  /** "a · b · c" 한 줄. 빈 값은 건너뛴다. 노드도 넣을 수 있다. */
  function metaLine(cls, parts, tail) {
    const el = h("p", { class: cls || "rs-meta" });
    parts.filter((x) => x != null && x !== "" && x !== false).forEach((p, i) => { if (i) el.append(" · "); el.append(p instanceof Node ? p : String(p)); });
    if (tail) el.append(" ", tail);
    return el;
  }

  /** 연구 한 줄 항목 (검색 결과 또는 RN.shared.research 원본): 제목, 요약 두 줄, 메타 한 줄 */
  function researchCard(r) {
    const painCount = r.painCount != null ? r.painCount : painCountOf(r.id);
    const kws = (Array.isArray(r.keywords) ? r.keywords : []).filter(Boolean).slice(0, 3);
    return h("article", { class: "rs-item rs-card", dataset: { researchId: r.id } },
      h("button", { type: "button", class: "rs-title", onclick: () => RN.go("research", { id: r.id }) }, r.title || "(제목 없음)"),
      r.summary ? h("p", { class: "rs-summary" }, excerpt(r.summary, 200)) : null,
      metaLine("rs-meta", [r.field, "고충 " + painCount + "건", hasReportOf(r) ? "결과보고서 있음" : null, kws.length ? kws.map((k) => "#" + k).join(" ") : null],
        r.isExample ? h("span", { class: "rs-ex" }, "예시") : null));
  }
  const researchList = (items) => h("div", { class: "rs-list" }, items.map((r) => researchCard(r)));

  /** 고충 목록 (검색 결과 또는 원본). 작성자 정보는 표시하지 않는다. */
  function painList(items) {
    return h("ul", { class: "rs-list rs-pain-list" }, items.map((p) => h("li", { class: "rs-item", dataset: { painId: p.id } },
      h("button", { type: "button", class: "rs-title rs-small-title", onclick: () => RN.go("pain", { id: p.id }) }, p.title || "(제목 없음)"),
      h("p", { class: "rs-summary rn-small" }, p.excerpt != null ? p.excerpt : excerpt(p.body, 140)),
      metaLine("rs-meta", [RN.STAGES[p.stage] || "기타", p.resolved ? "해결됨" : "미해결", (p.tags || []).slice(0, 3).map((t) => "#" + t).join(" ")],
        p.isExample ? h("span", { class: "rs-ex" }, "예시") : null))));
  }

  /** 공유 데이터 상태 안내. 보여 줄 수 있으면 null */
  function sharedBlocked(s, which) {
    if (s.error === "signed_out" || !RN.caps.db) return RN.notice("연구와 고충은 Claude에 로그인한 사람에게만 보여요. 로그인한 뒤 다시 열어 주세요.", "warn");
    if (!s.loaded[which]) return RN.notice("불러오는 중…");
    if (s.error === "timeout" && !(s[which] || []).length) return RN.notice("데이터에 연결하지 못했어요. 잠시 뒤 다시 열어 주세요.", "error");
    if (s.error && s.error !== "timeout" && !(s[which] || []).length) return RN.notice("데이터를 불러오지 못했어요 (" + s.error + ").", "error");
    return null;
  }

  // ---------- 보고서 HTML 정리 (허용 목록) ----------
  const ALLOWED_TAGS = new Set(("p h1 h2 h3 h4 h5 h6 ul ol li strong em b i u s del sub sup br hr blockquote pre code table thead tbody tfoot tr th td caption colgroup col figure figcaption img span div section article header footer small mark " +
    "math semantics annotation mrow mi mo mn ms mtext mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mstyle mpadded mphantom menclose " +
    "svg g path line rect circle ellipse polyline polygon text tspan title defs clippath").split(" "));
  const ALLOWED_ATTRS = new Set(("colspan rowspan alt width height style class data-caption-number " +
    "viewbox d x y x1 x2 y1 y2 cx cy r rx ry points fill stroke stroke-width stroke-dasharray opacity fill-opacity transform text-anchor font-size font-weight font-family dominant-baseline clip-path preserveaspectratio " +
    "mathvariant display encoding stretchy fence separator lspace rspace accent accentunder columnalign rowspacing columnspacing scriptlevel displaystyle notation").split(" "));
  const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "link", "meta", "form", "input", "button", "textarea", "select", "foreignobject"]);

  /** 저장된 보고서 HTML을 파싱해 허용한 요소·속성만 새로 만든다 (innerHTML로 넣지 않음) */
  function sanitizeReport(html) {
    const frag = document.createDocumentFragment();
    let parsed;
    try { parsed = new DOMParser().parseFromString(String(html || ""), "text/html"); } catch { return frag; }
    const walk = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === 3) { dst.append(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.localName.toLowerCase();
        if (DROP_WITH_CONTENT.has(tag)) continue;
        if (!ALLOWED_TAGS.has(tag)) { walk(n, dst); continue; } // 태그만 벗기고 내용은 남긴다
        const el = n.namespaceURI && n.namespaceURI !== "http://www.w3.org/1999/xhtml" ? document.createElementNS(n.namespaceURI, n.localName) : document.createElement(tag);
        for (const a of n.attributes) {
          const name = a.name.toLowerCase();
          if (!ALLOWED_ATTRS.has(name)) continue;
          let v = a.value;
          if (name === "style" && /url\s*\(|expression|@import|javascript:/i.test(v)) continue;
          if (name === "class") v = v.split(/\s+/).filter((c) => /^(katex|caption|figure|table|align|math)/.test(c)).join(" ");
          try { el.setAttribute(a.name, v); } catch { /* 잘못된 속성 이름 */ }
        }
        if (tag === "img") {
          const src = n.getAttribute("src") || "";
          if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) el.setAttribute("src", src); else continue; // 외부 이미지는 불러올 수 없다
        }
        walk(n, el);
        dst.append(el);
      }
    };
    walk(parsed.body, frag);
    return frag;
  }

  function reportHtmlDocument(r) {
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc((r.report && r.report.title) || r.title)}</title>` +
      `<style>body{max-width:800px;margin:40px auto;padding:0 24px;font-family:"Noto Serif KR",serif;line-height:1.7;color:#111;background:#fff}table{border-collapse:collapse}th,td{border:1px solid #333;padding:4px 8px}img,svg{max-width:100%}</style>` +
      `</head><body>${r.report.html}</body></html>`;
  }

  function downloadsErrorToast(e) {
    const code = e && e.code;
    if (code === "declined") return; // 사용자가 취소함: 오류 아님
    if (code === "rate_limited") RN.toast("저장 창이 이미 열려 있어요. 잠시 뒤 다시 눌러 주세요.", "error");
    else RN.toast("이 화면에서는 파일을 저장할 수 없어요.", "error");
  }
  const safeBase = (s, fallback) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;

  async function saveReport(r) {
    const dl = RN.caps.downloads;
    if (!dl || !r.report) return;
    try {
      const res = await dl.save({ filename: safeBase((r.report && r.report.title) || r.title, "결과보고서") + ".html", data: reportHtmlDocument(r) });
      if (res && res.status === "saved") RN.toast("결과보고서를 저장했어요.");
    } catch (e) { downloadsErrorToast(e); }
  }

  // ---------- 결과보고서 PDF (assets) ----------
  let assetsOff = false; // 이 화면에서 assets를 쓸 수 없다는 오류를 받으면 올리기 UI를 숨긴다
  const canUpload = () => !!RN.caps.assets && !assetsOff && !!RN.caps.canWrite;
  const assetUrls = new Map(); // 이번 세션에 올린 파일: id → 업로드가 돌려준 url
  const bytesCache = new Map(); // id → Promise<ArrayBuffer> (최근 3개)

  /** 표시용 주소: 업로드가 돌려준 url → (로컬 mock) blob: url → "/_blob/" + id */
  function assetUrl(id) {
    if (assetUrls.has(id)) return assetUrls.get(id);
    const mock = window.__mockAssets && typeof window.__mockAssets.get === "function" ? window.__mockAssets.get(id) : null;
    if (mock && mock.url) return mock.url;
    return "/_blob/" + encodeURIComponent(id);
  }
  const isPdfHead = (bytes) => bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";

  /** 같은 출처 주소에서 PDF 바이트를 받는다. PDF가 아니면 실패. */
  function fetchPdfBytes(id) {
    if (!bytesCache.has(id)) {
      const p = fetch(assetUrl(id)).then((res) => {
        if (!res.ok) throw Object.assign(new Error("파일을 받지 못했어요 (" + res.status + ")"), { code: "fetch_failed" });
        return res.arrayBuffer();
      }).then((buf) => {
        if (!isPdfHead(new Uint8Array(buf, 0, Math.min(5, buf.byteLength)))) throw Object.assign(new Error("PDF가 아니에요"), { code: "not_pdf" });
        return buf;
      });
      p.catch(() => bytesCache.delete(id));
      bytesCache.set(id, p);
      while (bytesCache.size > 3) bytesCache.delete(bytesCache.keys().next().value);
    }
    return bytesCache.get(id);
  }

  /** 고른 파일 검사. 문제가 없으면 null, 있으면 안내 문구. */
  async function checkPdf(file) {
    if (!file) return "PDF 파일을 골라 주세요.";
    if (!file.size) return "빈 파일이에요.";
    if (file.size > PDF_MAX_BYTES) return "파일이 20MB를 넘어요. 용량을 줄여 주세요.";
    let head;
    try { head = new Uint8Array(await file.slice(0, 5).arrayBuffer()); } catch { return "파일을 읽지 못했어요."; }
    if (!isPdfHead(head)) return "PDF 파일이 아니에요.";
    return null;
  }

  function uploadErrorCopy(code) {
    switch (code) {
      case "too_large": return "파일이 20MB를 넘어요. 용량을 줄여 주세요.";
      case "unsupported_type": return "PDF 파일만 올릴 수 있어요.";
      case "invalid_request": return "이 파일은 올릴 수 없어요. 다른 PDF로 해 보세요.";
      case "quota_or_state": return "저장 공간이 가득 찼거나 지금은 파일을 받을 수 없어요. 아티팩트 주인에게 알려 주세요.";
      case "rate_limited": return "요청이 많아요. 잠시 뒤 다시 해 주세요.";
      case "upstream_auth": return "로그인이 풀렸어요. 새로 고친 뒤 다시 해 주세요.";
      case "store_unavailable": return "지금 파일 저장소에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.";
      default:
        if (ASSET_OFF_CODES.has(code)) return "이 화면에서는 파일을 올릴 수 없어요.";
        return "PDF를 올리지 못했어요 (" + (code || "오류") + ").";
    }
  }
  const cleanFilename = (name) => {
    const base = safeBase(String(name || "").replace(/\.pdf$/i, ""), "결과보고서");
    return base + ".pdf";
  };

  /** 올리고 { id, filename, sizeBytes }를 돌려준다. 실패하면 { code }를 던진다. */
  async function uploadPdf(file) {
    const assets = RN.caps.assets;
    if (!assets || assetsOff) throw { code: "not_granted" };
    const once = () => assets.upload(file, { type: "application/pdf" });
    let res;
    try { res = await once(); }
    catch (e) {
      const code = e && e.code;
      if (code === "store_unavailable") { await new Promise((r) => setTimeout(r, 1500)); try { res = await once(); } catch (e2) { throw { code: (e2 && e2.code) || "upstream_error" }; } }
      else { if (ASSET_OFF_CODES.has(code)) assetsOff = true; throw { code: code || "upstream_error" }; }
    }
    if (!res || typeof res.id !== "string" || !ASSET_ID.test(res.id)) throw { code: "upstream_error" };
    if (res.url) assetUrls.set(res.id, res.url);
    return { id: res.id, filename: cleanFilename(file.name), sizeBytes: Number(res.sizeBytes) || file.size };
  }
  /** 내가 올린 자산 지우기. 실패해도 화면 흐름은 막지 않는다(남은 파일은 가리키는 행이 없을 뿐). */
  async function deleteAsset(id) {
    const assets = RN.caps.assets;
    if (!assets || !id) return false;
    try { await assets.delete(id); assetUrls.delete(id); bytesCache.delete(id); return true; }
    catch (e) { console.warn("결과보고서 PDF를 지우지 못했어요", e && e.code); return false; }
  }

  async function savePdf(asset) {
    const dl = RN.caps.downloads;
    if (!dl) return;
    let buf;
    try { buf = await fetchPdfBytes(asset.id); } catch { RN.toast("PDF 파일을 불러오지 못했어요.", "error"); return; }
    try {
      const res = await dl.save({ filename: cleanFilename(asset.filename), data: new Blob([buf], { type: "application/pdf" }) });
      if (res && res.status === "saved") RN.toast("PDF를 저장했어요.");
    } catch (e) { downloadsErrorToast(e); }
  }

  // pdf.js: 필요할 때만 불러온다. 아티팩트에서는 외부 URL로 Worker를 만들 수 없으므로
  // 워커 스크립트도 메인 스레드에 불러와 전역 pdfjsWorker가 생기게 한다 → pdf.js가 "가짜 워커"로 돈다.
  let pdfjsLoading = null;
  function loadPdfjs() {
    if (!pdfjsLoading) {
      pdfjsLoading = (async () => {
        await RN.loadScript(PDFJS_URL);
        await RN.loadScript(PDFJS_WORKER_URL);
        const lib = window.pdfjsLib;
        if (!lib || typeof lib.getDocument !== "function" || !(window.pdfjsWorker && window.pdfjsWorker.WorkerMessageHandler)) throw new Error("pdf.js를 쓸 수 없어요");
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return lib;
      })();
      pdfjsLoading.catch(() => { pdfjsLoading = null; });
    }
    return pdfjsLoading;
  }

  /** 상세 화면의 PDF 뷰어: 첫 쪽부터 그리고 "다음 쪽 더 보기"로 한 쪽씩 이어 그린다. 실패하면 안내 + "PDF 저장"만. */
  function pdfViewer(asset) {
    const status = h("p", { class: "rn-notice", role: "status", id: "research-pdf-status" }, "미리보기를 여는 중…");
    const pages = h("div", { class: "rs-pdf-pages", id: "research-pdf-pages" });
    const more = h("button", { type: "button", class: "rn-btn", id: "research-pdf-more", hidden: true }, "다음 쪽 더 보기");
    const save = RN.caps.downloads ? h("button", { type: "button", class: "rn-btn", id: "research-pdf-save", onclick: () => savePdf(asset) }, "PDF 저장") : null;
    const wrap = h("div", { class: "rs-pdf", id: "research-pdf", dataset: { assetId: asset.id } },
      h("div", { class: "rn-row rn-between" }, h("span", { class: "rn-small rn-muted" }, asset.filename + (asset.sizeBytes ? " · " + fmtSize(asset.sizeBytes) : "")), save),
      status, pages, more);
    let doc = null, next = 1, failed = false;
    const fail = (e) => {
      if (failed) return;
      failed = true;
      console.warn("PDF 미리보기 실패", e && (e.message || e.code || e));
      status.hidden = false;
      status.id = "research-pdf-error";
      status.className = "rn-notice rn-warn";
      status.textContent = "미리보기를 열 수 없어요";
      pages.replaceChildren();
      more.hidden = true;
      if (doc) { try { doc.destroy(); } catch { /* 무시 */ } doc = null; }
    };
    async function renderNext() {
      if (!doc || failed || next > doc.numPages) return;
      more.disabled = true;
      try {
        const page = await doc.getPage(next);
        const base = page.getViewport({ scale: 1 });
        const cssWidth = Math.max(240, Math.min(pages.clientWidth || 800, 1000));
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: (cssWidth / base.width) * ratio });
        const canvas = h("canvas", { width: Math.floor(vp.width), height: Math.floor(vp.height), role: "img", "aria-label": next + "쪽" });
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        if (failed || !wrap.isConnected) return;
        pages.append(canvas);
        next++;
        more.hidden = next > doc.numPages;
        more.textContent = `다음 쪽 더 보기 (${next}/${doc.numPages})`;
      } catch (e) { fail(e); }
      finally { more.disabled = false; }
    }
    more.addEventListener("click", renderNext);
    (async () => {
      try {
        const [lib, buf] = await Promise.all([loadPdfjs(), fetchPdfBytes(asset.id)]);
        // isEvalSupported: false — 글꼴 처리에서 eval을 쓰지 않게 한다(CVE-2024-4367 완화)
        doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, useSystemFonts: true }).promise;
        if (failed) return;
        status.hidden = true;
        await renderNext();
      } catch (e) { fail(e); }
    })();
    return wrap;
  }

  // ---------- 화면: explore ----------
  const EXPAND_PROMPT = (q) => "연구·고충 공유 사이트의 검색을 넓히려고 합니다. 아래 검색어와 뜻이 같거나 가까운 표현, 동의어, 상위 개념을 5~8개 골라 " +
    "JSON 문자열 배열로만 답하세요. 각 표현은 2~20자의 짧은 검색어(한국어, 필요하면 영어 용어)로 쓰고, 설명이나 다른 내용은 쓰지 마세요.\n" +
    '예: ["진동 저감", "방진", "댐핑"]\n\n검색어: ' + String(q).slice(0, 100);

  RN.view("explore", {
    title: "연구 탐색",
    mount(root, params) {
      let q = String((params && params.q) || "").trim();
      let expanded = null; // { q, terms } — "의미로 더 찾기"를 누른 검색어에만
      let alive = true;
      let expandOff = false;
      const input = h("input", { type: "search", id: "explore-q", name: "q", value: q, placeholder: "키워드 (예: 음향 블랙홀 진동 감쇠)", autocomplete: "off" });
      const results = h("div", { class: "rn-stack", id: "explore-results", "aria-live": "polite" });
      const expandBtn = RN.caps.sample ? h("button", { type: "button", class: "rn-btn", id: "explore-expand", title: "AI가 관련 표현을 골라 주면, 그 표현들로 이 사이트를 더 찾아요(AI 요청 1회)" }, "의미로 더 찾기") : null;
      const form = h("form", { class: "rs-search", role: "search", onsubmit: (e) => { e.preventDefault(); const nq = input.value.trim(); if (nq !== q) expanded = null; q = nq; render(RN.shared); } },
        h("label", { for: "explore-q", class: "rs-sr" }, "검색어"),
        input, h("button", { type: "submit", class: "rn-btn rn-primary" }, "검색"), expandBtn);

      async function expand() {
        const sample = RN.caps.sample;
        const nq = input.value.trim();
        if (!nq) { input.focus(); RN.toast("먼저 검색어를 적어 주세요."); return; }
        if (!sample || expandOff || expandBtn.disabled) return;
        if (nq !== q) { q = nq; expanded = null; render(RN.shared); }
        expandBtn.disabled = true;
        expandBtn.textContent = "찾는 중…";
        try {
          if (RN.aiQuota && typeof RN.aiQuota.take === "function" && !(await RN.aiQuota.take())) {
            RN.toast("오늘 쓸 수 있는 AI 요청을 모두 썼어요. 내일 다시 써 주세요.", "error");
            return;
          }
          let raw;
          try { raw = await sample.json(EXPAND_PROMPT(nq), { modelTier: "quick" }); }
          catch (e) {
            const code = e && e.code;
            if (code === "cancelled") return;
            if (SAMPLE_OFF_CODES.has(code)) { expandOff = true; if (expandBtn) expandBtn.remove(); RN.toast("이 화면에서는 AI 기능을 쓸 수 없어요.", "error"); return; }
            RN.toast(code === "rate_limited" ? "AI 요청이 많아요. 잠시 뒤 다시 눌러 주세요." : "관련 표현을 받지 못했어요. 다시 눌러 보세요.", "error");
            return;
          }
          // AI가 준 것은 검색어뿐: 문자열 배열만 남기고 나머지는 버린다
          const terms = RN.searchUtil && RN.searchUtil.cleanTerms ? RN.searchUtil.cleanTerms(raw, nq) : [];
          if (!alive) return;
          if (!terms.length) { RN.toast("관련 표현을 받지 못했어요. 다시 눌러 보세요.", "error"); return; }
          if (input.value.trim() !== nq) return; // 그 사이 검색어를 바꿨다
          expanded = { q: nq, terms };
          render(RN.shared);
        } finally {
          if (alive && expandBtn) { expandBtn.disabled = false; expandBtn.textContent = "의미로 더 찾기"; }
        }
      }
      if (expandBtn) expandBtn.addEventListener("click", expand);

      function render(s) {
        const blocked = sharedBlocked(s, "research");
        if (blocked) { results.replaceChildren(blocked); return; }
        if (!q) {
          const all = [...(s.research || [])].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
          results.replaceChildren(
            h("h2", {}, "최근 공개된 연구"),
            all.length ? researchList(all.slice(0, 30)) : h("p", { class: "rs-empty", id: "explore-empty" }, "아직 이 사이트에 등록된 연구가 없어요"));
          return;
        }
        if (typeof RN.search !== "function") { results.replaceChildren(RN.notice("검색 기능을 불러오지 못했어요.", "error")); return; }
        const useExpanded = expanded && expanded.q === q && typeof RN.searchExpanded === "function";
        const res = useExpanded ? RN.searchExpanded(q, expanded.terms, { limit: 20 }) : RN.search(q, { limit: 20 });
        // 유사도는 정렬에만 쓴다(카드에 표시하지 않음)
        const parts = [h("p", { class: "rn-small rn-muted" }, `“${res.query}” 검색 결과 — 연구 ${res.research.length}건 · 고충 ${res.pains.length}건`)];
        if (useExpanded) {
          parts.push(h("p", { class: "rs-terms", id: "explore-terms" }, "이런 표현으로도 찾았어요: " + res.terms.join(", ")));
        }
        if (res.research.length) parts.push(h("section", { class: "rs-section", "aria-label": "연구 결과" }, researchList(res.research)));
        else {
          parts.push(h("p", { class: "rs-empty", id: "explore-empty", role: "status" }, "아직 이 사이트에 등록된 연구가 없어요"));
          parts.push(h("p", { class: "rn-muted rn-small" }, res.pains.length
            ? "비슷한 연구는 없지만, 관련된 고충 글은 있어요."
            : expandBtn && !useExpanded && !expandOff ? "다른 키워드로 찾거나 ‘의미로 더 찾기’를 눌러 보세요." : "다른 키워드로 찾아보거나, 고충 게시판에 먼저 물어보세요."));
        }
        if (res.pains.length) {
          parts.push(h("section", { class: "rs-section", "aria-label": "관련 고충", id: "explore-pains" }, h("h2", {}, "관련 고충 " + res.pains.length + "건"), painList(res.pains)));
        }
        results.replaceChildren(...parts);
      }

      root.append(
        h("h1", {}, "연구 탐색"),
        h("p", { class: "rn-muted" }, "이 사이트에 공개된 연구와 고충 글에서만 찾아요."),
        form, results);
      const off = RN.onShared(render);
      return () => { alive = false; off(); };
    },
  });

  // ---------- 화면: research (상세) ----------
  RN.view("research", {
    title: "연구 상세",
    nav: "explore",
    mount(root, params) {
      const id = params && params.id;
      const body = h("div", { class: "rs-detail" });
      root.append(body);
      let lastKey = null;
      let fetched = null; // 공유 목록에 아직 없을 때(방금 공개) 한 번 직접 읽는다
      let triedFetch = false;

      function render(s) {
        if (!id) { body.replaceChildren(h("h1", {}, "연구 상세"), RN.notice("연구를 고르지 않았어요."), backBtn()); return; }
        const blocked = sharedBlocked(s, "research");
        if (blocked) { body.replaceChildren(h("h1", {}, "연구 상세"), blocked); return; }
        let r = (s.research || []).find((x) => x.id === id) || fetched;
        if (!r && !triedFetch && RN.caps.db) {
          triedFetch = true;
          RN.caps.db.collection("research").doc(id).get().then((snap) => { if (snap.exists) { fetched = { id, ...snap.data() }; render(RN.shared); } else render(RN.shared); }).catch(() => render(RN.shared));
          body.replaceChildren(h("h1", {}, "연구 상세"), RN.notice("불러오는 중…"));
          return;
        }
        if (!r) { body.replaceChildren(h("h1", {}, "연구를 찾을 수 없어요"), RN.notice("삭제되었거나 주소가 잘못되었어요."), backBtn()); return; }
        // 같은 내용이면 다시 그리지 않는다 (보고서 뷰어 상태·스크롤 유지)
        const linked = linkedPains(r.id);
        const key = JSON.stringify([r, linked.map((p) => [p.id, p.title, p.resolved, p.stage]), (s.research || []).length]);
        if (key === lastKey) return;
        lastKey = key;
        body.replaceChildren(...detail(r, linked));
        RN.names([r.authorId]).then((m) => { const el = body.querySelector("[data-author]"); if (el && m[r.authorId]) el.textContent = "공개한 사람 " + m[r.authorId]; });
      }
      return RN.onShared(render);
    },
  });

  function backBtn() { return h("button", { type: "button", class: "rn-btn", onclick: () => RN.go("explore") }, "← 연구 탐색으로"); }

  function linkedPains(researchId) {
    if (RN.pains && typeof RN.pains.listFor === "function") {
      try { const list = RN.pains.listFor({ researchId }); if (Array.isArray(list)) return list.filter((p) => !p.isAnonymous); } catch (e) { console.error(e); }
    }
    return (RN.shared.pains || []).filter((p) => p.researchId === researchId && !p.isAnonymous);
  }

  function detail(r, linked) {
    const me = RN.caps.uid;
    const mine = !!me && r.authorId === me;
    const asset = validAsset(r.reportAsset);
    const out = [];
    const kws = (Array.isArray(r.keywords) ? r.keywords : []).filter(Boolean);
    out.push(h("header", { class: "rs-detail-head" },
      h("div", {}, h("button", { type: "button", class: "rn-link rn-small", onclick: () => RN.go("explore") }, "← 연구 탐색")),
      h("h1", {}, r.title || "(제목 없음)"),
      metaLine("rs-meta", [r.field, r.publishedAt ? "공개 " + RN.fmtDate(r.publishedAt) : null, r.authorId ? h("span", { "data-author": "" }, "") : null, kws.length ? kws.map((k) => "#" + k).join(" ") : null],
        r.isExample ? h("span", { class: "rs-ex" }, "예시") : null)));

    out.push(h("section", { class: "rs-section", id: "research-summary" }, h("h2", {}, "요약"), h("p", { class: "rs-detail-text" }, r.summary || "요약이 없어요.")));
    out.push(h("section", { class: "rs-section", id: "research-limitations" }, h("h2", {}, "한계"), h("p", { class: "rs-detail-text" }, r.limitations || "적힌 한계가 없어요.")));

    // 결과보고서: PDF > 문서에서 만든 HTML > 없음
    const rep = h("section", { class: "rs-section", id: "research-report" });
    const head = h("div", { class: "rn-row rn-between" }, h("h2", {}, "결과보고서"));
    rep.append(head);
    if (asset) rep.append(pdfViewer(asset));
    else if (r.report && r.report.html) {
      if (RN.caps.downloads) head.append(h("button", { type: "button", class: "rn-btn", id: "research-report-save", onclick: () => saveReport(r) }, "HTML로 저장"));
      if (r.report.title) rep.append(h("p", { class: "rn-small rn-muted" }, r.report.title));
      const paper = h("div", { class: "rs-paper", id: "research-report-paper", role: "document", "aria-label": "결과보고서 본문" });
      paper.append(sanitizeReport(r.report.html));
      rep.append(paper);
    } else rep.append(RN.notice("등록된 결과보고서가 없어요."));
    if (mine && canUpload()) rep.append(reportUploader(r, asset));
    out.push(rep);

    // 연결된 고충
    const painSec = h("section", { class: "rs-section", id: "research-pains" }, h("div", { class: "rn-row rn-between" }, h("h2", {}, "연결된 고충 " + linked.length + "건"),
      RN.pains && !RN.writeBlockedReason() ? h("button", { type: "button", class: "rn-btn rn-ghost", onclick: () => RN.go("pain-edit", { researchId: r.id }) }, "고충 남기기") : null));
    if (!linked.length) painSec.append(RN.notice("이 연구에 연결된 고충 글이 아직 없어요."));
    else if (RN.pains && typeof RN.pains.renderList === "function") {
      try { painSec.append(RN.pains.renderList(linked)); } catch (e) { console.error(e); painSec.append(painList(linked)); }
    } else painSec.append(painList(linked));
    out.push(painSec);

    // 비슷한 연구
    const sim = typeof RN.similarResearch === "function" ? RN.similarResearch(r.id, 4) : [];
    out.push(h("section", { class: "rs-section", id: "research-similar" }, h("h2", {}, "비슷한 연구"),
      sim.length ? researchList(sim) : RN.notice("이 사이트에 비슷한 연구가 아직 없어요.")));

    // 작성자 삭제 (사용자가 눌렀을 때만 올린 PDF도 함께 지운다)
    if (mine && RN.caps.canWrite) {
      out.push(h("div", { class: "rn-row rn-end" }, h("button", { type: "button", class: "rn-btn rn-danger", id: "research-delete", onclick: async () => {
        const ok = await RN.confirm("이 연구 공개를 취소하고 삭제할까요? 연결된 고충 글은 남아요." + (asset ? " 올린 결과보고서 PDF도 함께 지워요." : ""), { okLabel: "삭제", danger: true });
        if (!ok) return;
        try { await RN.caps.db.collection("research").doc(r.id).delete(); }
        catch (e) { RN.toast("삭제하지 못했어요 (" + ((e && e.code) || "오류") + ").", "error"); return; }
        if (asset) await deleteAsset(asset.id);
        RN.toast("연구를 삭제했어요.");
        RN.go("explore");
      } }, "삭제")));
    }
    return out;
  }

  /** 상세 화면(작성자만): 결과보고서 PDF 올리기/바꾸기 */
  function reportUploader(r, asset) {
    const fileInput = h("input", { type: "file", id: "research-pdf-file", accept: "application/pdf,.pdf", class: "rs-sr", tabIndex: -1 });
    const status = h("span", { class: "rn-small", role: "status", "aria-live": "polite", id: "research-pdf-upload-status" });
    const btn = h("button", { type: "button", class: "rn-btn", id: "research-pdf-upload", onclick: () => fileInput.click() }, asset ? "PDF 바꾸기" : "PDF 올리기");
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      const bad = await checkPdf(file);
      if (bad) { status.textContent = bad; return; }
      const replacing = asset || (r.report && r.report.html);
      if (replacing && !(await RN.confirm("결과보고서를 이 PDF(" + cleanFilename(file.name) + ")로 바꿀까요? 지금 공개된 결과보고서는 사라져요.", { okLabel: "바꾸기" }))) return;
      btn.disabled = true;
      status.textContent = "PDF를 올리는 중…";
      let next;
      try { next = await uploadPdf(file); }
      catch (e) { status.textContent = uploadErrorCopy(e && e.code); btn.disabled = false; if (assetsOff) btn.hidden = true; return; }
      try { await RN.caps.db.collection("research").doc(r.id).update({ reportAsset: next, report: null }); }
      catch (e) { await deleteAsset(next.id); status.textContent = "결과보고서를 바꾸지 못했어요 (" + ((e && e.code) || "오류") + ")."; btn.disabled = false; return; }
      if (asset && asset.id !== next.id) await deleteAsset(asset.id); // 이제 아무 행도 가리키지 않는 이전 파일
      RN.toast("결과보고서 PDF를 올렸어요.");
    });
    return h("div", { class: "rn-row" }, h("label", { for: "research-pdf-file", class: "rs-sr" }, "결과보고서 PDF 파일"), fileInput, btn, status);
  }

  // ---------- 화면: publish ----------
  async function loadProject(projectId) {
    if (RN.docs && typeof RN.docs.listProjects === "function") {
      try { const list = await RN.docs.listProjects(); const p = (list || []).find((x) => x.id === projectId); if (p) return p; } catch (e) { console.error(e); }
    }
    const coll = RN.userColl && RN.userColl("projects");
    if (!coll) return null;
    const snap = await coll.doc(projectId).get();
    return snap.exists ? { id: projectId, ...snap.data() } : null;
  }

  RN.view("publish", {
    title: "연구 공개",
    nav: "projects",
    mount(root, params) {
      const projectId = params && params.projectId;
      const box = h("div", { class: "rn-stack" });
      root.append(h("h1", {}, "연구 공개"), h("p", { class: "rn-muted" }, "공개하면 로그인한 모든 사람이 검색하고 볼 수 있어요."), box);
      const blocked = RN.writeBlockedReason();
      if (blocked) { box.append(RN.notice(blocked, "warn")); return; }
      if (!projectId) { box.append(RN.notice("공개할 프로젝트를 먼저 고르세요."), h("button", { type: "button", class: "rn-btn", onclick: () => RN.go("projects") }, "내 프로젝트로")); return; }
      let alive = true;
      box.append(RN.notice("프로젝트를 불러오는 중…"));
      const timer = setTimeout(() => { if (alive && !formShown) box.replaceChildren(RN.notice("프로젝트를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.", "error")); }, 10000);
      let formShown = false;
      (async () => {
        let project = null, docs = [];
        try { project = await loadProject(projectId); } catch (e) { console.error(e); }
        if (!alive) return;
        if (!project) { formShown = true; box.replaceChildren(RN.notice("프로젝트를 찾을 수 없어요.", "error")); return; }
        if (RN.docs && typeof RN.docs.listDocs === "function") {
          try { docs = (await RN.docs.listDocs(projectId)) || []; } catch (e) { console.error(e); }
        }
        if (!alive) return;
        formShown = true;
        clearTimeout(timer);
        box.replaceChildren(publishForm(project, docs));
      })();
      return () => { alive = false; clearTimeout(timer); };
    },
  });

  function publishForm(project, docs) {
    const title = h("input", { type: "text", id: "pub-title", value: project.title || "", maxLength: 200, required: true });
    const field = h("input", { type: "text", id: "pub-field", value: project.field || "", maxLength: 50, placeholder: "예: 물리" });
    const summary = h("textarea", { id: "pub-summary", maxLength: 4000, required: true, placeholder: "무엇을, 어떻게 했고, 무엇을 알아냈는지" });
    if (project.description) summary.value = project.description;
    const keywords = h("input", { type: "text", id: "pub-keywords", value: (project.keywords || []).join(", "), placeholder: "예: 음향 블랙홀, 진동 감쇠" });
    const limitations = h("textarea", { id: "pub-limitations", maxLength: 4000, placeholder: "하지 못한 것, 오차, 다음 사람이 조심할 점" });

    // 결과보고서: 내 문서에서 만들기 / PDF 파일 올리기 / 없이
    const canDocs = RN.docs && typeof RN.docs.getDoc === "function" && typeof RN.docs.exportHtml === "function";
    const usable = (docs || []).filter((d) => !d.deletedAt);
    const docOk = !!canDocs && usable.length > 0;
    const pdfOk = canUpload();
    let kind = docOk ? "doc" : "none";
    const radio = (value, label, disabled) => {
      const inp = h("input", { type: "radio", name: "pub-report-kind", id: "pub-report-kind-" + value, value, checked: kind === value, disabled });
      inp.addEventListener("change", () => { if (inp.checked) { kind = value; sync(); } });
      return h("label", { for: inp.id }, inp, label);
    };
    const docSelect = h("select", { id: "pub-report" }, usable.map((d) => h("option", { value: d.id }, d.title || "(제목 없는 문서)")));
    const pdfInput = h("input", { type: "file", id: "pub-pdf", accept: "application/pdf,.pdf" });
    const pdfNote = h("small", { id: "pub-pdf-note", class: "rn-muted", "aria-live": "polite" }, "20MB 이하 PDF");
    pdfInput.addEventListener("change", async () => {
      const f = pdfInput.files && pdfInput.files[0];
      if (!f) { pdfNote.textContent = "20MB 이하 PDF"; pdfNote.className = "rn-muted"; return; }
      const bad = await checkPdf(f);
      pdfNote.textContent = bad || cleanFilename(f.name) + " · " + fmtSize(f.size);
      pdfNote.className = bad ? "rn-error" : "rn-muted";
    });
    const docBox = h("div", { class: "rn-field" }, h("label", { for: "pub-report" }, "결과보고서로 쓸 문서"), docSelect, h("small", {}, "지금 내용이 공개돼요. 나중에 문서를 고쳐도 공개본은 그대로예요."));
    const pdfBox = h("div", { class: "rn-field" }, h("label", { for: "pub-pdf" }, "결과보고서 PDF"), pdfInput, pdfNote);
    const sync = () => { docBox.hidden = kind !== "doc"; pdfBox.hidden = kind !== "pdf"; };
    const choice = h("fieldset", { class: "rs-choice", id: "pub-report-choice" },
      h("legend", {}, "결과보고서"),
      h("div", { class: "rn-row" },
        radio("doc", "내 문서에서 만들기", !docOk),
        pdfOk ? radio("pdf", "PDF 파일 올리기", false) : null,
        radio("none", "없이 공개", false)),
      !docOk ? h("small", { class: "rn-muted" }, !canDocs ? "문서 기능을 불러오지 못했어요." : "이 프로젝트에 문서가 없어요.") : null,
      !pdfOk ? h("small", { class: "rn-muted", id: "pub-pdf-unavailable" }, "PDF 올리기는 이 페이지에서 파일 올리기 권한이 있는 사람만 쓸 수 있어요.") : null,
      docBox, pdfOk ? pdfBox : null);
    sync();

    const status = h("p", { class: "rn-small", role: "status", "aria-live": "polite", id: "pub-status" });
    const submit = h("button", { type: "submit", class: "rn-btn rn-primary", id: "pub-submit" }, "공개");

    const form = h("form", { class: "rs-form", id: "publish-form", onsubmit: async (e) => {
      e.preventDefault();
      const kw = [...new Set(keywords.value.split(/[,，\n]+/).map((k) => k.trim()).filter(Boolean))].slice(0, 10);
      if (!title.value.trim()) { status.textContent = "제목을 적어 주세요."; title.focus(); return; }
      if (!summary.value.trim()) { status.textContent = "요약을 적어 주세요."; summary.focus(); return; }
      if (!kw.length) { status.textContent = "키워드를 하나 이상 적어 주세요."; keywords.focus(); return; }
      submit.disabled = true;
      let uploaded = null;
      try {
        let rep = null, pdfFile = null;
        if (kind === "doc" && docOk && docSelect.value) {
          status.textContent = "결과보고서를 준비하는 중…";
          const doc = await RN.docs.getDoc(docSelect.value);
          if (!doc) throw { message: "고른 문서를 찾지 못했어요." };
          const html = String(RN.docs.exportHtml(doc) || "");
          if (new Blob([html]).size > REPORT_MAX_BYTES) throw { message: "결과보고서가 너무 커요(200KB 초과). 그림을 줄이거나 PDF로 올려 주세요." };
          rep = { title: doc.title || title.value.trim(), html };
        } else if (kind === "pdf" && canUpload()) {
          pdfFile = pdfInput.files && pdfInput.files[0];
          const bad = await checkPdf(pdfFile);
          if (bad) throw { message: bad, focus: pdfInput };
        }
        status.textContent = "";
        const ok = await RN.confirm("공개하면 로그인한 모든 사람이 이 연구의 요약·키워드·한계" + (rep || pdfFile ? "·결과보고서" : "") + "를 볼 수 있어요. 공개할까요?", { okLabel: "공개" });
        if (!ok) { submit.disabled = false; return; }
        if (pdfFile) {
          status.textContent = "PDF를 올리는 중…";
          try { uploaded = await uploadPdf(pdfFile); }
          catch (err) { throw { message: uploadErrorCopy(err && err.code) }; }
        }
        status.textContent = "공개하는 중…";
        const id = RN.newId();
        await RN.caps.db.collection("research").doc(id).set({
          title: title.value.trim(), summary: summary.value.trim(), field: field.value.trim(), keywords: kw,
          limitations: limitations.value.trim(), authorId: RN.caps.uid, publishedAt: Date.now(), report: rep, reportAsset: uploaded,
        });
        RN.toast("연구를 공개했어요.");
        RN.go("research", { id });
      } catch (err) {
        if (uploaded) deleteAsset(uploaded.id); // 저장에 실패했으니 아무 행도 가리키지 않는 파일
        const code = err && err.code;
        status.textContent = (err && !code && err.message) ? err.message
          : code === "quota_exceeded" ? "저장 공간이 가득 찼어요. 아티팩트 주인에게 알려 주세요."
          : code === "invalid_argument" ? "내용이 너무 크거나 형식이 맞지 않아요."
          : "공개하지 못했어요 (" + (code || "오류") + ").";
        if (err && err.focus) err.focus.focus();
        submit.disabled = false;
      }
    } },
    RN.field("제목", title),
    RN.field("분야", field),
    RN.field("요약", summary),
    RN.field("키워드", keywords, "쉼표로 구분해요."),
    RN.field("한계", limitations),
    choice,
    h("div", { class: "rn-row rn-end" },
      h("button", { type: "button", class: "rn-btn rn-ghost", onclick: () => RN.go("project", { id: project.id }) }, "취소"),
      submit),
    status);
    return form;
  }

  // ---------- 프로젝트 홈 섹션 ----------
  (RN.projectSections = RN.projectSections || []).push({
    id: "research",
    label: "연구 공개",
    mount(container, project) {
      const rec = h("div", { class: "rn-stack", id: "project-recommend" });
      const blocked = RN.writeBlockedReason();
      container.append(
        h("div", { class: "rn-row rn-between" }, h("h2", {}, "연구 공개·추천"),
          !blocked ? h("button", { type: "button", class: "rn-btn", id: "project-publish", onclick: () => RN.go("publish", { projectId: project.id }) }, "공개") : null),
        rec);
      const kws = (project.keywords || []).filter(Boolean);
      let off = null;
      const render = (s) => {
        if (!container.isConnected && off) { off(); return; }
        const b = sharedBlocked(s, "research");
        if (b) { rec.replaceChildren(b); return; }
        if (!kws.length) { rec.replaceChildren(RN.notice("프로젝트에 키워드를 넣으면 관련된 연구·고충을 추천해 드려요.")); return; }
        if (typeof RN.recommend !== "function") { rec.replaceChildren(RN.notice("추천 기능을 불러오지 못했어요.", "error")); return; }
        const res = RN.recommend(kws, 5);
        rec.replaceChildren(
          h("h3", {}, "내 키워드와 관련된 연구"),
          res.research.length ? researchList(res.research) : h("p", { class: "rn-muted" }, "아직 이 사이트에 등록된 관련 연구가 없어요."),
          h("h3", {}, "관련 고충"),
          res.pains.length ? painList(res.pains) : h("p", { class: "rn-muted" }, "관련된 고충 글이 없어요."));
      };
      off = RN.onShared(render);
      return off;
    },
  });

  RN.research = { card: researchCard, painList, sanitizeReport };
})();
