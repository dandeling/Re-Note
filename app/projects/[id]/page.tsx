import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectPains } from "@/components/pains/project-pains";
import { ProjectDataSection } from "@/components/data/project-data-section";
import { ImportEntry } from "@/components/importer/import-entry";
import { NewDocumentButton } from "@/components/projects/new-document-button";
import { ProjectActions } from "@/components/projects/project-actions";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectRecommendations } from "@/components/research/project-recommendations";
import { ProjectResearchPanel } from "@/components/research/project-research-panel";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { messages } from "@/lib/messages";
import { listProjectDatasets } from "@/server/datasets";
import { listDocuments } from "@/server/documents";
import { requireUser } from "@/server/require-user";

export default async function ProjectHomePage({ params }: PageProps<"/projects/[id]">) {
  const t = messages.projects;
  const { id } = await params;
  const user = await requireUser(`/projects/${id}`);
  // 소유자가 아니거나 휴지통에 있으면 404 (SPEC 7.6)
  const project = await prisma.project.findFirst({ where: { id, ownerId: user.id, deletedAt: null } });
  if (!project) notFound();
  const documents = await listDocuments(project.id);
  const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{project.title}</h1>
          <Badge variant="outline">{t.private}</Badge>
          {project.archivedAt ? <Badge variant="secondary">{t.archivedBadge}</Badge> : null}
        </div>
        {project.description ? <p className="text-muted-foreground">{project.description}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {project.field ? <Badge variant="secondary">{project.field}</Badge> : null}
          {project.keywords.map((k) => (
            <Badge key={k} variant="secondary">
              {k}
            </Badge>
          ))}
        </div>
      </header>
      <section aria-labelledby="project-docs-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="project-docs-heading" className="text-lg font-semibold">
            {messages.docs.heading}
          </h2>
          <NewDocumentButton projectId={project.id} />
          <ImportEntry projectId={project.id} />
        </div>
        {documents.length === 0 ? (
          <p className="text-muted-foreground">{messages.docs.empty}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <Link href={`/projects/${project.id}/docs/${d.id}`} className="font-medium hover:underline">
                  {d.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {messages.docs.updatedAt.replace("{date}", dateFormat.format(d.updatedAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ProjectPains projectId={project.id} ownerId={user.id} />
      <ProjectDataSection projectId={project.id} initial={await listProjectDatasets(project.id)} />
      <ProjectResearchPanel projectId={project.id} />
      <ProjectRecommendations keywords={project.keywords} />
      <section aria-labelledby="project-edit-heading" className="max-w-2xl">
        <h2 id="project-edit-heading" className="mb-3 text-lg font-semibold">
          {t.editHeading}
        </h2>
        <ProjectForm
          initial={{
            id: project.id,
            title: project.title,
            description: project.description,
            field: project.field,
            keywords: project.keywords,
          }}
        />
      </section>
      <section aria-labelledby="project-manage-heading">
        <h2 id="project-manage-heading" className="mb-3 text-lg font-semibold">
          {t.manageHeading}
        </h2>
        <ProjectActions projectId={project.id} actions={[project.archivedAt ? "unarchive" : "archive", "delete"]} />
      </section>
    </main>
  );
}
