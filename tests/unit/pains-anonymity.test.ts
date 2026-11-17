import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGET, POST } from "@/app/api/pains/route";
import { GET, PATCH } from "@/app/api/pains/[id]/route";
import { POST as commentPOST } from "@/app/api/pains/[id]/comments/route";
import { POST as reactionPOST } from "@/app/api/pains/[id]/reactions/route";
import { POST as reportPOST } from "@/app/api/pains/[id]/reports/route";
import { prisma } from "@/lib/db";
import { listPains } from "@/server/pains";
import { resetRateLimits } from "@/server/rate-limit";
import { resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

// SPEC 7.1 완료 기준: "익명 글은 작성자 정보가 API 응답에 포함되지 않는다"
// 모든 엔드포인트의 응답 JSON을 재귀적으로 훑어 (1) 작성자를 가리키는 키가 없고 (2) 작성자의 id·이름·이메일·이미지 값이 어디에도 없음을 확인한다.

const FORBIDDEN_KEYS = new Set(["authorid", "userid", "ownerid", "reporterid", "email", "name", "image", "user", "reporter"]);

/** 응답 전체를 재귀적으로 돌며 [경로, 키, 값]을 모은다. */
function walk(value: unknown, path = "$", out: { path: string; key: string; value: unknown }[] = []) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      out.push({ path: `${path}.${key}`, key, value: v });
      walk(v, `${path}.${key}`, out);
    }
  }
  return out;
}

type Identity = { id: string; email: string; name: string; image: string };

/** 응답 JSON 어디에도 작성자 정보가 없음을 검사한다. */
function expectNoAuthorInfo(json: unknown, who: Identity, opts: { allowAuthorObjects?: boolean } = {}) {
  const text = JSON.stringify(json);
  for (const secret of [who.id, who.email, who.name, who.image]) expect(text).not.toContain(secret);
  for (const entry of walk(json)) {
    const key = entry.key.toLowerCase();
    // author 키는 익명 글·익명 글쓴이의 댓글에서는 반드시 null이어야 한다.
    if (key === "author") {
      if (!opts.allowAuthorObjects) expect(entry.value, entry.path).toBeNull();
      continue;
    }
    // 다른 사람(실명 댓글 작성자)의 author 객체 안에 있는 name·image는 허용한다.
    if (opts.allowAuthorObjects && /\.author\.(name|image)$/.test(entry.path)) continue;
    expect(FORBIDDEN_KEYS.has(key), `금지된 키 ${entry.path}`).toBe(false);
  }
}

const identity = (tag: string) => ({
  email: `${tag}-secret-mail@example.com`,
  name: `${tag}비밀이름`,
  image: `https://img.example.com/${tag}-secret-face.png`,
});

let author: Identity;
let commenter: Identity;

beforeEach(async () => {
  await resetDb();
  await resetRateLimits();
  author = await prisma.user.create({ data: identity("author") }) as Identity;
  commenter = await prisma.user.create({ data: identity("commenter") }) as Identity;
});

async function createAnonymous() {
  loginAs(author);
  const res = await POST(
    jsonRequest("POST", "/api/pains", { title: "익명 고충", body: "말하기 어려운 이야기", tags: ["비밀"], isAnonymous: true }),
    {},
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { pain: { id: string; isMine: boolean; author: unknown } };
}

describe("P5-3 익명 글 작성자 비노출", () => {
  it("작성 직후 응답에도 작성자 정보가 없다 (isMine만 true)", async () => {
    const created = await createAnonymous();
    expectNoAuthorInfo(created, author);
    expect(created.pain).toMatchObject({ isAnonymous: true, author: null, isMine: true });
  });

  it("목록·상세 응답: 비로그인·다른 사용자·작성자 본인 모두에게 작성자 정보가 없다", async () => {
    const { pain } = await createAnonymous();
    for (const viewer of [null, commenter, author]) {
      loginAs(viewer);
      for (const query of ["", "?sort=popular", `?q=${encodeURIComponent("익명")}`, `?tag=${encodeURIComponent("비밀")}`]) {
        const list = await (await listGET(jsonRequest("GET", `/api/pains${query}`), {})).json();
        expect(list.pains).toHaveLength(1);
        expectNoAuthorInfo(list, author);
        expect(list.pains[0].isMine).toBe(viewer === author);
      }
      const detail = await (await GET(jsonRequest("GET", `/api/pains/${pain.id}`), ctx({ id: pain.id }))).json();
      expectNoAuthorInfo(detail, author);
      expect(detail.pain.author).toBeNull();
      // "내 글인지"는 본인에게만 true
      expect(detail.pain.isMine).toBe(viewer === author);
    }
  });

  it("댓글 포함 응답: 익명 글쓴이가 자기 글에 단 댓글에도 작성자 정보가 없다", async () => {
    const { pain } = await createAnonymous();
    const id = pain.id;

    loginAs(commenter);
    const c1 = await (await commentPOST(jsonRequest("POST", `/api/pains/${id}/comments`, { body: "저도요" }), ctx({ id }))).json();
    expectNoAuthorInfo(c1, author, { allowAuthorObjects: true });
    expect(c1.comment.author).toEqual({ name: commenter.name, image: commenter.image });

    loginAs(author);
    const c2 = await (await commentPOST(jsonRequest("POST", `/api/pains/${id}/comments`, { body: "글쓴이입니다" }), ctx({ id }))).json();
    expectNoAuthorInfo(c2, author);
    expect(c2.comment).toMatchObject({ author: null, isPostAuthor: true, isMine: true });

    for (const viewer of [null, commenter, author]) {
      loginAs(viewer);
      const detail = await (await GET(jsonRequest("GET", `/api/pains/${id}`), ctx({ id }))).json();
      expect(detail.comments).toHaveLength(2);
      expectNoAuthorInfo(detail, author, { allowAuthorObjects: true });
      expect(detail.pain.author).toBeNull();
      expect(detail.comments[1]).toMatchObject({ author: null, isPostAuthor: true, isMine: viewer === author });
      // 댓글 작성자의 이메일·id는 실명이어도 나가지 않는다.
      const text = JSON.stringify(detail);
      expect(text).not.toContain(commenter.email);
      expect(text).not.toContain(commenter.id);
    }
  });

  it("수정·해결됨·공감·신고 응답에도 작성자 정보가 없다", async () => {
    const { pain } = await createAnonymous();
    const id = pain.id;
    const patched = await (await PATCH(jsonRequest("PATCH", `/api/pains/${id}`, { title: "고친 제목" }), ctx({ id }))).json();
    expectNoAuthorInfo(patched, author);
    const resolved = await (
      await PATCH(jsonRequest("PATCH", `/api/pains/${id}`, { resolved: true, resolution: "해결했어요" }), ctx({ id }))
    ).json();
    expectNoAuthorInfo(resolved, author);

    loginAs(commenter);
    const reaction = await (await reactionPOST(jsonRequest("POST", `/api/pains/${id}/reactions`), ctx({ id }))).json();
    expectNoAuthorInfo(reaction, author);
    expectNoAuthorInfo(reaction, commenter);
    const report = await (await reportPOST(jsonRequest("POST", `/api/pains/${id}/reports`, { reason: "사유" }), ctx({ id }))).json();
    expectNoAuthorInfo(report, author);
    expectNoAuthorInfo(report, commenter);
    // 남이 수정하려다 받는 403 응답에도 없다.
    const forbidden = await PATCH(jsonRequest("PATCH", `/api/pains/${id}`, { title: "x" }), ctx({ id }));
    expect(forbidden.status).toBe(403);
    expectNoAuthorInfo(await forbidden.json(), author);
  });

  it("서버 함수 listPains도 익명 글의 작성자 정보를 돌려주지 않는다 (페이지 렌더링 경로)", async () => {
    await createAnonymous();
    const project = await prisma.project.create({ data: { ownerId: author.id, title: "p" } });
    await prisma.painPost.updateMany({ data: { projectId: project.id } });
    for (const viewerId of [null, commenter.id]) {
      const result = await listPains({ viewerId });
      expectNoAuthorInfo(result, author);
      // 프로젝트 연결도 남에게는 보이지 않는다(실명 글과 묶여 신원이 드러나는 것 방지).
      expect(JSON.stringify(result)).not.toContain(project.id);
    }
  });

  it("실명 글에는 이름·이미지만 나가고 이메일·id는 나가지 않는다", async () => {
    loginAs(author);
    const res = await POST(jsonRequest("POST", "/api/pains", { title: "실명 고충", body: "본문" }), {});
    const { pain } = await res.json();
    loginAs(null);
    const detail = await (await GET(jsonRequest("GET", `/api/pains/${pain.id}`), ctx({ id: pain.id }))).json();
    expect(detail.pain.author).toEqual({ name: author.name, image: author.image });
    const text = JSON.stringify(detail);
    expect(text).not.toContain(author.email);
    expect(text).not.toContain(author.id);
  });

  it("실명에서 익명으로 바꾸면 그때부터 작성자 정보가 사라진다", async () => {
    loginAs(author);
    const { pain } = await (await POST(jsonRequest("POST", "/api/pains", { title: "실명 고충", body: "본문" }), {})).json();
    const id = pain.id as string;
    await PATCH(jsonRequest("PATCH", `/api/pains/${id}`, { isAnonymous: true }), ctx({ id }));
    loginAs(null);
    expectNoAuthorInfo(await (await GET(jsonRequest("GET", `/api/pains/${id}`), ctx({ id }))).json(), author);
    expectNoAuthorInfo(await (await listGET(jsonRequest("GET", "/api/pains"), {})).json(), author);
  });
});
