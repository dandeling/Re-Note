import { ApiError, errorResponse } from "@/server/api";
import { clientIp, RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/**
 * 로그인 시도 rate limit (SPEC 9장 "인증 엔드포인트에 rate limit"). IP당.
 * - Auth.js 라우트(`/api/auth/*`): POST 전부(signin·callback·signout)와 GET 콜백(매직링크·OAuth 확인)만 센다.
 *   세션 조회(GET /api/auth/session 등)는 화면마다 불리므로 세지 않는다.
 * - 로그인 화면의 서버 액션은 `/api/auth`를 거치지 않으므로 `limitLoginAttempt(ip)`를 직접 부른다.
 */
export async function limitLoginAttempt(ip: string) {
  await rateLimit(`auth:${ip}`, RATE_LIMITS.auth());
}

export function isCountedAuthRequest(req: Request) {
  if (req.method === "POST") return true;
  return new URL(req.url).pathname.includes("/api/auth/callback/");
}

type Handler<Ctx> = (req: never, ctx: Ctx) => Promise<Response>;

/** Auth.js 핸들러를 감싸 한도를 넘으면 429 `{ error: { code: "RATE_LIMITED" } }`를 돌려준다. */
export function withAuthRateLimit<Ctx, H extends Handler<Ctx>>(handler: H) {
  return (async (req: Request, ctx: Ctx) => {
    if (isCountedAuthRequest(req)) {
      try {
        await limitLoginAttempt(clientIp(req));
      } catch (err) {
        if (err instanceof ApiError) return errorResponse(err);
        throw err;
      }
    }
    return handler(req as never, ctx);
  }) as unknown as H;
}
