import * as React from "react";
import { cn } from "@/lib/utils";

/** 브라우저 기본 select (키보드·스크린리더 지원을 그대로 쓴다). Input과 같은 모양. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
