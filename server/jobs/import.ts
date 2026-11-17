import path from "node:path";
import { z } from "zod";
import { looksLikeDocx } from "@/lib/conversion/precheck";
import { ConversionError, type Attempt } from "@/lib/conversion/to-pdf";
import { prisma } from "@/lib/db";
import { MAX_CONTENT_BYTES, type DocContent, type DocNode } from "@/lib/editor/content";
import type { Prisma } from "@/lib/generated/prisma/client";
import { docxToHtml } from "@/lib/importer/docx";
import { collectImageSources, htmlToDoc, type ImportStats } from "@/lib/importer/html-to-doc";
import { markdownToHtml } from "@/lib/importer/markdown";
import type { ImportNote, NoteCode } from "@/lib/importer/notes";
import { log } from "@/lib/log";
import { messages } from "@/lib/messages";
import { getStorage } from "@/lib/storage";
import { createAssetFromBytes } from "@/server/assets";
import { ImportTargetGoneError, type JobContext, type JobOutcome, type JobWithInput } from "@/server/jobs/process";
import { snapshotOf } from "@/server/snapshots";

/** 작업 입력값 (POST /api/import가 만든다) */
export const importParamsSchema = z.object({
  projectId: z.string().min(1),
  /** 있으면 이 문서의 끝에 붙인다(붙이기 전 스냅샷). 없으면 새 문서를 만든다. */
  documentId: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
});
export type ImportParams = z.infer<typeof importParamsSchema>;

/** 추출기가 돌려주는 중간 결과 */
export type Extracted = {
  html: string;
  notes: NoteCode[];
  /** HTML의 img src → 그림 바이트 (data: URI가 아닌 그림) */
  images?: Map<string, { filename: string; bytes: Uint8Array }>;
  /** 원본 미리보기용 PDF (DOCX·HWP처럼 브라우저가 바로 못 보여 주는 형식) */
  previewPdf?: { filename: string; bytes: Uint8Array } | null;
  /** 문서를 만들지 않고 원본을 첨부 자산으로만 남긴다 (스캔 PDF) */
  attachOnly?: boolean;
  /** 제목으로 쓸 만한 문서 속성 (PDF Title 등) */
  title?: string | null;
  /** 추출에 쓴 엔진과 시도 내역 (구조화 로그·작업 결과) */
  engine?: string;
  attempts?: Attempt[];
};

export type ImportResult = {
  mode: "new" | "insert" | "attachOnly";
  projectId: string;
  documentId: string | null;
  notes: ImportNote[];
  stats: ImportStats;
  previewAssetId: string | null;
  engine?: string;
  attempts?: Attempt[];
};

const MAX_IMAGES = 200;
const DATA_URI = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i;

type ExtractInput = { bytes: Uint8Array; job: JobWithInput; ctx: JobContext };

async function extractMarkdown({ bytes }: ExtractInput): Promise<Extracted> {
  if (bytes.includes(0)) throw new ConversionError("CORRUPT");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // UTF-8이 아니면(CP949 등) 깨진 글자를 대체 문자로 두고 진행한다
    text = new TextDecoder("utf-8").decode(bytes);
  }
  const { html, hadHtml } = markdownToHtml(text);
  return { html, notes: [...(hadHtml ? (["MD_HTML"] as const) : []), "CHECK_ORIGINAL"] };
}

async function extractDocx({ bytes, ctx }: ExtractInput): Promise<Extracted> {
  if (!looksLikeDocx(bytes)) throw new ConversionError("CORRUPT");
  let html: string;
  try {
    ({ html } = await docxToHtml(bytes));
  } catch (err) {
    throw new ConversionError("CORRUPT", [], String(err));
  }
  const { renderPreviewPdf } = await import("@/server/jobs/import-preview");
  return { html, notes: ["LAYOUT", "DOCX_STYLES", "CHECK_ORIGINAL"], previewPdf: await renderPreviewPdf(bytes, "docx", ctx) };
}

async function extract(input: ExtractInput): Promise<Extracted> {
  switch (input.job.type) {
    case "IMPORT_MD":
      return extractMarkdown(input);
    case "IMPORT_DOCX":
      return extractDocx(input);
    case "IMPORT_PDF": {
      const { extractPdf } = await import("@/server/jobs/import-pdf");
      return extractPdf(input);
    }
    case "IMPORT_HWP": {
      const { extractHwp } = await import("@/server/jobs/import-hwp");
      return extractHwp(input);
    }
    default:
      throw new ConversionError("INTERNAL", [], `not an import job: ${input.job.type}`);
  }
}

/** 그림을 프로젝트 자산으로 올리고 img src → 자산 URL 표를 만든다. 실패한 그림은 버린다(품질 안내에 개수 표시). */
async function uploadImages(html: string, extracted: Extracted, owner: { ownerId: string; projectId: string }) {
  const urls = new Map<string, string>();
  for (const [index, src] of collectImageSources(html).slice(0, MAX_IMAGES).entries()) {
    let image: { filename: string; bytes: Uint8Array } | undefined;
    const data = DATA_URI.exec(src);
    if (data) {
      const ext = data[1].toLowerCase() === "jpeg" ? "jpg" : data[1].toLowerCase();
      image = { filename: `image-${index + 1}.${ext}`, bytes: Buffer.from(data[2].replace(/\s+/g, ""), "base64") };
    } else {
      image = extracted.images?.get(src);
    }
    if (!image) continue;
    try {
      const asset = await createAssetFromBytes({
        ownerId: owner.ownerId,
        projectId: owner.projectId,
        filename: image.filename,
        bytes: image.bytes,
        allowed: ["png", "jpg", "jpeg", "gif", "webp"],
      });
      urls.set(src, `/api/assets/${asset.id}`);
    } catch (err) {
      log.warn("import.image_skipped", { filename: image.filename, reason: String(err).slice(0, 200) });
    }
  }
  return urls;
}

/** 직렬화 크기가 문서 한도를 넘으면 뒤쪽 블록부터 잘라 낸다 */
function fitToLimit(doc: DocContent, extra: DocNode[] = []): { doc: DocContent; truncated: boolean } {
  const blocks = [...(doc.content ?? [])];
  const size = () => JSON.stringify({ type: "doc", content: [...extra, ...blocks] }).length;
  let truncated = false;
  while (blocks.length > 1 && size() > MAX_CONTENT_BYTES) {
    blocks.splice(Math.max(1, Math.floor(blocks.length * 0.9)));
    truncated = true;
  }
  return { doc: { type: "doc", content: blocks }, truncated };
}

function firstHeadingText(doc: DocContent): string | null {
  const heading = doc.content?.find((n) => n.type === "heading");
  const text = heading?.content?.map((n) => n.text ?? "").join("").trim();
  return text ? text.slice(0, 200) : null;
}

/**
 * 가져오기 작업: 파일 → 중간 형식(HTML) → Tiptap JSON → 새 문서 (또는 스냅샷 후 기존 문서 끝에 삽입).
 * 기존 문서의 내용을 바꾸거나 지우는 경로는 없다 (SPEC 7.5).
 */
export async function runImportJob(job: JobWithInput, ctx: JobContext): Promise<JobOutcome> {
  const params = importParamsSchema.parse(job.params);
  if (!job.ownerId) throw new ConversionError("INTERNAL", [], "import job without owner");
  const ownerId = job.ownerId;
  const project = await prisma.project.findFirst({ where: { id: params.projectId, ownerId, deletedAt: null }, select: { id: true } });
  if (!project) throw new ImportTargetGoneError();

  const bytes = await getStorage().get(job.inputAsset.storageKey);
  const extracted = await extract({ bytes, job, ctx });
  const notes = new Map<NoteCode, ImportNote>(extracted.notes.map((code) => [code, { code }]));

  const previewAssetId = extracted.previewPdf
    ? (
        await createAssetFromBytes({
          ownerId,
          projectId: params.projectId,
          filename: extracted.previewPdf.filename,
          bytes: extracted.previewPdf.bytes,
          allowed: ["pdf"],
          keyPrefix: "previews",
        }).catch(() => null)
      )?.id ?? null
    : null;

  if (extracted.attachOnly) {
    const result: ImportResult = {
      mode: "attachOnly",
      projectId: params.projectId,
      documentId: null,
      notes: [...notes.values()],
      stats: { paragraphs: 0, headings: 0, tables: 0, images: 0 },
      previewAssetId,
    };
    return { result };
  }

  const imageUrls = await uploadImages(extracted.html, extracted, { ownerId, projectId: params.projectId });
  const converted = htmlToDoc(extracted.html, { imageUrl: (src) => imageUrls.get(src) ?? null });
  if (converted.droppedImages > 0) notes.set("IMAGES_DROPPED", { code: "IMAGES_DROPPED", n: converted.droppedImages });
  const stem = path.parse(job.inputAsset.filename).name.slice(0, 200) || messages.importer.defaultTitle;
  const title = params.title?.trim() || extracted.title?.trim().slice(0, 200) || firstHeadingText(converted.doc) || stem;

  let documentId: string;
  if (params.documentId) {
    documentId = await insertIntoDocument(ownerId, params.projectId, params.documentId, converted.doc, notes);
  } else {
    const { doc, truncated } = fitToLimit(converted.doc);
    if (truncated) notes.set("TRUNCATED", { code: "TRUNCATED" });
    const created = await prisma.document.create({
      data: { projectId: params.projectId, title, contentJson: doc as Prisma.InputJsonValue },
    });
    documentId = created.id;
  }

  const result: ImportResult = {
    mode: params.documentId ? "insert" : "new",
    projectId: params.projectId,
    documentId,
    notes: [...notes.values()],
    stats: converted.stats,
    previewAssetId,
    ...(extracted.engine ? { engine: extracted.engine, attempts: extracted.attempts ?? [] } : {}),
  };
  return { result };
}

/**
 * 스냅샷을 먼저 남기고 문서 끝에 붙인다. 버전 비교로 저장하므로 그사이 편집기가 저장한 내용을
 * 덮어쓰지 않는다(그 경우 다시 읽어 한 번 더 시도).
 */
async function insertIntoDocument(ownerId: string, projectId: string, documentId: string, imported: DocContent, notes: Map<NoteCode, ImportNote>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await prisma.document.findFirst({
      where: { id: documentId, projectId, deletedAt: null, project: { ownerId, deletedAt: null } },
    });
    if (!current) throw new ImportTargetGoneError();
    const existing = ((current.contentJson as DocContent | null)?.content ?? []) as DocNode[];
    const { doc, truncated } = fitToLimit(imported, existing);
    if (truncated) notes.set("TRUNCATED", { code: "TRUNCATED" });
    const saved = await prisma.$transaction(async (tx) => {
      await snapshotOf(tx, current, "IMPORT");
      const updated = await tx.document.updateMany({
        where: { id: documentId, version: current.version },
        data: { contentJson: { type: "doc", content: [...existing, ...(doc.content ?? [])] } as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new VersionRace();
      return true;
    }).catch((err) => {
      if (err instanceof VersionRace) return false;
      throw err;
    });
    if (saved) return documentId;
  }
  throw new ConversionError("INTERNAL", [], "document kept changing during import");
}

class VersionRace extends Error {}
