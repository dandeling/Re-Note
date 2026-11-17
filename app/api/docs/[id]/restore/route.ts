import { z } from "zod";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { restoreSnapshot } from "@/server/snapshots";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/docs/[id]/restore">;

const restoreSchema = z.object({ snapshotId: z.string().min(1).max(64) });

export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const { id } = await ctx.params;
  const { snapshotId } = await parseBody(req, restoreSchema);
  return json({ document: await restoreSnapshot(user.id, id, snapshotId) });
});
