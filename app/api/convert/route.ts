import { json, route } from "@/server/api";
import { assertServerConversion, conversionView, limitConversions, optionalUser, startConversion } from "@/server/convert";
import { getViewableJob } from "@/server/jobs/jobs";

/**
 * HWP/HWPX → PDF 변환 요청 (multipart `file`). 로그인 없이 쓸 수 있다. 202와 작업 상태를 돌려준다.
 * 서버 변환을 끈 배포(Vercel)에서는 본문을 읽지 않고 501.
 */
export const POST = route(async (req) => {
  assertServerConversion();
  const user = await optionalUser();
  await limitConversions(req, user?.id ?? null);
  const job = await startConversion(req, user?.id ?? null);
  return json({ job: conversionView(await getViewableJob(user?.id ?? null, job.id)) }, { status: 202 });
});
