"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";

export function NewDocumentButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const { document } = await api<{ document: { id: string } }>(`/api/projects/${projectId}/docs`, {
        method: "POST",
        body: {},
      });
      router.push(`/projects/${projectId}/docs/${document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" onClick={create} disabled={pending}>
        {messages.docs.new}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
