import type { Metadata } from "next";
import { BrowserConvertTool } from "@/components/convert/browser-convert-tool";
import { ConvertTool } from "@/components/convert/convert-tool";
import { serverConversionEnabled } from "@/lib/features";
import { maxUploadBytes } from "@/lib/files/types";
import { MAX_FILE } from "@/lib/hwp-browser";
import { hwpBrowserText } from "@/lib/hwp-browser/ui-text";
import { messages } from "@/lib/messages";
import { listProjects } from "@/server/projects";
import { getCurrentUser } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: serverConversionEnabled() ? messages.convert.title : hwpBrowserText.convert.title };
}

/**
 * 한글 파일 도구. 로그인 없이 쓸 수 있다.
 * - 서버 변환을 켠 배포: HWP → PDF 변환(SPEC 7.3 a). `?job=<작업 ID>`로 진행 중인 작업을 다시 연다.
 * - 끈 배포(Vercel 등, lib/features.ts): 브라우저에서 파일을 읽어 미리 보여 주고, 로그인했으면 내 프로젝트로 가져온다.
 */
export default async function ConvertPage({ searchParams }: PageProps<"/tools/convert">) {
  if (!serverConversionEnabled()) {
    const user = await getCurrentUser();
    const projects = user ? (await listProjects(user.id)).map((p) => ({ id: p.id, title: p.title })) : [];
    const t = hwpBrowserText.convert;
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground">{t.intro}</p>
        </header>
        <BrowserConvertTool maxMb={Math.floor(Math.min(maxUploadBytes(), MAX_FILE) / 1024 / 1024)} loggedIn={Boolean(user)} projects={projects} />
      </main>
    );
  }

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
