"use client";

import { MessageCircle, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat-panel";

/** 현재 주소에서 프로젝트·문서 ID를 읽는다 (/projects/:id, /projects/:id/docs/:docId). */
function contextFromPath(pathname: string) {
  const match = /^\/projects\/([^/]+)(?:\/docs\/([^/]+))?/.exec(pathname);
  return { projectId: match?.[2] ? undefined : match?.[1], documentId: match?.[2] };
}

/**
 * 모든 페이지 우측 하단의 플로팅 챗봇 버튼과 대화 창 (SPEC 5장·7.4).
 * 에디터 화면(/projects/:id/docs/:docId)에서는 챗봇이 우측 패널에 고정되므로 플로팅 버튼을 숨긴다.
 */
export function ChatFloating({ loggedIn }: { loggedIn: boolean }) {
  const t = messages.chat;
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const context = contextFromPath(pathname ?? "");

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  if (context.documentId) return null;

  return (
    <>
      {/* 닫아도 대화가 유지되도록 언마운트하지 않고 숨긴다 */}
      <div
        id={panelId}
        role="dialog"
        aria-label={t.title}
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
        className="fixed bottom-20 right-4 z-40 h-[min(36rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-background shadow-xl"
      >
        <ChatPanel
          loggedIn={loggedIn}
          projectId={context.projectId}
          documentId={context.documentId}
          inputRef={inputRef}
          headerActions={
            <Button type="button" variant="ghost" size="icon" aria-label={t.close} onClick={close}>
              <X aria-hidden="true" />
            </Button>
          }
        />
      </div>
      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? t.close : t.open}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          buttonVariants({ size: "icon" }),
          "fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg [&_svg]:size-6",
        )}
      >
        {open ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
      </button>
    </>
  );
}
