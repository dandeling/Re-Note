"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NativeSelect } from "@/components/pains/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { uploadAsset, type UploadedAsset } from "@/lib/upload-client";
import { parseKeywords } from "@/lib/validation/project";

type Initial = { projectId: string; title: string; summary: string; field: string; keywords: string[] };

type Draft = {
  projectId: string;
  title: string;
  summary: string;
  field: string;
  keywords: string[];
  limitations: string;
  reportAssetId: string | null;
};

type ReportMode = "none" | "upload" | "doc";
type Report = { id: string; filename: string };

/**
 * 연구 공개 폼: 입력 → 공개 전 확인 모달 → POST /api/research (SPEC 7.2, 9장 "공개 전 확인 모달").
 * 결과보고서는 (a) PDF 파일 업로드 또는 (b) 이 프로젝트의 문서를 서버에서 PDF로 내보내 내 자산으로 저장한 뒤,
 * 그 자산 ID를 `reportAssetId`로 넘긴다. 서버가 본인 소유 PDF인지 다시 검사한다.
 */
export function PublishResearchForm({
  initial,
  documents = [],
}: {
  initial: Initial;
  documents?: { id: string; title: string }[];
}) {
  const t = messages.research;
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReportMode>("none");
  const [report, setReport] = useState<Report | null>(null);
  const [reportBusy, setReportBusy] = useState<"upload" | "doc" | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [docId, setDocId] = useState(documents[0]?.id ?? "");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (draft && !dialog.open) dialog.showModal();
    if (!draft && dialog.open) dialog.close();
  }, [draft]);

  function changeMode(next: ReportMode) {
    setMode(next);
    setReport(null);
    setReportError(null);
  }

  async function attach(run: () => Promise<UploadedAsset>, kind: "upload" | "doc") {
    setReportBusy(kind);
    setReportError(null);
    setReport(null);
    try {
      const asset = await run();
      if (asset.kind !== "PDF") throw new Error(t.reportOnlyPdf);
      setReport({ id: asset.id, filename: asset.filename });
    } catch (err) {
      setReportError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setReportBusy(null);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      setReport(null);
      setReportError(t.reportOnlyPdf);
      return;
    }
    void attach(() => uploadAsset(file, { projectId: initial.projectId }), "upload");
  }

  function exportDoc() {
    if (!docId) return;
    void attach(
      async () =>
        (
          await api<{ asset: UploadedAsset }>(`/api/docs/${encodeURIComponent(docId)}/export`, {
            method: "POST",
            body: { format: "pdf", saveAsAsset: true },
          })
        ).asset,
      "doc",
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (reportBusy) {
      setError(t.reportBusy);
      return;
    }
    const form = new FormData(e.currentTarget);
    const keywords = parseKeywords(String(form.get("keywords") ?? ""));
    if (keywords.length === 0) {
      setError(t.keywordsRequired);
      return;
    }
    setError(null);
    setDraft({
      projectId: initial.projectId,
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
      field: String(form.get("field") ?? ""),
      keywords,
      limitations: String(form.get("limitations") ?? ""),
      reportAssetId: mode === "none" ? null : (report?.id ?? null),
    });
  }

  async function publish() {
    if (!draft) return;
    setPending(true);
    setError(null);
    try {
      const { research } = await api<{ research: { id: string } }>("/api/research", { method: "POST", body: draft });
      router.push(`/research/${research.id}`);
    } catch (err) {
      setDraft(null);
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  const attached = mode !== "none" ? report : null;

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="research-title">{t.fieldTitle}</Label>
          <Input id="research-title" name="title" required maxLength={200} defaultValue={initial.title} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="research-summary">{t.fieldSummary}</Label>
          <Textarea
            id="research-summary"
            name="summary"
            required
            maxLength={5000}
            rows={6}
            placeholder={t.summaryPlaceholder}
            defaultValue={initial.summary}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="research-field">{t.fieldField}</Label>
            <Input id="research-field" name="field" maxLength={100} defaultValue={initial.field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="research-keywords">{t.fieldKeywords}</Label>
            <Input
              id="research-keywords"
              name="keywords"
              required
              placeholder={t.keywordsPlaceholder}
              defaultValue={initial.keywords.join(", ")}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="research-limitations">{t.fieldLimitations}</Label>
          <Textarea
            id="research-limitations"
            name="limitations"
            maxLength={5000}
            rows={4}
            placeholder={t.limitationsPlaceholder}
          />
        </div>
        <fieldset className="flex flex-col gap-3" aria-describedby="research-report-hint">
          <legend className="text-sm font-medium">{t.fieldReport}</legend>
          <p id="research-report-hint" className="text-sm text-muted-foreground">
            {t.reportHint}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {(
              [
                ["none", t.reportModeNone],
                ["upload", t.reportModeUpload],
                ["doc", t.reportModeDoc],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="reportMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => changeMode(value)}
                />
                {label}
              </label>
            ))}
          </div>
          {mode === "upload" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="research-report-file">{t.reportFileLabel}</Label>
              <Input
                id="research-report-file"
                type="file"
                accept=".pdf,application/pdf"
                disabled={reportBusy !== null}
                onChange={onFile}
              />
            </div>
          ) : null}
          {mode === "doc" ? (
            documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.reportNoDocs}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="research-report-doc">{t.reportDocLabel}</Label>
                <div className="flex flex-wrap gap-2">
                  <NativeSelect
                    id="research-report-doc"
                    value={docId}
                    onChange={(e) => {
                      setDocId(e.currentTarget.value);
                      setReport(null);
                    }}
                    className="w-auto min-w-48 flex-1"
                  >
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="button" variant="outline" disabled={reportBusy !== null} onClick={exportDoc}>
                    {t.reportMakePdf}
                  </Button>
                </div>
              </div>
            )
          ) : null}
          <div aria-live="polite" className="text-sm">
            {reportBusy === "upload" ? <p>{t.reportUploading}</p> : null}
            {reportBusy === "doc" ? <p>{t.reportExporting}</p> : null}
            {attached ? (
              <p data-testid="report-attached">{t.reportAttached.replace("{filename}", attached.filename)}</p>
            ) : null}
          </div>
          {reportError ? (
            <p role="alert" className="text-sm text-destructive">
              {reportError}
            </p>
          ) : null}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit">{t.submit}</Button>
        </div>
      </form>

      <dialog
        ref={dialogRef}
        aria-labelledby="publish-confirm-title"
        onClose={() => setDraft(null)}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/40"
      >
        <h2 id="publish-confirm-title" className="text-lg font-semibold">
          {t.confirmTitle}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t.confirmBody}</p>
        {draft ? (
          <dl className="mt-4 flex flex-col gap-1 text-sm">
            <dt className="font-medium">{t.fieldTitle}</dt>
            <dd className="text-muted-foreground">{draft.title}</dd>
            <dt className="font-medium">{t.fieldKeywords}</dt>
            <dd className="text-muted-foreground">{draft.keywords.join(", ")}</dd>
            <dt className="font-medium">{t.report}</dt>
            <dd className="text-muted-foreground">{draft.reportAssetId && attached ? attached.filename : t.reportNone}</dd>
          </dl>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => setDraft(null)}>
            {t.cancel}
          </Button>
          <Button type="button" disabled={pending} onClick={publish}>
            {t.confirm}
          </Button>
        </div>
      </dialog>
    </>
  );
}
