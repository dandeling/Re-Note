"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiClientError } from "@/lib/api-client";
import { messages } from "@/lib/messages";

type ImportJobView = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  filename: string;
  error: string | null;
  mode: "new" | "insert" | "attachOnly" | null;
  projectId: string | null;
  documentId: string | null;
  stats: { paragraphs: number; headings: number; tables: number; images: number } | null;
  notes: { code: string; text: string }[];
  original: { url: string; kind: string; mime: string };
  previewUrl: string | null;
};

const t = messages.importer;
const POLL_MS = 1000;
const ACCEPT = ".pdf,.hwp,.hwpx,.docx,.md";

function setJobInUrl(jobId: string | null) {
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", url);
}

/** 원본 미리보기 주소: 변환한 미리보기 PDF가 있으면 그것, 아니면 브라우저가 바로 보여 주는 형식(PDF·텍스트)만 */
function previewSource(job: ImportJobView): string | null {
  if (job.previewUrl) return job.previewUrl;
  if (job.original.mime === "application/pdf" || job.original.mime.startsWith("text/")) return job.original.url;
  return null;
}

export function ImportTool({
  projectId,
  target,
  maxMb,
  initialJobId,
}: {
  projectId: string;
  target: { id: string; title: string } | null;
  maxMb: number;
  initialJobId: string | null;
}) {
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [job, setJob] = useState<ImportJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const { job: next } = await api<{ job: ImportJobView }>(`/api/import/${jobId}`);
        if (stopped) return;
        setJob(next);
        if (next.status === "QUEUED" || next.status === "RUNNING") timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (stopped) return;
        setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
        setJobId(null);
        setJobInUrl(null);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) return setError(messages.assets.fileRequired);
    if (!/\.(pdf|hwpx?|docx|md)$/i.test(file.name)) return setError(t.unsupported);
    if (file.size > maxMb * 1024 * 1024) return setError(messages.assets.tooLarge.replace("{mb}", String(maxMb)));
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", projectId);
    if (target) form.set("documentId", target.id);
    setUploading(true);
    try {
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiClientError(res.status, data?.error?.code ?? "INTERNAL_ERROR", data?.error?.message ?? messages.errors.INTERNAL_ERROR);
      setJob(data.job);
      setJobId(data.job.id);
      setJobInUrl(data.job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setJob(null);
    setJobId(null);
    setError(null);
    setJobInUrl(null);
  }

  const finished = job?.status === "DONE" || job?.status === "FAILED";
  const busy = uploading || (jobId !== null && !finished);
  const preview = job?.status === "DONE" ? previewSource(job) : null;

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
        {target ? t.insertNotice.replace("{title}", target.title) : t.safeNotice}
      </p>

      {!jobId ? (
        <form onSubmit={submit} className="flex max-w-xl flex-col gap-3">
          <Label htmlFor="import-file">{t.fileLabel}</Label>
          <Input id="import-file" ref={inputRef} type="file" accept={ACCEPT} disabled={busy} />
          <p className="text-sm text-muted-foreground">{t.accept.replace("{mb}", String(maxMb))}</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {t.submit}
            </Button>
            <Link href={`/projects/${projectId}`} className={buttonVariants({ variant: "ghost" })}>
              {t.backToProject}
            </Link>
          </div>
        </form>
      ) : null}

      <div role="status" aria-live="polite" className="text-sm">
        {uploading ? t.uploading : job ? t.status[job.status] : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {job?.status === "FAILED" && job.error ? <p className="text-sm text-destructive">{job.error}</p> : null}

      {job?.status === "DONE" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.qualityTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {job.mode === "attachOnly" ? (
                <p className="text-sm">{t.attachedOnly}</p>
              ) : job.stats ? (
                <p className="text-sm text-muted-foreground">
                  {t.stats
                    .replace("{paragraphs}", String(job.stats.paragraphs))
                    .replace("{headings}", String(job.stats.headings))
                    .replace("{tables}", String(job.stats.tables))
                    .replace("{images}", String(job.stats.images))}
                </p>
              ) : null}
              <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
                {job.notes.map((note) => (
                  <li key={note.code}>{note.text}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {job.documentId && job.projectId ? (
                  <Link href={`/projects/${job.projectId}/docs/${job.documentId}`} className={buttonVariants()}>
                    {t.openDocument}
                  </Link>
                ) : null}
                <Link href={`/projects/${projectId}`} className={buttonVariants({ variant: "outline" })}>
                  {t.backToProject}
                </Link>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>{t.previewTitle}</CardTitle>
              <a href={`${job.original.url}?download=1`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t.downloadOriginal}
              </a>
            </CardHeader>
            <CardContent>
              {preview ? (
                <iframe title={t.previewTitle} src={preview} className="h-[70vh] w-full rounded-md border bg-white" />
              ) : (
                <p className="text-sm text-muted-foreground">{t.previewUnavailable}</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {finished ? (
        <div>
          <Button type="button" variant="outline" onClick={reset}>
            {t.submit}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
