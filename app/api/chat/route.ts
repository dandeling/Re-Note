import { prepareChat, runChat } from "@/lib/ai/chat";
import { getAiClient } from "@/lib/ai/client";
import { aiRateLimit } from "@/lib/ai/quota";
import type { ChatEvent } from "@/lib/ai/shared";
import { defaultSiteSearch } from "@/lib/ai/site-search";
import { log } from "@/lib/log";
import { messages } from "@/lib/messages";
import { chatRequestSchema } from "@/lib/validation/ai";
import { ApiError, parseBody, requireApiUser, route } from "@/server/api";

/**
 * POST /api/chat — SSE 스트리밍 (SPEC 7.4).
 * 스트림을 열기 전의 오류(401·400·404·429·503)는 일반 JSON 에러로, 그 뒤의 오류는 `error` 이벤트로 알린다.
 */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  const input = await parseBody(req, chatRequestSchema);
  await aiRateLimit(user.id);
  const client = getAiClient();
  const session = await prepareChat(user.id, input);

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: ChatEvent) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runChat(session, { client, search: defaultSiteSearch, emit, signal: abort.signal });
      } catch (err) {
        if (!abort.signal.aborted) {
          const apiError = err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR");
          if (!(err instanceof ApiError)) log.error("chat.failed", { threadId: session.threadId, error: String(err) });
          emit({ type: "error", code: apiError.code, message: apiError.message || messages.errors.INTERNAL_ERROR });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // 클라이언트가 먼저 끊은 경우
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
});
