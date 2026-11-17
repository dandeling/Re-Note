"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiClientError } from "@/lib/api-client";
import { messages } from "@/lib/messages";

type JobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";
type ConversionJobView = {
  id: string;
  status: JobStatus;
  filename: string;
  error: string | null;
  pages: number | null;
  outputFilename: string | null;
  previewUrl: string | null;
  downloadUrl: string | null;
};

const POLL_MS = 1000;
const t = messages.convert;

async function postFile(file: File): Promise<ConversionJobView> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/convert", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiClientError(res.status, data?.error?.code ?? "INTERNAL_ERROR", data?.error?.message ?? messages.errors.INTERNAL_ERROR);
  return data.job;
}

function setJobInUrl(jobId: string | null) {
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", url);
}

export function ConvertTool({ maxMb, initialJobId }: { maxMb: number; initialJobId: string | null }) {
  const [job, setJob] = useState<ConversionJobView | null>(null);
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 작업이 끝날 때까지 상태를 폴링한다.
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const { job: next } = await api<{ job: ConversionJobView }>(`/api/convert/${jobId}`);
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
    if (!/\.hwpx?$/i.test(file.name)) return setError(t.onlyHwp);
    if (file.size > maxMb * 1024 * 1024) return setError(messages.assets.tooLarge.replace("{mb}", String(maxMb)));
    setUploading(true);
    try {
      const created = await postFile(file);
      setJob(created);
      setJobId(created.id);
      setJobInUrl(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setUploading(false);
    }
  }

  const reset = useCallback(() => {
    setJob(null);
    setJobId(null);
    setError(null);
    setJobInUrl(null);
  }, []);

  const finished = job?.status === "DONE" || job?.status === "FAILED";
  const busy = uploading || (jobId !== null && !finished);

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        {t.layoutNotice}
      </p>

      {!jobId ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Label htmlFor="convert-file">{t.fileLabel}</Label>
          <Input id="convert-file" ref={inputRef} type="file" accept=".hwp,.hwpx" disabled={busy} />
          <p className="text-sm text-muted-foreground">{t.limit.replace("{mb}", String(maxMb))}</p>
          <div>
            <Button type="submit" disabled={busy}>
              {t.submit}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.privacy}</p>
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

      {job?.status === "FAILED" ? (
        <p className="text-sm text-destructive">{t.failedReason.replace("{reason}", job.error ?? t.errors.INTERNAL)}</p>
      ) : null}

      {job?.status === "DONE" && job.previewUrl && job.downloadUrl ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <CardTitle>
              {t.previewTitle}
              {job.pages ? <span className="ml-2 text-sm font-normal text-muted-foreground">{t.pages.replace("{n}", String(job.pages))}</span> : null}
            </CardTitle>
            <Button asChild>
              <a href={job.downloadUrl} download={job.outputFilename ?? undefined}>
                {t.download}
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            <iframe title={t.previewTitle} src={job.previewUrl} className="h-[70vh] w-full rounded-md border" />
          </CardContent>
        </Card>
      ) : null}

      {finished ? (
        <div>
          <Button type="button" variant="outline" onClick={reset}>
            {t.another}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
