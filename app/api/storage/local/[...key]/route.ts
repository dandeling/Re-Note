import { maxUploadBytes } from "@/lib/files/types";
import { getStorage, StorageNotFoundError } from "@/lib/storage";
import { verifyLocalSignature } from "@/lib/storage/local";
import { ApiError, json, notFound, route } from "@/server/api";

type Ctx = RouteContext<"/api/storage/local/[...key]">;

/**
 * 로컬 스토리지 드라이버의 presigned URL 엔드포인트 (개발·테스트용).
 * S3 드라이버를 쓸 때는 404다. 서명(HMAC)과 만료 시간이 맞아야만 읽고 쓸 수 있다.
 */
async function authorize(req: Request, ctx: Ctx, method: "GET" | "PUT") {
  const storage = getStorage();
  if (storage.driver !== "local") notFound();
  const key = (await ctx.params).key.join("/");
  const query = new URL(req.url).searchParams;
  if (!verifyLocalSignature(method, key, Number(query.get("exp")), query.get("sig") ?? "")) {
    throw new ApiError("FORBIDDEN");
  }
  return { storage, key };
}

export const PUT = route<Ctx>(async (req, ctx) => {
  const { storage, key } = await authorize(req, ctx, "PUT");
  if (Number(req.headers.get("content-length") ?? 0) > maxUploadBytes()) throw new ApiError("PAYLOAD_TOO_LARGE");
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > maxUploadBytes()) throw new ApiError("PAYLOAD_TOO_LARGE");
  await storage.put(key, body);
  return json({ ok: true });
});

export const GET = route<Ctx>(async (req, ctx) => {
  const { storage, key } = await authorize(req, ctx, "GET");
  try {
    const bytes = await storage.get(key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof StorageNotFoundError) notFound();
    throw err;
  }
});
