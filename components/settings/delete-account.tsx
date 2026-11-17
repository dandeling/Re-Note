"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { messages } from "@/lib/messages";

/** 계정 삭제: 로그인 이메일을 다시 입력해야 버튼이 켜지고, 삭제 후 로그아웃한다. */
export function DeleteAccount({ email }: { email: string }) {
  const t = messages.settings;
  const router = useRouter();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!matches) {
      setError(t.deleteEmailMismatch);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api("/api/account", { method: "DELETE", body: { confirmEmail } });
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
      setPending(false);
      return;
    }
    // 계정은 이미 없다. 세션 쿠키를 지우고 홈으로 보낸다(쿠키 삭제가 실패해도 서버는 이 세션을 받지 않는다).
    try {
      await signOut({ redirectTo: "/" });
    } catch {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm">{t.deleteWarning}</p>
      <p className="text-sm text-muted-foreground">{t.deleteOthersNotice}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-delete-confirm" className="leading-normal">
          {t.deleteConfirmLabel.replace("{email}", email)}
        </Label>
        <Input
          id="settings-delete-confirm"
          type="email"
          autoComplete="off"
          value={confirmEmail}
          onChange={(e) => {
            setConfirmEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "settings-delete-error" : undefined}
        />
      </div>
      {error ? (
        <p id="settings-delete-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="destructive" disabled={pending || !matches}>
          {pending ? t.deleting : t.deleteButton}
        </Button>
      </div>
    </form>
  );
}
