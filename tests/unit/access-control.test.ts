import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGET, POST } from "@/app/api/projects/route";
import { DELETE, GET, PATCH } from "@/app/api/projects/[id]/route";
import { prisma } from "@/lib/db";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

/**
 * SPEC 7.6 완료 기준: 다른 사용자의 프로젝트·문서 ID로 요청하면 404가 반환된다.
 * 문서 API 케이스는 문서 API가 추가될 때 이 파일에 덧붙인다.
 */
describe("접근 제어: 다른 사용자의 프로젝트", () => {
  let projectId: string;
  let owner: Awaited<ReturnType<typeof createUser>>;
  let intruder: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await resetDb();
    owner = await createUser("소유자");
    intruder = await createUser("침입자");
    loginAs(owner);
    const res = await POST(jsonRequest("POST", "/api/projects", { title: "비공개 연구" }), {});
    projectId = (await res.json()).project.id;
    loginAs(intruder);
  });

  it("GET은 404이고 제목 등 내용이 응답에 없다", async () => {
    const res = await GET(jsonRequest("GET", `/api/projects/${projectId}`), ctx({ id: projectId }));
    expect(res.status).toBe(404);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("비공개 연구");
    expect(text).toContain("NOT_FOUND");
  });

  it("PATCH는 404이고 데이터가 바뀌지 않는다", async () => {
    const res = await PATCH(
      jsonRequest("PATCH", `/api/projects/${projectId}`, { title: "탈취" }),
      ctx({ id: projectId }),
    );
    expect(res.status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).title).toBe("비공개 연구");
  });

  it("DELETE는 404이고 삭제되지 않는다", async () => {
    const res = await DELETE(jsonRequest("DELETE", `/api/projects/${projectId}`), ctx({ id: projectId }));
    expect(res.status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).deletedAt).toBeNull();
  });

  it("목록에는 내 프로젝트만 나온다", async () => {
    const res = await listGET(jsonRequest("GET", "/api/projects"), {});
    expect((await res.json()).projects).toEqual([]);
  });

  it("존재하지 않는 ID와 남의 ID는 같은 응답이다 (존재 여부를 알 수 없다)", async () => {
    const a = await GET(jsonRequest("GET", `/api/projects/${projectId}`), ctx({ id: projectId }));
    const b = await GET(jsonRequest("GET", "/api/projects/does-not-exist"), ctx({ id: "does-not-exist" }));
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
  });

  it("소유자는 정상 접근한다", async () => {
    loginAs(owner);
    const res = await GET(jsonRequest("GET", `/api/projects/${projectId}`), ctx({ id: projectId }));
    expect(res.status).toBe(200);
  });
});
