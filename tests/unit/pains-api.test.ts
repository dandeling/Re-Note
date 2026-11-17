import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGET, POST } from "@/app/api/pains/route";
import { DELETE, GET, PATCH } from "@/app/api/pains/[id]/route";
import { POST as commentPOST } from "@/app/api/pains/[id]/comments/route";
import { POST as reactionPOST } from "@/app/api/pains/[id]/reactions/route";
import { POST as reportPOST } from "@/app/api/pains/[id]/reports/route";
import { prisma } from "@/lib/db";
import { parseTags } from "@/lib/validation/pain";
import { listPains, PAIN_RATE_LIMITS } from "@/server/pains";
import { resetRateLimits } from "@/server/rate-limit";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

type User = Awaited<ReturnType<typeof createUser>>;

async function createPain(body: Record<string, unknown> = {}) {
  const res = await POST(jsonRequest("POST", "/api/pains", { title: "표본이 너무 적어요", body: "설문 응답이 12명뿐입니다.", ...body }), {});
  return { res, data: await res.json() };
}
async function list(query = "") {
  const res = await listGET(jsonRequest("GET", `/api/pains${query}`), {});
  return { res, data: await res.json() };
}
async function detail(id: string) {
  const res = await GET(jsonRequest("GET", `/api/pains/${id}`), ctx({ id }));
  return { res, data: await res.json() };
}
async function patch(id: string, body: unknown) {
  const res = await PATCH(jsonRequest("PATCH", `/api/pains/${id}`, body), ctx({ id }));
  return { res, data: await res.json() };
}
const remove = (id: string) => DELETE(jsonRequest("DELETE", `/api/pains/${id}`), ctx({ id }));
const comment = (id: string, body: unknown) =>
  commentPOST(jsonRequest("POST", `/api/pains/${id}/comments`, body), ctx({ id }));
const react = (id: string) => reactionPOST(jsonRequest("POST", `/api/pains/${id}/reactions`), ctx({ id }));
const report = (id: string, body: unknown = {}) =>
  reportPOST(jsonRequest("POST", `/api/pains/${id}/reports`, body), ctx({ id }));
const titles = (data: { pains: { title: string }[] }) => data.pains.map((p) => p.title);

let author: User;
let other: User;

beforeEach(async () => {
  await resetDb();
  await resetRateLimits();
  author = await createUser("김작성");
  other = await createUser("이방문");
  loginAs(author);
});

describe("P5-1 고충 작성·수정·삭제", () => {
  it("비로그인은 작성·수정·삭제할 수 없다 (401)", async () => {
    const { data } = await createPain();
    loginAs(null);
    expect((await createPain()).res.status).toBe(401);
    expect((await patch(data.pain.id, { title: "x" })).res.status).toBe(401);
    expect((await remove(data.pain.id)).status).toBe(401);
  });

  it("제목·본문·단계·분야·태그·익명 여부로 작성한다", async () => {
    const { res, data } = await createPain({
      title: "  측정값이 흔들려요 ",
      body: "**센서** 값이 매번 달라요.",
      stage: "EXPERIMENT",
      field: "물리",
      tags: ["#센서", "측정", "측정"],
      isAnonymous: false,
    });
    expect(res.status).toBe(201);
    expect(data.pain).toMatchObject({
      title: "측정값이 흔들려요",
      body: "**센서** 값이 매번 달라요.",
      stage: "EXPERIMENT",
      field: "물리",
      tags: ["센서", "측정"],
      isAnonymous: false,
      resolved: false,
      resolution: null,
      isMine: true,
      author: { name: "김작성" },
      meTooCount: 0,
      commentCount: 0,
    });
  });

  it("기본값: 단계는 기타, 실명", async () => {
    const { data } = await createPain();
    expect(data.pain).toMatchObject({ stage: "OTHER", field: "", tags: [], isAnonymous: false });
  });

  it("잘못된 입력은 400", async () => {
    for (const body of [{ title: "  " }, { body: "" }, { stage: "주제선정" }, { tags: Array(11).fill("a").map((a, i) => a + i) }, { isAnonymous: "yes" }]) {
      const { res, data } = await createPain(body);
      expect(res.status).toBe(400);
      expect(data.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("내 프로젝트만 연결할 수 있다", async () => {
    const mine = await prisma.project.create({ data: { ownerId: author.id, title: "내 프로젝트" } });
    const theirs = await prisma.project.create({ data: { ownerId: other.id, title: "남의 프로젝트" } });
    const trashed = await prisma.project.create({ data: { ownerId: author.id, title: "휴지통", deletedAt: new Date() } });

    const ok = await createPain({ projectId: mine.id });
    expect(ok.res.status).toBe(201);
    expect(ok.data.pain.projectId).toBe(mine.id);

    for (const projectId of [theirs.id, trashed.id, "nope"]) {
      const bad = await createPain({ projectId });
      expect(bad.res.status).toBe(400);
    }
    // 수정으로도 남의 프로젝트에 연결할 수 없다.
    expect((await patch(ok.data.pain.id, { projectId: theirs.id })).res.status).toBe(400);
    expect((await patch(ok.data.pain.id, { projectId: null })).data.pain.projectId).toBeNull();
  });

  it("내가 공개한 연구만 연결할 수 있고, 익명 글은 연구에 연결할 수 없다", async () => {
    const mine = await prisma.research.create({ data: { authorId: author.id, title: "내 연구", summary: "요약" } });
    const theirs = await prisma.research.create({ data: { authorId: other.id, title: "남의 연구", summary: "요약" } });

    const ok = await createPain({ researchId: mine.id });
    expect(ok.res.status).toBe(201);
    expect(ok.data.pain.researchId).toBe(mine.id);
    expect((await createPain({ researchId: theirs.id })).res.status).toBe(400);
    expect((await createPain({ researchId: mine.id, isAnonymous: true })).res.status).toBe(400);
    // 연구에 연결된 글을 익명으로 바꿀 수 없고, 익명 글을 연구에 연결할 수도 없다.
    expect((await patch(ok.data.pain.id, { isAnonymous: true })).res.status).toBe(400);
    const anon = await createPain({ isAnonymous: true });
    expect((await patch(anon.data.pain.id, { researchId: mine.id })).res.status).toBe(400);
    // 연결을 끊으면서 익명으로 바꾸는 것은 된다.
    expect((await patch(ok.data.pain.id, { isAnonymous: true, researchId: null })).res.status).toBe(200);
  });

  it("작성자는 수정할 수 있다", async () => {
    const { data } = await createPain();
    const id = data.pain.id as string;
    const patched = await patch(id, { title: "새 제목", stage: "ANALYSIS", tags: ["통계"] });
    expect(patched.res.status).toBe(200);
    expect(patched.data.pain).toMatchObject({ title: "새 제목", stage: "ANALYSIS", tags: ["통계"], body: "설문 응답이 12명뿐입니다." });
    expect((await patch(id, {})).res.status).toBe(400);
  });

  it("남의 글은 수정·삭제할 수 없다 (403), 없는 글은 404", async () => {
    const { data } = await createPain();
    const id = data.pain.id as string;
    loginAs(other);
    const patched = await patch(id, { title: "탈취" });
    expect(patched.res.status).toBe(403);
    expect(patched.data.error.code).toBe("FORBIDDEN");
    expect((await patch(id, { resolved: true, resolution: "내가 해결" })).res.status).toBe(403);
    expect((await remove(id)).status).toBe(403);
    expect((await patch("nope", { title: "x" })).res.status).toBe(404);
    expect((await remove("nope")).status).toBe(404);

    const row = await prisma.painPost.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ title: "표본이 너무 적어요", resolved: false });
  });

  it("작성자가 삭제하면 댓글·공감·신고도 함께 사라진다", async () => {
    const { data } = await createPain();
    const id = data.pain.id as string;
    loginAs(other);
    await comment(id, { body: "저도요" });
    await react(id);
    await report(id);
    loginAs(author);
    expect((await remove(id)).status).toBe(200);
    expect((await detail(id)).res.status).toBe(404);
    expect(await prisma.comment.count()).toBe(0);
    expect(await prisma.reaction.count()).toBe(0);
    expect(await prisma.painReport.count()).toBe(0);
  });

  it("작성이 너무 잦으면 429", async () => {
    for (let i = 0; i < PAIN_RATE_LIMITS.write.limit; i++) expect((await createPain()).res.status).toBe(201);
    const { res, data } = await createPain();
    expect(res.status).toBe(429);
    expect(data.error.code).toBe("RATE_LIMITED");
    // 다른 사용자는 영향이 없다.
    loginAs(other);
    expect((await createPain()).res.status).toBe(201);
  });
});

describe("P5-2 비로그인 목록·상세 읽기, 정렬·필터·검색", () => {
  async function seed() {
    const a = (await createPain({ title: "주제를 못 정하겠어요", body: "관심사가 너무 넓어요", stage: "TOPIC", field: "생명과학", tags: ["주제"] })).data.pain;
    const b = (await createPain({ title: "설문 표본이 적어요", body: "응답자가 12명", stage: "ANALYSIS", field: "사회", tags: ["통계", "설문"] })).data.pain;
    const c = (await createPain({ title: "그래프 그리기", body: "오차 막대를 어떻게 넣죠? 통계 초보입니다", stage: "ANALYSIS", field: "물리", tags: ["통계"] })).data.pain;
    // 작성 시각을 벌려 최신순을 결정적으로 만든다.
    const base = Date.now();
    await prisma.painPost.update({ where: { id: a.id }, data: { createdAt: new Date(base - 3000) } });
    await prisma.painPost.update({ where: { id: b.id }, data: { createdAt: new Date(base - 2000) } });
    await prisma.painPost.update({ where: { id: c.id }, data: { createdAt: new Date(base - 1000) } });
    return { a, b, c };
  }

  it("비로그인도 목록과 상세를 읽는다", async () => {
    const { a } = await seed();
    loginAs(null);
    const { res, data } = await list();
    expect(res.status).toBe(200);
    expect(titles(data)).toEqual(["그래프 그리기", "설문 표본이 적어요", "주제를 못 정하겠어요"]);
    expect(data).toMatchObject({ page: 1, total: 3, totalPages: 1 });
    expect(data.pains[0]).toMatchObject({ isMine: false, reactedByMe: false, excerpt: expect.stringContaining("오차 막대") });
    expect(data.pains[0].body).toBeUndefined();

    const d = await detail(a.id);
    expect(d.res.status).toBe(200);
    expect(d.data.pain).toMatchObject({ title: "주제를 못 정하겠어요", body: "관심사가 너무 넓어요", isMine: false });
    expect(d.data.comments).toEqual([]);
    expect((await detail("nope")).res.status).toBe(404);
  });

  it("공감순 정렬", async () => {
    const { a, b } = await seed();
    const third = await createUser();
    loginAs(other);
    await react(a.id);
    await react(b.id);
    loginAs(third);
    await react(a.id);
    loginAs(null);
    expect(titles((await list("?sort=popular")).data)).toEqual(["주제를 못 정하겠어요", "설문 표본이 적어요", "그래프 그리기"]);
    expect((await list("?sort=popular")).data.pains[0].meTooCount).toBe(2);
  });

  it("단계·분야·태그 필터와 조합", async () => {
    await seed();
    loginAs(null);
    expect(titles((await list("?stage=TOPIC")).data)).toEqual(["주제를 못 정하겠어요"]);
    expect(titles((await list("?stage=ANALYSIS")).data)).toHaveLength(2);
    expect(titles((await list(`?field=${encodeURIComponent("물리")}`)).data)).toEqual(["그래프 그리기"]);
    expect(titles((await list(`?tag=${encodeURIComponent("통계")}`)).data)).toEqual(["그래프 그리기", "설문 표본이 적어요"]);
    expect(titles((await list(`?tag=${encodeURIComponent("#설문")}`)).data)).toEqual(["설문 표본이 적어요"]);
    expect(titles((await list(`?stage=ANALYSIS&tag=${encodeURIComponent("통계")}&field=${encodeURIComponent("사회")}`)).data)).toEqual(["설문 표본이 적어요"]);
    // 비워 둔 필터는 무시한다.
    expect((await list("?stage=&field=&tag=&q=&sort=")).data.total).toBe(3);
  });

  it("제목·본문 검색", async () => {
    await seed();
    loginAs(null);
    expect(titles((await list(`?q=${encodeURIComponent("표본")}`)).data)).toEqual(["설문 표본이 적어요"]);
    // 본문에만 있는 단어
    expect(titles((await list(`?q=${encodeURIComponent("오차 막대")}`)).data)).toEqual(["그래프 그리기"]);
    expect((await list(`?q=${encodeURIComponent("없는말")}`)).data).toMatchObject({ pains: [], total: 0 });
    // LIKE 와일드카드는 글자로 취급한다.
    expect((await list("?q=%25")).data.total).toBe(0);
  });

  it("페이지네이션", async () => {
    await seed();
    loginAs(null);
    const p1 = (await list("?pageSize=2")).data;
    expect(p1).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(titles(p1)).toEqual(["그래프 그리기", "설문 표본이 적어요"]);
    expect(titles((await list("?pageSize=2&page=2")).data)).toEqual(["주제를 못 정하겠어요"]);
    expect(titles((await list("?pageSize=2&page=9")).data)).toEqual([]);
  });

  it("잘못된 쿼리는 400", async () => {
    for (const q of ["?sort=random", "?stage=NOPE", "?page=0", "?pageSize=1000", "?page=abc"]) {
      expect((await list(q)).res.status).toBe(400);
    }
  });

  it("listPains({ researchId })는 그 연구에 연결된 고충만 돌려준다", async () => {
    const research = await prisma.research.create({ data: { authorId: author.id, title: "연구", summary: "요약" } });
    await createPain({ title: "연구에 연결", researchId: research.id });
    await createPain({ title: "연결 없음" });
    const result = await listPains({ researchId: research.id });
    expect(result.pains.map((p) => p.title)).toEqual(["연구에 연결"]);
    expect(titles((await list(`?researchId=${research.id}`)).data)).toEqual(["연구에 연결"]);
  });

  it("projectId는 본인에게만 보인다", async () => {
    const project = await prisma.project.create({ data: { ownerId: author.id, title: "p" } });
    const { data } = await createPain({ projectId: project.id });
    expect((await detail(data.pain.id)).data.pain.projectId).toBe(project.id);
    for (const viewer of [other, null]) {
      loginAs(viewer);
      expect(JSON.stringify((await detail(data.pain.id)).data)).not.toContain(project.id);
      expect(JSON.stringify((await list()).data)).not.toContain(project.id);
    }
  });
});

describe("P5-4 댓글 · 나도 겪었어요 · 신고", () => {
  let id: string;
  beforeEach(async () => {
    id = (await createPain()).data.pain.id;
  });

  it("비로그인은 댓글·공감·신고를 할 수 없다 (401)", async () => {
    loginAs(null);
    expect((await comment(id, { body: "x" })).status).toBe(401);
    expect((await react(id)).status).toBe(401);
    expect((await report(id)).status).toBe(401);
  });

  it("없는 글에는 404", async () => {
    expect((await comment("nope", { body: "x" })).status).toBe(404);
    expect((await react("nope")).status).toBe(404);
    expect((await report("nope")).status).toBe(404);
  });

  it("댓글을 달면 상세에 작성 순서대로 보인다", async () => {
    loginAs(other);
    const res = await comment(id, { body: "  저도 같은 문제를 겪었어요 " });
    expect(res.status).toBe(201);
    expect((await res.json()).comment).toMatchObject({
      body: "저도 같은 문제를 겪었어요",
      author: { name: "이방문" },
      isPostAuthor: false,
      isMine: true,
    });
    expect((await comment(id, { body: "   " })).status).toBe(400);
    loginAs(author);
    await comment(id, { body: "답변 감사합니다" });

    loginAs(null);
    const { data } = await detail(id);
    expect(data.pain.commentCount).toBe(2);
    expect(data.comments.map((c: { body: string }) => c.body)).toEqual(["저도 같은 문제를 겪었어요", "답변 감사합니다"]);
    expect(data.comments[1]).toMatchObject({ isPostAuthor: true, isMine: false, author: { name: "김작성" } });
  });

  it("나도 겪었어요는 토글이고 사용자당 하나만 저장된다", async () => {
    loginAs(other);
    expect(await (await react(id)).json()).toEqual({ reacted: true, meTooCount: 1 });
    expect((await detail(id)).data.pain).toMatchObject({ meTooCount: 1, reactedByMe: true });
    expect((await list()).data.pains[0]).toMatchObject({ meTooCount: 1, reactedByMe: true });
    loginAs(author);
    expect((await detail(id)).data.pain).toMatchObject({ meTooCount: 1, reactedByMe: false });
    expect(await (await react(id)).json()).toEqual({ reacted: true, meTooCount: 2 });
    loginAs(other);
    expect(await (await react(id)).json()).toEqual({ reacted: false, meTooCount: 1 });
    expect(await prisma.reaction.count({ where: { painPostId: id, userId: other.id } })).toBe(0);
  });

  it("동시에 여러 번 눌러도 (글, 사용자)당 반응은 최대 하나", async () => {
    loginAs(other);
    await Promise.all([react(id), react(id), react(id), react(id), react(id)]);
    expect(await prisma.reaction.count({ where: { painPostId: id, userId: other.id } })).toBeLessThanOrEqual(1);
    await expect(prisma.reaction.createMany({ data: [{ painPostId: id, userId: author.id }, { painPostId: id, userId: author.id }] })).rejects.toThrow();
  });

  it("신고는 플래그만 저장하고 글에는 아무 영향이 없다", async () => {
    loginAs(other);
    expect((await report(id, { reason: "광고 글입니다" })).status).toBe(201);
    // 같은 사람이 다시 신고해도 한 건만 남는다.
    expect((await report(id, { reason: "다시 신고" })).status).toBe(201);
    const reports = await prisma.painReport.findMany();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ painPostId: id, reporterId: other.id, reason: "다시 신고" });
    expect((await report(id, { reason: "x".repeat(1001) })).status).toBe(400);

    // 신고 정보는 공개 응답에 나오지 않는다.
    const { res, data } = await detail(id);
    expect(res.status).toBe(200);
    expect(JSON.stringify(data)).not.toMatch(/report|광고|신고/i);
  });

  it("댓글·공감·신고에 rate limit이 걸려 있다", async () => {
    loginAs(other);
    for (let i = 0; i < PAIN_RATE_LIMITS.comment.limit; i++) expect((await comment(id, { body: `댓글 ${i}` })).status).toBe(201);
    expect((await comment(id, { body: "초과" })).status).toBe(429);
    for (let i = 0; i < PAIN_RATE_LIMITS.reaction.limit; i++) expect((await react(id)).status).toBe(200);
    expect((await react(id)).status).toBe(429);
    for (let i = 0; i < PAIN_RATE_LIMITS.report.limit; i++) expect((await report(id)).status).toBe(201);
    expect((await report(id)).status).toBe(429);
  });
});

describe("P5-5 해결됨 처리", () => {
  let id: string;
  beforeEach(async () => {
    id = (await createPain()).data.pain.id;
  });

  it("작성자가 해결 방법과 함께 해결됨으로 바꾼다", async () => {
    const { res, data } = await patch(id, { resolved: true, resolution: "  표본을 30명으로 늘렸어요 " });
    expect(res.status).toBe(200);
    expect(data.pain).toMatchObject({ resolved: true, resolution: "표본을 30명으로 늘렸어요" });
    loginAs(null);
    expect((await detail(id)).data.pain).toMatchObject({ resolved: true, resolution: "표본을 30명으로 늘렸어요" });
    expect((await list()).data.pains[0].resolved).toBe(true);
  });

  it("해결 방법 없이 해결됨으로 바꿀 수 없다", async () => {
    expect((await patch(id, { resolved: true })).res.status).toBe(400);
    expect((await patch(id, { resolved: true, resolution: "   " })).res.status).toBe(400);
    // 해결되지 않은 글에 해결 방법만 적을 수도 없다.
    expect((await patch(id, { resolution: "방법" })).res.status).toBe(400);
    expect((await detail(id)).data.pain).toMatchObject({ resolved: false, resolution: null });
  });

  it("해결 방법을 고치거나 해결을 취소할 수 있다", async () => {
    await patch(id, { resolved: true, resolution: "첫 방법" });
    expect((await patch(id, { resolution: "고친 방법" })).data.pain).toMatchObject({ resolved: true, resolution: "고친 방법" });
    // 다른 필드만 고쳐도 해결 상태는 유지된다.
    expect((await patch(id, { title: "제목만" })).data.pain).toMatchObject({ resolved: true, resolution: "고친 방법" });
    expect((await patch(id, { resolved: false })).data.pain).toMatchObject({ resolved: false, resolution: null });
  });

  it("다른 사용자는 해결됨으로 바꿀 수 없다", async () => {
    loginAs(other);
    expect((await patch(id, { resolved: true, resolution: "남이" })).res.status).toBe(403);
  });
});

describe("parseTags", () => {
  it("쉼표·줄바꿈으로 나누고 #·공백·중복을 정리한다", () => {
    expect(parseTags(" #통계, 설문,,\n통계 ")).toEqual(["통계", "설문"]);
  });
});
