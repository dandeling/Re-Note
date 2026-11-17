import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { authorizeTestLogin, buildProviders, devMagicLinkSender, isEmailLoginEnabled, TEST_PROVIDER_ID } from "@/server/auth-providers";
import { resetDb } from "../setup/db";

const ids = (env: Record<string, string>) =>
  buildProviders(env).map((p) => (typeof p === "function" ? p().id : (p.options?.id as string) ?? p.id));

describe("로그인 제공자 구성", () => {
  it("기본은 이메일 매직링크만 제공한다", () => {
    expect(ids({})).toEqual(["nodemailer"]);
  });
  it("Google 키가 있으면 Google OAuth를 추가한다", () => {
    expect(ids({ AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "secret" })).toEqual(["nodemailer", "google"]);
  });
  it("테스트 로그인은 AUTH_TEST_MODE=1일 때만 켜진다", () => {
    expect(ids({ AUTH_TEST_MODE: "1" })).toContain(TEST_PROVIDER_ID);
    expect(ids({ AUTH_TEST_MODE: "0" })).not.toContain(TEST_PROVIDER_ID);
  });
});

describe("메일(매직링크) 로그인: 운영에서 링크를 로그에 남기지 않는다", () => {
  const url = "http://localhost/api/auth/callback/nodemailer?token=secret-token-123";

  it("개발(EMAIL_SERVER 없음)에서는 켜지고 매직링크를 로그에 남긴다", async () => {
    const env = { NODE_ENV: "development" };
    expect(isEmailLoginEnabled(env)).toBe(true);
    expect(ids(env)).toContain("nodemailer");
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    await devMagicLinkSender(env)({ identifier: "a@example.com", url });
    expect(info).toHaveBeenCalledWith("auth.magic_link", { email: "a@example.com", url });
    info.mockRestore();
  });

  it("운영에서 EMAIL_SERVER가 없으면 메일 로그인을 끄고, 링크는 어디에도 로그로 남지 않는다", async () => {
    const env = { NODE_ENV: "production" };
    const spies = (["info", "warn", "error"] as const).map((level) => vi.spyOn(log, level).mockImplementation(() => undefined));
    expect(isEmailLoginEnabled(env)).toBe(false);
    expect(ids(env)).toEqual([]);
    expect(ids({ ...env, AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "s" })).toEqual(["google"]);
    await expect(devMagicLinkSender(env)({ identifier: "a@example.com", url })).rejects.toThrow(/EMAIL_SERVER/);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-token-123");
      spy.mockRestore();
    }
  });

  it("운영에서 EMAIL_SERVER가 있으면 실제 메일 발송 제공자를 쓴다", () => {
    const env = { NODE_ENV: "production", EMAIL_SERVER: "smtp://user:pass@smtp.example.com:587" };
    expect(isEmailLoginEnabled(env)).toBe(true);
    expect(ids(env)).toEqual(["nodemailer"]);
  });
});

describe("테스트 로그인", () => {
  beforeEach(resetDb);

  it("같은 이메일은 같은 사용자로 로그인된다", async () => {
    const a = await authorizeTestLogin({ email: "Kim@Example.com" });
    const b = await authorizeTestLogin({ email: "kim@example.com" });
    expect(a?.id).toBeTruthy();
    expect(a?.id).toBe(b?.id);
    expect(await prisma.user.count()).toBe(1);
  });
  it("이메일 형식이 아니면 거부한다", async () => {
    expect(await authorizeTestLogin({ email: "not-an-email" })).toBeNull();
    expect(await authorizeTestLogin({})).toBeNull();
  });
});
