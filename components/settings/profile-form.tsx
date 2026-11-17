"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";

/** 이름 변경 + 로그인 이메일 표시 */
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const t = messages.settings;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setResult(null);
    try {
      await api("/api/account", { method: "PATCH", body: { name: String(form.get("name") ?? "") } });
      setResult({ kind: "ok", text: t.saved });
      router.refresh();
    } catch (err) {
      setResult({ kind: "error", text: err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-name">{t.nameLabel}</Label>
        <Input
          id="settings-name"
          name="name"
          required
          maxLength={50}
          autoComplete="name"
          defaultValue={name}
          aria-describedby="settings-name-help"
        />
        <p id="settings-name-help" className="text-xs text-muted-foreground">
          {t.nameHelp}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-email">{t.emailLabel}</Label>
        <Input
          id="settings-email"
          type="email"
          value={email}
          readOnly
          aria-describedby="settings-email-help"
          className="bg-muted"
        />
        <p id="settings-email-help" className="text-xs text-muted-foreground">
          {t.emailHelp}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t.save}
        </Button>
        {result ? (
          <p
            role={result.kind === "error" ? "alert" : "status"}
            data-testid="settings-profile-result"
            className={result.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
          >
            {result.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
