import { uploadUrlSchema } from "@/lib/validation/asset";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { createUploadUrl } from "@/server/assets";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/** 업로드 1단계: 확장자·용량·소유자 검사 후 presigned PUT URL 발급 */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`upload:${user.id}`, RATE_LIMITS.upload());
  const input = await parseBody(req, uploadUrlSchema);
  return json(await createUploadUrl(user.id, input));
});
