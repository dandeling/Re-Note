"use client";

import { api, ApiClientError } from "@/lib/api-client";
import { messages } from "@/lib/messages";

export type UploadedAsset = {
  id: string;
  kind: "IMAGE" | "PDF" | "HWP" | "HWPX" | "CSV" | "OTHER";
  filename: string;
  size: number;
  mime: string;
  projectId: string | null;
  /** 소유자만 읽을 수 있는 자산 URL (`/api/assets/:id`) */
  url: string;
};

type UploadTicket = { uploadUrl: string; key: string; method: "PUT"; headers: Record<string, string> };

/**
 * 파일을 스토리지에 올리고 Asset을 만든다 (로그인 필요).
 * upload-url 발급 → presigned URL로 PUT → complete(서버가 매직바이트·용량 재검사) 순서다.
 */
export async function uploadAsset(file: File, opts: { projectId?: string } = {}): Promise<UploadedAsset> {
  const ticket = await api<UploadTicket>("/api/assets/upload-url", {
    method: "POST",
    body: { filename: file.name, size: file.size, projectId: opts.projectId },
  });
  const put = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body: file });
  if (!put.ok) throw new ApiClientError(put.status, "INTERNAL_ERROR", messages.assets.uploadFailed);
  const { asset } = await api<{ asset: UploadedAsset }>("/api/assets/complete", {
    method: "POST",
    body: { key: ticket.key, filename: file.name, projectId: opts.projectId },
  });
  return asset;
}
