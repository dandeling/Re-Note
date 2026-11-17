import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as assetGET } from "@/app/api/assets/[id]/route";
import { POST as completePOST } from "@/app/api/assets/complete/route";
import { POST as uploadUrlPOST } from "@/app/api/assets/upload-url/route";
import { GET as localGET, PUT as localPUT } from "@/app/api/storage/local/[...key]/route";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { resetRateLimits } from "@/server/rate-limit";
import { purgeExpiredTrash } from "@/server/trash";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";
import { fixture, tempStorage } from "../setup/storage";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
tempStorage();

const keyCtx = (key: string[]) => ({ params: Promise.resolve({ key }) });
type User = Awaited<ReturnType<typeof createUser>>;

describe("자산 업로드 API (P3-1)", () => {
  let owner: User;
  let other: User;
  let projectId: string;
  const savedMax = process.env.MAX_UPLOAD_MB;

  const requestUrl = (body: unknown) => uploadUrlPOST(jsonRequest("POST", "/api/assets/upload-url", body), ctx({}));
  const complete = (body: unknown) => completePOST(jsonRequest("POST", "/api/assets/complete", body), ctx({}));

  /** presigned URL(로컬 드라이버)로 실제 PUT */
  async function putTo(uploadUrl: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
    const url = new URL(uploadUrl, "http://localhost");
    const key = url.pathname.replace("/api/storage/local/", "").split("/");
    return localPUT(new Request(url, { method: "PUT", body: new Uint8Array(bytes), headers }), keyCtx(key));
  }

  async function upload(filename: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
    const ticket = await (await requestUrl({ filename, size: bytes.byteLength, ...extra })).json();
    expect((await putTo(ticket.uploadUrl, bytes, ticket.headers)).status).toBe(200);
    return { ticket, res: await complete({ key: ticket.key, filename, ...extra }) };
  }

  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    owner = await createUser("소유자");
    other = await createUser("다른 사용자");
    projectId = (await prisma.project.create({ data: { ownerId: owner.id, title: "프로젝트" } })).id;
    loginAs(owner);
  });
  afterEach(() => {
    if (savedMax === undefined) delete process.env.MAX_UPLOAD_MB;
    else process.env.MAX_UPLOAD_MB = savedMax;
  });

  it("로그인하지 않으면 401", async () => {
    loginAs(null);
    expect((await requestUrl({ filename: "a.pdf", size: 10 })).status).toBe(401);
    expect((await complete({ key: "uploads/x/y/file.pdf", filename: "a.pdf" })).status).toBe(401);
  });

  it("presigned URL로 올리고 complete하면 Asset이 만들어지고, 소유자만 내려받을 수 있다", async () => {
    const bytes = fixture("import/sample.pdf");
    const { ticket, res } = await upload("결과 보고서.pdf", bytes, { projectId });
    expect(ticket.method).toBe("PUT");
    expect(ticket.key.startsWith(`uploads/${owner.id}/`)).toBe(true);
    expect(res.status).toBe(201);
    const { asset } = await res.json();
    expect(asset).toMatchObject({ kind: "PDF", filename: "결과 보고서.pdf", size: bytes.byteLength, mime: "application/pdf", projectId });
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.ownerId).toBe(owner.id);

    const download = await assetGET(jsonRequest("GET", asset.url), ctx({ id: asset.id }));
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);

    loginAs(other);
    expect((await assetGET(jsonRequest("GET", asset.url), ctx({ id: asset.id }))).status).toBe(404);
    loginAs(null);
    expect((await assetGET(jsonRequest("GET", asset.url), ctx({ id: asset.id }))).status).toBe(401);
  });

  it("complete를 두 번 불러도 Asset은 하나다", async () => {
    const { ticket, res } = await upload("a.png", fixture("import/pixel.png"));
    const first = (await res.json()).asset;
    const again = await complete({ key: ticket.key, filename: "a.png" });
    expect((await again.json()).asset.id).toBe(first.id);
    expect(await prisma.asset.count()).toBe(1);
  });

  it("허용하지 않는 확장자는 415", async () => {
    for (const filename of ["malware.exe", "page.html", "vector.svg", "noext"]) {
      const res = await requestUrl({ filename, size: 100 });
      expect(res.status).toBe(415);
      expect((await res.json()).error.code).toBe("UNSUPPORTED_FILE");
    }
  });

  it("MAX_UPLOAD_MB를 넘는 크기는 413", async () => {
    process.env.MAX_UPLOAD_MB = "1";
    const res = await requestUrl({ filename: "big.pdf", size: 1024 * 1024 + 1 });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect((await requestUrl({ filename: "ok.pdf", size: 1024 * 1024 })).status).toBe(200);
  });

  it("크기를 속여 올리면 complete에서 413이고 올라간 객체는 지워진다", async () => {
    const bytes = fixture("import/sample.pdf");
    const ticket = await (await requestUrl({ filename: "a.pdf", size: 10 })).json();
    await putTo(ticket.uploadUrl, bytes);
    process.env.MAX_UPLOAD_MB = "0.01";
    const res = await complete({ key: ticket.key, filename: "a.pdf" });
    expect(res.status).toBe(413);
    expect(await getStorage().head(ticket.key)).toBeNull();
    expect(await prisma.asset.count()).toBe(0);
  });

  it("매직바이트가 확장자와 다르면 415이고 올라간 객체는 지워진다", async () => {
    const { ticket, res } = await upload("가짜.pdf", fixture("import/pixel.png"));
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_FILE");
    expect(await getStorage().head(ticket.key)).toBeNull();
    expect(await prisma.asset.count()).toBe(0);
  });

  it("complete의 파일 이름 확장자가 발급받은 키와 다르면 415", async () => {
    const ticket = await (await requestUrl({ filename: "a.png", size: 97 })).json();
    await putTo(ticket.uploadUrl, fixture("import/pixel.png"));
    expect((await complete({ key: ticket.key, filename: "a.pdf" })).status).toBe(415);
  });

  it("다른 사용자의 프로젝트에는 올릴 수 없다 (404)", async () => {
    loginAs(other);
    expect((await requestUrl({ filename: "a.pdf", size: 10, projectId })).status).toBe(404);
  });

  it("다른 사용자가 올린 객체의 키로 complete하면 404", async () => {
    const ticket = await (await requestUrl({ filename: "a.png", size: 97 })).json();
    await putTo(ticket.uploadUrl, fixture("import/pixel.png"));
    loginAs(other);
    expect((await complete({ key: ticket.key, filename: "a.png" })).status).toBe(404);
    expect(await prisma.asset.count()).toBe(0);
  });

  it("올리지 않고 complete하면 404", async () => {
    const ticket = await (await requestUrl({ filename: "a.png", size: 97 })).json();
    expect((await complete({ key: ticket.key, filename: "a.png" })).status).toBe(404);
  });

  it("휴지통에 있는 프로젝트의 자산은 내려받을 수 없다", async () => {
    const { res } = await upload("a.png", fixture("import/pixel.png"), { projectId });
    const { asset } = await res.json();
    await prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
    expect((await assetGET(jsonRequest("GET", asset.url), ctx({ id: asset.id }))).status).toBe(404);
  });

  it("휴지통 보관 기간이 지나 영구 삭제되면 스토리지 객체도 지워진다", async () => {
    const { ticket, res } = await upload("a.png", fixture("import/pixel.png"), { projectId });
    expect(res.status).toBe(201);
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.project.update({ where: { id: projectId }, data: { deletedAt: longAgo } });
    await purgeExpiredTrash();
    expect(await prisma.asset.count()).toBe(0);
    expect(await getStorage().head(ticket.key)).toBeNull();
  });

  it("로컬 presigned URL은 서명이 틀리거나 만료되면 403", async () => {
    const ticket = await (await requestUrl({ filename: "a.png", size: 97 })).json();
    const url = new URL(ticket.uploadUrl, "http://localhost");
    const key = url.pathname.replace("/api/storage/local/", "").split("/");
    const tampered = new URL(url);
    tampered.searchParams.set("sig", "0".repeat(64));
    expect((await localPUT(new Request(tampered, { method: "PUT", body: "x" }), keyCtx(key))).status).toBe(403);
    // PUT용 서명으로는 GET할 수 없다
    expect((await localGET(new Request(url), keyCtx(key))).status).toBe(403);
    const expired = new URL(url);
    expired.searchParams.set("exp", "1");
    expect((await localPUT(new Request(expired, { method: "PUT", body: "x" }), keyCtx(key))).status).toBe(403);
  });

  it("업로드 URL 발급에 rate limit이 걸린다 (429)", async () => {
    process.env.RATE_LIMIT_UPLOAD_PER_MINUTE = "2";
    try {
      expect((await requestUrl({ filename: "a.png", size: 97 })).status).toBe(200);
      expect((await requestUrl({ filename: "a.png", size: 97 })).status).toBe(200);
      const res = await requestUrl({ filename: "a.png", size: 97 });
      expect(res.status).toBe(429);
      expect((await res.json()).error.code).toBe("RATE_LIMITED");
    } finally {
      delete process.env.RATE_LIMIT_UPLOAD_PER_MINUTE;
    }
  });
});
