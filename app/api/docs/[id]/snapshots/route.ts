import { json, requireApiUser, route } from "@/server/api";
import { createSnapshot, listSnapshots } from "@/server/snapshots";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/docs/[id]/snapshots">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  return json({ snapshots: await listSnapshots(user.id, id) });
});

/** 수동 "버전 저장": 현재 서버에 저장된 내용을 스냅샷으로 남긴다. */
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const { id } = await ctx.params;
  return json({ snapshot: await createSnapshot(user.id, id, "MANUAL") }, { status: 201 });
});
