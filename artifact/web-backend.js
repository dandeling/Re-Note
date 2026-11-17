/* 웹 체험판(정적 호스팅)용 window.claude 대체품.
   claude.ai 아티팩트 밖에서는 공유 DB·계정·AI가 없으므로, 같은 인터페이스를 이 브라우저 안에서만 흉내 낸다.
   - db: 메모리 + IndexedDB("renote-web"). 처음 열면 seed.json의 예시 데이터를 넣는다. 다른 방문자와 공유되지 않는다.
   - user: 이 브라우저에 만든 임시 사용자 한 명.
   - downloads: 브라우저의 일반 파일 저장.
   - sample(AI), assets(파일 업로드): 없음(null) → 앱이 그 기능을 숨긴다.
   index.html보다 먼저 불러온다. */
(function () {
  "use strict";
  const DB_NAME = "renote-web";
  const STORE = "docs";
  const clone = (v) => JSON.parse(JSON.stringify(v));

  let uid;
  try {
    uid = localStorage.getItem("renote-web:uid");
    if (!uid) { uid = "local-" + Math.random().toString(36).slice(2, 12); localStorage.setItem("renote-web:uid", uid); }
  } catch { uid = "local-guest"; }

  // ---------- 저장소 ----------
  const store = new Map();
  let idb = null;
  const subs = new Set();
  let notifyQueued = false;
  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    setTimeout(() => { notifyQueued = false; subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }, 0);
  }
  function openIdb() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  function idbAll(db) {
    return new Promise((resolve) => {
      const out = [];
      const cur = db.transaction(STORE).objectStore(STORE).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
      cur.onerror = () => resolve(out);
    });
  }
  function persist(path, value) {
    if (!idb) return;
    try {
      const os = idb.transaction(STORE, "readwrite").objectStore(STORE);
      if (value === undefined) os.delete(path); else os.put(value, path);
    } catch { /* 저장소를 못 쓰는 환경: 메모리에만 남는다 */ }
  }
  const loaded = (async () => {
    idb = await openIdb();
    if (idb) for (const [k, v] of await idbAll(idb)) store.set(k, v);
    const hasShared = [...store.keys()].some((k) => k.startsWith("research/") || k.startsWith("pains/"));
    if (!hasShared) {
      try {
        const docs = await (await fetch("seed.json")).json();
        for (const [path, doc] of Object.entries(docs)) { store.set(path, doc); persist(path, doc); }
      } catch { /* 예시 데이터 없이 시작 */ }
    }
  })();

  const segs = (path) => path.split("/").filter(Boolean).length;
  const snapOf = (path) => ({
    id: path.split("/").pop(), exists: store.has(path),
    data: () => (store.has(path) ? clone(store.get(path)) : undefined),
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  const tooBig = (data) => { if (JSON.stringify(data).length > 256 * 1024) throw { code: "invalid_argument", message: "document over 256 KiB" }; };

  function doc(path) {
    if (segs(path) % 2 !== 0) throw new TypeError("db.doc(): 문서 경로는 세그먼트가 짝수여야 한다: " + path);
    return {
      id: path.split("/").pop(), path,
      async get() { return snapOf(path); },
      async set(data) { tooBig(data); const v = clone(data); store.set(path, v); persist(path, v); notify(); },
      async update(data) {
        if (!store.has(path)) throw { code: "invalid_argument", message: "no such document" };
        const next = { ...store.get(path), ...clone(data) }; tooBig(next); store.set(path, next); persist(path, next); notify();
      },
      async delete() { store.delete(path); persist(path, undefined); notify(); },
      async acquire() { return { acquired: true }; },
      onSnapshot(next) { const f = () => next(snapOf(path)); subs.add(f); setTimeout(f, 0); return () => subs.delete(f); },
      collection: (sub) => collection(path + "/" + sub),
    };
  }
  const OPS = {
    "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b,
    "array-contains": (a, b) => Array.isArray(a) && a.includes(b), in: (a, b) => Array.isArray(b) && b.includes(a), "not-in": (a, b) => Array.isArray(b) && !b.includes(a),
  };
  function collection(path, ops = []) {
    if (segs(path) % 2 !== 1) throw new TypeError("db.collection(): 컬렉션 경로는 세그먼트가 홀수여야 한다: " + path);
    const run = () => {
      const depth = segs(path) + 1;
      const prefix = path + "/";
      let rows = [];
      for (const k of store.keys()) if (k.startsWith(prefix) && segs(k) === depth) rows.push(snapOf(k));
      for (const op of ops) {
        if (op.t === "where") { const fn = OPS[op.op] || (() => true); rows = rows.filter((d) => fn(d.data()[op.f], op.v)); }
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
      doc: (id) => doc(path + "/" + (id || Math.random().toString(36).slice(2, 14))),
      async add(data) { const d = doc(path + "/" + Math.random().toString(36).slice(2, 14)); await d.set(data); return d; },
    };
  }

  // ---------- 사용자 ----------
  const NAME = "나";
  const profile = (id) => ({ id, name: id === uid ? NAME : "", avatarUrl: "", color: "#2343d3", email: null, isMe: id === uid, guest: false });
  const user = {
    async isOwner() { return true; }, async canEdit() { return true; }, async can() { return true; },
    async id() { return uid; }, async name() { return NAME; }, async avatarUrl() { return null; }, async email() { return null; },
    async me() { return { id: uid, name: NAME, avatarUrl: "", color: "#2343d3", email: null, isOwner: true, canEdit: true }; },
    async profiles(ids) { const list = Array.isArray(ids) ? ids : [ids]; return Object.fromEntries(list.map((id) => [id, profile(id)])); },
    async search() { return []; },
  };

  // ---------- 파일 저장 ----------
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = String(filename || "download"); a.style.display = "none";
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: "saved" };
    },
  };

  const table = { db: { doc, collection }, user, downloads, sample: null, assets: null };
  window.__renoteLocal = true;
  window.claude = { use: async (name) => { await loaded; return name in table ? table[name] : null; } };
})();
