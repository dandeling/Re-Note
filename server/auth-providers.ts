import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";

type Env = Record<string, string | undefined>;

export const TEST_PROVIDER_ID = "test-login";

const testLoginSchema = z.object({ email: z.string().email().max(254) });

/** 테스트 로그인: 이메일만으로 사용자를 찾거나 만든다. AUTH_TEST_MODE=1일 때만 등록된다. */
export async function authorizeTestLogin(credentials: unknown) {
  const parsed = testLoginSchema.safeParse(credentials);
  if (!parsed.success) return null;
  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0], emailVerified: new Date() },
  });
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}

export function isTestLoginEnabled(env: Env = process.env) {
  return env.AUTH_TEST_MODE === "1";
}

export function isGoogleEnabled(env: Env = process.env) {
  return Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

function isProduction(env: Env) {
  return env.NODE_ENV === "production";
}

/**
 * 메일(매직링크) 로그인 사용 여부. 운영(`NODE_ENV=production`)에서는 `EMAIL_SERVER`가 있어야 켜진다.
 * 로컬 개발에서는 메일 서버 없이도 켜고, 매직링크를 서버 로그에 남긴다.
 */
export function isEmailLoginEnabled(env: Env = process.env) {
  return Boolean(env.EMAIL_SERVER) || !isProduction(env);
}

/** EMAIL_SERVER가 없을 때(개발 전용) 메일 대신 매직링크를 로그에 남긴다. 운영에서는 링크를 절대 로그에 남기지 않는다. */
export function devMagicLinkSender(env: Env = process.env) {
  return async function sendVerificationRequest({ identifier, url }: { identifier: string; url: string }) {
    if (isProduction(env)) {
      // buildProviders가 운영에서는 이 경로를 등록하지 않지만, 혹시 불리더라도 링크(로그인 토큰)를 남기지 않는다.
      log.error("auth.magic_link_unavailable", { reason: "EMAIL_SERVER not configured" });
      throw new Error("EMAIL_SERVER is not configured");
    }
    log.info("auth.magic_link", { email: identifier, url });
  };
}

/** 환경변수에 따라 로그인 제공자를 구성한다. */
export function buildProviders(env: Env = process.env): Provider[] {
  const providers: Provider[] = [];
  if (env.EMAIL_SERVER) {
    providers.push(Nodemailer({ server: env.EMAIL_SERVER, from: env.EMAIL_FROM || "no-reply@localhost" }));
  } else if (isEmailLoginEnabled(env)) {
    providers.push(
      Nodemailer({
        server: { jsonTransport: true },
        from: env.EMAIL_FROM || "no-reply@localhost",
        sendVerificationRequest: devMagicLinkSender(env),
      }),
    );
  } else {
    // 운영인데 메일 서버가 없으면 메일 로그인을 끈다(로그인 화면에서도 숨김).
    log.warn("auth.email_login_disabled", { reason: "EMAIL_SERVER not configured in production" });
  }
  if (isGoogleEnabled(env)) {
    providers.push(Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }));
  }
  if (isTestLoginEnabled(env)) {
    providers.push(
      Credentials({
        id: TEST_PROVIDER_ID,
        name: "Test Login",
        credentials: { email: {} },
        authorize: authorizeTestLogin,
      }),
    );
  }
  return providers;
}
