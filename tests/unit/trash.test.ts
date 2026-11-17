import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGET } from "@/app/api/projects/route";
import { DELETE, GET, PATCH } from "@/app/api/projects/[id]/route";
import { prisma } from "@/lib/db";
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from "@/server/trash";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const DAY = 24 * 60 * 60 * 1000;

async function seed(ownerId: string) {
  const project = await prisma.project.create({ data: { ownerId, title: "실험 프로젝트" } });
  const doc = await prisma.document.create({
    data: { projectId: project.id, title: "보고서", contentJson: { type: "doc" } },
  });
  const oldDoc = await prisma.document.create({
    data: { projectId: project.id, title: "먼저 지운 문서", contentJson: {}, deletedAt: new Date(Date.now() - DAY) },
  });
  const asset = await prisma.asset.create({
    data: { projectId: project.id, ownerId, kind: "CSV", storageKey: `k-${project.id}`, filename: "a.csv", size: 1, mime: "text/csv" },
  });
  return { project, doc, oldDoc, asset };
}

describe("프로젝트 휴지통 (SPEC 7.6)", () => {
  let user: Awaited<ReturnType<typeof createUser>>;
  beforeEach(async () => {
    await resetDb();
    user = await createUser();
    loginAs(user);
  });

  it("삭제하면 하위 문서·자산이 함께 휴지통으로 이동한다", async () => {
    const { project, doc, asset } = await seed(user.id);
    const res = await DELETE(jsonRequest("DELETE", `/api/projects/${project.id}`), ctx({ id: project.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).purgeAt).toBeTruthy();

    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const d = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    const a = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(p.deletedAt).not.toBeNull();
    expect(d.deletedAt).toEqual(p.deletedAt);
    expect(a.deletedAt).toEqual(p.deletedAt);

    const trash = await (await listGET(jsonRequest("GET", "/api/projects?status=trash"), {})).json();
    expect(trash.projects.map((x: { id: string }) => x.id)).toEqual([project.id]);
    expect((await GET(jsonRequest("GET", `/api/projects/${project.id}`), ctx({ id: project.id }))).status).toBe(404);
  });

  it("복구하면 프로젝트와 함께 옮겨진 문서·자산이 돌아오고, 그전에 따로 지운 문서는 그대로다", async () => {
    const { project, doc, oldDoc, asset } = await seed(user.id);
    await DELETE(jsonRequest("DELETE", `/api/projects/${project.id}`), ctx({ id: project.id }));
    const res = await PATCH(
      jsonRequest("PATCH", `/api/projects/${project.id}`, { restore: true }),
      ctx({ id: project.id }),
    );
    expect(res.status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).toBeNull();
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).deletedAt).toBeNull();
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).deletedAt).toBeNull();
    expect((await prisma.document.findUniqueOrThrow({ where: { id: oldDoc.id } })).deletedAt).not.toBeNull();
    expect((await GET(jsonRequest("GET", `/api/projects/${project.id}`), ctx({ id: project.id }))).status).toBe(200);
  });

  it("다른 사용자는 남의 휴지통 프로젝트를 복구할 수 없다 (404)", async () => {
    const { project } = await seed(user.id);
    await DELETE(jsonRequest("DELETE", `/api/projects/${project.id}`), ctx({ id: project.id }));
    loginAs(await createUser("다른 사람"));
    const res = await PATCH(
      jsonRequest("PATCH", `/api/projects/${project.id}`, { restore: true }),
      ctx({ id: project.id }),
    );
    expect(res.status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).not.toBeNull();
  });

  it(`${TRASH_RETENTION_DAYS}일이 지나면 영구 삭제되고, 그 전에는 남아 있다`, async () => {
    const { project, doc } = await seed(user.id);
    await DELETE(jsonRequest("DELETE", `/api/projects/${project.id}`), ctx({ id: project.id }));

    const early = await purgeExpiredTrash(new Date(Date.now() + 29 * DAY));
    expect(early.projects).toBe(0);
    expect(await prisma.project.count()).toBe(1);

    const late = await purgeExpiredTrash(new Date(Date.now() + 31 * DAY));
    expect(late.projects).toBe(1);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toBeNull();
    expect(await prisma.asset.count()).toBe(0);
  });

  it("영구 삭제는 휴지통에 없는 프로젝트를 건드리지 않는다", async () => {
    await seed(user.id);
    await purgeExpiredTrash(new Date(Date.now() + 365 * DAY));
    expect(await prisma.project.count()).toBe(1);
    // 프로젝트는 남고, 31일 넘게 지난 개별 삭제 문서만 정리된다
    expect(await prisma.document.count()).toBe(1);
  });
});
