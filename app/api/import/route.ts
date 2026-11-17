import { messages } from "@/lib/messages";
import { json, requireApiUser, route } from "@/server/api";
import { assertServerConversion } from "@/server/convert";
import { getImportJob, importView, startImport } from "@/server/importer";

/**
 * 가져오기 요청 (multipart). 항상 새 문서를 만들거나, documentId가 있으면 스냅샷 후 끝에 붙인다.
 * 서버 변환을 끈 배포(Vercel)에서는 501 (로그인 확인 뒤, 본문을 읽기 전).
 */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  assertServerConversion(messages.importer.serverDisabled);
  const job = await startImport(req, user.id);
  return json({ job: importView(await getImportJob(user.id, job.id)) }, { status: 202 });
});
