import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import { log } from "@/lib/log";
import { messages as t } from "@/lib/messages";
import { ApiError } from "@/server/api";
import { FakeAiClient } from "./fake";

/**
 * AI 호출을 감싸는 얇은 인터페이스 (SPEC 7.4).
 * - API 키와 모델 ID는 서버 환경변수(ANTHROPIC_API_KEY, ANTHROPIC_MODEL)로만 받는다. 모델 ID를 코드에 적지 않는다.
 * - 라우트·도메인 코드는 이 인터페이스에만 의존하고, 테스트에서는 `getAiClient`를 mock으로 바꾼다.
 */
export type AiTurnRequest = {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
  signal?: AbortSignal;
};

export type AiTurnResult = {
  stopReason: Anthropic.StopReason | null;
  /** 모델이 낸 블록 그대로. 도구 결과를 돌려줄 때 수정 없이 assistant 턴으로 다시 보낸다. */
  content: Anthropic.ContentBlockParam[];
};

export type AiJsonTask = "latex" | "format" | "chart";

export type AiJsonRequest = {
  task: AiJsonTask;
  system: string;
  content: Anthropic.MessageParam["content"];
  /** 있으면 구조화 출력으로 강제한다. 없으면 모델이 낸 JSON 텍스트를 파싱한다. */
  schema?: ZodType;
  signal?: AbortSignal;
};

export interface AiClient {
  /** 한 턴을 스트리밍한다. 텍스트 조각은 onText로 전달되고, 끝나면 전체 블록을 돌려준다. */
  streamTurn(req: AiTurnRequest, onText: (delta: string) => void): Promise<AiTurnResult>;
  /** JSON 한 덩어리를 받는다. 반환값은 검증 전의 값이므로 호출하는 쪽에서 zod로 검증한다. */
  generateJson(req: AiJsonRequest): Promise<unknown>;
}

const CHAT_MAX_TOKENS = 32_000;
const JSON_MAX_TOKENS = 16_000;

/** 모델 출력에서 JSON 객체를 꺼낸다 (코드 펜스나 앞뒤 설명이 붙어도 허용). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ApiError("AI_UNAVAILABLE", t.ai.errors.badOutput);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ApiError("AI_UNAVAILABLE", t.ai.errors.badOutput);
  }
}

/** SDK 오류를 API 오류로 바꾸고 실패를 기록한다 (SPEC 9장 관측: AI 작업 실패율). */
function toApiError(err: unknown, op: string): never {
  if (err instanceof ApiError) throw err;
  if (err instanceof Anthropic.APIUserAbortError) throw err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    log.error("ai.failed", { op, reason: "auth", status: err.status });
  } else if (err instanceof Anthropic.RateLimitError) {
    log.warn("ai.failed", { op, reason: "upstream_rate_limit", status: err.status });
  } else if (err instanceof Anthropic.APIConnectionError) {
    log.error("ai.failed", { op, reason: "connection" });
  } else if (err instanceof Anthropic.APIError) {
    log.error("ai.failed", { op, reason: "api", status: err.status, error: err.message });
  } else {
    log.error("ai.failed", { op, reason: "unknown", error: String(err) });
  }
  throw new ApiError("AI_UNAVAILABLE");
}

class AnthropicAiClient implements AiClient {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async streamTurn(req: AiTurnRequest, onText: (delta: string) => void): Promise<AiTurnResult> {
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? CHAT_MAX_TOKENS,
          system: req.system,
          messages: req.messages,
          ...(req.tools?.length ? { tools: req.tools } : {}),
        },
        { signal: req.signal },
      );
      stream.on("text", onText);
      const message = await stream.finalMessage();
      log.info("ai.ok", { op: "chat", stop: message.stop_reason, out: message.usage.output_tokens });
      return { stopReason: message.stop_reason, content: message.content };
    } catch (err) {
      toApiError(err, "chat");
    }
  }

  async generateJson(req: AiJsonRequest): Promise<unknown> {
    try {
      const base = {
        model: this.model,
        max_tokens: JSON_MAX_TOKENS,
        system: req.system,
        messages: [{ role: "user" as const, content: req.content }],
      };
      if (req.schema) {
        const message = await this.client.messages.parse(
          { ...base, output_config: { format: zodOutputFormat(req.schema) } },
          { signal: req.signal },
        );
        if (message.stop_reason === "refusal") throw new ApiError("AI_UNAVAILABLE", t.ai.errors.refused);
        if (message.parsed_output == null) throw new ApiError("AI_UNAVAILABLE", t.ai.errors.badOutput);
        log.info("ai.ok", { op: req.task, out: message.usage.output_tokens });
        return message.parsed_output;
      }
      const message = await this.client.messages.create(base, { signal: req.signal });
      if (message.stop_reason === "refusal") throw new ApiError("AI_UNAVAILABLE", t.ai.errors.refused);
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      log.info("ai.ok", { op: req.task, out: message.usage.output_tokens });
      return extractJson(text);
    } catch (err) {
      toApiError(err, req.task);
    }
  }
}

/** 테스트 전용 가짜 AI 모드. 운영(NODE_ENV=production)에서는 AI_FAKE가 있어도 켜지지 않는다. */
export function isFakeAiMode() {
  return process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production";
}

let sdkCached: { key: string; sdk: Anthropic } | null = null;

/**
 * 모델을 호출하는 쪽이 정하는 SDK 클라이언트 (자동완성 lib/ai/autocomplete.ts가 쓴다).
 * 키를 읽는 곳을 이 파일 하나로 유지한다. 키가 없으면 503 AI_UNAVAILABLE.
 */
export function getAnthropicSdk(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ApiError("AI_UNAVAILABLE", t.ai.errors.notConfigured);
  if (!sdkCached || sdkCached.key !== key) sdkCached = { key, sdk: new Anthropic({ apiKey: key }) };
  return sdkCached.sdk;
}

let cached: { key: string; model: string; client: AiClient } | null = null;

/**
 * AI 클라이언트를 돌려준다. 키나 모델이 설정되지 않았으면 503 AI_UNAVAILABLE.
 */
export function getAiClient(): AiClient {
  if (isFakeAiMode()) return new FakeAiClient();
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;
  if (!key || !model) throw new ApiError("AI_UNAVAILABLE", t.ai.errors.notConfigured);
  if (!cached || cached.key !== key || cached.model !== model) {
    cached = { key, model, client: new AnthropicAiClient(new Anthropic({ apiKey: key }), model) };
  }
  return cached.client;
}
