import { ConvertTool } from "@/components/convert/convert-tool";
import { maxUploadBytes } from "@/lib/files/types";
import { messages } from "@/lib/messages";

export const metadata = { title: messages.convert.title };

/** HWP → PDF 단독 변환 도구 (SPEC 7.3 a). 로그인 없이 쓸 수 있다. `?job=<작업 ID>`로 진행 중인 작업을 다시 연다. */
export default async function ConvertPage({ searchParams }: PageProps<"/tools/convert">) {
  const { job } = await searchParams;
  const jobId = typeof job === "string" && /^[0-9a-z]{16,64}$/.test(job) ? job : null;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{messages.convert.title}</h1>
        <p className="text-muted-foreground">{messages.convert.intro}</p>
      </header>
      <ConvertTool maxMb={Math.floor(maxUploadBytes() / 1024 / 1024)} initialJobId={jobId} />
    </main>
  );
}
