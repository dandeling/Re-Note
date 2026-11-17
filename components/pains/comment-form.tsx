"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { PAIN_LIMITS } from "@/lib/validation/pain";

export function CommentForm({ painId }: { painId: string }) {
  const t = messages.pains.comments;
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(`/api/pains/${painId}/comments`, { method: "POST", body: { body } });
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Label htmlFor="comment-body">{t.label}</Label>
      <Textarea
        id="comment-body"
        required
        maxLength={PAIN_LIMITS.comment}
        placeholder={t.placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending || body.trim() === ""}>
          {t.submit}
        </Button>
      </div>
    </form>
  );
}
