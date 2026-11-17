import { messages } from "@/lib/messages";

export default function VerifyRequestPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="text-2xl font-bold">{messages.login.verifyTitle}</h1>
      <p className="text-zinc-600">{messages.login.verifyBody}</p>
    </main>
  );
}
