import { prisma } from "@/lib/db";
import { updateProjectSchema } from "@/lib/validation/project";
import { getOwnedProject } from "@/server/access";
import { purgeDate, restoreProject, trashProject } from "@/server/trash";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/projects/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  return json({ project: await getOwnedProject(user.id, id) });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const { id } = await ctx.params;
  const { archived, restore, ...fields } = await parseBody(req, updateProjectSchema);
  if (restore) await restoreProject(user.id, id);
  else await getOwnedProject(user.id, id);
  const project = await prisma.project.update({
    where: { id },
    data: { ...fields, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) },
  });
  return json({ project });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const { id } = await ctx.params;
  const deletedAt = await trashProject(user.id, id);
  return json({ ok: true, purgeAt: purgeDate(deletedAt) });
});
