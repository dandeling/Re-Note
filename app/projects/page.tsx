import Link from "next/link";
import { ProjectActions } from "@/components/projects/project-actions";
import { ProjectForm } from "@/components/projects/project-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { listProjectsQuerySchema } from "@/lib/validation/project";
import { listProjects } from "@/server/projects";
import { requireUser } from "@/server/require-user";
import { purgeDate } from "@/server/trash";

export const metadata = { title: messages.nav.projects };

const TABS = [
  { status: "active", label: "tabActive" },
  { status: "archived", label: "tabArchived" },
  { status: "trash", label: "tabTrash" },
] as const;

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const t = messages.projects;
  const user = await requireUser("/projects");
  const parsed = listProjectsQuerySchema.safeParse(await searchParams);
  const status = parsed.success ? parsed.data.status : "active";
  const projects = await listProjects(user.id, status);
  const emptyText = status === "trash" ? t.emptyTrash : status === "archived" ? t.emptyArchived : t.empty;
  const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10">
      <h1 className="text-2xl font-bold">{messages.nav.projects}</h1>
      <nav aria-label={t.listHeading} className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            href={tab.status === "active" ? "/projects" : `/projects?status=${tab.status}`}
            aria-current={status === tab.status ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              status === tab.status ? "border-primary font-semibold" : "border-transparent text-muted-foreground",
            )}
          >
            {t[tab.label]}
          </Link>
        ))}
      </nav>
      <section aria-labelledby="project-list-heading" className="flex flex-col gap-3">
        <h2 id="project-list-heading" className="sr-only">
          {t.listHeading}
        </h2>
        {status === "trash" ? <p className="text-sm text-muted-foreground">{t.trashNotice}</p> : null}
        {projects.length === 0 ? (
          <p className="text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>
                      {status === "trash" ? (
                        p.title
                      ) : (
                        <Link href={`/projects/${p.id}`} className="hover:underline">
                          {p.title}
                        </Link>
                      )}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">{p.description || t.noDescription}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{t.docCount.replace("{n}", String(p._count.documents))}</span>
                      {p.keywords.map((k) => (
                        <Badge key={k} variant="secondary">
                          {k}
                        </Badge>
                      ))}
                    </div>
                    {status === "trash" && p.deletedAt ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {t.purgeAt.replace("{date}", dateFormat.format(purgeDate(p.deletedAt)))}
                        </p>
                        <ProjectActions projectId={p.id} actions={["restore"]} />
                      </>
                    ) : null}
                    {status === "archived" ? <ProjectActions projectId={p.id} actions={["unarchive"]} /> : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      {status === "active" ? (
        <section aria-labelledby="project-new-heading" className="max-w-2xl">
          <h2 id="project-new-heading" className="mb-3 text-lg font-semibold">
            {t.newHeading}
          </h2>
          <ProjectForm />
        </section>
      ) : null}
    </main>
  );
}
