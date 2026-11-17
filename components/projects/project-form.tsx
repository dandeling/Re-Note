"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { parseKeywords } from "@/lib/validation/project";

type Initial = { id: string; title: string; description: string; field: string; keywords: string[] };

/** 프로젝트 생성(initial 없음) 또는 수정(initial 있음) 폼 */
export function ProjectForm({ initial }: { initial?: Initial }) {
  const t = messages.projects;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      field: String(form.get("field") ?? ""),
      keywords: parseKeywords(String(form.get("keywords") ?? "")),
    };
    setPending(true);
    setError(null);
    try {
      if (initial) {
        await api(`/api/projects/${initial.id}`, { method: "PATCH", body });
        router.refresh();
      } else {
        const { project } = await api<{ project: { id: string } }>("/api/projects", { method: "POST", body });
        router.push(`/projects/${project.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-title">{t.fieldTitle}</Label>
        <Input id="project-title" name="title" required maxLength={200} defaultValue={initial?.title} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-description">{t.fieldDescription}</Label>
        <Textarea id="project-description" name="description" maxLength={5000} defaultValue={initial?.description} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-field">{t.fieldField}</Label>
          <Input id="project-field" name="field" maxLength={100} defaultValue={initial?.field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-keywords">{t.fieldKeywords}</Label>
          <Input
            id="project-keywords"
            name="keywords"
            placeholder={t.keywordsPlaceholder}
            defaultValue={initial?.keywords.join(", ")}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {initial ? t.save : t.create}
        </Button>
      </div>
    </form>
  );
}
