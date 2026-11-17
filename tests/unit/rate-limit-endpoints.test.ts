import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as COMPLETE } from "@/app/api/assets/complete/route";
import { POST as CREATE_DATASET } from "@/app/api/datasets/route";
import { DELETE as DELETE_DOC, PATCH as PATCH_DOC } from "@/app/api/docs/[id]/route";
import { POST as RESTORE } from "@/app/api/docs/[id]/restore/route";
import { POST as SNAPSHOT } from "@/app/api/docs/[id]/snapshots/route";
import { POST as SAVE_TEMPLATE } from "@/app/api/format-templates/route";
import { POST as CREATE_DOC } from "@/app/api/projects/[id]/docs/route";
import { DELETE as DELETE_PROJECT, PATCH as PATCH_PROJECT } from "@/app/api/projects/[id]/route";
import { POST as CREATE_PROJECT } from "@/app/api/projects/route";
import { POST as PUBLISH } from "@/app/api/research/route";
import { GET as SEARCH } from "@/app/api/search/route";
import { prisma } from "@/lib/db";
import { withAuthRateLimit } from "@/server/auth-rate-limit";
import { resetRateLimits } from "@/server/rate-limit";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

/** SPEC 9장 "인증·AI·업로드 엔드포인트에 rate limit" + 비용이 큰 엔드포인트·쓰기 엔드포인트 (P8-1). 표는 docs/api-security.md */
const ENV = ["RATE_LIMIT_AUTH_PER_10_MIN", "RATE_LIMIT_SEARCH_PER_MINUTE", "RATE_LIMIT_WRITE_PER_MINUTE", "RATE_LIMIT_UPLOAD_PER_MINUTE"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

function fromIp(ip: string, url: string, method = "GET") {
  return new Request(`http://localhost${url}`, { method, headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
}

async function expect429(res: Response) {
  expect(res.status).toBe(429);
  const body = await res.json();
  expect(body.error.code).toBe("RATE_LIMITED");
  expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
}

beforeEach(async () => {
  await resetRateLimits();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("인증(/api/auth/*): IP당", () => {
  const inner = vi.fn<(req: Request, ctx: unknown) => Promise<Response>>(async () => new Response("ok"));
  const handler = withAuthRateLimit(inner);

  it("로그인 시도(POST)와 콜백(GET)을 세고, 세션 조회 GET은 세지 않는다", async () => {
    process.env.RATE_LIMIT_AUTH_PER_10_MIN = "2";
    inner.mockClear();
    expect((await handler(fromIp("1.1.1.1", "/api/auth/callback/test-login", "POST") as never, {})).status).toBe(200);
    expect((await handler(fromIp("1.1.1.1", "/api/auth/callback/nodemailer?token=x") as never, {})).status).toBe(200);
    await expect429(await handler(fromIp("1.1.1.1", "/api/auth/signin/nodemailer", "POST") as never, {}));
    expect(inner).toHaveBeenCalledTimes(2); // 막힌 요청은 Auth.js까지 가지 않는다
    for (let i = 0; i < 5; i++) expect((await handler(fromIp("1.1.1.1", "/api/auth/session") as never, {})).status).toBe(200);
    // 다른 IP는 따로 센다
    expect((await handler(fromIp("2.2.2.2", "/api/auth/callback/test-login", "POST") as never, {})).status).toBe(200);
  });
});

describe("검색(/api/search, 비로그인 가능): IP당", () => {
  beforeEach(resetDb);

  it("한도를 넘으면 429, 다른 IP는 영향 없음", async () => {
    process.env.RATE_LIMIT_SEARCH_PER_MINUTE = "2";
    const search = (ip: string) => SEARCH(fromIp(ip, `/api/search?q=${encodeURIComponent("음향 블랙홀")}`), undefined);
    expect((await search("3.3.3.3")).status).toBe(200);
    expect((await search("3.3.3.3")).status).toBe(200);
    await expect429(await search("3.3.3.3"));
    expect((await search("4.4.4.4")).status).toBe(200);
  });
});

describe("쓰기·업로드 엔드포인트: 사용자당", () => {
  let user: Awaited<ReturnType<typeof createUser>>;
  let projectId: string;
  let docId: string;

  beforeEach(async () => {
    await resetDb();
    user = await createUser();
    projectId = (await prisma.project.create({ data: { ownerId: user.id, title: "p" } })).id;
    docId = (await prisma.document.create({ data: { projectId, title: "d", contentJson: { type: "doc", content: [] } } })).id;
    loginAs(user);
    process.env.RATE_LIMIT_WRITE_PER_MINUTE = "1";
    process.env.RATE_LIMIT_UPLOAD_PER_MINUTE = "1";
  });

  // 같은 묶음("write")을 공유하는 엔드포인트: 한 번 쓰면 나머지는 모두 429 (검증 전에 막는다)
  const writes: [string, () => Promise<Response>][] = [
    ["POST /api/projects", () => CREATE_PROJECT(jsonRequest("POST", "/api/projects", { title: "x" }), undefined)],
    ["PATCH /api/projects/:id", () => PATCH_PROJECT(jsonRequest("PATCH", "/api/projects/p", {}), ctx({ id: projectId }))],
    ["DELETE /api/projects/:id", () => DELETE_PROJECT(jsonRequest("DELETE", "/api/projects/p"), ctx({ id: projectId }))],
    ["POST /api/projects/:id/docs", () => CREATE_DOC(jsonRequest("POST", "/api/projects/p/docs", {}), ctx({ id: projectId }))],
    ["DELETE /api/docs/:id", () => DELETE_DOC(jsonRequest("DELETE", "/api/docs/d"), ctx({ id: docId }))],
    ["POST /api/docs/:id/snapshots", () => SNAPSHOT(jsonRequest("POST", "/api/docs/d/snapshots"), ctx({ id: docId }))],
    ["POST /api/docs/:id/restore", () => RESTORE(jsonRequest("POST", "/api/docs/d/restore", {}), ctx({ id: docId }))],
    ["POST /api/format-templates", () => SAVE_TEMPLATE(jsonRequest("POST", "/api/format-templates", {}), undefined)],
    ["POST /api/research", () => PUBLISH(jsonRequest("POST", "/api/research", {}), {})],
  ];

  it("프로젝트·문서·스냅샷·서식 템플릿·연구 공개는 함께 한도를 센다", async () => {
    expect((await writes[0][1]()).status).toBe(201);
    for (const [name, call] of writes) {
      const res = await call();
      expect(res.status, name).toBe(429);
    }
  });

  it("문서 자동 저장(PATCH)은 따로 센다", async () => {
    expect((await writes[0][1]()).status).toBe(201);
    const patch = () => PATCH_DOC(jsonRequest("PATCH", "/api/docs/d", { title: "새 제목" }), ctx({ id: docId }));
    expect((await patch()).status).toBe(200);
    await expect429(await patch());
  });

  it("업로드 완료·데이터셋 만들기도 업로드 한도를 쓴다", async () => {
    expect((await COMPLETE(jsonRequest("POST", "/api/assets/complete", {}), undefined)).status).toBe(400);
    await expect429(await COMPLETE(jsonRequest("POST", "/api/assets/complete", {}), undefined));
    expect((await CREATE_DATASET(jsonRequest("POST", "/api/datasets", {}), undefined)).status).toBe(400);
    await expect429(await CREATE_DATASET(jsonRequest("POST", "/api/datasets", {}), undefined));
  });

  it("비로그인은 한도를 쓰지 않고 401", async () => {
    loginAs(null);
    for (let i = 0; i < 3; i++) expect((await writes[0][1]()).status).toBe(401);
  });
});
