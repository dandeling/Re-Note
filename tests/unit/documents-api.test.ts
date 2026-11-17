import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH } from "@/app/api/docs/[id]/route";
import { GET as listGET, POST } from "@/app/api/projects/[id]/docs/route";
import { prisma } from "@/lib/db";
import { docContentSchema, docToText, EMPTY_DOC } from "@/lib/editor/content";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const para = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("문서 API", () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let projectId: string;

  async function createDoc(body: unknown = {}) {
    const res = await POST(jsonRequest("POST", `/api/projects/${projectId}/docs`, body), ctx({ id: projectId }));
    return { res, doc: (await res.json()).document };
  }
  const patch = (id: string, body: unknown) => PATCH(jsonRequest("PATCH", `/api/docs/${id}`, body), ctx({ id }));

  beforeEach(async () => {
    await resetDb();
    owner = await createUser("소유자");
    loginAs(owner);
    projectId = (await prisma.project.create({ data: { ownerId: owner.id, title: "프로젝트" } })).id;
  });

  it("프로젝트 안에 문서를 여러 개 만들 수 있고 기본 제목·빈 내용·버전 1로 시작한다", async () => {
    const { res, doc } = await createDoc();
    expect(res.status).toBe(201);
    expect(doc).toMatchObject({ title: "제목 없는 문서", version: 1, contentJson: EMPTY_DOC });
    await createDoc({ title: "둘째 문서" });
    const list = await (await listGET(jsonRequest("GET", "/x"), ctx({ id: projectId }))).json();
    expect(list.documents).toHaveLength(2);
  });

  it("내용을 저장하면 버전이 올라가고 다시 읽으면 그대로다", async () => {
    const { doc } = await createDoc();
    const res = await patch(doc.id, { title: "결과보고서", contentJson: para("진동 감쇠 측정"), baseVersion: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).document).toMatchObject({ title: "결과보고서", version: 2 });
    const read = await (await GET(jsonRequest("GET", "/x"), ctx({ id: doc.id }))).json();
    expect(docToText(read.document.contentJson)).toBe("진동 감쇠 측정");
  });

  it("baseVersion이 서버 버전과 다르면 409 CONFLICT이고 내용은 바뀌지 않는다", async () => {
    const { doc } = await createDoc();
    await patch(doc.id, { contentJson: para("첫 번째 탭"), baseVersion: 1 });
    const res = await patch(doc.id, { contentJson: para("두 번째 탭(옛 버전)"), baseVersion: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "CONFLICT", serverVersion: 2, yourBaseVersion: 1 });
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(docToText(saved.contentJson as never)).toBe("첫 번째 탭");
    expect(saved.version).toBe(2);
  });

  it("동시에 같은 버전으로 저장하면 하나만 성공한다", async () => {
    const { doc } = await createDoc();
    const results = await Promise.all(
      ["A", "B", "C"].map((t) => patch(doc.id, { contentJson: para(t), baseVersion: 1 })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it("내용을 저장할 때 baseVersion이 없으면 400, 제목만 바꿀 때는 필요 없다", async () => {
    const { doc } = await createDoc();
    expect((await patch(doc.id, { contentJson: para("x") })).status).toBe(400);
    const res = await patch(doc.id, { title: "제목만" });
    expect(res.status).toBe(200);
    expect((await res.json()).document.version).toBe(1);
  });

  it("문서 JSON이 아니면 400", async () => {
    const { doc } = await createDoc();
    expect((await patch(doc.id, { contentJson: { type: "paragraph" }, baseVersion: 1 })).status).toBe(400);
    expect((await patch(doc.id, { contentJson: "<p>html</p>", baseVersion: 1 })).status).toBe(400);
  });

  it("삭제하면 휴지통으로 가서 조회·목록에서 빠진다", async () => {
    const { doc } = await createDoc();
    expect((await DELETE(jsonRequest("DELETE", "/x"), ctx({ id: doc.id }))).status).toBe(200);
    expect((await GET(jsonRequest("GET", "/x"), ctx({ id: doc.id }))).status).toBe(404);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).deletedAt).not.toBeNull();
  });

  describe("접근 제어 (SPEC 7.6): 다른 사용자의 문서 ID로 요청하면 404", () => {
    let docId: string;
    beforeEach(async () => {
      docId = (await createDoc({ title: "비밀 보고서", contentJson: para("비밀 내용") })).doc.id;
      loginAs(await createUser("침입자"));
    });

    it("GET 404, 내용 비노출", async () => {
      const res = await GET(jsonRequest("GET", "/x"), ctx({ id: docId }));
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("비밀");
    });
    it("PATCH 404, 내용 불변", async () => {
      expect((await patch(docId, { contentJson: para("덮어쓰기"), baseVersion: 1 })).status).toBe(404);
      const saved = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
      expect(docToText(saved.contentJson as never)).toBe("비밀 내용");
    });
    it("DELETE 404, 삭제 안 됨", async () => {
      expect((await DELETE(jsonRequest("DELETE", "/x"), ctx({ id: docId }))).status).toBe(404);
      expect((await prisma.document.findUniqueOrThrow({ where: { id: docId } })).deletedAt).toBeNull();
    });
    it("남의 프로젝트에 문서 생성·목록 조회도 404", async () => {
      expect((await createDoc()).res.status).toBe(404);
      expect((await listGET(jsonRequest("GET", "/x"), ctx({ id: projectId }))).status).toBe(404);
    });
    it("비로그인은 401", async () => {
      loginAs(null);
      expect((await GET(jsonRequest("GET", "/x"), ctx({ id: docId }))).status).toBe(401);
    });
  });
});

describe("문서 JSON 스키마", () => {
  it("빈 문서와 일반 문서를 받아들인다", () => {
    expect(docContentSchema.safeParse(EMPTY_DOC).success).toBe(true);
    expect(docContentSchema.safeParse(para("가")).success).toBe(true);
  });
  it("지나치게 깊은 구조는 거부한다", () => {
    let node: Record<string, unknown> = { type: "paragraph" };
    for (let i = 0; i < 60; i++) node = { type: "blockquote", content: [node] };
    expect(docContentSchema.safeParse({ type: "doc", content: [node] }).success).toBe(false);
  });
});
