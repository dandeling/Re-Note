import { getSchema } from "@tiptap/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as importGET } from "@/app/api/import/[jobId]/route";
import { POST as importPOST } from "@/app/api/import/route";
import { prisma } from "@/lib/db";
import { docToText, type DocContent, type DocNode } from "@/lib/editor/content";
import { documentExtensions } from "@/lib/editor/extensions";
import { htmlToDoc } from "@/lib/importer/html-to-doc";
import { markdownToHtml } from "@/lib/importer/markdown";
import { getStorage } from "@/lib/storage";
import { createAssetFromBytes } from "@/server/assets";
import { createJob } from "@/server/jobs/jobs";
import { processJob } from "@/server/jobs/process";
import { resetRateLimits } from "@/server/rate-limit";
import { createUser, resetDb } from "../setup/db";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractHwpStructure } from "@/lib/importer/hwp";
import { HAS_HWP5HTML, HAS_POPPLER, HAS_SOFFICE, HAS_UNHWP, scopedEnv, THIRD_PARTY_DIR, THIRD_PARTY_SAMPLES } from "../setup/engines";
import { ctx, loginAs } from "../setup/session";
import { fixture, formRequest, tempStorage } from "../setup/storage";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
tempStorage();
const setEnv = scopedEnv();

const schema = getSchema(documentExtensions());
/** 실제 에디터 스키마로 검증한다 (노드·마크·내용 규칙) */
function expectValidDoc(doc: unknown) {
  expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
}
const types = (doc: DocContent) => (doc.content ?? []).map((n) => n.type);
function find(node: DocNode, type: string): DocNode[] {
  return [...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap((c) => find(c, type))];
}

type ImportView = {
  id: string;
  status: string;
  error: string | null;
  mode: string | null;
  documentId: string | null;
  projectId: string | null;
  stats: { paragraphs: number; headings: number; tables: number; images: number } | null;
  notes: { code: string; text: string }[];
  original: { url: string; mime: string };
  previewUrl: string | null;
};

async function postImport(fields: Record<string, string | { name: string; bytes: Uint8Array }>) {
  return importPOST(formRequest("/api/import", fields), ctx({}));
}
const getImport = (jobId: string) => importGET(new Request(`http://localhost/api/import/${jobId}`), ctx({ jobId }));

async function waitImport(jobId: string, timeoutMs = 90_000): Promise<ImportView> {
  const started = Date.now();
  for (;;) {
    const res = await getImport(jobId);
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: ImportView };
    if (job.status === "DONE" || job.status === "FAILED") return job;
    if (Date.now() - started > timeoutMs) throw new Error(`still ${job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe("HTML → 문서 JSON 매핑", () => {
  it("기본 노드만 만들고 에디터 스키마에 맞는다", () => {
    const { doc, stats } = htmlToDoc(
      `<h1>제목</h1><h6>깊은 제목</h6><p>글 <b>굵게 <i>둘 다</i></b> <code>x</code><br>줄</p>
       <ul><li>하나<ul><li>안쪽</li></ul></li><li><p>둘</p></li></ul><ol start="3"><li>셋</li></ol>
       <table><tr><th>머리</th><th colspan="2">합침</th></tr><tr><td>1</td><td><p>2</p><p>3</p></td><td></td></tr></table>
       <blockquote><p>인용</p></blockquote><pre><code class="language-js">a &lt; b\n</code></pre>
       <div>흩어진 <span>글</span></div><hr><p><img src="ok.png" alt="그림"> 그림 옆 글</p>`,
      { imageUrl: (src) => (src === "ok.png" ? "/api/assets/abc" : null) },
    );
    expectValidDoc(doc);
    expect(types(doc)).toEqual([
      "heading", "heading", "paragraph", "bulletList", "orderedList", "table", "blockquote", "codeBlock", "paragraph", "paragraph", "image",
    ]);
    expect(doc.content![1].attrs).toEqual({ level: 4 });
    expect(doc.content![4].attrs).toMatchObject({ start: 3 });
    expect(find(doc, "tableHeader")[1].attrs).toMatchObject({ colspan: 2 });
    expect(doc.content![7]).toMatchObject({ attrs: { language: "js" }, content: [{ text: "a < b" }] });
    expect(doc.content!.at(-1)).toMatchObject({ type: "image", attrs: { src: "/api/assets/abc", alt: "그림" } });
    expect(stats).toEqual({ paragraphs: 13, headings: 2, tables: 1, images: 1 });
  });

  it("스크립트·이벤트 속성·위험한 링크·외부 그림을 남기지 않는다", () => {
    const { doc, droppedImages } = htmlToDoc(
      `<p>안전</p><script>alert(1)</script><style>p{}</style><img src="https://evil.example/x.png" onerror="alert(1)">
       <p><a href="javascript:alert(1)">나쁜 링크</a> <a href="https://example.com">좋은 링크</a></p><iframe src="https://x"></iframe>`,
    );
    expectValidDoc(doc);
    const json = JSON.stringify(doc);
    expect(json).not.toMatch(/alert|onerror|javascript:|evil|iframe/);
    expect(droppedImages).toBe(1);
    const links = find(doc, "text").filter((n) => n.marks?.some((m) => m.type === "link"));
    expect(links).toHaveLength(1);
    expect(links[0].marks![0].attrs!.href).toBe("https://example.com");
  });

  it("Markdown → HTML: 원본에 HTML이 있었는지 알려 준다", () => {
    expect(markdownToHtml("# 제목\n\n본문").hadHtml).toBe(false);
    expect(markdownToHtml("본문\n\n<script>x</script>").hadHtml).toBe(true);
  });
});

describe("가져오기 API (P3-4: Markdown, DOCX)", () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    setEnv({ CONVERSION_QUEUE: "inline", SOFFICE_BIN: "/nonexistent/soffice" });
    owner = await createUser("소유자");
    loginAs(owner);
    projectId = (await prisma.project.create({ data: { ownerId: owner.id, title: "프로젝트" } })).id;
  });

  async function importFile(path: string, extra: Record<string, string> = {}) {
    const name = path.split("/").pop()!;
    const res = await postImport({ file: { name, bytes: fixture(path) }, projectId, ...extra });
    expect(res.status, await res.clone().text()).toBe(202);
    return waitImport(((await res.json()) as { job: ImportView }).job.id);
  }

  it("Markdown → 새 문서: 제목·목록·표·인용·코드가 편집 가능한 노드가 되고 HTML은 제거된다", async () => {
    const job = await importFile("import/sample.md");
    expect(job.status, job.error ?? "").toBe("DONE");
    expect(job.mode).toBe("new");
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: job.documentId! } });
    expect(doc.projectId).toBe(projectId);
    expect(doc.title).toBe("Markdown 가져오기 샘플");
    const content = doc.contentJson as DocContent;
    expectValidDoc(content);
    expect(types(content)).toEqual(expect.arrayContaining(["heading", "paragraph", "bulletList", "orderedList", "table", "blockquote", "codeBlock"]));
    expect(JSON.stringify(content)).not.toMatch(/alert|onerror|javascript:/);
    expect(docToText(content)).toContain("굵은 글씨");
    expect(job.stats).toMatchObject({ headings: 2, tables: 1 });
    expect(job.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["MD_HTML", "CHECK_ORIGINAL"]));
    expect(job.notes[0].text.length).toBeGreaterThan(5);
    // 원본 미리보기는 원본 파일 그대로 (텍스트)
    expect(job.original.mime).toBe("text/markdown");
  });

  it("DOCX → 새 문서: 그림은 프로젝트 자산으로 올라가고 문서는 자산 주소를 가리킨다", async () => {
    const job = await importFile("import/sample.docx");
    expect(job.status, job.error ?? "").toBe("DONE");
    const content = (await prisma.document.findUniqueOrThrow({ where: { id: job.documentId! } })).contentJson as DocContent;
    expectValidDoc(content);
    expect(types(content)).toEqual(["heading", "paragraph", "heading", "bulletList", "table", "image", "paragraph"]);
    const src = String(content.content![5].attrs!.src);
    expect(src).toMatch(/^\/api\/assets\/\w+$/);
    const image = await prisma.asset.findUniqueOrThrow({ where: { id: src.split("/").pop()! } });
    expect(image).toMatchObject({ ownerId: owner.id, projectId, kind: "IMAGE" });
    expect((await getStorage().get(image.storageKey)).subarray(1, 4).toString()).toBe("PNG");
    expect(job.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["LAYOUT", "DOCX_STYLES"]));
    expect(job.stats).toMatchObject({ headings: 2, tables: 1, images: 1 });
  });

  it("기존 문서를 절대 덮어쓰지 않는다: 가져오기는 새 문서를 만들고 기존 문서는 그대로", async () => {
    const existing = await prisma.document.create({
      data: { projectId, title: "기존 문서", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "소중한 내용" }] }] } },
    });
    const job = await importFile("import/sample.md", { title: "기존 문서" });
    expect(job.status).toBe("DONE");
    expect(job.documentId).not.toBe(existing.id);
    const after = await prisma.document.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.contentJson).toEqual(existing.contentJson);
    expect(after.version).toBe(existing.version);
    expect(after.updatedAt).toEqual(existing.updatedAt);
    expect(await prisma.document.count({ where: { projectId } })).toBe(2);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: job.documentId! } })).title).toBe("기존 문서");
  });

  it("기존 문서에 넣을 때는 스냅샷을 먼저 남기고 끝에 붙인다 (기존 내용은 앞에 그대로)", async () => {
    const original = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "소중한 내용" }] }] };
    const existing = await prisma.document.create({ data: { projectId, title: "기존 문서", contentJson: original } });
    const job = await importFile("import/sample.md", { documentId: existing.id });
    expect(job.status, job.error ?? "").toBe("DONE");
    expect(job.mode).toBe("insert");
    expect(job.documentId).toBe(existing.id);

    const snapshots = await prisma.documentSnapshot.findMany({ where: { documentId: existing.id } });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ reason: "IMPORT", version: existing.version, contentJson: original });

    const after = await prisma.document.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.version).toBe(existing.version + 1);
    const content = after.contentJson as DocContent;
    expect(content.content![0]).toEqual(original.content[0]);
    expect(content.content!.length).toBeGreaterThan(5);
    expectValidDoc(content);
    expect(await prisma.document.count({ where: { projectId } })).toBe(1);
  });

  it("넣을 문서가 그사이 휴지통으로 가면 FAILED(TARGET_GONE)이고 아무것도 바뀌지 않는다", async () => {
    const existing = await prisma.document.create({ data: { projectId, title: "기존", contentJson: { type: "doc", content: [{ type: "paragraph" }] } } });
    const asset = await createAssetFromBytes({ ownerId: owner.id, projectId, filename: "a.md", bytes: fixture("import/sample.md") });
    const job = await createJob({ ownerId: owner.id, inputAssetId: asset.id, type: "IMPORT_MD", params: { projectId, documentId: existing.id }, enqueue: false });
    await prisma.document.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    await processJob(job.id);
    const failed = await prisma.conversionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.result).toMatchObject({ code: "TARGET_GONE" });
    expect(failed.error).toContain("찾을 수 없습니다");
    expect(await prisma.documentSnapshot.count()).toBe(0);
  });

  it("손상된 DOCX는 FAILED(CORRUPT), 지원하지 않는 형식은 415", async () => {
    const job = await importFile("import/corrupt.docx").catch(() => null);
    // corrupt.docx는 ZIP 매직바이트는 맞아 업로드는 통과하고, 작업에서 걸러진다
    expect(job?.status).toBe("FAILED");
    expect(job?.error).toContain("손상");
    const csv = await postImport({ file: { name: "a.csv", bytes: new TextEncoder().encode("a,b\n1,2") }, projectId });
    expect(csv.status).toBe(415);
    const png = await postImport({ file: { name: "a.png", bytes: fixture("import/pixel.png") }, projectId });
    expect(png.status).toBe(415);
  });

  it("권한: 비로그인 401, 남의 프로젝트·문서로는 가져올 수 없고(404) 남의 가져오기 작업은 볼 수 없다(404)", async () => {
    const mine = await importFile("import/sample.md");
    const other = await createUser("다른 사용자");
    const otherDoc = await prisma.document.create({
      data: { project: { create: { ownerId: other.id, title: "남의 프로젝트" } }, title: "남의 문서", contentJson: { type: "doc", content: [] } },
    });

    loginAs(null);
    expect((await postImport({ file: { name: "a.md", bytes: fixture("import/sample.md") }, projectId })).status).toBe(401);
    expect((await getImport(mine.id)).status).toBe(401);

    loginAs(other);
    expect((await postImport({ file: { name: "a.md", bytes: fixture("import/sample.md") }, projectId })).status).toBe(404);
    expect((await getImport(mine.id)).status).toBe(404);

    loginAs(owner);
    const intoOthers = await postImport({ file: { name: "a.md", bytes: fixture("import/sample.md") }, projectId, documentId: otherDoc.id });
    expect(intoOthers.status).toBe(404);
    const otherDocAfter = await prisma.document.findUniqueOrThrow({ where: { id: otherDoc.id } });
    expect(otherDocAfter.contentJson).toEqual({ type: "doc", content: [] });
  });
});

describe("가져오기 API (P3-5: PDF, HWP/HWPX)", () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    setEnv({ CONVERSION_QUEUE: "inline", SOFFICE_BIN: "/nonexistent/soffice" });
    owner = await createUser("소유자");
    loginAs(owner);
    projectId = (await prisma.project.create({ data: { ownerId: owner.id, title: "프로젝트" } })).id;
  });

  async function importBytes(name: string, bytes: Uint8Array) {
    const res = await postImport({ file: { name, bytes }, projectId });
    expect(res.status, await res.clone().text()).toBe(202);
    return waitImport(((await res.json()) as { job: ImportView }).job.id);
  }
  const importFile = (file: string) => importBytes(file.split("/").pop()!, fixture(file));
  const contentOf = async (job: ImportView) =>
    (await prisma.document.findUniqueOrThrow({ where: { id: job.documentId! } })).contentJson as DocContent;

  it.skipIf(!HAS_POPPLER)("PDF → 편집 가능한 문서: 텍스트·제목 구조·표·그림을 추출한다", async () => {
    const job = await importFile("import/sample.pdf");
    expect(job.status, job.error ?? "").toBe("DONE");
    expect(job.mode).toBe("new");
    const content = await contentOf(job);
    expectValidDoc(content);
    expect(types(content)).toEqual(["heading", "paragraph", "heading", "paragraph", "table", "paragraph", "image", "heading", "paragraph"]);
    expect(content.content!.filter((n) => n.type === "heading").map((n) => [n.attrs!.level, docToText(n)])).toEqual([
      [1, "PDF 가져오기 샘플"],
      [2, "측정 결과"],
      [2, "결론"],
    ]);
    const table = content.content!.find((n) => n.type === "table")!;
    expect(table.content!.map((row) => row.content!.map((cell) => docToText(cell)))).toEqual([
      ["시료", "길이", "무게"],
      ["A", "10 mm", "2.5 g"],
      ["B", "12 mm", "3.1 g"],
    ]);
    // 여러 줄 문단은 한 문단으로 합쳐진다
    expect(docToText(content.content![1])).toMatch(/^이 문서는 .*합쳐져야 합니다\.$/);
    const src = String(content.content!.find((n) => n.type === "image")!.attrs!.src);
    const image = await prisma.asset.findUniqueOrThrow({ where: { id: src.split("/").pop()! } });
    expect(image).toMatchObject({ projectId, kind: "IMAGE" });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: job.documentId! } })).title).toBe("PDF 가져오기 샘플");
    expect(job.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["PDF_STRUCTURE", "PDF_TABLES", "CHECK_ORIGINAL"]));
    expect(job.original.mime).toBe("application/pdf");
  });

  it.skipIf(!HAS_POPPLER)("스캔 PDF: 문서를 만들지 않고 '텍스트 추출 불가' 안내 후 원본을 첨부 자산으로만 추가한다", async () => {
    const job = await importFile("import/scanned.pdf");
    expect(job.status, job.error ?? "").toBe("DONE");
    expect(job.mode).toBe("attachOnly");
    expect(job.documentId).toBeNull();
    expect(await prisma.document.count()).toBe(0);
    expect(job.notes.map((n) => n.code)).toEqual(["PDF_SCANNED"]);
    expect(job.notes[0].text).toContain("텍스트 추출 불가");
    const assetId = job.original.url.split("/").pop()!;
    expect(await prisma.asset.findUniqueOrThrow({ where: { id: assetId } })).toMatchObject({ projectId, ownerId: owner.id, kind: "PDF", deletedAt: null });
  });

  it("손상 PDF: 매직바이트가 다르면 415, 매직바이트만 맞으면 FAILED(CORRUPT)", async () => {
    expect((await postImport({ file: { name: "fake.pdf", bytes: fixture("import/fake.pdf") }, projectId })).status).toBe(415);
    const truncated = fixture("import/sample.pdf").subarray(0, 2000);
    const job = await importBytes("truncated.pdf", truncated);
    expect(job.status).toBe("FAILED");
    expect(job.error).toContain("손상");
  });

  it.skipIf(!HAS_UNHWP && !HAS_HWP5HTML)("HWP·HWPX → 편집 가능한 문서: 중간 형식을 거쳐 문단과 표가 된다", async () => {
    for (const file of ["hwp/sample.hwpx", "hwp/sample.hwp"]) {
      const job = await importFile(file);
      expect(job.status, `${file}: ${job.error}`).toBe("DONE");
      const content = await contentOf(job);
      expectValidDoc(content);
      expect(docToText(content), file).toContain("음향 블랙홀");
      const table = content.content!.find((n) => n.type === "table");
      expect(table, file).toBeTruthy();
      expect(docToText(table!)).toContain("감쇠율");
      expect(job.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["LAYOUT", "HWP_STRUCTURE", "CHECK_ORIGINAL"]));
      const result = (await prisma.conversionJob.findUniqueOrThrow({ where: { id: job.id } })).result as { engine: string };
      expect(["unhwp", "hwp5html"]).toContain(result.engine);
    }
  }, 120_000);

  it.skipIf(!HAS_UNHWP || !HAS_SOFFICE || !HAS_POPPLER)("HWPX 가져오기 결과에 원본 미리보기 PDF가 붙는다", async () => {
    setEnv({ SOFFICE_BIN: undefined });
    const job = await importFile("hwp/sample.hwpx");
    expect(job.status, job.error ?? "").toBe("DONE");
    expect(job.previewUrl).toMatch(/^\/api\/assets\/\w+$/);
    const preview = await prisma.asset.findUniqueOrThrow({ where: { id: job.previewUrl!.split("/").pop()! } });
    expect(preview).toMatchObject({ kind: "PDF", projectId });
    expect((await getStorage().get(preview.storageKey)).subarray(0, 5).toString()).toBe("%PDF-");
  }, 120_000);

  it("손상 HWP·HWPX는 FAILED(CORRUPT), 엔진이 하나도 없으면 FAILED(NO_ENGINE)", async () => {
    for (const file of ["hwp/corrupt.hwp", "hwp/truncated.hwpx"]) {
      const job = await importFile(file);
      expect(job.status, file).toBe("FAILED");
      expect(job.error, file).toContain("손상");
    }
    setEnv({ UNHWP_PYTHON: "/nonexistent/python3", HWP5HTML_BIN: "/nonexistent/hwp5html" });
    const job = await importFile("hwp/sample.hwp");
    expect(job.status).toBe("FAILED");
    const result = (await prisma.conversionJob.findUniqueOrThrow({ where: { id: job.id } })).result;
    expect(result).toMatchObject({ code: "NO_ENGINE", attempts: [{ engine: "unhwp", outcome: "unavailable" }, { engine: "hwp5html", outcome: "unavailable" }] });
  });

  it.skipIf(!HAS_HWP5HTML || THIRD_PARTY_SAMPLES.length === 0)("unhwp가 없으면 hwp5html로 폴백한다 (제3자 샘플)", async () => {
    setEnv({ UNHWP_PYTHON: "/nonexistent/python3" });
    const dir = mkdtempSync(path.join(tmpdir(), "rm-hwp-"));
    const result = await extractHwpStructure({ input: path.join(THIRD_PARTY_DIR, "sample-5017.hwp"), kind: "hwp", workDir: dir, deadline: Date.now() + 60_000 });
    expect(result.engine).toBe("hwp5html");
    expect(result.attempts.map((a) => a.outcome)).toEqual(["unavailable", "ok"]);
    const { doc } = htmlToDoc(result.html, { imageUrl: (src) => (result.images.has(src) ? "/api/assets/x" : null) });
    expectValidDoc(doc);
    expect(docToText(doc)).toContain("본문 내용입니다");
    expect(find(doc, "table").length).toBeGreaterThan(0);
    expect(find(doc, "image").length).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf((!HAS_UNHWP && !HAS_HWP5HTML) || THIRD_PARTY_SAMPLES.length === 0)("제3자 HWP 샘플(표·그림·각주·다단)이 모두 편집 가능한 문서로 매핑된다", async () => {
    for (const name of THIRD_PARTY_SAMPLES) {
      const dir = mkdtempSync(path.join(tmpdir(), "rm-hwp-"));
      const result = await extractHwpStructure({ input: path.join(THIRD_PARTY_DIR, `${name}.hwp`), kind: "hwp", workDir: dir, deadline: Date.now() + 60_000 });
      const { doc } = htmlToDoc(result.html, { imageUrl: (src) => (result.images.has(src) ? "/api/assets/x" : null) });
      expectValidDoc(doc);
      // matrix.hwp는 글자·그림 없이 도형만 있는 문서다
      if (name !== "matrix") expect(docToText(doc).trim().length + find(doc, "image").length, name).toBeGreaterThan(0);
    }
  }, 120_000);
});
