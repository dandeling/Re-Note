import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/api";
import {
  MemoryRateLimitStore,
  rateLimit,
  resetRateLimits,
  setRateLimitStore,
  type RateLimitStore,
} from "@/server/rate-limit";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

afterEach(() => setRateLimitStore(new MemoryRateLimitStore()));

describe("rateLimit", () => {
  it("한도까지는 통과하고 넘으면 RATE_LIMITED(429)", async () => {
    await resetRateLimits();
    const opts = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) await rateLimit("t:a", opts);
    const err = await rateLimit("t:a", opts).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(err.extra.retryAfterSeconds).toBeGreaterThan(0);
    // 키가 다르면 따로 센다.
    await expect(rateLimit("t:b", opts)).resolves.toBeUndefined();
  });

  it("윈도가 지나면 다시 허용한다", async () => {
    let now = 1_000_000;
    setRateLimitStore(new MemoryRateLimitStore(() => now));
    const opts = { limit: 1, windowMs: 1000 };
    await rateLimit("k", opts);
    await expect(rateLimit("k", opts)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    now += 1001;
    await expect(rateLimit("k", opts)).resolves.toBeUndefined();
  });

  it("저장소를 바꿔 끼울 수 있다 (예: Redis)", async () => {
    const calls: string[] = [];
    const fake: RateLimitStore = {
      async hit(key) {
        calls.push(key);
        return { count: 99, resetAt: Date.now() + 5000 };
      },
      async clear() {},
    };
    setRateLimitStore(fake);
    await expect(rateLimit("x", { limit: 10, windowMs: 1000 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls).toEqual(["x"]);
  });
});
