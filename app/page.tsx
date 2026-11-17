import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appName, messages } from "@/lib/messages";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24">
      <h1 className="text-4xl font-bold tracking-tight">{appName}</h1>
      <p className="max-w-xl text-center text-muted-foreground">{messages.common.appTagline}</p>
      <form action="/explore" role="search" className="flex w-full max-w-xl gap-2">
        <Input name="q" aria-label={messages.home.searchLabel} placeholder={messages.home.searchPlaceholder} />
        <Button type="submit">{messages.home.searchButton}</Button>
      </form>
    </main>
  );
}
