import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as EXPORT } from "@/app/api/docs/[id]/export/route";
import { POST as IMPORT } from "@/app/api/import/route";
import { POST as CONVERT } from "@/app/api/convert/route";
import { prisma } from "@/lib/db";
import { pdfExportEnabled, serverConversionEnabled } from "@/lib/features";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ApiError } from "@/server/api";
import { createAssetFromBytes } from "@/server/assets";
import { createJob } from "@/server/jobs/jobs";
import { enqueueJob, isServerless } from "@/server/jobs/queue";
import { resetRateLimits } from "@/server/rate-limit";
import { createUser, resetDb } from "../setup/db";
import { scopedEnv } from "../setup/engines";
import { ctx, jsonRequest, loginAs } from "../setup/session";
import { fixture, formRequest, tempStorage } from "../setup/storage";

/**
 * 서버리스(Vercel) 배포용 기능 플래그 (lib/features.ts):
 * 서버 HWP 변환·가져오기와 PDF 내보내기를 끄면 작업을 만들거나 Chromium을 띄우지 않고 501을 돌려준다.
 */
vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
// PDF를 끈 상태에서는 playwright를 불러오지도 않아야 한다. 불러오면 이 모의 모듈이 실패시킨다.
vi.mock("playwright", () => {
  throw new Error("playwright must not be loaded when PDF export is disabled");
});

tempStorage();
const setEnv = scopedEnv();

type ErrorBody = { error: { code: string; message: string; reason?: string } };

describe("lib/features 기본값", () => {
  it("Vercel(VERCEL=1)에서는 꺼지고, 환경변수로 직접 켜고 끌 수 있다", () => {
    setEnv({ VERCEL: undefined, SERVER_CONVERSION: undefined, PDF_EXPORT: undefined });
    expect(serverConversionEnabled()).toBe(true);
    expect(pdfExportEnabled()).toBe(true);
    setEnv({ VERCEL: "1" });
    expect(serverConversionEnabled()).toBe(false);
    expect(pdfExportEnabled()).toBe(false);
    setEnv({ SERVER_CONVERSION: "1", PDF_EXPORT: "true" });
    expect(serverConversionEnabled()).toBe(true);
    expect(pdfExportEnabled()).toBe(true);
    setEnv({ VERCEL: undefined, SERVER_CONVERSION: "0", PDF_EXPORT: "false" });
    expect(serverConversionEnabled()).toBe(false);
    expect(pdfExportEnabled()).toBe(false);
  });
});

describe("서버 변환이 꺼졌을 때 (SERVER_CONVERSION=0)", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    loginAs(null);
    setEnv({ SERVER_CONVERSION: "0", CONVERSION_QUEUE: "inline", VERCEL: undefined });
  });

  it("POST /api/convert는 501과 한국어 안내를 돌려주고 자산·작업을 만들지 않는다", async () => {
    const res = await CONVERT(formRequest("/api/convert", { file: { name: "sample.hwp", bytes: fixture("hwp/sample.hwp") } }), ctx({}));
    expect(res.status).toBe(501);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
    expect(body.error.reason).toBe("SERVER_CONVERSION_DISABLED");
    expect(body.error.message).toContain("이 서버에서는 HWP 변환을 지원하지 않습니다");
    expect(await prisma.asset.count()).toBe(0);
    expect(await prisma.conversionJob.count()).toBe(0);
  });

  it("POST /api/import는 로그인 확인 뒤 501이고 자산·작업을 만들지 않는다 (HWP가 아닌 형식도)", async () => {
    const user = await createUser();
    const project = await prisma.project.create({ data: { ownerId: user.id, title: "p" } });
    const req = () =>
      formRequest("/api/import", { file: { name: "note.md", bytes: new TextEncoder().encode("# 제목") }, projectId: project.id });

    expect((await IMPORT(req(), ctx({}))).status).toBe(401);

    loginAs(user);
    const res = await IMPORT(req(), ctx({}));
    expect(res.status).toBe(501);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
    expect(body.error.message).toContain("HWP 변환");
    expect(await prisma.asset.count()).toBe(0);
    expect(await prisma.conversionJob.count()).toBe(0);
  });

  it("enqueueJob은 큐에 넣거나 inline으로 실행하지 않고 501을 던진다", async () => {
    await expect(enqueueJob("0123456789abcdef0123456789abcdef")).rejects.toMatchObject({ status: 501, code: "NOT_IMPLEMENTED" });
  });

  it("createJob이 큐에 못 넣으면 작업은 QUEUED로 남지 않고 FAILED가 된다", async () => {
    const asset = await createAssetFromBytes({ ownerId: null, filename: "sample.hwp", bytes: fixture("hwp/sample.hwp") });
    const err = await createJob({ ownerId: null, inputAssetId: asset.id, type: "HWP_TO_PDF" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const jobs = await prisma.conversionJob.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("FAILED");
    expect(jobs[0].error).toContain("HWP 변환을 지원하지 않습니다");
  });
});

describe("서버리스에서는 inline 모드를 절대 실행하지 않는다", () => {
  beforeEach(async () => {
    await resetDb();
    // 누군가 Vercel에서 SERVER_CONVERSION=1을 켰는데 Redis가 없어 inline이 되는 경우
    setEnv({ VERCEL: "1", SERVER_CONVERSION: "1", CONVERSION_QUEUE: "inline", REDIS_URL: undefined });
  });

  it("작업을 실행하지 않고(RUNNING이 되지 않음) 501을 던진다", async () => {
    expect(isServerless()).toBe(true);
    const asset = await createAssetFromBytes({ ownerId: null, filename: "sample.hwp", bytes: fixture("hwp/sample.hwp") });
    await expect(createJob({ ownerId: null, inputAssetId: asset.id, type: "HWP_TO_PDF" })).rejects.toMatchObject({ status: 501 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const job = await prisma.conversionJob.findFirstOrThrow();
    expect(job.status).toBe("FAILED");
  });
});

describe("PDF 내보내기가 꺼졌을 때 (PDF_EXPORT=0)", () => {
  let docId = "";
  const call = (body: unknown) => EXPORT(jsonRequest("POST", `/api/docs/${docId}/export`, body), ctx({ id: docId }));

  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    setEnv({ PDF_EXPORT: "0", VERCEL: undefined });
    const me = await createUser("나");
    loginAs(me);
    const project = await prisma.project.create({ data: { ownerId: me.id, title: "p" } });
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "본문" }] }] };
    docId = (await prisma.document.create({ data: { projectId: project.id, title: "보고서", contentJson: content as Prisma.InputJsonValue } })).id;
  });

  it("PDF 요청(saveAsAsset 포함)은 501이고 자산을 만들지 않는다", async () => {
    for (const body of [{ format: "pdf" }, { format: "pdf", saveAsAsset: true }]) {
      const res = await call(body);
      expect(res.status).toBe(501);
      const data = (await res.json()) as ErrorBody;
      expect(data.error.code).toBe("NOT_IMPLEMENTED");
      expect(data.error.reason).toBe("PDF_EXPORT_DISABLED");
      expect(data.error.message).toContain("PDF 내보내기를 지원하지 않습니다");
    }
    expect(await prisma.asset.count()).toBe(0);
  });

  it("DOCX·Markdown 내보내기는 그대로 되고 playwright를 불러오지 않는다", async () => {
    const docx = await call({ format: "docx" });
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    const md = await call({ format: "md" });
    expect(md.status).toBe(200);
    expect(await md.text()).toContain("본문");
  });
});
