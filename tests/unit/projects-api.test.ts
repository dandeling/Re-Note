import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGET, POST } from "@/app/api/projects/route";
import { DELETE, GET, PATCH } from "@/app/api/projects/[id]/route";
import { parseKeywords } from "@/lib/validation/project";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

async function createProject(body: unknown = { title: "음향 블랙홀 연구" }) {
  const res = await POST(jsonRequest("POST", "/api/projects", body), {});
  return { res, data: await res.json() };
}

describe("프로젝트 CRUD API", () => {
  beforeEach(async () => {
    await resetDb();
    loginAs(await createUser());
  });

  it("비로그인은 401", async () => {
    loginAs(null);
    expect((await listGET(jsonRequest("GET", "/api/projects"), {})).status).toBe(401);
    expect((await createProject()).res.status).toBe(401);
  });

  it("제목·설명·분야·키워드로 프로젝트를 만들고 기본은 비공개", async () => {
    const { res, data } = await createProject({
      title: "  음향 블랙홀 연구 ",
      description: "진동 감쇠 측정",
      field: "물리",
      keywords: ["음향 블랙홀", "진동 감쇠"],
    });
    expect(res.status).toBe(201);
    expect(data.project).toMatchObject({
      title: "음향 블랙홀 연구",
      field: "물리",
      keywords: ["음향 블랙홀", "진동 감쇠"],
      visibility: "PRIVATE",
    });
  });

  it("제목이 없으면 400", async () => {
    const { res, data } = await createProject({ title: "   " });
    expect(res.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("여러 개를 만들면 내 목록에 최신 수정순으로 나온다", async () => {
    await createProject({ title: "첫째" });
    await createProject({ title: "둘째" });
    const res = await listGET(jsonRequest("GET", "/api/projects"), {});
    const { projects } = await res.json();
    expect(projects.map((p: { title: string }) => p.title)).toEqual(["둘째", "첫째"]);
  });

  it("조회·수정·삭제", async () => {
    const { data } = await createProject();
    const id = data.project.id as string;
    expect((await GET(jsonRequest("GET", `/api/projects/${id}`), ctx({ id }))).status).toBe(200);

    const patched = await PATCH(jsonRequest("PATCH", `/api/projects/${id}`, { title: "새 제목" }), ctx({ id }));
    expect((await patched.json()).project.title).toBe("새 제목");

    const empty = await PATCH(jsonRequest("PATCH", `/api/projects/${id}`, {}), ctx({ id }));
    expect(empty.status).toBe(400);

    expect((await DELETE(jsonRequest("DELETE", `/api/projects/${id}`), ctx({ id }))).status).toBe(200);
    expect((await GET(jsonRequest("GET", `/api/projects/${id}`), ctx({ id }))).status).toBe(404);
    const list = await (await listGET(jsonRequest("GET", "/api/projects"), {})).json();
    expect(list.projects).toHaveLength(0);
  });

  it("보관하면 기본 목록에서 빠지고 보관 목록에 나온다", async () => {
    const { data } = await createProject();
    const id = data.project.id as string;
    await PATCH(jsonRequest("PATCH", `/api/projects/${id}`, { archived: true }), ctx({ id }));
    const active = await (await listGET(jsonRequest("GET", "/api/projects"), {})).json();
    const archived = await (await listGET(jsonRequest("GET", "/api/projects?status=archived"), {})).json();
    expect(active.projects).toHaveLength(0);
    expect(archived.projects).toHaveLength(1);
  });
});

describe("parseKeywords", () => {
  it("쉼표·줄바꿈으로 나누고 공백·중복을 정리한다", () => {
    expect(parseKeywords(" 음향 블랙홀, 진동 감쇠,,\n음향 블랙홀 ")).toEqual(["음향 블랙홀", "진동 감쇠"]);
  });
});
