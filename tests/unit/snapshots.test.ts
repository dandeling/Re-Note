import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/docs/[id]/route";
import { POST as restorePOST } from "@/app/api/docs/[id]/restore/route";
import { GET as listGET, POST as snapPOST } from "@/app/api/docs/[id]/snapshots/route";
import { prisma } from "@/lib/db";
import { docToText } from "@/lib/editor/content";
import { AUTO_SNAPSHOT_INTERVAL_MS, MAX_SNAPSHOTS } from "@/server/snapshots";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const para = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("스냅샷 (SPEC 7.5)", () => {
  let docId: string;
  let version: number;

  const save = async (text: string) => {
    const res = await PATCH(
      jsonRequest("PATCH", "/x", { contentJson: para(text), baseVersion: version }),
      ctx({ id: docId }),
    );
    version = (await res.json()).document.version;
    return res;
  };
  const snap = () => snapPOST(jsonRequest("POST", "/x"), ctx({ id: docId }));
  const list = async () =>
    (await (await listGET(jsonRequest("GET", "/x"), ctx({ id: docId }))).json()).snapshots as {
      id: string;
      reason: string;
      version: number;
    }[];
  const restore = (snapshotId: string) =>
    restorePOST(jsonRequest("POST", "/x", { snapshotId }), ctx({ id: docId }));
  const ageAll = (ms: number) =>
    prisma.$executeRaw`UPDATE "DocumentSnapshot" SET "createdAt" = "createdAt" - (${ms} * interval '1 millisecond')`;

  beforeEach(async () => {
    await resetDb();
    const user = await createUser();
    loginAs(user);
    const project = await prisma.project.create({ data: { ownerId: user.id, title: "p" } });
    const doc = await prisma.document.create({
      data: { projectId: project.id, title: "d", contentJson: para("처음") },
    });
    docId = doc.id;
    version = 1;
  });

  it("첫 저장 때 자동 스냅샷이 생기고, 10분 안의 저장에서는 더 생기지 않는다", async () => {
    await save("하나");
    await save("둘");
    await save("셋");
    const snaps = await list();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].reason).toBe("AUTO");
  });

  it("마지막 스냅샷에서 10분이 지나면 다음 저장 때 자동 스냅샷이 추가된다", async () => {
    await save("하나");
    await ageAll(AUTO_SNAPSHOT_INTERVAL_MS - 5000);
    await save("둘");
    expect(await list()).toHaveLength(1);
    await ageAll(10_000);
    await save("셋");
    const snaps = await list();
    expect(snaps).toHaveLength(2);
    expect(snaps.every((s) => s.reason === "AUTO")).toBe(true);
  });

  it("수동 '버전 저장'은 간격과 무관하게 항상 생긴다", async () => {
    await save("하나");
    expect((await snap()).status).toBe(201);
    expect((await snap()).status).toBe(201);
    const snaps = await list();
    expect(snaps.filter((s) => s.reason === "MANUAL")).toHaveLength(2);
  });

  it("버전 기록에서 복원하면 그때의 내용으로 돌아가고, 복원 직전 내용도 기록에 남는다", async () => {
    await save("초안 A");
    const manual = (await (await snap()).json()).snapshot;
    await save("망친 내용");
    const before = (await list()).length;

    const res = await restore(manual.id);
    expect(res.status).toBe(200);
    const restored = (await res.json()).document;
    expect(docToText(restored.contentJson)).toBe("초안 A");
    expect(restored.version).toBe(version + 1);

    const snaps = await list();
    expect(snaps).toHaveLength(before + 1);
    const newest = await prisma.documentSnapshot.findUniqueOrThrow({ where: { id: snaps[0].id } });
    expect(docToText(newest.contentJson as never)).toBe("망친 내용");
  });

  it(`문서당 최근 ${MAX_SNAPSHOTS}개만 유지한다`, async () => {
    await prisma.documentSnapshot.createMany({
      data: Array.from({ length: MAX_SNAPSHOTS + 5 }, (_, i) => ({
        documentId: docId,
        contentJson: para(`old-${i}`),
        version: 1,
        reason: "AUTO" as const,
        createdAt: new Date(Date.now() - (i + 1) * 60_000),
      })),
    });
    await snap();
    const snaps = await list();
    expect(snaps).toHaveLength(MAX_SNAPSHOTS);
    expect(snaps[0].reason).toBe("MANUAL");
    const texts = await prisma.documentSnapshot.findMany({ where: { documentId: docId } });
    expect(texts.some((s) => docToText(s.contentJson as never) === `old-${MAX_SNAPSHOTS + 4}`)).toBe(false);
  });

  it("다른 문서의 스냅샷 ID로는 복원할 수 없다 (404)", async () => {
    const user2 = await createUser();
    const p2 = await prisma.project.create({ data: { ownerId: user2.id, title: "p2" } });
    const d2 = await prisma.document.create({ data: { projectId: p2.id, title: "d2", contentJson: para("남의 글") } });
    const foreign = await prisma.documentSnapshot.create({
      data: { documentId: d2.id, contentJson: para("남의 글"), version: 1, reason: "MANUAL" },
    });
    expect((await restore(foreign.id)).status).toBe(404);
    const mine = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(docToText(mine.contentJson as never)).toBe("처음");
  });

  it("다른 사용자는 스냅샷 목록·생성·복원 모두 404", async () => {
    await save("하나");
    const id = (await list())[0].id;
    loginAs(await createUser("침입자"));
    expect((await listGET(jsonRequest("GET", "/x"), ctx({ id: docId }))).status).toBe(404);
    expect((await snap()).status).toBe(404);
    expect((await restore(id)).status).toBe(404);
  });
});
