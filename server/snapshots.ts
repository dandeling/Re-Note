import { prisma } from "@/lib/db";
import type { Prisma, SnapshotReason } from "@/lib/generated/prisma/client";
import { getOwnedDocument } from "@/server/access";
import { notFound } from "@/server/api";

/** 문서당 보관하는 스냅샷 수 (SPEC 7.5) */
export const MAX_SNAPSHOTS = 50;
/** 자동 스냅샷 간격 */
export const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

type Tx = Prisma.TransactionClient;

async function prune(tx: Tx, documentId: string) {
  const old = await tx.documentSnapshot.findMany({
    where: { documentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: MAX_SNAPSHOTS,
    select: { id: true },
  });
  if (old.length) await tx.documentSnapshot.deleteMany({ where: { id: { in: old.map((s) => s.id) } } });
}

/** 트랜잭션 안에서 스냅샷을 남긴다 (가져오기의 "스냅샷 후 삽입"도 쓴다) */
export async function snapshotOf(
  tx: Tx,
  doc: { id: string; contentJson: unknown; version: number },
  reason: SnapshotReason,
) {
  const snapshot = await tx.documentSnapshot.create({
    data: { documentId: doc.id, contentJson: doc.contentJson as Prisma.InputJsonValue, version: doc.version, reason },
    select: { id: true, version: true, reason: true, createdAt: true },
  });
  await prune(tx, doc.id);
  return snapshot;
}

/** 수동 "버전 저장" */
export async function createSnapshot(userId: string, documentId: string, reason: SnapshotReason = "MANUAL") {
  const doc = await getOwnedDocument(userId, documentId);
  return prisma.$transaction((tx) => snapshotOf(tx, doc, reason));
}

export async function listSnapshots(userId: string, documentId: string) {
  await getOwnedDocument(userId, documentId);
  return prisma.documentSnapshot.findMany({
    where: { documentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, version: true, reason: true, createdAt: true },
  });
}

/**
 * 내용 저장 직후 호출: 마지막 스냅샷이 10분보다 오래됐으면(또는 없으면) 자동 스냅샷을 남긴다.
 */
export async function maybeAutoSnapshot(
  doc: { id: string; contentJson: unknown; version: number },
  now = new Date(),
) {
  const last = await prisma.documentSnapshot.findFirst({
    where: { documentId: doc.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && now.getTime() - last.createdAt.getTime() < AUTO_SNAPSHOT_INTERVAL_MS) return null;
  return prisma.$transaction((tx) => snapshotOf(tx, doc, "AUTO"));
}

/**
 * 스냅샷으로 복원한다. 복원 직전의 내용도 스냅샷으로 남겨 되돌릴 수 있게 한다.
 */
export async function restoreSnapshot(userId: string, documentId: string, snapshotId: string) {
  const doc = await getOwnedDocument(userId, documentId);
  const snapshot = await prisma.documentSnapshot.findFirst({ where: { id: snapshotId, documentId } });
  if (!snapshot) notFound();
  return prisma.$transaction(async (tx) => {
    await snapshotOf(tx, doc, "AUTO");
    return tx.document.update({
      where: { id: documentId },
      data: { contentJson: snapshot.contentJson as Prisma.InputJsonValue, version: { increment: 1 } },
    });
  });
}
