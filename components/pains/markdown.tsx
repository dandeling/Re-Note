import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/** 사용자 마크다운을 sanitize한 HTML로 보여 준다. 서버 컴포넌트 전용. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div
      className={cn(
        "doc-content break-words leading-7 [&>*+*]:mt-3 [&_a]:text-primary [&_a]:underline [&_li>p]:inline",
        className,
      )}
      // renderMarkdown이 허용 목록 기반으로 sanitize한 결과만 넣는다 (lib/markdown.ts).
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  );
}
