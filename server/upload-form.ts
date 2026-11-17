import { maxUploadBytes } from "@/lib/files/types";
import { messages } from "@/lib/messages";
import { assetFilenameSchema } from "@/lib/validation/asset";
import { ApiError } from "@/server/api";

/** multipart 본문의 경계·필드 이름 등에 쓰이는 여유분 */
const FORM_OVERHEAD = 64 * 1024;

function tooLarge(): never {
  throw new ApiError("PAYLOAD_TOO_LARGE", messages.assets.tooLarge.replace("{mb}", String(Math.floor(maxUploadBytes() / 1024 / 1024))));
}

/**
 * multipart/form-data 요청에서 파일 하나를 읽는다 (서버가 바이트를 직접 받는 업로드: /api/convert, /api/import).
 * 본문을 읽기 전에 Content-Length로 MAX_UPLOAD_MB를 먼저 확인한다. 확장자·매직바이트 검사는
 * `createAssetFromBytes()`가 한다.
 */
export async function readUploadedFile(req: Request, field = "file"): Promise<{ filename: string; bytes: Uint8Array; form: FormData }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxUploadBytes() + FORM_OVERHEAD) tooLarge();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("VALIDATION_ERROR", messages.assets.fileRequired);
  }
  const file = form.get(field);
  if (!file || typeof file === "string") throw new ApiError("VALIDATION_ERROR", messages.assets.fileRequired);
  if (file.size > maxUploadBytes()) tooLarge();
  const filename = assetFilenameSchema.parse(file.name);
  return { filename, bytes: new Uint8Array(await file.arrayBuffer()), form };
}
