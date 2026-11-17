import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs, log, type LogEntry } from "@/lib/log";
import { ApiError, json, parseBody, requireApiUser, route } from "@/server/api";
import { z } from "zod";
import { jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

let captured: { entries: LogEntry[]; restore: () => void };

beforeEach(() => {
  captured = captureLogs();
  loginAs(null);
});
afterEach(() => captured.restore());

const requests = () => captured.entries.filter((e) => e.msg === "api.request");

describe("구조화 로그", () => {
  it("한 항목에 level, msg, time과 필드가 들어가고 필드가 기본 키를 덮어쓰지 못한다", () => {
    log.warn("something", { a: 1, level: "info", msg: "x" });
    expect(captured.entries).toHaveLength(1);
    const [entry] = captured.entries;
    expect(entry).toMatchObject({ level: "warn", msg: "something", a: 1 });
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
  });

  it("테스트 실행 중에는 콘솔에 아무것도 쓰지 않는다", () => {
    captured.restore();
    const spies = (["log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    log.info("quiet");
    log.error("quiet");
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    captured = captureLogs();
  });
});

describe("API 요청 단위 로그", () => {
  it("메서드, 경로, 상태 코드, 소요 시간, 사용자 id를 남긴다", async () => {
    loginAs({ id: "user_1", email: "a@example.com", name: "가" });
    const handler = route(async () => {
      await requireApiUser();
      return json({ ok: true }, { status: 201 });
    });
    await handler(jsonRequest("POST", "/api/things/abc?token=secret-value"), {});
    expect(requests()).toEqual([
      {
        level: "info",
        msg: "api.request",
        time: expect.any(String),
        method: "POST",
        path: "/api/things/abc",
        status: 201,
        durationMs: expect.any(Number),
        userId: "user_1",
      },
    ]);
    expect(requests()[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("비로그인 요청은 userId가 null이고 4xx는 warn", async () => {
    const handler = route(async () => {
      await requireApiUser();
      return json({});
    });
    await handler(jsonRequest("GET", "/api/private"), {});
    expect(requests()[0]).toMatchObject({ level: "warn", status: 401, userId: null, path: "/api/private" });
  });

  it("ApiError 상태 코드를 그대로 기록한다", async () => {
    loginAs({ id: "user_2" });
    const handler = route(async () => {
      await requireApiUser();
      throw new ApiError("NOT_FOUND");
    });
    await handler(jsonRequest("GET", "/api/x"), {});
    expect(requests()[0]).toMatchObject({ level: "warn", status: 404, userId: "user_2" });
  });

  it("처리하지 못한 예외는 500 error 로그이고, 요청 본문·쿼리·헤더 값은 어느 로그에도 남지 않는다", async () => {
    loginAs({ id: "user_3" });
    const handler = route(async (req) => {
      await requireApiUser();
      await parseBody(req, z.object({ password: z.string() }));
      throw new Error("boom");
    });
    const req = new Request("http://localhost/api/boom?apiKey=query-secret", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=cookie-secret", authorization: "Bearer header-secret" },
      body: JSON.stringify({ password: "body-secret" }),
    });
    const res = await handler(req, {});
    expect(res.status).toBe(500);
    expect(requests()[0]).toMatchObject({ level: "error", status: 500, userId: "user_3", path: "/api/boom" });
    expect(captured.entries.some((e) => e.msg === "api.unhandled")).toBe(true);
    const all = JSON.stringify(captured.entries);
    for (const secret of ["body-secret", "query-secret", "cookie-secret", "header-secret"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("동시에 처리되는 요청의 사용자 id가 섞이지 않는다", async () => {
    const handler = route(async (req) => {
      const id = new URL(req.url).searchParams.get("u")!;
      loginAs({ id });
      await requireApiUser();
      await new Promise((r) => setTimeout(r, id === "slow" ? 60 : 0));
      return json({});
    });
    // 로그인 mock은 전역 값이라, 느린 요청이 사용자 확인을 마친 뒤(아직 처리 중일 때) 빠른 요청을 시작한다.
    const slow = handler(jsonRequest("GET", "/api/a?u=slow"), {});
    await new Promise((r) => setTimeout(r, 5));
    const fast = handler(jsonRequest("GET", "/api/a?u=fast"), {});
    await Promise.all([slow, fast]);
    expect(requests().map((e) => e.userId).sort()).toEqual(["fast", "slow"]);
  });
});
