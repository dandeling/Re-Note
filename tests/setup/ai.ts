import type { AiClient, AiJsonRequest, AiTurnRequest, AiTurnResult } from "@/lib/ai/client";
import type { ChatEvent } from "@/lib/ai/shared";

/**
 * 통합 테스트용 AI mock. 실제 API는 절대 부르지 않는다.
 * 사용하는 테스트 파일 맨 위에서
 * `vi.mock("@/lib/ai/client", async (orig) => (await import("../setup/ai")).aiClientMock(orig))`를 호출한다.
 * `useAi(null)`이면 실제 `getAiClient`(환경변수 검사 포함)로 넘어간다.
 */
export type Turn = AiTurnResult | ((req: AiTurnRequest) => AiTurnResult);

export class ScriptedAi implements AiClient {
  turnRequests: AiTurnRequest[] = [];
  jsonRequests: AiJsonRequest[] = [];
  constructor(
    private turns: Turn[] = [],
    private jsonReplies: unknown[] = [],
  ) {}

  async streamTurn(req: AiTurnRequest, onText: (delta: string) => void): Promise<AiTurnResult> {
    // 호출 시점의 메시지를 그대로 보관한다 (이후 루프가 배열을 바꿔도 영향이 없게 복사).
    this.turnRequests.push({ ...req, messages: structuredClone(req.messages) });
    const next = this.turns.shift();
    if (!next) throw new Error("ScriptedAi: 준비된 턴이 없습니다.");
    const turn = typeof next === "function" ? next(req) : next;
    for (const block of turn.content) {
      if (block.type !== "text") continue;
      // 두 조각으로 나눠 스트리밍을 흉내 낸다.
      const half = Math.ceil(block.text.length / 2);
      for (const part of [block.text.slice(0, half), block.text.slice(half)]) if (part) onText(part);
    }
    return turn;
  }

  async generateJson(req: AiJsonRequest): Promise<unknown> {
    this.jsonRequests.push(req);
    if (this.jsonReplies.length === 0) throw new Error("ScriptedAi: 준비된 JSON 응답이 없습니다.");
    return this.jsonReplies.shift();
  }
}

export const text = (value: string): AiTurnResult => ({ stopReason: "end_turn", content: [{ type: "text", text: value }] });
export const toolCall = (name: string, input: unknown, id = `tool_${name}`): AiTurnResult => ({
  stopReason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});

let current: AiClient | null = null;
export function useAi(client: AiClient | null) {
  current = client;
}

export async function aiClientMock(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof import("@/lib/ai/client");
  return { ...actual, getAiClient: () => current ?? actual.getAiClient() };
}

/** SSE 응답 본문을 이벤트 배열로 읽는다. */
export async function readSse(res: Response): Promise<ChatEvent[]> {
  const body = await res.text();
  return body
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
}
