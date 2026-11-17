"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";

/** "나도 겪었어요" 토글 버튼 (로그인 사용자용). 눌린 상태는 aria-pressed로 알린다. */
export function ReactionButton({ painId, count, reacted }: { painId: string; count: number; reacted: boolean }) {
  const t = messages.pains.reaction;
  const router = useRouter();
  const [state, setState] = useState({ count, reacted });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const res = await api<{ reacted: boolean; meTooCount: number }>(`/api/pains/${painId}/reactions`, {
        method: "POST",
      });
      setState({ count: res.meTooCount, reacted: res.reacted });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant={state.reacted ? "default" : "outline"}
        aria-pressed={state.reacted}
        disabled={pending}
        onClick={toggle}
      >
        {t.meToo}
        <span className="tabular-nums" data-testid="me-too-count">
          {state.count}
        </span>
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
