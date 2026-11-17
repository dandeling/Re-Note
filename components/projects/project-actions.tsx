"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";

type Action = "archive" | "unarchive" | "delete" | "restore";

/** 프로젝트 보관·보관 해제·삭제(휴지통)·복구 버튼 */
export function ProjectActions({ projectId, actions }: { projectId: string; actions: Action[] }) {
  const t = messages.projects;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action) {
    if (action === "delete" && !window.confirm(t.deleteConfirm)) return;
    setPending(true);
    setError(null);
    try {
      const url = `/api/projects/${projectId}`;
      if (action === "delete") {
        await api(url, { method: "DELETE" });
        router.push("/projects?status=trash");
      } else {
        const body = action === "restore" ? { restore: true } : { archived: action === "archive" };
        await api(url, { method: "PATCH", body });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <Button
          key={action}
          type="button"
          size="sm"
          variant={action === "delete" ? "destructive" : "outline"}
          disabled={pending}
          onClick={() => run(action)}
        >
          {t[action]}
        </Button>
      ))}
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
