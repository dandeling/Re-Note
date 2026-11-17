import { json, notFound, route } from "@/server/api";
import { conversionView, optionalUser } from "@/server/convert";
import { getViewableJob } from "@/server/jobs/jobs";

type Ctx = RouteContext<"/api/convert/[jobId]">;

/** 변환 진행 상태 (폴링). 익명 작업은 작업 ID를 아는 사람만, 로그인 사용자의 작업은 본인만 조회한다. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { jobId } = await ctx.params;
  const user = await optionalUser();
  const job = await getViewableJob(user?.id ?? null, jobId);
  if (job.type !== "HWP_TO_PDF") notFound();
  return json({ job: conversionView(job) }, { headers: { "cache-control": "no-store" } });
});
