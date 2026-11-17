/* 로컬 테스트용 window.claude 흉내 (게시하지 않는다). dev.html이 index.html보다 먼저 불러온다.
   db는 메모리+localStorage("renote-mock-db"). ?user=u2 로 다른 사용자, ?anon=1 로 비로그인, ?nosample=1 로 AI 없음. */
(function () {
  const q = new URLSearchParams(location.search);
  const uid = q.get("anon") ? null : q.get("user") || "u1";
  const NAMES = { u1: "김연구", u2: "박탐구", u3: "이실험" };
  let store = {};
  try { store = JSON.parse(localStorage.getItem("renote-mock-db") || "{}"); } catch {}
  const subs = new Set();
  const persist = () => { try { localStorage.setItem("renote-mock-db", JSON.stringify(store)); } catch {} subs.forEach((f) => f()); };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const docSnap = (path) => ({ id: path.split("/").pop(), exists: path in store, data: () => (path in store ? clone(store[path]) : undefined), metadata: { fromCache: false, hasPendingWrites: false } });
  const check = (data) => { if (JSON.stringify(data).length > 256 * 1024) throw { code: "invalid_argument", message: "document over 256 KiB" }; };
  const canWrite = (path) => uid && (!path.startsWith("data/users/") || path.startsWith(`data/users/${uid}/`));
  const canRead = (path) => uid && (!path.startsWith("data/users/") || path.startsWith(`data/users/${uid}/`));
  const segs = (path) => path.split("/").filter(Boolean).length;
  function doc(path) {
    if (segs(path) % 2 !== 0) throw new TypeError("db.doc(): 문서 경로는 세그먼트가 짝수여야 한다: " + path);
    return {
      id: path.split("/").pop(), path,
      async get() { if (!canRead(path)) throw { code: "not_granted", message: "no read" }; return docSnap(path); },
      async set(data) { if (!canWrite(path)) throw { code: "not_granted", message: "no write" }; check(data); store[path] = clone(data); persist(); },
      async update(data) { if (!canWrite(path)) throw { code: "not_granted", message: "no write" }; if (!(path in store)) throw { code: "invalid_argument", message: "no such doc" }; const next = { ...store[path], ...clone(data) }; check(next); store[path] = next; persist(); },
      async delete() { if (!canWrite(path)) throw { code: "not_granted", message: "no write" }; delete store[path]; persist(); },
      async acquire() { return { acquired: true }; },
      onSnapshot(next) { const f = () => next(docSnap(path)); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
      collection: (sub) => collection(path + "/" + sub),
    };
  }
  function collection(path, ops = []) {
    if (segs(path) % 2 !== 1) throw new TypeError("db.collection(): 컬렉션 경로는 세그먼트가 홀수여야 한다: " + path);
    const run = () => {
      const depth = path.split("/").length + 1;
      let rows = Object.keys(store).filter((p) => p.startsWith(path + "/") && p.split("/").length === depth && canRead(p)).map((p) => docSnap(p));
      for (const op of ops) {
        if (op.t === "where") rows = rows.filter((d) => { const v = d.data()[op.f]; return op.op === "==" ? v === op.v : op.op === "!=" ? v !== op.v : op.op === ">" ? v > op.v : op.op === ">=" ? v >= op.v : op.op === "<" ? v < op.v : op.op === "<=" ? v <= op.v : op.op === "array-contains" ? Array.isArray(v) && v.includes(op.v) : op.op === "in" ? op.v.includes(v) : true; });
        if (op.t === "orderBy") rows.sort((a, b) => { const x = a.data()[op.f], y = b.data()[op.f]; return (x > y ? 1 : x < y ? -1 : 0) * (op.d === "desc" ? -1 : 1); });
        if (op.t === "limit") rows = rows.slice(0, op.n);
      }
      return { docs: rows, size: rows.length, empty: rows.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      path,
      where: (f, op, v) => collection(path, [...ops, { t: "where", f, op, v }]),
      orderBy: (f, d) => collection(path, [...ops, { t: "orderBy", f, d }]),
      limit: (n) => collection(path, [...ops, { t: "limit", n }]),
      async get() { return run(); },
      onSnapshot(next) { const f = () => next(run()); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
      doc: (id) => doc(path + "/" + (id || Math.random().toString(36).slice(2, 12))),
      async add(data) { const d = doc(path + "/" + Math.random().toString(36).slice(2, 12)); await d.set(data); return d; },
    };
  }
  const user = {
    async isOwner() { return uid === "u1"; }, async canEdit() { return uid === "u1"; }, async can() { return uid ? true : false; },
    async id() { return uid; }, async name() { return NAMES[uid] || ""; },
    async me() { return { id: uid, name: NAMES[uid] || "", avatarUrl: "", color: "#888", email: null, isOwner: uid === "u1", canEdit: uid === "u1" }; },
    async profiles(ids) { const list = Array.isArray(ids) ? ids : [ids]; return Object.fromEntries(list.map((id) => [id, { id, name: NAMES[id] || "", avatarUrl: "", color: "#888", email: null, isMe: id === uid, guest: false }])); },
    async search() { return []; },
  };
  // 가짜 AI: window.__mockSample 를 테스트가 바꿔 끼울 수 있다. 기본은 입력을 되풀이한다.
  // 글쓰기 자동완성 프롬프트(<before_cursor>)에는 그럴듯한 한 문장을 돌려준다(window.__mockAutocompleteDelay ms 뒤, signal을 따른다).
  function mockCompletion(text) {
    const a = text.lastIndexOf("<before_cursor>"), b = text.lastIndexOf("</before_cursor>");
    const before = a >= 0 && b > a ? text.slice(a + 15, b) : "";
    if (/[.!?]\s*$/.test(before)) return " 이를 통해 실험 조건이 결과에 미치는 영향을 확인할 수 있었다.";
    if (/\s$/.test(before)) return "측정값의 변화 경향을 비교하여 분석하였다.";
    return " 측정값의 변화 경향을 비교하여 분석하였다.";
  }
  // AI 사용 동의(내장 permissions 흉내). ?consent=prompt 면 첫 sample 호출이나 permissions.request 때 묻는다
  // (답은 window.__mockConsentAnswer: "grant"(기본) | "deny" | "dismiss"), ?consent=denied 는 거절된 상태, ?nopermissions=1 은 permissions 없음.
  // 묻는 횟수 window.__mockConsentAsked, sample 호출 시도 수(동의 전 포함) window.__mockSampleAttempts.
  let sampleConsent = q.get("consent") === "prompt" ? "prompt" : q.get("consent") === "denied" ? "denied" : "granted";
  async function askConsent() {
    window.__mockConsentAsked = (window.__mockConsentAsked || 0) + 1;
    await new Promise((r) => setTimeout(r, 30));
    const a = window.__mockConsentAnswer || "grant";
    if (a === "grant") sampleConsent = "granted"; else if (a === "deny") sampleConsent = "denied";
  }
  const permissions = {
    async state(name) { return name === undefined ? { sample: sampleConsent } : name === "sample" ? sampleConsent : "unavailable"; },
    async request(names) { if (sampleConsent === "prompt" && (!names || names.includes("sample"))) await askConsent(); return { sample: sampleConsent }; },
    async manage() { window.__mockManageOpened = (window.__mockManageOpened || 0) + 1; if (window.__mockManageGrants) sampleConsent = "granted"; },
  };
  async function sample(input, opts = {}) {
    window.__mockSampleAttempts = (window.__mockSampleAttempts || 0) + 1;
    if (sampleConsent === "prompt") await askConsent();
    if (sampleConsent !== "granted") throw { code: "not_granted", message: "not granted" };
    const text = typeof input === "string" ? input : input[input.length - 1].content;
    const fn = window.__mockSample;
    if (!fn && text.includes("<before_cursor>")) {
      window.__mockAutocompleteCalls = (window.__mockAutocompleteCalls || 0) + 1;
      window.__mockAutocompletePrompt = text;
      await new Promise((r) => setTimeout(r, window.__mockAutocompleteDelay || 50));
      if (opts.signal && opts.signal.aborted) throw { code: "cancelled", message: "aborted" };
      const out = mockCompletion(text);
      if (opts.onText) opts.onText({ text: out, delta: out });
      return { text: out, truncated: false, modelTierApplied: opts.modelTier || "default" };
    }
    const out = fn ? await fn(text, opts, input) : "가짜 AI 응답: " + text.slice(0, 60);
    if (opts.signal && opts.signal.aborted) throw { code: "cancelled", message: "aborted" };
    if (!String(out == null ? "" : out).trim()) throw { code: "empty_completion", message: "empty" }; // 실제 런타임은 빈 답을 이 코드로 거절한다
    if (opts.onText) opts.onText({ text: out, delta: out });
    return { text: out, truncated: false };
  }
  sample.json = async (input, opts) => { const r = await sample(input, opts); try { return JSON.parse(r.text); } catch { return null; } };
  sample.limits = async () => ({ images: true });
  const downloads = { async save(req) { (window.__downloads = window.__downloads || []).push({ filename: req.filename, data: req.data }); return { status: "saved" }; } };
  // 가짜 assets: 올린 파일을 메모리에 두고 blob: URL을 돌려준다.
  const blobs = new Map();
  const assets = {
    async upload(blob) { const id = Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32); const url = URL.createObjectURL(blob); blobs.set(id, { id, url, sizeBytes: blob.size, contentType: blob.type, blob }); return { id, url, sizeBytes: blob.size, contentType: blob.type }; },
    async list() { return { assets: [...blobs.values()].map(({ blob, ...a }) => a), usage: { bytes: 0 } }; },
    async delete(id) { blobs.delete(id); },
  };
  window.__mockAssets = blobs;
  const table = { db: uid ? { doc, collection } : null, user, sample: q.get("nosample") ? null : sample, permissions: q.get("nopermissions") ? null : permissions, downloads, assets: uid && !q.get("noassets") ? assets : null };
  window.claude = { use: async (name) => (name in table ? table[name] : null) };
  window.__mockDb = { store, reset() { for (const k of Object.keys(store)) delete store[k]; persist(); }, seed(rows) { Object.assign(store, clone(rows)); persist(); } };
})();
