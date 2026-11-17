import Link from "next/link";
import { NavLinks } from "@/components/layout/nav-links";
import { Button } from "@/components/ui/button";
import { appName, messages } from "@/lib/messages";
import { signOut } from "@/server/auth";
import { getCurrentUser } from "@/server/session";

/** 상단 메뉴: 아티팩트판(artifact/index.html)과 같은 네 항목 */
const NAV = [
  { href: "/explore", key: "explore" },
  { href: "/pains", key: "pains" },
  { href: "/projects", key: "projects" },
  { href: "/tools/convert", key: "convert" },
] as const;

/** "Re: Note" → Re + 강조한 : + Note (앱 이름에 : 나 ;가 없으면 그대로) */
function Brand() {
  const i = appName.search(/[:;]/);
  if (i < 0) return <>{appName}</>;
  return (
    <>
      {appName.slice(0, i)}
      <span className="text-primary">{appName[i]}</span>
      {appName.slice(i + 1)}
    </>
  );
}

export async function SiteHeader() {
  const t = messages.nav;
  const user = await getCurrentUser();
  const items = NAV.map((item) => ({ href: item.href, label: t[item.key] }));

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" aria-label={appName} className="text-xl font-bold tracking-tight">
          <Brand />
        </Link>
        <nav
          aria-label={t.label}
          className="order-3 -mx-1 flex w-full items-center gap-0.5 overflow-x-auto text-sm sm:order-none sm:mx-0 sm:w-auto sm:flex-1"
        >
          <NavLinks items={items} />
        </nav>
        {user ? (
          <div className="ml-auto flex items-center gap-2 text-sm">
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
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href="/login">{t.login}</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
