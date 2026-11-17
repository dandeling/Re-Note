import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { messages } from "@/lib/messages";
import { getStorage } from "@/lib/storage";
import { ApiError, notFound } from "@/server/api";

const accountSelect = { id: true, email: true, name: true, createdAt: true } as const;

export async function getAccount(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: accountSelect });
  return user ?? notFound();
}

export async function updateAccountName(userId: string, name: string) {
  await getAccount(userId);
  return prisma.user.update({ where: { id: userId }, data: { name }, select: accountSelect });
}

/**
 * 계정과 그 사용자의 모든 데이터를 지운다 (SPEC 9장 개인정보).
 *
 * 대부분은 User 삭제의 DB cascade로 사라진다(프로젝트→문서→스냅샷·데이터셋, 자산, 변환 작업, 연구, 고충,
 * 댓글, 반응, 채팅 스레드→메시지, 세션, 계정 연결, 서식 템플릿). cascade가 닿지 않는 것은 여기서 직접 지운다:
 *  - 신고(PainReport.reporter는 SetNull) → 이 사용자가 낸 신고 행
 *  - 소유자·프로젝트가 비어 있는 변환 결과 자산(이 사용자의 변환 작업에만 연결된 것)
 *  - 로그인 링크 토큰(VerificationToken은 이메일로만 연결)
 *  - 스토리지 객체(자산 파일) → DB 삭제가 확정된 뒤 지운다
 */
export async function deleteAccount(userId: string, confirmEmail: string) {
  const user = await getAccount(userId);
  if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new ApiError("VALIDATION_ERROR", messages.settings.deleteEmailMismatch);
  }

  const jobs = await prisma.conversionJob.findMany({
    where: { ownerId: userId },
    select: { inputAssetId: true, outputAssetId: true },
  });
  const jobAssetIds = jobs.flatMap((j) => (j.outputAssetId ? [j.inputAssetId, j.outputAssetId] : [j.inputAssetId]));
  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { project: { ownerId: userId } },
        // 변환 작업에만 달린 자산은 남의 것이 아닐 때만(소유자·프로젝트가 비어 있을 때만) 함께 지운다.
        { id: { in: jobAssetIds }, ownerId: null, projectId: null },
      ],
    },
    select: { id: true, storageKey: true },
  });

  await prisma.$transaction([
    prisma.painReport.deleteMany({ where: { reporterId: userId } }),
    prisma.asset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } }),
    prisma.verificationToken.deleteMany({ where: { identifier: user.email } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  // DB에서 사라진 뒤에 파일을 지운다. 실패해도 계정 삭제는 끝난 것이므로 남은 키만 기록한다.
  const storage = getStorage();
  const failed: string[] = [];
  for (const asset of assets) {
    try {
      await storage.delete(asset.storageKey);
    } catch {
      failed.push(asset.storageKey);
    }
  }
  if (failed.length > 0) log.error("account.delete.storage_orphans", { userId, count: failed.length, keys: failed });
  log.info("account.deleted", { userId, assets: assets.length });
  return { deletedAssets: assets.length, orphanedObjects: failed.length };
}
