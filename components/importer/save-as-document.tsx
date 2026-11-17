"use client";

import Link from "next/link";
import { useState } from "react";
import { createDocumentFromContent, importBlocksAsDocument } from "@/components/importer/browser-import";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DocContent } from "@/lib/editor/content";
import type { Block } from "@/lib/hwp-browser";
import { fill, hwpBrowserText } from "@/lib/hwp-browser/ui-text";

const c = hwpBrowserText.common;

export const titleFromFilename = (name: string) => name.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "가져온 문서";

/**
 * 브라우저에서 읽은 문서를 새 문서로 저장하는 양식. projects가 있으면 프로젝트를 고르고, 없으면 projectId에 저장한다.
 * 저장하기 전에는 아무것도 서버로 가지 않는다. blocks(한글 파일) 또는 이미 만든 문서 JSON(doc, Markdown·텍스트)을 저장한다.
 */
export function SaveAsDocument({
  blocks,
  doc,
  filename,
  projectId,
  projects,
  actionLabel = c.save,
  onSaved,
}: {
  blocks?: Block[];
  doc?: DocContent;
  filename: string;
  projectId?: string;
  projects?: { id: string; title: string }[];
  actionLabel?: string;
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState(() => titleFromFilename(filename));
  const [project, setProject] = useState(projectId ?? projects?.[0]?.id ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ projectId: string; documentId: string; title: string; imageFailures: number; truncated: boolean } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || saving) return;
    setSaving(true);
    setError(null);
    setStatus(c.saving);
    try {
      const name = title.trim() || titleFromFilename(filename);
      if (doc) {
        setStatus(c.creating);
        const created = await createDocumentFromContent(project, name, doc);
        setResult({ projectId: project, documentId: created.id, title: created.title, imageFailures: 0, truncated: false });
      } else {
        const saved = await importBlocksAsDocument({
          projectId: project,
          title: name,
          blocks: blocks ?? [],
          onProgress: (p) => setStatus(p.phase === "images" ? fill(c.uploadingImages, { done: p.done, total: p.total }) : c.creating),
        });
        setResult({ ...saved, projectId: project });
      }
      onSaved?.();
      setStatus(null);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error && /[가-힣]/.test(err.message) ? err.message : c.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border bg-muted/40 px-4 py-3 text-sm">
        <p>{fill(c.saved, { title: result.title })}</p>
        {result.imageFailures ? <p>{fill(c.imagesFailed, { n: result.imageFailures })}</p> : null}
        {result.truncated ? <p>{c.truncated}</p> : null}
        <div>
          <Link href={`/projects/${result.projectId}/docs/${result.documentId}`} className={buttonVariants({ size: "sm" })}>
            {c.openDocument}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {projects ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hwp-import-project">{hwpBrowserText.convert.projectLabel}</Label>
          <select
            id="hwp-import-project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            disabled={saving}
            className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hwp-import-title">{c.titleLabel}</Label>
        <Input id="hwp-import-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={saving} className="max-w-md" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving || !project}>
          {actionLabel}
        </Button>
        <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {status}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
