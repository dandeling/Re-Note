"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { DocContent } from "@/lib/editor/content";
import { messages } from "@/lib/messages";

type Snapshot = { id: string; version: number; reason: "AUTO" | "MANUAL" | "IMPORT"; createdAt: string };
export type RestoredDoc = { title: string; contentJson: DocContent; version: number; updatedAt: string };

const format = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "medium" });

/** 버전 기록: 스냅샷 목록과 복원 */
export function SnapshotPanel({
  docId,
  refreshKey,
  onRestored,
  onClose,
}: {
  docId: string;
  refreshKey: number;
  onRestored: (doc: RestoredDoc) => void;
  onClose: () => void;
}) {
  const t = messages.docs;
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // 패널을 연 요소(버전 기록 버튼)를 기억했다가, 패널 안에 포커스가 있던 채로 닫히면 그 요소로 되돌린다.
  // (닫기 버튼이 사라지면서 포커스가 문서 맨 앞으로 튀는 것을 막는다)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    return () => {
      const active = document.activeElement;
      const focusLost = !active || active === document.body || (panel?.contains(active) ?? false);
      if (focusLost && opener?.isConnected) opener.focus();
    };
  }, []);

  const fetchSnapshots = useCallback(
    () => api<{ snapshots: Snapshot[] }>(`/api/docs/${docId}/snapshots`).then((r) => r.snapshots),
    [docId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchSnapshots().then(
      (list) => {
        if (!cancelled) setSnapshots(list);
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshots, refreshKey]);

  async function restore(snapshotId: string) {
    if (!window.confirm(t.snapshotRestoreConfirm)) return;
    setPending(true);
    setError(null);
    try {
      const res = await api<{ document: RestoredDoc }>(`/api/docs/${docId}/restore`, {
        method: "POST",
        body: { snapshotId },
      });
      onRestored(res.document);
      setSnapshots(await fetchSnapshots());
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      ref={panelRef}
      aria-labelledby="snapshot-heading"
      className="rounded-lg border bg-card p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="snapshot-heading" className="font-semibold">
          {t.snapshotHistory}
        </h2>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t.snapshotNote}</p>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {snapshots === null ? null : snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.snapshotEmpty}</p>
      ) : (
        <ul className="divide-y" data-testid="snapshot-list">
          {snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <time dateTime={s.createdAt}>{format.format(new Date(s.createdAt))}</time>
              <Badge variant={s.reason === "MANUAL" ? "default" : "secondary"}>{t.snapshotReason[s.reason]}</Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={pending}
                onClick={() => restore(s.id)}
              >
                {t.snapshotRestore}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
