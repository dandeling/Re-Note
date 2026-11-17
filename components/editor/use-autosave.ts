"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/api-client";
import {
  AutosaveController,
  SaveConflictError,
  SaveOfflineError,
  type AutosaveStatus,
} from "@/lib/editor/autosave";
import type { DocContent } from "@/lib/editor/content";

export type DocPayload = { title: string; contentJson: DocContent };

async function saveDocument(docId: string, payload: DocPayload, baseVersion: number, keepalive = false) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new SaveOfflineError();
  try {
    const res = await api<{ document: { version: number; updatedAt: string } }>(`/api/docs/${docId}`, {
      method: "PATCH",
      body: { ...payload, baseVersion },
      keepalive,
    });
    return res.document;
  } catch (err) {
    if (err instanceof ApiClientError) {
      if (err.status === 409) throw new SaveConflictError(Number(err.body?.serverVersion ?? baseVersion));
      throw err;
    }
    // fetch 자체가 실패한 경우(TypeError)는 네트워크 문제로 본다.
    throw new SaveOfflineError();
  }
}

/** 문서 자동 저장 훅: 컨트롤러 생성, 온라인/오프라인 이벤트, 탭 닫기 전 저장을 처리한다. */
export function useAutosave(opts: {
  docId: string;
  version: number;
  savedAt: string;
  getPayload: () => DocPayload | null;
}) {
  const [status, setStatus] = useState<AutosaveStatus>({ kind: "saved", at: new Date(opts.savedAt) });
  const getPayloadRef = useRef(opts.getPayload);
  useEffect(() => {
    getPayloadRef.current = opts.getPayload;
  });
  const controllerRef = useRef<AutosaveController<DocPayload | null> | null>(null);

  useEffect(() => {
    const controller = new AutosaveController<DocPayload | null>({
      version: opts.version,
      savedAt: new Date(opts.savedAt),
      getPayload: () => getPayloadRef.current(),
      save: async (payload, baseVersion) => {
        if (!payload) throw new Error("editor not ready");
        return saveDocument(opts.docId, payload, baseVersion);
      },
      onStatus: setStatus,
    });
    controllerRef.current = controller;

    const onOnline = () => void controller.retry();
    const onOffline = () => controller.setOffline();
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void controller.flush();
      }
    };
    // 탭을 닫거나 떠날 때 남은 변경을 keepalive 요청으로 보낸다.
    const onPageHide = () => {
      const payload = getPayloadRef.current();
      if (controller.hasUnsavedChanges() && payload && controller.getStatus().kind !== "conflict") {
        void saveDocument(opts.docId, payload, controller.getVersion(), true).catch(() => {});
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsavedChanges()) e.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      void controller.flush();
      controller.dispose();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // 문서가 바뀔 때만 컨트롤러를 새로 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.docId]);

  return { status, controllerRef };
}
