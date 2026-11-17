import { completeUploadSchema } from "@/lib/validation/asset";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { assetView, completeUpload } from "@/server/assets";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/** 업로드 2단계: 올라온 파일의 실제 크기·매직바이트를 검사하고 Asset을 만든다 */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`upload-complete:${user.id}`, RATE_LIMITS.upload());
  const input = await parseBody(req, completeUploadSchema);
  const asset = await completeUpload(user.id, input);
  return json({ asset: assetView(asset) }, { status: 201 });
});
