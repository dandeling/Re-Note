import { prisma } from "@/lib/db";
import { auth } from "@/server/auth";

export type SessionUser = { id: string; email?: string | null; name?: string | null };

/**
 * 현재 로그인한 사용자. 비로그인 시 null.
 * 세션이 JWT라서 토큰만으로는 삭제된 계정을 알 수 없다. 사용자 행을 확인해
 * 삭제된 계정의 토큰은 로그인으로 치지 않고, 이름·이메일은 DB의 최신 값을 쓴다.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true },
  });
}
