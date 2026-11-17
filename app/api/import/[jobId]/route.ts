import { json, requireApiUser, route } from "@/server/api";
import { getImportJob, importView } from "@/server/importer";

type Ctx = RouteContext<"/api/import/[jobId]">;

/** 가져오기 진행 상태 (폴링, 본인만) */
export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const { jobId } = await ctx.params;
  return json({ job: importView(await getImportJob(user.id, jobId)) }, { headers: { "cache-control": "no-store" } });
});
