import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as fileGET } from "@/app/api/convert/[jobId]/file/route";
import { GET as statusGET } from "@/app/api/convert/[jobId]/route";
import { POST as convertPOST } from "@/app/api/convert/route";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/server/rate-limit";
import { createUser, resetDb } from "../setup/db";
import { HAS_POPPLER, HAS_SOFFICE, scopedEnv } from "../setup/engines";
import { ctx, loginAs } from "../setup/session";
import { fixture, formRequest, tempStorage } from "../setup/storage";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
tempStorage();
const setEnv = scopedEnv();
const outDir = mkdtempSync(path.join(tmpdir(), "rm-convert-api-"));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

type JobView = { id: string; status: string; error: string | null; pages: number | null; previewUrl: string | null; downloadUrl: string | null };

const upload = (name: string, bytes: Uint8Array, headers?: Record<string, string>) =>
  convertPOST(formRequest("/api/convert", { file: { name, bytes } }, headers), ctx({}));
const status = (jobId: string) => statusGET(new Request(`http://localhost/api/convert/${jobId}`), ctx({ jobId }));
const file = (jobId: string, download = false) =>
  fileGET(new Request(`http://localhost/api/convert/${jobId}/file${download ? "?download=1" : ""}`), ctx({ jobId }));

async function waitDone(jobId: string, timeoutMs = 90_000): Promise<JobView> {
  const started = Date.now();
  for (;;) {
    const res = await status(jobId);
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: JobView };
    if (job.status === "DONE" || job.status === "FAILED") return job;
    if (Date.now() - started > timeoutMs) throw new Error(`still ${job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe("HWP → PDF 변환 API (P3-3)", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    loginAs(null);
    setEnv({ CONVERSION_QUEUE: "inline" });
  });

  it.skipIf(!HAS_POPPLER || !HAS_SOFFICE)(
    "완료 기준: 샘플 HWP/HWPX가 로그인 없이 PDF로 변환되어 다운로드된다",
    async () => {
      for (const name of ["sample.hwpx", "sample.hwp"]) {
        const res = await upload(name, fixture(`hwp/${name}`));
        expect(res.status, name).toBe(202);
        const { job } = (await res.json()) as { job: JobView };
        expect(job.id).toMatch(/^[0-9a-f]{32}$/);
        expect(["QUEUED", "RUNNING"]).toContain(job.status);

        const done = await waitDone(job.id);
        expect(done.status, `${name}: ${done.error}`).toBe("DONE");
        expect(done.pages).toBeGreaterThanOrEqual(1);
        expect(done.downloadUrl).toBe(`/api/convert/${job.id}/file?download=1`);

        const download = await file(job.id, true);
        expect(download.status).toBe(200);
        expect(download.headers.get("content-type")).toBe("application/pdf");
        expect(download.headers.get("content-disposition")).toMatch(/^attachment;.*sample\.pdf/);
        const pdf = Buffer.from(await download.arrayBuffer());
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        const saved = path.join(outDir, `${name}.pdf`);
        writeFileSync(saved, pdf);
        expect(execFileSync("pdftotext", [saved, "-"]).toString()).toContain("음향 블랙홀");

        const preview = await file(job.id);
        expect(preview.headers.get("content-disposition")).toMatch(/^inline;/);
      }
    },
    180_000,
  );

  it("HWP/HWPX가 아닌 파일, 확장자를 바꾼 파일은 415", async () => {
    const docx = await upload("sample.docx", fixture("import/sample.docx"));
    expect(docx.status).toBe(415);
    expect((await docx.json()).error.code).toBe("UNSUPPORTED_FILE");
    const disguised = await upload("fake.hwp", fixture("import/sample.pdf"));
    expect(disguised.status).toBe(415);
    expect(await prisma.conversionJob.count()).toBe(0);
  });

  it("파일이 없으면 400", async () => {
    const res = await convertPOST(formRequest("/api/convert", { other: "x" }), ctx({}));
    expect(res.status).toBe(400);
  });

  it("용량 제한: MAX_UPLOAD_MB를 넘으면 413 (Content-Length로 본문을 읽기 전에 거른다)", async () => {
    setEnv({ MAX_UPLOAD_MB: "1" });
    const big = new Uint8Array(1024 * 1024 + 10);
    big.set(fixture("hwp/sample.hwp").subarray(0, 8));
    const res = await upload("big.hwp", big);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
    const declared = await convertPOST(
      new Request("http://localhost/api/convert", { method: "POST", headers: { "content-length": String(5 * 1024 * 1024) }, body: "x" }),
      ctx({}),
    );
    expect(declared.status).toBe(413);
  });

  it("rate limit: IP당 한도를 넘으면 429", async () => {
    setEnv({ RATE_LIMIT_CONVERT_PER_HOUR: "2", CONVERSION_ENGINES_HWPX: "none" });
    const bytes = fixture("hwp/sample.hwpx");
    const ip = { "x-forwarded-for": "203.0.113.7" };
    expect((await upload("a.hwpx", bytes, ip)).status).toBe(202);
    expect((await upload("b.hwpx", bytes, ip)).status).toBe(202);
    const limited = await upload("c.hwpx", bytes, ip);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    // 다른 IP는 영향받지 않는다
    expect((await upload("d.hwpx", bytes, { "x-forwarded-for": "198.51.100.1" })).status).toBe(202);
  });

  it("익명 작업은 작업 ID를 아는 사람만 조회한다. 로그인 사용자의 작업은 본인만", async () => {
    setEnv({ CONVERSION_ENGINES_HWPX: "none" });
    const anonymous = (await (await upload("a.hwpx", fixture("hwp/sample.hwpx"))).json()).job as JobView;
    const owner = await createUser("소유자");
    const other = await createUser("다른 사용자");
    loginAs(owner);
    const owned = (await (await upload("b.hwpx", fixture("hwp/sample.hwpx"))).json()).job as JobView;
    expect((await prisma.conversionJob.findUniqueOrThrow({ where: { id: owned.id } })).ownerId).toBe(owner.id);
    expect((await status(owned.id)).status).toBe(200);

    loginAs(other);
    expect((await status(owned.id)).status).toBe(404);
    expect((await file(owned.id)).status).toBe(404);
    expect((await status(anonymous.id)).status).toBe(200);
    loginAs(null);
    expect((await status(owned.id)).status).toBe(404);
    expect((await status(anonymous.id)).status).toBe(200);
    expect((await status("0".repeat(32))).status).toBe(404);
    expect((await status("abc")).status).toBe(404);
  });

  it("실패한 작업은 사유를 보여 주고 결과 파일은 없다", async () => {
    const res = await upload("corrupt.hwp", fixture("hwp/corrupt.hwp"));
    const { job } = (await res.json()) as { job: JobView };
    const failed = await waitDone(job.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("손상");
    expect(failed.downloadUrl).toBeNull();
    expect((await file(job.id)).status).toBe(404);
  });
});
