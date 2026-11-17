import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { validateRulesPatch } from "@/lib/format/patch";
import { log } from "@/lib/log";
import { ApiError } from "@/server/api";
import { getOwnedDatasetColumns, suggestChart, suggestFormatRules, suggestLatex } from "./assist";
import type { AiClient } from "./client";
import type { ChatEvent, Citation, InsertPayload } from "./shared";
import type { SiteSearch } from "./site-search";

/** 챗봇 도구 정의 (SPEC 7.4). */
export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_site",
    description:
      "이 사이트에 공개된 연구와 고충 글을 검색합니다. 사용자가 사이트에 어떤 연구·고충·선행 사례가 있는지 물으면 답하기 전에 반드시 호출합니다. 결과에 없는 연구는 사이트에 없는 것입니다.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "검색할 핵심 키워드 (예: 음향 블랙홀 진동 감쇠)" } },
      required: ["query"],
    },
  },
  {
    name: "suggest_latex",
    description: "자연어 설명을 LaTeX 수식으로 바꿔 사용자에게 삽입 제안으로 보여 줍니다. 문서는 바뀌지 않습니다.",
    input_schema: {
      type: "object",
      properties: { description: { type: "string", description: "수식에 대한 설명 (예: x에 대한 2차 방정식 근의 공식)" } },
      required: ["description"],
    },
  },
  {
    name: "suggest_format",
    description: "자유 텍스트로 된 서식 규칙을 구조화된 서식 규칙 후보로 바꿔 사용자에게 적용 제안으로 보여 줍니다. 문서는 바뀌지 않습니다.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "서식 설명 (예: 본문 10pt, 줄간격 160%)" } },
      required: ["text"],
    },
  },
  {
    name: "suggest_chart",
    description: "프로젝트 데이터셋의 열 정보를 보고 그래프 유형과 축 구성을 추천합니다. 수치는 만들지 않습니다. 컨텍스트에 나온 데이터셋 ID만 쓸 수 있습니다.",
    input_schema: {
      type: "object",
      properties: { datasetId: { type: "string", description: "컨텍스트의 데이터셋 ID" } },
      required: ["datasetId"],
    },
  },
  {
    name: "insert_into_document",
    description:
      "문서에 넣을 글(다듬은 문단, 새 문단 등)을 사용자에게 제안으로 보여 줍니다. 이 도구는 문서를 바꾸지 않습니다. 사용자가 '삽입' 버튼을 눌러야만 반영됩니다. 문서에 넣을 본문만 content에 담고, 설명은 답변에 씁니다.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "문서에 넣을 본문 (일반 텍스트)" },
        mode: {
          type: "string",
          enum: ["replace_selection", "insert"],
          description: "선택 영역을 바꾸는 제안이면 replace_selection, 새로 넣는 제안이면 insert",
        },
      },
      required: ["content", "mode"],
    },
  },
];

const inputSchemas = {
  search_site: z.object({ query: z.string().trim().min(1).max(200) }),
  suggest_latex: z.object({ description: z.string().trim().min(1).max(1000) }),
  suggest_format: z.object({ text: z.string().trim().min(1).max(2000) }),
  suggest_chart: z.object({ datasetId: z.string().min(1).max(64) }),
  insert_into_document: z.object({
    content: z.string().min(1).max(20_000),
    mode: z.enum(["replace_selection", "insert"]),
  }),
};
type ToolName = keyof typeof inputSchemas;

export type ToolContext = {
  userId: string;
  client: AiClient;
  search: SiteSearch;
  emit: (event: ChatEvent) => void;
  /** 이번 답변에서 검색으로 찾은 출처 (경로 기준 중복 제거) */
  citations: Map<string, Citation>;
  signal?: AbortSignal;
};

const SEARCH_LIMIT = 5;
export const NO_RESULT_INSTRUCTION =
  "사이트 내부 검색 결과가 0건입니다. 이 주제의 연구·고충은 사이트에 없다고 답하세요. 사이트에 있는 것처럼 연구나 글을 지어내지 말고, 링크도 만들지 마세요.";
const RESULT_INSTRUCTION =
  "아래 results가 사이트에 있는 자료의 전부입니다. 답변에서는 results에 있는 자료만 제목으로 언급하세요. 출처 링크는 화면에 따로 표시되므로 URL을 직접 쓰지 않아도 됩니다.";
export const PROPOSAL_NOTE =
  "제안이 사용자 화면에 표시되었습니다. 문서는 바뀌지 않았습니다. 사용자가 '삽입' 버튼을 눌러야 반영된다고 안내하세요.";

let suggestionSeq = 0;
function propose(ctx: ToolContext, payload: InsertPayload) {
  suggestionSeq += 1;
  ctx.emit({ type: "suggestion", suggestion: { id: `s${Date.now().toString(36)}${suggestionSeq}`, payload } });
}

async function run(ctx: ToolContext, name: ToolName, rawInput: unknown): Promise<string> {
  switch (name) {
    case "search_site": {
      const { query } = inputSchemas.search_site.parse(rawInput);
      const found = await ctx.search(query, { limit: SEARCH_LIMIT });
      const results = [
        ...found.research.map((r) => ({ type: "research" as const, id: r.id, title: r.title, summary: r.summary, url: r.path })),
        ...found.pains.map((p) => ({ type: "pain" as const, id: p.id, title: p.title, summary: p.excerpt, url: p.path })),
      ];
      for (const r of results) ctx.citations.set(r.url, { kind: r.type, id: r.id, title: r.title, path: r.url });
      if (results.length > 0) ctx.emit({ type: "citations", citations: [...ctx.citations.values()] });
      return JSON.stringify({
        query,
        result_count: results.length,
        results: results.map(({ type, title, summary, url }) => ({ type, title, summary, url })),
        instruction: results.length === 0 ? NO_RESULT_INSTRUCTION : RESULT_INSTRUCTION,
      });
    }
    case "suggest_latex": {
      const { description } = inputSchemas.suggest_latex.parse(rawInput);
      const suggestion = await suggestLatex(ctx.client, { description }, ctx.signal);
      propose(ctx, { kind: "latex", ...suggestion });
      return JSON.stringify({ latex: suggestion.latex, note: PROPOSAL_NOTE });
    }
    case "suggest_format": {
      const { text } = inputSchemas.suggest_format.parse(rawInput);
      const { rules } = await suggestFormatRules(ctx.client, text, validateRulesPatch, ctx.signal);
      propose(ctx, { kind: "format", rules });
      return JSON.stringify({ rules, note: PROPOSAL_NOTE });
    }
    case "suggest_chart": {
      const { datasetId } = inputSchemas.suggest_chart.parse(rawInput);
      // 소유자 검사: 남의 데이터셋 ID면 404가 나고, 아래에서 도구 오류로 바뀐다.
      const dataset = await getOwnedDatasetColumns(ctx.userId, datasetId);
      const suggestions = await suggestChart(ctx.client, dataset, ctx.signal);
      for (const suggestion of suggestions) propose(ctx, { kind: "chart", datasetId: dataset.id, suggestion });
      return JSON.stringify({ suggestions, note: suggestions.length ? PROPOSAL_NOTE : "추천할 그래프 구성을 찾지 못했습니다." });
    }
    case "insert_into_document": {
      const { content, mode } = inputSchemas.insert_into_document.parse(rawInput);
      // 서버는 문서를 건드리지 않는다. 제안만 클라이언트로 보낸다 (자동 반영 금지).
      propose(ctx, { kind: "text", content, mode });
      return PROPOSAL_NOTE;
    }
  }
}

/** 도구 호출 하나를 실행해 tool_result 블록으로 돌려준다. 실패는 is_error로 모델에 알린다. */
export async function executeTool(ctx: ToolContext, block: Anthropic.ToolUseBlockParam): Promise<Anthropic.ToolResultBlockParam> {
  const fail = (content: string): Anthropic.ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    is_error: true,
    content,
  });
  if (!(block.name in inputSchemas)) return fail("알 수 없는 도구입니다.");
  ctx.emit({ type: "tool", name: block.name });
  try {
    return { type: "tool_result", tool_use_id: block.id, content: await run(ctx, block.name as ToolName, block.input) };
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    if (err instanceof z.ZodError) return fail("도구 입력이 올바르지 않습니다.");
    if (err instanceof ApiError) return fail(err.code === "NOT_FOUND" ? "해당 자료를 찾을 수 없습니다." : err.message);
    log.error("ai.tool_failed", { tool: block.name, error: String(err) });
    return fail("도구 실행 중 오류가 발생했습니다.");
  }
}
