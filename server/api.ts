import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { log } from "@/lib/log";
import { messages } from "@/lib/messages";
import type { SessionUser } from "@/server/session";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "AI_UNAVAILABLE"
  | "NOT_IMPLEMENTED"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  AI_UNAVAILABLE: 503,
  /** 이 배포에서 끈 기능 (예: Vercel에서의 서버 HWP 변환·PDF 내보내기, lib/features.ts) */
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
};

/** API 에러. 응답 형식은 항상 `{ error: { code, message } }` (SPEC 8장). */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message ?? messages.errors[code]);
    this.status = STATUS[code];
  }
}

export function errorResponse(error: ApiError) {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, ...error.extra } },
    { status: error.status },
  );
}

export function notFound(): never {
  throw new ApiError("NOT_FOUND");
}

/** 요청 단위 로그에 남길 값. requireApiUser가 사용자 id를 채운다. */
type RequestContext = { userId?: string };
const requestContext = new AsyncLocalStorage<RequestContext>();

/** 라우트 핸들러 래퍼: 예외를 통일된 에러 응답으로 바꾸고 요청 단위 로그를 남긴다. */
export function route<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const started = performance.now();
    const context: RequestContext = {};
    const res = await requestContext.run(context, () => handle(handler, req, ctx));
    logRequest(req, res.status, performance.now() - started, context.userId);
    return res;
  };
}

async function handle<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>, req: Request, ctx: Ctx) {
  try {
    return await handler(req, ctx);
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.length ? `${first.path.join(".")}: ` : "";
      return errorResponse(
        new ApiError("VALIDATION_ERROR", `${messages.errors.VALIDATION_ERROR} (${where}${first?.message ?? ""})`),
      );
    }
    log.error("api.unhandled", { method: req.method, path: new URL(req.url).pathname, error: String(err) });
    return errorResponse(new ApiError("INTERNAL_ERROR"));
  }
}

/**
 * 메서드, 경로, 상태 코드, 소요 시간(ms), 사용자 id만 남긴다.
 * 쿼리스트링·본문·헤더(쿠키, 토큰)는 비밀 값이 섞일 수 있어 기록하지 않는다.
 */
function logRequest(req: Request, status: number, ms: number, userId: string | undefined) {
  const fields = {
    method: req.method,
    path: new URL(req.url).pathname,
    status,
    durationMs: Math.round(ms),
    userId: userId ?? null,
  };
  if (status >= 500) log.error("api.request", fields);
  else if (status >= 400) log.warn("api.request", fields);
  else log.info("api.request", fields);
}

/** JSON 본문을 읽어 zod 스키마로 검증한다. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", messages.errors.INVALID_JSON);
  }
  return schema.parse(raw);
}

/** 쿼리스트링을 zod 스키마로 검증한다. */
export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

/** 로그인 필수. 비로그인 시 401. */
export async function requireApiUser(): Promise<SessionUser> {
  // 세션(Auth.js)은 필요할 때만 불러온다 — 변환 워커처럼 Next 밖에서 도는 코드도 이 파일(ApiError)을 쓴다.
  const { getCurrentUser } = await import("@/server/session");
  const user = await getCurrentUser();
  if (!user) throw new ApiError("UNAUTHORIZED");
  const context = requestContext.getStore();
  if (context) context.userId = user.id;
  return user;
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
