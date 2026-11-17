import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH } from "@/app/api/account/route";
import { prisma } from "@/lib/db";
import { getStorage, newStorageKey } from "@/lib/storage";
import { resetRateLimits } from "@/server/rate-limit";
import { createUser, resetDb } from "../setup/db";
import { jsonRequest, loginAs } from "../setup/session";
import { tempStorage } from "../setup/storage";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

tempStorage();

type User = Awaited<ReturnType<typeof createUser>>;

async function putAsset(data: { ownerId?: string; projectId?: string; prefix: string; filename: string }) {
  const storageKey = newStorageKey(data.prefix, data.filename);
  await getStorage().put(storageKey, new TextEncoder().encode(`bytes of ${data.filename}`));
  return prisma.asset.create({
    data: {
      ownerId: data.ownerId ?? null,
      projectId: data.projectId ?? null,
      kind: "OTHER",
      storageKey,
      filename: data.filename,
      size: 10,
      mime: "application/octet-stream",
    },
  });
}

/** SPEC 6장의 모든 모델에 걸쳐 한 사용자의 데이터를 만든다. */
async function seedUserData(user: User, label: string) {
  const project = await prisma.project.create({ data: { ownerId: user.id, title: `${label} 프로젝트` } });
  const template = await prisma.formatTemplate.create({
    data: { ownerId: user.id, name: `${label} 서식`, rulesJson: {} },
  });
  const doc = await prisma.document.create({
    data: { projectId: project.id, title: `${label} 문서`, contentJson: { type: "doc" }, formatTemplateId: template.id },
  });
  await prisma.documentSnapshot.create({
    data: { documentId: doc.id, contentJson: { type: "doc" }, version: 1, reason: "MANUAL" },
  });
  const ownedAsset = await putAsset({ ownerId: user.id, projectId: project.id, prefix: `uploads/${user.id}`, filename: "data.csv" });
  // 소유자 없이 프로젝트에만 달린 자산(가져오기 결과 등)
  const projectOnlyAsset = await putAsset({ projectId: project.id, prefix: "imports", filename: "figure.png" });
  // 소유자·프로젝트 없이 변환 작업에만 달린 결과 자산
  const jobOutputAsset = await putAsset({ prefix: "converted", filename: "out.pdf" });
  const reportAsset = await putAsset({ ownerId: user.id, prefix: `uploads/${user.id}`, filename: "report.pdf" });
  await prisma.dataset.create({
    data: { projectId: project.id, assetId: ownedAsset.id, name: `${label} 데이터`, columnsJson: [], rowCount: 0 },
  });
  await prisma.conversionJob.create({
    data: { ownerId: user.id, inputAssetId: reportAsset.id, outputAssetId: jobOutputAsset.id, type: "HWP_TO_PDF", status: "DONE" },
  });
  const research = await prisma.research.create({
    data: { authorId: user.id, projectId: project.id, title: `${label} 연구`, summary: "요약", reportAssetId: reportAsset.id },
  });
  const pain = await prisma.painPost.create({
    data: { authorId: user.id, researchId: research.id, projectId: project.id, title: `${label} 고충`, body: "본문" },
  });
  const thread = await prisma.chatThread.create({
    data: { userId: user.id, projectId: project.id, documentId: doc.id, title: `${label} 대화` },
  });
  await prisma.chatMessage.create({ data: { threadId: thread.id, role: "user", content: "질문" } });
  await prisma.account.create({
    data: { userId: user.id, type: "oauth", provider: "google", providerAccountId: `google-${user.id}` },
  });
  await prisma.session.create({
    data: { userId: user.id, sessionToken: `token-${user.id}`, expires: new Date(Date.now() + 86_400_000) },
  });
  await prisma.verificationToken.create({
    data: { identifier: user.email, token: `magic-${user.id}`, expires: new Date(Date.now() + 600_000) },
  });
  const assets = [ownedAsset, projectOnlyAsset, jobOutputAsset, reportAsset];
  return { project, doc, research, pain, assets };
}

/** 두 사용자가 서로의 고충에 남긴 댓글·공감·신고 */
async function crossInteract(actor: User, targetPainId: string) {
  await prisma.comment.create({ data: { painPostId: targetPainId, authorId: actor.id, body: "댓글" } });
  await prisma.reaction.create({ data: { painPostId: targetPainId, userId: actor.id } });
  await prisma.painReport.create({ data: { painPostId: targetPainId, reporterId: actor.id, reason: "신고" } });
}

async function counts() {
  const [
    users, accounts, sessions, tokens, projects, documents, snapshots, templates, assets, datasets, jobs,
    researches, pains, comments, reactions, reports, threads, chatMessages,
  ] = await Promise.all([
    prisma.user.count(), prisma.account.count(), prisma.session.count(), prisma.verificationToken.count(),
    prisma.project.count(), prisma.document.count(), prisma.documentSnapshot.count(), prisma.formatTemplate.count(),
    prisma.asset.count(), prisma.dataset.count(), prisma.conversionJob.count(), prisma.research.count(),
    prisma.painPost.count(), prisma.comment.count(), prisma.reaction.count(), prisma.painReport.count(),
    prisma.chatThread.count(), prisma.chatMessage.count(),
  ]);
  return {
    users, accounts, sessions, tokens, projects, documents, snapshots, templates, assets, datasets, jobs,
    researches, pains, comments, reactions, reports, threads, chatMessages,
  };
}

async function storedKeys(assets: { storageKey: string }[]) {
  const heads = await Promise.all(assets.map((a) => getStorage().head(a.storageKey)));
  return heads.filter(Boolean).length;
}

function del(body: unknown) {
  return DELETE(jsonRequest("DELETE", "/api/account", body), {});
}

describe("계정 API", () => {
  let user: User;

  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    user = await createUser("김연구");
    loginAs(user);
  });

  it("비로그인은 401", async () => {
    loginAs(null);
    expect((await GET(jsonRequest("GET", "/api/account"), {})).status).toBe(401);
    expect((await PATCH(jsonRequest("PATCH", "/api/account", { name: "x" }), {})).status).toBe(401);
    expect((await del({ confirmEmail: user.email })).status).toBe(401);
    expect(await prisma.user.count()).toBe(1);
  });

  it("내 이름과 로그인 이메일을 돌려준다", async () => {
    const res = await GET(jsonRequest("GET", "/api/account"), {});
    expect((await res.json()).account).toMatchObject({ id: user.id, email: user.email, name: "김연구" });
  });

  it("이름을 바꾼다 (앞뒤 공백 제거)", async () => {
    const res = await PATCH(jsonRequest("PATCH", "/api/account", { name: "  이탐구 " }), {});
    expect(res.status).toBe(200);
    expect((await res.json()).account.name).toBe("이탐구");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe("이탐구");
  });

  it("빈 이름·너무 긴 이름은 400, 이메일은 바꿀 수 없다", async () => {
    expect((await PATCH(jsonRequest("PATCH", "/api/account", { name: "   " }), {})).status).toBe(400);
    expect((await PATCH(jsonRequest("PATCH", "/api/account", { name: "가".repeat(51) }), {})).status).toBe(400);
    await PATCH(jsonRequest("PATCH", "/api/account", { name: "이탐구", email: "evil@example.com" }), {});
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("이름 변경은 내 계정만 바꾼다", async () => {
    const other = await createUser("다른 사람");
    await PATCH(jsonRequest("PATCH", "/api/account", { name: "이탐구" }), {});
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).name).toBe("다른 사람");
  });
});

describe("계정 삭제 (SPEC 9장 개인정보)", () => {
  let me: User;
  let other: User;
  let mine: Awaited<ReturnType<typeof seedUserData>>;
  let theirs: Awaited<ReturnType<typeof seedUserData>>;

  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    me = await createUser("삭제할 사용자");
    other = await createUser("남는 사용자");
    mine = await seedUserData(me, "내");
    theirs = await seedUserData(other, "남의");
    await crossInteract(me, theirs.pain.id);
    await crossInteract(other, mine.pain.id);
    await crossInteract(me, mine.pain.id);
    await crossInteract(other, theirs.pain.id);
    // 남의 고충이 내 연구를 가리키는 경우: 글은 남고 연결만 끊겨야 한다.
    await prisma.painPost.create({
      data: { authorId: other.id, researchId: mine.research.id, title: "내 연구에 연결된 남의 고충", body: "본문" },
    });
    loginAs(me);
  });

  it("확인 이메일이 없거나 다르면 400이고 아무것도 지우지 않는다", async () => {
    const before = await counts();
    expect((await del({})).status).toBe(400);
    expect((await del({ confirmEmail: "" })).status).toBe(400);
    const wrong = await del({ confirmEmail: other.email });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe("VALIDATION_ERROR");
    expect(await counts()).toEqual(before);
    expect(await storedKeys(mine.assets)).toBe(4);
  });

  it("이메일을 다시 입력하면 내 데이터가 DB와 스토리지에서 모두 사라진다", async () => {
    const res = await del({ confirmEmail: ` ${me.email.toUpperCase()} ` });
    expect(res.status).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: me.id } })).toBeNull();
    expect(await prisma.account.count({ where: { userId: me.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: me.id } })).toBe(0);
    expect(await prisma.verificationToken.count({ where: { identifier: me.email } })).toBe(0);
    expect(await prisma.project.count({ where: { ownerId: me.id } })).toBe(0);
    expect(await prisma.document.count({ where: { projectId: mine.project.id } })).toBe(0);
    expect(await prisma.documentSnapshot.count({ where: { documentId: mine.doc.id } })).toBe(0);
    expect(await prisma.formatTemplate.count({ where: { ownerId: me.id } })).toBe(0);
    expect(await prisma.asset.count({ where: { id: { in: mine.assets.map((a) => a.id) } } })).toBe(0);
    expect(await prisma.dataset.count({ where: { projectId: mine.project.id } })).toBe(0);
    expect(await prisma.conversionJob.count({ where: { ownerId: me.id } })).toBe(0);
    expect(await prisma.research.count({ where: { authorId: me.id } })).toBe(0);
    expect(await prisma.painPost.count({ where: { authorId: me.id } })).toBe(0);
    expect(await prisma.comment.count({ where: { authorId: me.id } })).toBe(0);
    expect(await prisma.reaction.count({ where: { userId: me.id } })).toBe(0);
    expect(await prisma.chatThread.count({ where: { userId: me.id } })).toBe(0);
    // 신고는 FK가 SetNull이라 코드로 지운다: 작성자 없는 신고 행이 남지 않아야 한다.
    expect(await prisma.painReport.count({ where: { reporterId: null } })).toBe(0);
    // 스토리지 객체
    expect(await storedKeys(mine.assets)).toBe(0);
  });

  it("다른 사용자의 데이터는 그대로 남는다", async () => {
    await del({ confirmEmail: me.email });

    // 남은 것은 정확히 다른 사용자 한 명분 + 그 사용자가 자기 글에 남긴 상호작용 + 연결만 끊긴 고충 1건
    expect(await counts()).toEqual({
      users: 1, accounts: 1, sessions: 1, tokens: 1, projects: 1, documents: 1, snapshots: 1, templates: 1,
      assets: 4, datasets: 1, jobs: 1, researches: 1, pains: 2, comments: 1, reactions: 1, reports: 1,
      threads: 1, chatMessages: 1,
    });
    expect(await prisma.project.count({ where: { ownerId: other.id } })).toBe(1);
    expect(await prisma.comment.count({ where: { authorId: other.id, painPostId: theirs.pain.id } })).toBe(1);
    expect(await prisma.painReport.count({ where: { reporterId: other.id } })).toBe(1);
    expect(await storedKeys(theirs.assets)).toBe(4);
    const linked = await prisma.painPost.findFirstOrThrow({ where: { title: "내 연구에 연결된 남의 고충" } });
    expect(linked).toMatchObject({ authorId: other.id, researchId: null });
  });

  it("남의 변환 작업에 쓰인 자산이라도 남의 소유면 지우지 않는다", async () => {
    // 내 변환 작업이 다른 사용자 소유 자산을 입력으로 가리키는 비정상 데이터
    await prisma.conversionJob.create({
      data: { ownerId: me.id, inputAssetId: theirs.assets[0].id, type: "IMPORT_PDF" },
    });
    await del({ confirmEmail: me.email });
    expect(await prisma.asset.count({ where: { id: theirs.assets[0].id } })).toBe(1);
    expect(await storedKeys(theirs.assets)).toBe(4);
  });

  it("삭제한 뒤 같은 세션으로는 다시 호출해도 404 (계정이 없다)", async () => {
    await del({ confirmEmail: me.email });
    expect((await del({ confirmEmail: me.email })).status).toBe(404);
    expect((await GET(jsonRequest("GET", "/api/account"), {})).status).toBe(404);
  });

  it("rate limit: 10분에 5번까지만 시도할 수 있다", async () => {
    for (let i = 0; i < 5; i += 1) expect((await del({ confirmEmail: "wrong@example.com" })).status).toBe(400);
    const limited = await del({ confirmEmail: me.email });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    expect(await prisma.user.count()).toBe(2);
    // 한도는 사용자별이다.
    loginAs(other);
    expect((await del({ confirmEmail: "wrong@example.com" })).status).toBe(400);
  });
});
