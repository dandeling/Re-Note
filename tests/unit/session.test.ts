import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/session";
import { createUser, resetDb } from "../setup/db";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ auth: authMock }));

describe("getCurrentUser (JWT 세션 + 사용자 행 확인)", () => {
  beforeEach(resetDb);

  it("세션이 없으면 null", async () => {
    authMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("이름은 토큰이 아니라 DB의 최신 값을 쓴다", async () => {
    const user = await createUser("옛 이름");
    await prisma.user.update({ where: { id: user.id }, data: { name: "새 이름" } });
    authMock.mockResolvedValue({ user: { id: user.id, email: user.email, name: "옛 이름" } });
    expect(await getCurrentUser()).toEqual({ id: user.id, email: user.email, name: "새 이름" });
  });

  it("삭제된 계정의 토큰은 로그인으로 치지 않는다", async () => {
    const user = await createUser();
    authMock.mockResolvedValue({ user: { id: user.id, email: user.email, name: user.name } });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await getCurrentUser()).toBeNull();
  });
});
