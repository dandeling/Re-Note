import Link from "next/link";
import { messages } from "@/lib/messages";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start gap-3 px-4 py-16">
      <h1 className="text-2xl font-bold">{messages.common.notFoundTitle}</h1>
      <p className="text-muted-foreground">{messages.common.notFoundBody}</p>
      <Link href="/" className="text-primary underline">
        {messages.common.goHome}
      </Link>
    </main>
  );
}
