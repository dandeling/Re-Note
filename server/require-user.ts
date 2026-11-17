import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";

/** 페이지용: 비로그인 시 로그인 화면으로 보낸다. */
export async function requireUser(callbackUrl: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return user;
}
