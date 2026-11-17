"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import type { DatasetPreview, DatasetSummary } from "@/server/datasets";
import { DatasetPreviewTable } from "./dataset-preview-table";
import { DatasetUploadButton } from "./dataset-upload";
import { fill } from "./insert";

type Props = { projectId: string; initial: DatasetSummary[] };

/** 프로젝트 홈의 "데이터" 섹션: CSV 업로드와 데이터셋 목록·미리보기 (SPEC 7.3 (e)) */
export function ProjectDataSection({ projectId, initial }: Props) {
  const t = messages.data;
  const [datasets, setDatasets] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function togglePreview(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setError(null);
    if (preview?.dataset.id === id) return;
    setPreview(null);
    try {
      setPreview(await api<DatasetPreview>(`/api/datasets/${id}/preview`));
    } catch {
      setError(t.loadFailed);
    }
  }

  return (
    <section aria-labelledby="project-data-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="project-data-heading" className="text-lg font-semibold">
          {t.heading}
        </h2>
        <DatasetUploadButton
          projectId={projectId}
          variant="outline"
          onUploaded={({ dataset, encoding, warnings: w }) => {
            setDatasets((list) => [dataset, ...list]);
            setNotice(fill(t.uploaded, { name: dataset.name, rows: dataset.rowCount, encoding: t.encoding[encoding] }));
            setWarnings(w);
          }}
        />
      </div>
      {notice ? (
        <div role="status" className="text-sm">
          <p>{notice}</p>
          {warnings.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {datasets.length === 0 ? (
        <p className="text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label={t.heading}>
          {datasets.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{d.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {fill(t.summary, { rows: d.rowCount, cols: d.columns.length })}
                  </span>
                  <Button type="button" size="sm" variant="ghost" aria-expanded={openId === d.id} onClick={() => void togglePreview(d.id)}>
                    {openId === d.id ? t.previewHide : t.preview}
                  </Button>
                </div>
              </div>
              {openId === d.id ? (
                error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : preview?.dataset.id === d.id ? (
                  <>
                    <DatasetPreviewTable label={fill(t.previewLabel, { name: d.name })} columns={preview.columns} rows={preview.rows} />
                    {preview.truncated ? (
                      <p className="text-xs text-muted-foreground">
                        {fill(t.previewNote, { shown: preview.rows.length, rows: preview.rowCount })}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t.panel.loading}</p>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
