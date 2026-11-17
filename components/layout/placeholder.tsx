import { messages } from "@/lib/messages";

/** 아직 구현되지 않은 페이지의 골격. 해당 Phase에서 실제 화면으로 교체한다. */
export function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{messages.common.comingSoon}</p>
    </main>
  );
}
