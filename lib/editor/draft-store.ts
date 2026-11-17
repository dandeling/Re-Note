"use client";

import type { LocalDraft } from "@/lib/editor/draft";

const DB_NAME = "researchmate";
const STORE = "drafts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "docId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** IndexedDB를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 건너뛴다. */
async function safely<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    if (typeof indexedDB === "undefined") return fallback;
    return await fn();
  } catch {
    return fallback;
  }
}

export const draftStore = {
  get: (docId: string) =>
    safely<LocalDraft | null>(null, async () => (await tx<LocalDraft | undefined>("readonly", (s) => s.get(docId))) ?? null),
  put: (draft: LocalDraft) => safely<void>(undefined, async () => void (await tx("readwrite", (s) => s.put(draft)))),
  delete: (docId: string) => safely<void>(undefined, async () => void (await tx("readwrite", (s) => s.delete(docId)))),
};
