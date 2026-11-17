"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAutocomplete } from "@/components/editor/autocomplete-toggle";
import { editorExtensions } from "@/components/editor/editor-extensions";
import { ReportPanels, ReportTools } from "@/components/editor/report-tools";
import { DataTools } from "@/components/data/data-tools";
import { EditorChat } from "@/components/editor/editor-chat";
import { FormatSidebar } from "@/components/editor/format-sidebar";
import { SnapshotPanel, type RestoredDoc } from "@/components/editor/snapshot-panel";
import { EditorToolbar } from "@/components/editor/toolbar";
import { useAutosave } from "@/components/editor/use-autosave";
import { useDocumentFormat } from "@/components/editor/use-document-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import type { AutosaveStatus } from "@/lib/editor/autosave";
import type { DocContent } from "@/lib/editor/content";
import { decideDraft, type LocalDraft } from "@/lib/editor/draft";
import { draftStore } from "@/lib/editor/draft-store";
import { KeyboardExit } from "@/lib/editor/keyboard-exit";
import { messages } from "@/lib/messages";

type Props = {
  projectId: string;
  doc: { id: string; title: string; contentJson: DocContent; version: number; updatedAt: string };
  /** 서버에서 PDF 내보내기를 할 수 있는가 (lib/features.ts, 페이지가 내려준다) */
  pdfExportEnabled: boolean;
};

const DRAFT_WRITE_MS = 300;
const dateTimeFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

function statusText(status: AutosaveStatus) {
  const t = messages.docs;
  switch (status.kind) {
    case "saving":
      return t.saving;
    case "dirty":
      return t.unsaved;
    case "offline":
      return t.offline;
    case "conflict":
      return t.conflictTitle;
    case "error":
      return `${t.saveFailed}: ${status.message}`;
    default:
      return t.saved.replace("{time}", timeFormat.format(status.at));
  }
}

export function DocumentEditor({ projectId, doc, pdfExportEnabled }: Props) {
  const t = messages.docs;
  const [title, setTitle] = useState(doc.title);
  const titleRef = useRef(doc.title);
  const [resolving, setResolving] = useState(false);
  const format = useDocumentFormat(doc.id); // 서식 규칙 (CSS 변수로 본문에 적용)
  // 글쓰기 자동완성 (흐린 제안, 문서 내용에는 들어가지 않음)
  const autocomplete = useAutocomplete({ documentId: doc.id, getTitle: () => titleRef.current });

  const editor = useEditor({
    extensions: [
      ...editorExtensions(),
      Placeholder.configure({ placeholder: t.placeholder }),
      KeyboardExit,
      autocomplete.extension,
    ],
    content: doc.contentJson,
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": t.editorLabel, role: "textbox", "aria-multiline": "true" } },
    // useEditor는 처음 만든 옵션을 계속 쓰므로, 최신 핸들러는 ref로 호출한다.
    onUpdate: () => onChangeRef.current(),
  });
  const editorRef = useRef(editor);
  const onChangeRef = useRef<() => void>(() => {});
  useEffect(() => {
    editorRef.current = editor;
    onChangeRef.current = onChange;
  });

  const { status, controllerRef } = useAutosave({
    docId: doc.id,
    version: doc.version,
    savedAt: doc.updatedAt,
    getPayload: () =>
      editor ? { title: titleRef.current.trim() || t.untitled, contentJson: editor.getJSON() as DocContent } : null,
  });

  // --- 로컬 초안 (IndexedDB): 변경을 즉시 기기에 보관하고, 서버 저장이 끝나면 지운다 ---
  const [draftOffer, setDraftOffer] = useState<{ draft: LocalDraft; serverChanged: boolean } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftBlocked = useRef(true); // 열 때의 초안 확인이 끝나기 전에는 초안을 덮어쓰지 않는다

  function writeDraftNow() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    const current = editorRef.current;
    if (!current || draftBlocked.current) return;
    void draftStore.put({
      docId: doc.id,
      title: titleRef.current,
      contentJson: current.getJSON() as DocContent,
      baseVersion: controllerRef.current?.getVersion() ?? doc.version,
      savedAt: Date.now(),
    });
  }

  function onChange() {
    controllerRef.current?.markDirty();
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(writeDraftNow, DRAFT_WRITE_MS);
  }

  // 서버에 저장되면 초안은 필요 없다.
  useEffect(() => {
    if (status.kind === "saved" && !draftBlocked.current && !controllerRef.current?.hasUnsavedChanges()) {
      void draftStore.delete(doc.id);
    }
  }, [status, doc.id, controllerRef]);

  // 탭을 닫기 직전의 마지막 입력도 초안에 남긴다.
  useEffect(() => {
    const flush = () => {
      if (draftTimer.current) writeDraftNow();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  });

  // 문서를 열 때: 남아 있는 초안이 서버와 다르면 복구를 제안한다.
  const checkedRef = useRef(false);
  useEffect(() => {
    if (!editor || checkedRef.current) return;
    checkedRef.current = true;
    void (async () => {
      const draft = await draftStore.get(doc.id);
      if (!draft) {
        draftBlocked.current = false;
        return;
      }
      // 직전 탭이 닫히며 보낸 저장이 이 페이지 로드보다 늦게 반영됐을 수 있어 서버 최신본을 다시 읽는다.
      let server = { title: doc.title, contentJson: doc.contentJson, version: doc.version, updatedAt: doc.updatedAt };
      try {
        server = (await api<{ document: typeof server }>(`/api/docs/${doc.id}`)).document;
      } catch {
        // 오프라인이면 페이지에 실린 내용을 기준으로 판단한다.
      }
      if (server.version !== doc.version && !controllerRef.current?.hasUnsavedChanges()) {
        editor.commands.setContent(server.contentJson, { emitUpdate: false });
        titleRef.current = server.title;
        setTitle(server.title);
        controllerRef.current?.resolveUseServer(server.version, new Date(server.updatedAt));
      }
      const decision = decideDraft(draft, server);
      if (decision.action === "offer") setDraftOffer({ draft, serverChanged: decision.serverChanged });
      else {
        await draftStore.delete(doc.id);
        draftBlocked.current = false;
      }
    })();
  }, [editor, doc, controllerRef]);

  function restoreDraft() {
    if (!editor || !draftOffer) return;
    editor.commands.setContent(draftOffer.draft.contentJson, { emitUpdate: false });
    titleRef.current = draftOffer.draft.title;
    setTitle(draftOffer.draft.title);
    setDraftOffer(null);
    draftBlocked.current = false;
    onChange();
    void controllerRef.current?.flush();
  }

  function discardDraft() {
    setDraftOffer(null);
    draftBlocked.current = false;
    void draftStore.delete(doc.id);
  }

  // --- 스냅샷(버전 기록) ---
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  async function saveSnapshot() {
    setNotice(null);
    // 아직 서버에 가지 않은 변경을 먼저 저장해야 스냅샷에 담긴다.
    await controllerRef.current?.flush();
    try {
      await api(`/api/docs/${doc.id}/snapshots`, { method: "POST" });
      setNotice(t.snapshotSaved);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t.saveFailed);
    }
  }

  function applyRestored(restored: RestoredDoc) {
    if (!editor) return;
    editor.commands.setContent(restored.contentJson, { emitUpdate: false });
    controllerRef.current?.resolveUseServer(restored.version, new Date(restored.updatedAt));
    void draftStore.delete(doc.id);
    setNotice(t.snapshotRestored);
  }

  async function useServerVersion() {
    if (!editor) return;
    setResolving(true);
    try {
      const res = await api<{ document: { title: string; contentJson: DocContent; version: number; updatedAt: string } }>(
        `/api/docs/${doc.id}`,
      );
      editor.commands.setContent(res.document.contentJson, { emitUpdate: false });
      titleRef.current = res.document.title;
      setTitle(res.document.title);
      controllerRef.current?.resolveUseServer(res.document.version, new Date(res.document.updatedAt));
    } finally {
      setResolving(false);
    }
  }

  async function keepMine() {
    setResolving(true);
    try {
      await controllerRef.current?.resolveKeepMine();
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:underline">
          ← {t.backToProject}
        </Link>
        <span
          role="status"
          aria-live="polite"
          data-testid="save-status"
          data-state={status.kind}
          className="ml-auto text-sm text-muted-foreground"
        >
          {statusText(status)}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={saveSnapshot}>
          {t.snapshotSave}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {t.snapshotHistory}
        </Button>
      </div>
      {notice ? (
        <p role="status" data-testid="editor-notice" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {historyOpen ? (
        <SnapshotPanel
          docId={doc.id}
          refreshKey={historyKey}
          onRestored={applyRestored}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      {status.kind === "conflict" ? (
        <div role="alert" data-testid="conflict-banner" className="flex flex-col gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-amber-950">
          <p className="font-semibold">{t.conflictTitle}</p>
          <p className="text-sm">{t.conflictBody}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={keepMine} disabled={resolving}>
              {t.keepMine}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={useServerVersion} disabled={resolving}>
              {t.useServer}
            </Button>
          </div>
        </div>
      ) : null}
      {draftOffer ? (
        <div role="alert" data-testid="draft-banner" className="flex flex-col gap-2 rounded-lg border border-sky-400 bg-sky-50 px-4 py-3 text-sky-950">
          <p className="font-semibold">{t.draftTitle}</p>
          <p className="text-sm">
            {t.draftBody.replace("{time}", dateTimeFormat.format(new Date(draftOffer.draft.savedAt)))}
            {draftOffer.serverChanged ? ` ${t.draftServerChanged}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={restoreDraft}>
              {t.draftRestore}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={discardDraft}>
              {t.draftDiscard}
            </Button>
          </div>
        </div>
      ) : null}
      <Input
        aria-label={t.titleLabel}
        value={title}
        maxLength={200}
        onChange={(e) => {
          titleRef.current = e.target.value;
          setTitle(e.target.value);
          onChange();
        }}
        className="h-11 text-xl font-semibold"
      />
      {editor ? <DataTools editor={editor} projectId={projectId} /> : null}
      <div className="flex flex-1 flex-col items-start gap-3 lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col self-stretch rounded-lg border bg-card">
          {editor ? (
            <EditorToolbar editor={editor}>
              <ReportTools editor={editor} />
              {autocomplete.renderToggle(editor)}
            </EditorToolbar>
          ) : null}
          {editor ? <ReportPanels editor={editor} /> : null}
          <EditorContent editor={editor} {...format.scopeProps} className="doc-format doc-content flex-1 px-6 py-5" />
        </div>
        <FormatSidebar
          format={format}
          editor={editor}
          docId={doc.id}
          flush={async () => controllerRef.current?.flush()}
          chat={<EditorChat editor={editor} documentId={doc.id} />}
          pdfExportEnabled={pdfExportEnabled}
        />
      </div>
    </div>
  );
}
