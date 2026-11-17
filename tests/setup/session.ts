import { vi } from "vitest";
import type { SessionUser } from "@/server/session";

/**
 * 통합 테스트에서 로그인 사용자를 바꿔 끼운다.
 * 사용하는 테스트 파일 맨 위에서 `vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock)`을 호출한다.
 */
let current: SessionUser | null = null;

export const sessionMock = {
  getCurrentUser: vi.fn(async () => current),
};

export function loginAs(user: { id: string; email?: string | null; name?: string | null } | null) {
  current = user ? { id: user.id, email: user.email ?? null, name: user.name ?? null } : null;
}

export function jsonRequest(method: string, url: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Next 16 라우트 컨텍스트(params는 Promise) */
export function ctx<P extends Record<string, string>>(params: P) {
  return { params: Promise.resolve(params) };
}
