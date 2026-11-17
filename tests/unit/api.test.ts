import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getOwnedDocument, getOwnedProject } from "@/server/access";
import { ApiError, parseBody, parseQuery, requireApiUser, route } from "@/server/api";
import { createUser, resetDb } from "../setup/db";
import { jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const schema = z.object({ title: z.string().min(1) });

describe("공통 API 기반", () => {
  it("에러 형식은 { error: { code, message } }", async () => {
    const handler = route(async () => {
      throw new ApiError("NOT_FOUND");
    });
    const res = await handler(jsonRequest("GET", "/x"), {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "찾을 수 없습니다." } });
  });

  it("zod 검증 실패는 400 VALIDATION_ERROR", async () => {
    const handler = route(async (req) => Response.json(await parseBody(req, schema)));
    const res = await handler(jsonRequest("POST", "/x", { title: "" }), {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("JSON이 아닌 본문은 400", async () => {
    const handler = route(async (req) => Response.json(await parseBody(req, schema)));
    const req = new Request("http://localhost/x", { method: "POST", body: "{not json" });
    const res = await handler(req, {});
    expect(res.status).toBe(400);
  });

  it("쿼리스트링도 zod로 검증한다", async () => {
    const q = z.object({ page: z.coerce.number().int().min(1) });
    expect(parseQuery(jsonRequest("GET", "/x?page=3"), q)).toEqual({ page: 3 });
    expect(() => parseQuery(jsonRequest("GET", "/x?page=0"), q)).toThrow();
  });

  it("알 수 없는 예외는 내부 정보를 노출하지 않고 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = route(async () => {
      throw new Error("db password=secret");
    });
    const res = await handler(jsonRequest("GET", "/x"), {});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    spy.mockRestore();
  });

  it("비로그인은 401 UNAUTHORIZED", async () => {
    loginAs(null);
    const handler = route(async () => Response.json(await requireApiUser()));
    const res = await handler(jsonRequest("GET", "/x"), {});
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });
});

describe("소유자 검사 헬퍼", () => {
  beforeEach(resetDb);

  it("소유자는 접근할 수 있고, 다른 사용자는 404", async () => {
    const owner = await createUser();
    const other = await createUser();
    const project = await prisma.project.create({ data: { ownerId: owner.id, title: "p" } });
    const doc = await prisma.document.create({
      data: { projectId: project.id, title: "d", contentJson: { type: "doc" } },
    });
    expect((await getOwnedProject(owner.id, project.id)).id).toBe(project.id);
    expect((await getOwnedDocument(owner.id, doc.id)).id).toBe(doc.id);
    await expect(getOwnedProject(other.id, project.id)).rejects.toMatchObject({ status: 404 });
    await expect(getOwnedDocument(other.id, doc.id)).rejects.toMatchObject({ status: 404 });
  });

  it("휴지통에 있는 프로젝트·문서는 404", async () => {
    const owner = await createUser();
    const project = await prisma.project.create({
      data: { ownerId: owner.id, title: "p", deletedAt: new Date() },
    });
    const doc = await prisma.document.create({
      data: { projectId: project.id, title: "d", contentJson: {} },
    });
    await expect(getOwnedProject(owner.id, project.id)).rejects.toMatchObject({ status: 404 });
    await expect(getOwnedDocument(owner.id, doc.id)).rejects.toMatchObject({ status: 404 });
    expect((await getOwnedProject(owner.id, project.id, { includeDeleted: true })).id).toBe(project.id);
  });
});
