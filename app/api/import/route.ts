import { json, requireApiUser, route } from "@/server/api";
import { getImportJob, importView, startImport } from "@/server/importer";

/** 가져오기 요청 (multipart). 항상 새 문서를 만들거나, documentId가 있으면 스냅샷 후 끝에 붙인다. */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  const job = await startImport(req, user.id);
  return json({ job: importView(await getImportJob(user.id, job.id)) }, { status: 202 });
});
