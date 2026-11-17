"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NativeSelect } from "@/components/pains/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { PAIN_LIMITS, PAIN_STAGES, parseTags, type PainStageValue } from "@/lib/validation/pain";

type LinkOption = { id: string; title: string };

export type PainFormInitial = {
  id: string;
  title: string;
  body: string;
  stage: PainStageValue;
  field: string;
  tags: string[];
  projectId: string | null;
  researchId: string | null;
  isAnonymous: boolean;
};

/** 고충 작성(initial 없음) 또는 수정(initial 있음) 폼 */
export function PainForm({
  initial,
  projects,
  researches,
  defaultProjectId,
}: {
  initial?: PainFormInitial;
  projects: LinkOption[];
  researches: LinkOption[];
  defaultProjectId?: string;
}) {
  const t = messages.pains.form;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(initial?.isAnonymous ?? false);
  // 선택지에 없는 기존 연결(예: 휴지통에 간 프로젝트)은 "연결 안 함"으로 보이지만, 사용자가 바꾸지 않으면 그대로 둔다.
  const inOptions = (options: LinkOption[], id: string | null | undefined) =>
    id && options.some((o) => o.id === id) ? id : null;
  const initialProjectId = inOptions(projects, initial ? initial.projectId : defaultProjectId);
  const initialResearchId = inOptions(researches, initial?.researchId);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const projectId = String(form.get("projectId") ?? "") || null;
    const researchId = anonymous ? null : String(form.get("researchId") ?? "") || null;
    const base = {
      title: String(form.get("title") ?? ""),
      body: String(form.get("body") ?? ""),
      stage: String(form.get("stage") ?? "OTHER"),
      field: String(form.get("field") ?? ""),
      tags: parseTags(String(form.get("tags") ?? "")),
      isAnonymous: anonymous,
    };
    setPending(true);
    setError(null);
    try {
      if (initial) {
        // 연결은 바뀐 경우에만 보낸다(선택지에 없는 기존 연결을 실수로 끊지 않도록).
        const body = {
          ...base,
          ...(projectId !== initialProjectId ? { projectId } : {}),
          ...(researchId !== initialResearchId ? { researchId } : {}),
        };
        await api(`/api/pains/${initial.id}`, { method: "PATCH", body });
        router.push(`/pains/${initial.id}`);
        router.refresh();
      } else {
        const { pain } = await api<{ pain: { id: string } }>("/api/pains", {
          method: "POST",
          body: { ...base, projectId, researchId },
        });
        router.push(`/pains/${pain.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pain-title">{t.title}</Label>
        <Input id="pain-title" name="title" required maxLength={PAIN_LIMITS.title} defaultValue={initial?.title} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pain-body">{t.body}</Label>
        <Textarea
          id="pain-body"
          name="body"
          required
          rows={10}
          maxLength={PAIN_LIMITS.body}
          defaultValue={initial?.body}
          aria-describedby="pain-body-help"
          className="min-h-48 font-mono"
        />
        <p id="pain-body-help" className="text-xs text-muted-foreground">
          {t.bodyHelp}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pain-stage">{t.stage}</Label>
          <NativeSelect id="pain-stage" name="stage" defaultValue={initial?.stage ?? "OTHER"}>
            {PAIN_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {messages.pains.stages[stage]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pain-field">{t.field}</Label>
          <Input
            id="pain-field"
            name="field"
            maxLength={PAIN_LIMITS.field}
            placeholder={t.fieldPlaceholder}
            defaultValue={initial?.field}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pain-tags">{t.tags}</Label>
          <Input
            id="pain-tags"
            name="tags"
            placeholder={t.tagsPlaceholder}
            defaultValue={initial?.tags.join(", ")}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            id="pain-anonymous"
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            aria-describedby="pain-anonymous-help"
            className="size-4 accent-[var(--primary)]"
          />
          <Label htmlFor="pain-anonymous">{t.anonymous}</Label>
        </div>
        <p id="pain-anonymous-help" className="text-xs text-muted-foreground">
          {t.anonymousHelp}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pain-project">{t.project}</Label>
          <NativeSelect
            id="pain-project"
            name="projectId"
            defaultValue={initialProjectId ?? ""}
            aria-describedby="pain-project-help"
          >
            <option value="">{t.linkNone}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </NativeSelect>
          <p id="pain-project-help" className="text-xs text-muted-foreground">
            {t.projectHelp}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pain-research">{t.research}</Label>
          <NativeSelect
            id="pain-research"
            name="researchId"
            disabled={anonymous}
            defaultValue={initialResearchId ?? ""}
            aria-describedby="pain-research-help"
          >
            <option value="">{t.linkNone}</option>
            {researches.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </NativeSelect>
          <p id="pain-research-help" className="text-xs text-muted-foreground">
            {t.researchHelp}
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {initial ? t.save : t.create}
        </Button>
        <Button asChild variant="outline">
          <Link href={initial ? `/pains/${initial.id}` : "/pains"}>{t.cancel}</Link>
        </Button>
      </div>
    </form>
  );
}
