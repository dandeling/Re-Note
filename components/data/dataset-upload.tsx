"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { uploadAsset } from "@/lib/upload-client";
import type { DatasetSummary } from "@/server/datasets";

export type DatasetUploadResult = { dataset: DatasetSummary; encoding: "utf-8" | "euc-kr"; warnings: string[] };

/** CSV 파일을 자산으로 올린 뒤 Dataset으로 등록한다. */
export async function uploadDataset(file: File, projectId: string): Promise<DatasetUploadResult> {
  const asset = await uploadAsset(file, { projectId });
  return api<DatasetUploadResult>("/api/datasets", { method: "POST", body: { assetId: asset.id } });
}

type Props = {
  projectId: string;
  onUploaded: (result: DatasetUploadResult) => void;
  variant?: "default" | "outline";
};

export function DatasetUploadButton({ projectId, onUploaded, variant = "default" }: Props) {
  const t = messages.data;
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      onUploaded(await uploadDataset(file, projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.assets.uploadFailed);
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label={t.upload}
        data-testid="dataset-file-input"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button type="button" size="sm" variant={variant} disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? t.uploading : t.upload}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
