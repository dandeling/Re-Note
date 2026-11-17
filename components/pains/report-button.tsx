"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { PAIN_LIMITS } from "@/lib/validation/pain";

/** 신고 버튼: 누르면 사유(선택) 입력란이 펼쳐진다. 관리자 검토용 플래그만 저장된다. */
export function ReportButton({ painId }: { painId: string }) {
  const t = messages.pains.report;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    setPending(true);
    setError(null);
    try {
      await api(`/api/pains/${painId}/reports`, { method: "POST", body: { reason } });
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t.done}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {t.button}
        </Button>
      </div>
      {open ? (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-60 flex-1 flex-col gap-1.5">
            <Label htmlFor="report-reason">{t.reasonLabel}</Label>
            <Input id="report-reason" name="reason" maxLength={PAIN_LIMITS.reason} autoFocus />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            {t.submit}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
            {t.cancel}
          </Button>
          {error ? (
            <p role="alert" className="w-full text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
