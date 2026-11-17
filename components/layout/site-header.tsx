import Link from "next/link";
import { Button } from "@/components/ui/button";
import { appName, messages } from "@/lib/messages";
import { signOut } from "@/server/auth";
import { getCurrentUser } from "@/server/session";

const NAV = [
  { href: "/explore", key: "explore" },
  { href: "/pains", key: "pains" },
  { href: "/projects", key: "projects" },
  { href: "/tools/convert", key: "convert" },
] as const;

export async function SiteHeader() {
  const t = messages.nav;
  const user = await getCurrentUser();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold">
          {appName}
        </Link>
        <nav aria-label={t.label} className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded px-1 py-1 hover:underline">
              {t[item.key]}
            </Link>
          ))}
        </nav>
        {user ? (
          <div className="flex items-center gap-2 text-sm">
            <Link href="/settings" className="hover:underline">
              {user.name || user.email}
            </Link>
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm">
                {t.logout}
              </Button>
            </form>
          </div>
        ) : (
          <Button asChild size="sm">
            <Link href="/login">{t.login}</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
