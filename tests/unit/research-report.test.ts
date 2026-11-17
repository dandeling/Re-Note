import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as assetGET } from "@/app/api/assets/[id]/route";
import { POST as EXPORT } from "@/app/api/docs/[id]/export/route";
import { GET as REPORT } from "@/app/api/research/[id]/report/route";
import { POST as PUBLISH } from "@/app/api/research/route";
import { prisma } from "@/lib/db";
import { createAssetFromBytes } from "@/server/assets";
import { resetRateLimits } from "@/server/rate-limit";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";
import { fixture, tempStorage } from "../setup/storage";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
tempStorage();

/**
 * 연구 공개의 결과보고서 (SPEC 7.2 공개 흐름: "결과보고서(문서를 PDF로 내보내거나 파일 업로드) 선택").
 * (a) 업로드한 PDF 자산, (b) 문서를 서버에서 PDF로 내보내 만든 자산을 `reportAssetId`로 연결하고,
 * 공개 연구의 보고서만 `GET /api/research/:id/report`로 비로그인 다운로드할 수 있음을 확인한다.
 */
type User = Awaited<ReturnType<typeof createUser>>;

const base = {
  title: "반자성 흑연 부상 높이",
  summary: "네오디뮴 자석 위에서 흑연 판의 부상 높이를 측정했다.",
  keywords: ["자기부상"],
  limitations: "레일이 짧았다.",
};

const docContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "결과보고서 본문" }] },
    { type: "paragraph", content: [{ type: "text", text: "흑연 판이 2 mm 떠올랐다." }] },
  ],
};

async function publish(body: Record<string, unknown>) {
  const res = await PUBLISH(jsonRequest("POST", "/api/research", body), {});
  return { res, data: await res.json() };
}

async function exportAsAsset(docId: string, body: Record<string, unknown> = { format: "pdf", saveAsAsset: true }) {
  const res = await EXPORT(jsonRequest("POST", `/api/docs/${docId}/export`, body), ctx({ id: docId }));
  return { res, data: res.headers.get("content-type")?.startsWith("application/json") ? await res.json() : null };
}

function report(researchId: string, query = "") {
  return REPORT(jsonRequest("GET", `/api/research/${researchId}/report${query}`), ctx({ id: researchId }));
}

describe("결과보고서 연결 (P6-1 결과보고서 선택)", () => {
  let owner: User;
  let other: User;
  let projectId: string;
  let docId: string;
  const pdf = fixture("import/sample.pdf");
  const savedExportLimit = process.env.RATE_LIMIT_EXPORT_PER_MINUTE;

  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    owner = await createUser("소유자");
    other = await createUser("다른 사람");
    projectId = (await prisma.project.create({ data: { ownerId: owner.id, title: "내 프로젝트" } })).id;
    docId = (await prisma.document.create({ data: { projectId, title: "결과보고서", contentJson: docContent } })).id;
    loginAs(owner);
  });
  afterEach(() => {
    if (savedExportLimit === undefined) delete process.env.RATE_LIMIT_EXPORT_PER_MINUTE;
    else process.env.RATE_LIMIT_EXPORT_PER_MINUTE = savedExportLimit;
  });

  it("(a) 업로드한 내 PDF를 연결하면 비로그인도 보고서를 인라인으로 보고 내려받는다", async () => {
    const asset = await createAssetFromBytes({ ownerId: owner.id, projectId, filename: "보고서.pdf", bytes: pdf });
    const { res, data } = await publish({ ...base, projectId, reportAssetId: asset.id });
    expect(res.status).toBe(201);
    expect(data.research.report).toMatchObject({ assetId: asset.id, filename: "보고서.pdf" });

    loginAs(null);
    const inline = await report(data.research.id);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toBe("application/pdf");
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await inline.arrayBuffer()).equals(Buffer.from(pdf))).toBe(true);

    const download = await report(data.research.id, "?download=1");
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    // 자산 경로(소유자 전용)로는 여전히 못 받는다.
    expect((await assetGET(jsonRequest("GET", `/api/assets/${asset.id}`), ctx({ id: asset.id }))).status).toBe(401);
  });

  it("(b) 내 문서를 PDF 자산으로 내보내 연결할 수 있다", async () => {
    const { res, data } = await exportAsAsset(docId);
    expect(res.status).toBe(201);
    expect(data.asset).toMatchObject({ kind: "PDF", mime: "application/pdf", filename: "결과보고서.pdf", projectId });
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: data.asset.id } });
    expect(row).toMatchObject({ ownerId: owner.id, projectId, kind: "PDF" });

    const published = await publish({ ...base, projectId, reportAssetId: data.asset.id });
    expect(published.res.status).toBe(201);

    loginAs(null);
    const file = await report(published.data.research.id);
    expect(file.status).toBe(200);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const file2 = path.join(mkdtempSync(path.join(tmpdir(), "report-")), "r.pdf");
    writeFileSync(file2, bytes);
    expect(execFileSync("pdftotext", [file2, "-"], { encoding: "utf8" })).toContain("흑연 판이 2 mm 떠올랐다.");
  });

  it("남의 문서는 PDF 자산으로 내보낼 수 없다 (404, 자산이 생기지 않음)", async () => {
    loginAs(other);
    const { res, data } = await exportAsAsset(docId);
    expect(res.status).toBe(404);
    expect(data.error.code).toBe("NOT_FOUND");
    expect(await prisma.asset.count()).toBe(0);
  });

  it("비로그인은 내보낼 수 없고(401), PDF가 아닌 형식은 자산으로 저장할 수 없다(400)", async () => {
    loginAs(null);
    expect((await exportAsAsset(docId)).res.status).toBe(401);
    loginAs(owner);
    for (const format of ["docx", "md"]) {
      const { res } = await exportAsAsset(docId, { format, saveAsAsset: true });
      expect(res.status, format).toBe(400);
    }
    expect(await prisma.asset.count()).toBe(0);
  });

  it("남의 자산, 남의 문서에서 만든 자산은 연결할 수 없다 (400, 연구가 생기지 않음)", async () => {
    const theirs = await createAssetFromBytes({ ownerId: other.id, filename: "남의 보고서.pdf", bytes: pdf });
    const theirProject = await prisma.project.create({ data: { ownerId: other.id, title: "남의 프로젝트" } });
    const theirDoc = await prisma.document.create({ data: { projectId: theirProject.id, title: "남의 문서", contentJson: docContent } });
    loginAs(other);
    const exported = await exportAsAsset(theirDoc.id);
    expect(exported.res.status).toBe(201);

    loginAs(owner);
    for (const id of [theirs.id, exported.data.asset.id]) {
      const { res, data } = await publish({ ...base, projectId, reportAssetId: id });
      expect(res.status, id).toBe(400);
      expect(data.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await prisma.research.count()).toBe(0);
  });

  it("공개 연구에 연결되지 않은 자산은 보고서 경로로 받을 수 없다", async () => {
    const asset = await createAssetFromBytes({ ownerId: owner.id, projectId, filename: "비공개.pdf", bytes: pdf });
    const { data } = await publish({ ...base, projectId });
    loginAs(null);
    // 보고서 없는 연구, 자산 ID를 연구 ID 자리에 넣은 요청, 없는 연구 모두 404
    for (const id of [data.research.id, asset.id, "nope"]) {
      const res = await report(id);
      expect(res.status, id).toBe(404);
    }
  });

  it("연결된 보고서 자산이 삭제되면 더는 받을 수 없다", async () => {
    const asset = await createAssetFromBytes({ ownerId: owner.id, projectId, filename: "보고서.pdf", bytes: pdf });
    const { data } = await publish({ ...base, projectId, reportAssetId: asset.id });
    await prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
    loginAs(null);
    expect((await report(data.research.id)).status).toBe(404);
  });

  it("내보내기는 사용자당 rate limit (429)", async () => {
    process.env.RATE_LIMIT_EXPORT_PER_MINUTE = "2";
    for (let i = 0; i < 2; i++) expect((await exportAsAsset(docId, { format: "md" })).res.status).toBe(200);
    const { res, data } = await exportAsAsset(docId, { format: "md" });
    expect(res.status).toBe(429);
    expect(data.error.code).toBe("RATE_LIMITED");
    // 다른 사용자는 영향을 받지 않는다(남의 문서라 404).
    loginAs(other);
    expect((await exportAsAsset(docId, { format: "md" })).res.status).toBe(404);
  });
});
