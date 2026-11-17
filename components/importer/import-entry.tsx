import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/lib/messages";

/** 프로젝트 홈의 "가져오기" 진입점 */
export function ImportEntry({ projectId }: { projectId: string }) {
  return (
    <Link href={`/projects/${projectId}/import`} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {messages.importer.entry}
    </Link>
  );
}
