import { createDocumentSchema } from "@/lib/validation/document";
import { getOwnedProject } from "@/server/access";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { createDocument, listDocuments } from "@/server/documents";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/projects/[id]/docs">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  await getOwnedProject(user.id, id);
  return json({ documents: await listDocuments(id) });
});

export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const { id } = await ctx.params;
  const input = await parseBody(req, createDocumentSchema);
  return json({ document: await createDocument(user.id, id, input) }, { status: 201 });
});
