import { createProjectSchema, listProjectsQuerySchema } from "@/lib/validation/project";
import { json, parseBody, parseQuery, requireApiUser, route } from "@/server/api";
import { createProject, listProjects } from "@/server/projects";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

export const GET = route(async (req) => {
  const user = await requireApiUser();
  const { status } = parseQuery(req, listProjectsQuerySchema);
  return json({ projects: await listProjects(user.id, status) });
});

export const POST = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`write:${user.id}`, RATE_LIMITS.write());
  const input = await parseBody(req, createProjectSchema);
  return json({ project: await createProject(user.id, input) }, { status: 201 });
});
