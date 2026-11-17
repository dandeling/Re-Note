import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { AiClient, AiJsonRequest, AiTurnRequest, AiTurnResult } from "./client";

/**
 * 테스트 전용 가짜 AI (환경변수 AI_FAKE=1, 운영에서는 꺼져 있다 — client.ts의 isFakeAiMode).
 * 실제 API를 부르지 않고, 입력에 따라 정해진 응답을 낸다. Playwright E2E에서
 * 스트리밍·도구 호출·출처 링크·"없음" 답변을 결정적으로 검증하기 위한 것이다.
 *
 * 규칙 (마지막 사용자 메시지 기준)
 * - "연구 있어"  → search_site 호출 → 결과 수에 따라 "N건을 찾았습니다" / "찾지 못했습니다"
 * - "다듬어"     → insert_into_document 제안
 * - "수식"       → suggest_latex, "서식" → suggest_format, "그래프" → suggest_chart
 * - 그 외        → 입력을 되풀이하는 답을 여러 조각으로 스트리밍
 */
const CHUNK_DELAY_MS = 15;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    setTimeout(resolve, ms);
  });
}

function textOf(content: Anthropic.MessageParam["content"]) {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function toolResultTexts(content: Anthropic.MessageParam["content"]) {
  if (typeof content === "string") return [];
  return content.flatMap((b) => (b.type === "tool_result" ? [typeof b.content === "string" ? b.content : ""] : []));
}

function answerFromToolResults(results: string[]) {
  for (const raw of results) {
    try {
      const parsed = JSON.parse(raw) as { result_count?: number; results?: { title: string }[] };
      if (typeof parsed.result_count === "number") {
        if (parsed.result_count === 0) return "사이트에서 관련 연구를 찾지 못했습니다. 이 주제의 자료는 아직 사이트에 없습니다.";
        const titles = (parsed.results ?? []).map((r) => `「${r.title}」`).join(", ");
        return `사이트에서 ${parsed.result_count}건을 찾았습니다: ${titles}`;
      }
    } catch {
      // JSON이 아닌 도구 결과(제안 안내문)는 아래 기본 답으로 처리한다.
    }
  }
  return "제안을 준비했습니다. 삽입 버튼을 누르면 문서에 반영됩니다.";
}

let toolSeq = 0;

export class FakeAiClient implements AiClient {
  async streamTurn(req: AiTurnRequest, onText: (delta: string) => void): Promise<AiTurnResult> {
    const stream = async (text: string) => {
      for (const chunk of text.match(/[\s\S]{1,6}/g) ?? []) {
        await sleep(CHUNK_DELAY_MS, req.signal);
        onText(chunk);
      }
    };
    const last = req.messages.at(-1);
    const results = last ? toolResultTexts(last.content) : [];
    if (results.length > 0) {
      const text = answerFromToolResults(results);
      await stream(text);
      return { stopReason: "end_turn", content: [{ type: "text", text }] };
    }

    const user = last ? textOf(last.content).trim() : "";
    const callTool = async (name: string, input: Record<string, unknown>): Promise<AiTurnResult> => {
      const text = "확인해 볼게요.";
      await stream(text);
      toolSeq += 1;
      return {
        stopReason: "tool_use",
        content: [
          { type: "text", text },
          { type: "tool_use", id: `fake_tool_${toolSeq}`, name, input },
        ],
      };
    };

    if (/연구\s*있어/.test(user)) {
      const query = user.replace(/\s*(관련|에 대한|에 관한)?\s*연구\s*있어.*$/, "").trim() || user;
      return callTool("search_site", { query });
    }
    if (user.includes("다듬어")) {
      const selection = /<selection>\n([\s\S]*?)\n<\/selection>/.exec(req.system)?.[1];
      return callTool("insert_into_document", {
        content: `[다듬은 글] ${selection ?? user}`,
        mode: selection ? "replace_selection" : "insert",
      });
    }
    if (user.includes("수식")) return callTool("suggest_latex", { description: user });
    if (user.includes("서식")) return callTool("suggest_format", { text: user });
    if (user.includes("그래프")) {
      const datasetId = /<datasets>\n- id=(\S+)/.exec(req.system)?.[1];
      if (datasetId) return callTool("suggest_chart", { datasetId });
    }

    const text = `가짜 AI 응답입니다: ${user}`;
    await stream(text);
    return { stopReason: "end_turn", content: [{ type: "text", text }] };
  }

  async generateJson(req: AiJsonRequest): Promise<unknown> {
    const text = textOf(req.content);
    switch (req.task) {
      case "latex": {
        const hasImage = typeof req.content !== "string" && req.content.some((b) => b.type === "image");
        if (hasImage) return { latex: "E = mc^2", display: "block" };
        if (text.includes("근의 공식")) return { latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", display: "block" };
        return { latex: "a^2 + b^2 = c^2", display: "inline" };
      }
      case "format":
        // SPEC 7.3 (d)의 예시 문장("본문 함초롬바탕 10pt, 줄간격 160%, 제목은 가운데 정렬 16pt 굵게")에 대한 결정적 응답
        return {
          body: { font: "함초롬바탕", sizePt: 10, lineHeight: 160 },
          headings: { h1: { sizePt: 16, bold: true, align: "center" } },
        };
      case "chart": {
        let columns: { name: string; type: string; unit: string | null }[] = [];
        try {
          columns = JSON.parse(text.slice(text.indexOf("[")));
        } catch {
          // 열 정보를 읽지 못하면 추천 없음
        }
        const numeric = columns.filter((c) => c.type === "number");
        if (numeric.length === 0) return { suggestions: [] };
        const axis = (c: { name: string; unit: string | null }) => (c.unit ? `${c.name} (${c.unit})` : c.name);
        const [x, y] = numeric;
        return {
          suggestions: y
            ? [{ chartType: "scatter", x: x.name, y: [y.name], errorBar: null, logX: false, logY: false, trendline: true, xTitle: axis(x), yTitle: axis(y), reason: "두 숫자 열의 관계를 보기에 산점도가 알맞습니다." }]
            : [{ chartType: "histogram", x: null, y: [x.name], errorBar: null, logX: false, logY: false, trendline: false, xTitle: axis(x), yTitle: "빈도", reason: "숫자 열 하나의 분포를 보기에 히스토그램이 알맞습니다." }],
        };
      }
    }
  }
}

/**
 * 자동완성용 가짜 응답 (AI_FAKE=1). 커서 앞 텍스트에 따라 정해진 제안을 낸다.
 * - "자동완성 없음"이 들어 있으면 → 빈 제안
 * - 문장이 끝났으면(마침표 등) → 다음 한 문장
 * - 그 외 → 쓰던 문장을 마무리
 */
export const FAKE_AUTOCOMPLETE = {
  nextSentence: "이 결과는 추가 실험으로 확인할 필요가 있다.",
  finishSentence: " 추가 실험으로 확인할 필요가 있다.",
} as const;

export function fakeAutocomplete(before: string): string {
  if (before.includes("자동완성 없음")) return "";
  return /[.!?。]\s*$/.test(before) ? FAKE_AUTOCOMPLETE.nextSentence : FAKE_AUTOCOMPLETE.finishSentence;
}
