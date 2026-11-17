/* Re: Note 아티팩트 판 — 공통 뼈대. 모듈은 이 파일이 만든 전역 `RN`만 쓴다. (계약: CONTRACT.md) */
(function () {
  "use strict";

  // ---------- DOM 도우미 ----------
  // 모듈이 `el.append(조건 ? 노드 : null)`이나 배열을 넘겨도 "null"·"[object …]" 글자가 찍히지 않게, 빈 값은 건너뛰고 배열은 편다.
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    for (const name of ["append", "prepend", "replaceChildren"]) {
      const native = proto[name];
      proto[name] = function (...nodes) { return native.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false)); };
    }
  }
  /** h("div", {class:"x", onclick:fn, dataset:{id:1}}, "글자", 자식노드, [배열]) — 문자열은 항상 텍스트로 들어간다(HTML 아님). */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== "list" && k !== "form") { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? "" : v);
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  const cssSeen = new Set();
  /** 모듈 전용 CSS를 한 번만 넣는다. 색은 반드시 index.html의 토큰(var(--…))만 쓴다. */
  function css(id, text) {
    if (cssSeen.has(id)) return;
    cssSeen.add(id);
    document.head.append(h("style", { "data-mod": id }, text));
  }

  let toastTimer = null;
  function toast(message, kind) {
    const box = document.getElementById("rn-toast");
    box.textContent = message;
    box.dataset.kind = kind || "info";
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 4000);
  }

  const scriptLoads = new Map();
  /** 외부 스크립트를 필요할 때만 불러온다(cdnjs의 정확한 버전 URL만). 같은 URL은 한 번만. Promise. */
  function loadScript(url) {
    if (!/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\//.test(url)) return Promise.reject(new Error("허용되지 않은 스크립트 주소"));
    if (!scriptLoads.has(url)) {
      scriptLoads.set(url, new Promise((resolve, reject) => {
        const el = h("script", { src: url });
        el.onload = () => resolve();
        el.onerror = () => { scriptLoads.delete(url); reject(new Error("스크립트를 불러오지 못했어요")); };
        document.head.append(el);
      }));
    }
    return scriptLoads.get(url);
  }

  /** confirm()은 아티팩트에서 항상 false라 직접 만든 확인 창을 쓴다. Promise<boolean>. */
  function confirmDialog(message, { okLabel = "확인", cancelLabel = "취소", danger = false } = {}) {
    return new Promise((resolve) => {
      const dlg = h("dialog", { class: "rn-dialog", "aria-label": message });
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      dlg.append(
        h("p", {}, message),
        h("div", { class: "rn-row rn-end" },
          h("button", { type: "button", class: "rn-btn", onclick: () => done(false) }, cancelLabel),
          h("button", { type: "button", class: "rn-btn " + (danger ? "rn-danger" : "rn-primary"), onclick: () => done(true) }, okLabel)),
      );
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  const dateFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" });
  const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  const fmtDate = (ms) => (ms ? dateFmt.format(new Date(ms)) : "");
  const fmtDateTime = (ms) => (ms ? dateTimeFmt.format(new Date(ms)) : "");
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const local = {
    get(key, fallback) { try { const v = localStorage.getItem("renote:" + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem("renote:" + key, JSON.stringify(value)); } catch { /* 저장소를 못 쓰는 환경 */ } },
    remove(key) { try { localStorage.removeItem("renote:" + key); } catch { /* 무시 */ } },
  };

  // ---------- 기능(capability) ----------
  const caps = { db: null, user: null, sample: null, downloads: null, assets: null, uid: null, me: null, canWrite: false };
  const ready = (async () => {
    const use = (name) => (window.claude && window.claude.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
    const [db, user, sample, downloads, assets] = await Promise.all([use("db"), use("user"), use("sample"), use("downloads"), use("assets")]);
    Object.assign(caps, { db, user, sample, downloads, assets });
    if (user) {
      try {
        caps.me = await user.me();
        caps.uid = caps.me.id;
        const can = await user.can("data.write");
        caps.canWrite = can !== false && !!caps.uid;
      } catch { /* 비로그인 */ }
    }
    return caps;
  })();

  /** 내 개인 데이터 경로: data/users/<내 id>/<sub>. 로그인하지 않았으면 null. */
  const userPath = (sub) => (caps.uid ? `data/users/${caps.uid}/${sub}` : null);
  /**
   * 내 개인 컬렉션. db 경로는 문서=짝수·컬렉션=홀수 세그먼트여야 해서 중간에 "items"를 끼운다:
   *   RN.userColl("projects")        → data/users/<id>/projects/items            (컬렉션)
   *   RN.userColl("projects").doc(x) → data/users/<id>/projects/items/x          (문서)
   *   …doc(x).collection("snapshots") → …/items/x/snapshots                       (하위 컬렉션)
   * 로그인하지 않았으면 null.
   */
  const userColl = (name) => (caps.db && caps.uid ? caps.db.collection(`data/users/${caps.uid}/${name}/items`) : null);
  /** 내 개인 단일 문서: RN.userDoc("aiUsage") → data/users/<id>/aiUsage. 로그인하지 않았으면 null. */
  const userDoc = (name) => (caps.db && caps.uid ? caps.db.doc(`data/users/${caps.uid}/${name}`) : null);

  /** 사용자 id → 표시 이름. 이름은 저장하지 않고 그릴 때마다 풀어 쓴다. */
  async function names(ids) {
    const list = [...new Set((ids || []).filter(Boolean))];
    if (!caps.user || !list.length) return {};
    try {
      const ps = await caps.user.profiles(list);
      return Object.fromEntries(list.map((id) => [id, (ps[id] && ps[id].name) || "이름 없음"]));
    } catch { return {}; }
  }

  // ---------- 공유 컬렉션 구독 (research, pains) ----------
  const shared = { research: [], pains: [], loaded: { research: false, pains: false }, error: null, examplesOnly: false };
  const sharedListeners = new Set();
  const emitShared = () => sharedListeners.forEach((fn) => { try { fn(shared); } catch (e) { console.error(e); } });
  /** 공유 데이터가 바뀔 때마다 fn(shared)를 부른다. 등록 즉시 한 번 부른다. 해제 함수를 돌려준다. */
  function onShared(fn) { sharedListeners.add(fn); fn(shared); return () => sharedListeners.delete(fn); }
  ready.then(({ db }) => {
    if (!db) {
      // 데이터에 연결할 수 없는 화면(공개 링크로 단독으로 연 페이지, 주인의 조직 밖 계정 등)에서는
      // 함께 게시한 예시 데이터(seed.json)를 읽기 전용으로 보여 준다.
      shared.examplesOnly = true;
      fetch("seed.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("seed")))).then((docs) => {
        for (const [path, doc] of Object.entries(docs)) {
          const [coll, id] = path.split("/");
          if ((coll === "research" || coll === "pains") && id) shared[coll].push({ id, ...doc });
        }
        shared.error = null;
      }).catch(() => { shared.error = "signed_out"; }).finally(() => { shared.loaded.research = shared.loaded.pains = true; emitShared(); });
      return;
    }
    for (const name of ["research", "pains"]) {
      const timer = setTimeout(() => { if (!shared.loaded[name]) { shared.loaded[name] = true; shared.error = "timeout"; emitShared(); } }, 10000);
      db.collection(name).limit(1000).onSnapshot(
        (snap) => { clearTimeout(timer); shared[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() })); shared.loaded[name] = true; shared.error = null; emitShared(); },
        (err) => { clearTimeout(timer); shared.loaded[name] = true; shared.error = err.code || "error"; emitShared(); },
      );
    }
  });

  // ---------- 화면 전환 ----------
  // 주소의 #이름은 최상위 화면에만 쓴다(아티팩트는 #name만 전달). 상세 화면의 id 같은 값은 params로 넘긴다.
  const views = {};
  const TOP = ["home", "explore", "pains", "projects", "convert"];
  let current = { name: null, cleanup: null };
  /** 화면 등록: RN.view("pains", { title, mount(root, params) { …; return 정리함수(선택) } }) */
  function view(name, def) { views[name] = def; if (pendingRoute && pendingRoute.name === name) { const p = pendingRoute; pendingRoute = null; go(p.name, p.params, true); } }
  let pendingRoute = null;
  function go(name, params, replace) {
    const def = views[name];
    if (!def) { pendingRoute = { name, params }; return; }
    if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
    const root = document.getElementById("rn-view");
    root.replaceChildren();
    document.querySelectorAll("#rn-nav a").forEach((a) => {
      const on = a.dataset.view === (def.nav || name);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.body.dataset.view = name;
    current = { name, params: params || {}, cleanup: null };
    try { current.cleanup = def.mount(root, params || {}) || null; }
    catch (e) { console.error(e); root.append(h("p", { class: "rn-error", role: "alert" }, "화면을 그리지 못했어요: " + (e && e.message ? e.message : e))); }
    const hash = TOP.includes(name) ? name : (def.nav && TOP.includes(def.nav) ? def.nav : null);
    if (hash && location.hash !== "#" + hash) { try { history[replace ? "replaceState" : "pushState"](null, "", "#" + hash); } catch { /* 무시 */ } }
    window.scrollTo(0, 0);
    const heading = root.querySelector("h1");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  window.addEventListener("hashchange", () => {
    const name = location.hash.slice(1);
    if (TOP.includes(name) && (current.name !== name) && !(views[current.name] && views[current.name].nav === name)) go(name, {}, true);
  });
  function start() {
    const name = location.hash.slice(1);
    go(TOP.includes(name) ? name : "home", {}, true);
  }

  // ---------- 공통 조각 ----------
  /** 로딩·비어 있음·오류 안내 한 줄 */
  const notice = (text, kind) => h("p", { class: "rn-notice" + (kind ? " rn-" + kind : ""), role: kind === "error" ? "alert" : "status" }, text);
  /** 이 화면이 단독 페이지로 열렸는지(= claude.ai 안의 아티팩트 보기 화면이 아닌지) */
  function isStandalone() { try { return window.top === window.self; } catch { return false; } }
  /** 데이터에 연결되지 않은 이유를 한 문장으로. (Claude에 로그인했어도 연결되지 않는 경우가 있다.) */
  function connectionHelp() {
    return isStandalone()
      ? "지금은 둘러보기만 할 수 있어요. 이 주소를 직접 열면 Claude 로그인 정보가 전달되지 않아요. claude.ai의 아티팩트 화면에서 열어 주세요."
      : "지금은 둘러보기만 할 수 있어요. Claude에 로그인했더라도, 이 아티팩트를 만든 사람의 조직 계정이거나 초대받은 계정이어야 글을 쓰고 내 프로젝트를 만들 수 있어요.";
  }
  /** 로그인하지 않았거나 쓰기 권한이 없을 때 보여 줄 문구. 쓸 수 있으면 null. */
  function writeBlockedReason() {
    if (!caps.db || !caps.uid) return connectionHelp();
    if (!caps.canWrite) return "보기 권한만 있어 쓸 수 없어요. 아티팩트 주인에게 참여 권한을 요청하세요.";
    return null;
  }
  const badge = (text, kind) => h("span", { class: "rn-badge" + (kind ? " rn-badge-" + kind : "") }, text);
  /** 라벨이 붙은 입력: field("제목", h("input", {...})) */
  function field(label, control, hint) {
    const id = control.id || "f-" + newId();
    control.id = id;
    return h("div", { class: "rn-field" }, h("label", { for: id }, label), control, hint ? h("small", {}, hint) : null);
  }

  window.RN = {
    h, css, toast, loadScript, confirm: confirmDialog, fmtDate, fmtDateTime, newId, local,
    caps, ready, userPath, userColl, userDoc, names,
    shared, onShared,
    view, go, start, get current() { return current; },
    notice, writeBlockedReason, connectionHelp, isStandalone, badge, field,
    STAGES: { TOPIC: "주제선정", DESIGN: "설계", EXPERIMENT: "실험", ANALYSIS: "분석", REPORT: "보고서작성", OTHER: "기타" },
    // 아래는 모듈이 채운다 (CONTRACT.md 참고). 없을 수 있으니 쓰는 쪽에서 확인한다.
    search: null, // research 모듈: (query, {limit}) => { research: [...], pains: [...] }
    editor: null, // editor 모듈: 열려 있는 문서에 넣기 { insertText, insertLatex, insertTable, insertFigure, getSelectionText, applyFormat }
    editorPanels: [], // 에디터 오른쪽 패널에 붙을 탭 { id, label, mount(container, editorApi) }
    projectSections: [], // 프로젝트 홈에 붙을 섹션 { id, mount(container, project) }
    chat: null, // chat 모듈: { open(context) }
  };
})();
