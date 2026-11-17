import { deleteAccountSchema, updateAccountSchema } from "@/lib/validation/account";
import { deleteAccount, getAccount, updateAccountName } from "@/server/account";
import { json, parseBody, requireApiUser, route } from "@/server/api";
import { rateLimit } from "@/server/rate-limit";

export const GET = route(async () => {
  const user = await requireApiUser();
  return json({ account: await getAccount(user.id) });
});

export const PATCH = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`account-update:${user.id}`, { limit: 30, windowMs: 60_000 });
  const input = await parseBody(req, updateAccountSchema);
  return json({ account: await updateAccountName(user.id, input.name) });
});

/** 계정 삭제. 본문의 confirmEmail이 로그인 이메일과 같아야 한다. 삭제 후 클라이언트가 로그아웃한다. */
export const DELETE = route(async (req) => {
  const user = await requireApiUser();
  await rateLimit(`account-delete:${user.id}`, { limit: 5, windowMs: 10 * 60_000 });
  const input = await parseBody(req, deleteAccountSchema);
  await deleteAccount(user.id, input.confirmEmail);
  return json({ ok: true });
});
