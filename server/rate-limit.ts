import { ApiError } from "@/server/api";

/**
 * 공용 rate limit (SPEC 9장).
 *
 * 사용법: `await rateLimit(`pains:create:${user.id}`, { limit: 10, windowMs: 10 * 60_000 })`
 * 한도를 넘으면 `ApiError("RATE_LIMITED")`(429)를 던진다.
 *
 * 기본 저장소는 프로세스 메모리(고정 윈도)다. 서버를 여러 대로 늘리면
 * `setRateLimitStore()`로 Redis 구현(INCR + PEXPIRE)을 끼워 넣는다.
 */
export type RateLimitOptions = { limit: number; windowMs: number };

export interface RateLimitStore {
  /** key의 카운터를 1 올리고, 현재 윈도의 누적 횟수와 윈도가 끝나는 시각(ms)을 돌려준다. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  /** 모든 카운터를 지운다 (테스트용). */
  clear(): Promise<void>;
}

const MAX_KEYS = 50_000;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async hit(key: string, windowMs: number) {
    const now = this.now();
    const current = this.windows.get(key);
    if (current && current.resetAt > now) {
      current.count += 1;
      return { ...current };
    }
    if (this.windows.size >= MAX_KEYS) this.prune(now);
    const fresh = { count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    return { ...fresh };
  }

  async clear() {
    this.windows.clear();
  }

  private prune(now: number) {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
    // 만료된 것이 없는데도 가득 찼다면 가장 오래된 키부터 버린다.
    for (const key of this.windows.keys()) {
      if (this.windows.size < MAX_KEYS) break;
      this.windows.delete(key);
    }
  }
}

// next dev의 모듈 재평가에도 카운터가 유지되도록 globalThis에 둔다.
const holder = globalThis as unknown as { __rateLimitStore?: RateLimitStore };

export function getRateLimitStore(): RateLimitStore {
  holder.__rateLimitStore ??= new MemoryRateLimitStore();
  return holder.__rateLimitStore;
}

export function setRateLimitStore(store: RateLimitStore) {
  holder.__rateLimitStore = store;
}

export async function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): Promise<void> {
  const { count, resetAt } = await getRateLimitStore().hit(key, windowMs);
  if (count > limit) {
    throw new ApiError("RATE_LIMITED", undefined, {
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    });
  }
}

/** 테스트용: 모든 카운터 초기화 */
export async function resetRateLimits() {
  await getRateLimitStore().clear();
}

/** `RateLimitOptions`의 다른 이름 (변환·업로드 쪽 코드가 쓴다) */
export type RateLimitRule = RateLimitOptions;

/** 프록시 뒤에서는 X-Forwarded-For의 첫 주소를 쓴다. */
export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

/** 환경변수로 한도를 바꿀 수 있는 규칙 */
export function ruleFromEnv(name: string, fallback: RateLimitRule): RateLimitRule {
  const limit = Number(process.env[name]);
  return Number.isFinite(limit) && limit > 0 ? { ...fallback, limit } : fallback;
}

const MINUTE = 60_000;

/**
 * 엔드포인트 묶음별 기본 한도 (SPEC 9장, docs/api-security.md 표).
 * 호출할 때마다 환경변수를 읽으므로 테스트·운영에서 한도를 바꿀 수 있다.
 * 고충(PAIN_RATE_LIMITS)과 AI(lib/ai/quota.ts)는 각자 정의한다.
 */
export const RATE_LIMITS = {
  /** 로그인 시도(Auth.js POST, 콜백, 로그인 화면의 서버 액션): IP당 */
  auth: () => ruleFromEnv("RATE_LIMIT_AUTH_PER_10_MIN", { limit: 30, windowMs: 10 * MINUTE }),
  /** 사이트 검색(비로그인 가능): IP당 */
  search: () => ruleFromEnv("RATE_LIMIT_SEARCH_PER_MINUTE", { limit: 60, windowMs: MINUTE }),
  /** 업로드(presigned URL 발급, 완료 처리, 데이터셋 만들기): 사용자당 */
  upload: () => ruleFromEnv("RATE_LIMIT_UPLOAD_PER_MINUTE", { limit: 60, windowMs: MINUTE }),
  /** 문서 내보내기(PDF는 Chromium 실행): 사용자당 */
  export: () => ruleFromEnv("RATE_LIMIT_EXPORT_PER_MINUTE", { limit: 10, windowMs: MINUTE }),
  /** 그 밖의 쓰기(프로젝트·문서·스냅샷·연구 공개·서식 템플릿·챗 스레드): 사용자당 */
  write: () => ruleFromEnv("RATE_LIMIT_WRITE_PER_MINUTE", { limit: 120, windowMs: MINUTE }),
} satisfies Record<string, () => RateLimitRule>;
