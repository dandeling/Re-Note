import { notFound, route } from "@/server/api";
import { readAsset, fileResponse } from "@/server/assets";
import { optionalUser } from "@/server/convert";
import { getViewableJob } from "@/server/jobs/jobs";

type Ctx = RouteContext<"/api/convert/[jobId]/file">;

/** 변환 결과 PDF. 기본은 미리보기(inline), `?download=1`이면 내려받기. */
export const GET = route<Ctx>(async (req, ctx) => {
  const { jobId } = await ctx.params;
  const user = await optionalUser();
  const job = await getViewableJob(user?.id ?? null, jobId);
  if (job.type !== "HWP_TO_PDF" || job.status !== "DONE" || !job.outputAsset) notFound();
  const download = new URL(req.url).searchParams.get("download") === "1";
  return fileResponse(await readAsset(job.outputAsset), { filename: job.outputAsset.filename, mime: job.outputAsset.mime, download });
});
