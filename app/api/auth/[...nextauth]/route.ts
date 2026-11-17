import { handlers } from "@/server/auth";
import { withAuthRateLimit } from "@/server/auth-rate-limit";

// 로그인 시도(POST, 콜백)는 IP당 rate limit (server/auth-rate-limit.ts)
export const GET = withAuthRateLimit(handlers.GET);
export const POST = withAuthRateLimit(handlers.POST);
