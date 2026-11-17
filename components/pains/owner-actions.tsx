"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { PAIN_LIMITS } from "@/lib/validation/pain";

/** 작성자 전용: 수정·삭제, 해결됨 처리(해결 방법 기록)·해결 취소 */
export function OwnerActions({
  painId,
  resolved,
  resolution,
}: {
  painId: string;
  resolved: boolean;
  resolution: string | null;
}) {
  const t = messages.pains;
  const router = useRouter();
  const [text, setText] = useState(resolution ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  const patch = (body: unknown) =>
    run(async () => {
      await api(`/api/pains/${painId}`, { method: "PATCH", body });
      router.refresh();
    });

  function onResolve(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void patch({ resolved: true, resolution: text });
  }

  function onUnresolve() {
    setText("");
    void patch({ resolved: false });
  }

  function onDelete() {
    if (!window.confirm(t.detail.deleteConfirm)) return;
    void run(async () => {
      await api(`/api/pains/${painId}`, { method: "DELETE" });
      router.push("/pains");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onResolve} className="flex flex-col gap-2">
        <Label htmlFor="pain-resolution">{t.resolution.label}</Label>
        <Textarea
          id="pain-resolution"
          required
          maxLength={PAIN_LIMITS.resolution}
          placeholder={t.resolution.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || text.trim() === ""}>
            {resolved ? t.resolution.update : t.resolution.markResolved}
          </Button>
          {resolved ? (
            <Button type="button" variant="outline" disabled={pending} onClick={onUnresolve}>
              {t.resolution.unresolve}
            </Button>
          ) : null}
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/pains/${painId}/edit`}>{t.detail.edit}</Link>
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={onDelete}>
          {t.detail.delete}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
