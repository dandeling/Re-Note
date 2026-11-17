"use client";

import { api, ApiClientError } from "@/lib/api-client";
import type { DocContent } from "@/lib/editor/content";
import { blocksToDoc, type Block, type ImageBlock } from "@/lib/hwp-browser";
import { uploadAsset } from "@/lib/upload-client";

/**
 * 브라우저에서 읽은 한글 문서를 이 앱의 새 문서로 저장한다(서버 변환을 끈 배포용).
 * 1) 그림은 기존 자산 업로드 경로(presigned PUT → complete)로 프로젝트 자산이 된다. 실패한 그림은 그 자리에 안내 문단.
 * 2) 블록 → Tiptap JSON(blocksToDoc) → POST /api/projects/:id/docs 로 새 문서. 기존 문서는 건드리지 않는다.
 */

const EXT: Record<ImageBlock["mime"], string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
/** 요청 본문 한도(Vercel 함수 본문 4.5MB)보다 작게: 문서 JSON의 UTF-8 바이트 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type BrowserImportProgress = { phase: "images"; done: number; total: number } | { phase: "document" };

export type BrowserImportResult = {
  documentId: string;
  title: string;
  imageFailures: number;
  truncated: boolean;
  stats: ReturnType<typeof blocksToDoc>["stats"];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadImage(img: ImageBlock, projectId: string, index: number): Promise<string> {
  const file = new File([img.bytes.slice()], `hwp-image-${index}.${EXT[img.mime]}`, { type: img.mime });
  // 업로드 한도(분당 횟수)에 걸리면 잠시 기다렸다 두 번까지 다시 해 본다
  for (let attempt = 0; ; attempt++) {
    try {
      const asset = await uploadAsset(file, { projectId });
      return asset.url;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429 && attempt < 2) {
        await sleep(15_000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

/** 워커를 거치지 않는 기존 문서 생성 API(POST /api/projects/:id/docs)로 새 문서를 만든다 */
export async function createDocumentFromContent(projectId: string, title: string, contentJson: DocContent) {
  const { document } = await api<{ document: { id: string; title: string } }>(`/api/projects/${projectId}/docs`, {
    method: "POST",
    body: { title: title.trim().slice(0, 200) || "가져온 문서", contentJson },
  });
  return document;
}

export async function importBlocksAsDocument(opts: {
  projectId: string;
  title: string;
  blocks: Block[];
  onProgress?: (p: BrowserImportProgress) => void;
}): Promise<BrowserImportResult> {
  const { projectId, blocks } = opts;
  const title = opts.title.trim().slice(0, 200) || "가져온 문서";

  // 같은 그림(같은 바이트)을 여러 곳에서 쓰면 한 번만 올린다
  const unique: ImageBlock[] = [];
  const seen = new Set<Uint8Array>();
  for (const b of blocks) {
    if (b.type !== "image" || seen.has(b.bytes)) continue;
    seen.add(b.bytes);
    unique.push(b);
  }
  const urls = new Map<Uint8Array, string>();
  let done = 0;
  for (const img of unique) {
    opts.onProgress?.({ phase: "images", done, total: unique.length });
    try {
      urls.set(img.bytes, await uploadImage(img, projectId, img.n));
    } catch (err) {
      console.warn("hwp image upload failed", err);
    }
    done++;
  }

  opts.onProgress?.({ phase: "document" });
  const converted = blocksToDoc(blocks, { imageUrl: (img) => urls.get(img.bytes) ?? null, maxBytes: MAX_BODY_BYTES });
  const document = await createDocumentFromContent(projectId, title, converted.doc);
  return {
    documentId: document.id,
    title: document.title,
    imageFailures: converted.stats.imagePlaceholders,
    truncated: converted.truncated,
    stats: converted.stats,
  };
}
