import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { messages } from "@/lib/messages";
import { signIn } from "@/server/auth";
import { isEmailLoginEnabled, isGoogleEnabled, isTestLoginEnabled, TEST_PROVIDER_ID } from "@/server/auth-providers";
import { limitLoginAttempt } from "@/server/auth-rate-limit";
import { clientIp } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

const inputClass = "w-full rounded-md border border-zinc-300 px-3 py-2";
const buttonClass = "w-full rounded-md bg-zinc-900 px-4 py-2 text-white";

/** 서버 액션은 /api/auth를 거치지 않으므로 로그인 시도 한도를 여기서 센다. 넘으면 오류 표시로 돌려보낸다. */
async function guardLoginAttempt() {
  const ip = clientIp(new Request("http://local/", { headers: await headers() }));
  try {
    await limitLoginAttempt(ip);
  } catch {
    redirect("/login?error=RateLimited");
  }
}

function safeRedirect(value: string | string[] | undefined) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/projects";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = messages.login;
  const params = await searchParams;
  const redirectTo = safeRedirect(params.callbackUrl);
  if (await getCurrentUser()) redirect(redirectTo);

  async function emailLogin(formData: FormData) {
    "use server";
    await guardLoginAttempt();
    await signIn("nodemailer", { email: String(formData.get("email") ?? ""), redirectTo });
  }
  async function googleLogin() {
    "use server";
    await signIn("google", { redirectTo });
  }
  async function testLogin(formData: FormData) {
    "use server";
    await guardLoginAttempt();
    await signIn(TEST_PROVIDER_ID, { email: String(formData.get("email") ?? ""), redirectTo });
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      {params.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {t.error}
        </p>
      ) : null}
      {isEmailLoginEnabled() ? (
      <form action={emailLogin} className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          {t.emailLabel}
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        <button type="submit" className={buttonClass}>
          {t.emailButton}
        </button>
      </form>
      ) : null}
      {isGoogleEnabled() ? (
        <form action={googleLogin}>
          <button type="submit" className="w-full rounded-md border border-zinc-300 px-4 py-2">
            {t.googleButton}
          </button>
        </form>
      ) : null}
      {isTestLoginEnabled() ? (
        <form action={testLogin} className="flex flex-col gap-2 border-t border-dashed border-zinc-300 pt-4">
          <label htmlFor="test-email" className="text-sm font-medium">
            {t.testLabel}
          </label>
          <input id="test-email" name="email" type="email" required className={inputClass} />
          <button type="submit" className={buttonClass}>
            {t.testButton}
          </button>
        </form>
      ) : null}
    </main>
  );
}
