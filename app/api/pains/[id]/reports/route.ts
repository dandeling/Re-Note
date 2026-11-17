import { createReportSchema } from "@/lib/validation/pain";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { PAIN_RATE_LIMITS, reportPain } from "@/server/pains";
import { rateLimit } from "@/server/rate-limit";

type Ctx = RouteContext<"/api/pains/[id]/reports">;

/** 신고: 관리자 검토용 플래그만 저장한다 (SPEC 7.1). */
export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  await rateLimit(`pains:report:${user.id}`, PAIN_RATE_LIMITS.report);
  const { id } = await ctx.params;
  const { reason } = await parseBody(req, createReportSchema);
  await reportPain(user.id, id, reason);
  return json({ ok: true }, { status: 201 });
});
