import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { GET as threadsGET } from "@/app/api/chat/threads/route";
import { GET as threadGET } from "@/app/api/chat/threads/[id]/route";
import { defaultSiteSearch } from "@/lib/ai/site-search";
import { NO_RESULT_INSTRUCTION } from "@/lib/ai/tools";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/server/rate-limit";
import { readSse, ScriptedAi, text, toolCall, useAi } from "../setup/ai";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
vi.mock("@/lib/ai/client", async (orig) => (await import("../setup/ai")).aiClientMock(orig));

type User = Awaited<ReturnType<typeof createUser>>;

const paragraph = (value: string) => ({ type: "paragraph", content: [{ type: "text", text: value }] });
const docJson = (...lines: string[]) => ({ type: "doc", content: lines.map(paragraph) });

async function createProjectWithDoc(owner: User, opts: { description?: string; keywords?: string[]; body?: string } = {}) {
  const project = await prisma.project.create({
    data: {
      ownerId: owner.id,
      title: "비밀 프로젝트",
      description: opts.description ?? "",
      keywords: opts.keywords ?? [],
    },
  });
  const document = await prisma.document.create({
    data: { projectId: project.id, title: "보고서", contentJson: docJson(opts.body ?? "본문") },
  });
  return { project, document };
}

async function chat(body: unknown) {
  const res = await POST(jsonRequest("POST", "/api/chat", body), {});
  return res;
}

function toolResults(req: { messages: Anthropic.MessageParam[] }): Anthropic.ToolResultBlockParam[] {
  const last = req.messages.at(-1);
  if (!last || typeof last.content === "string") return [];
  return last.content.flatMap((b): Anthropic.ToolResultBlockParam[] => (b.type === "tool_result" ? [b] : []));
}

describe("POST /api/chat", () => {
  let me: User;
  let other: User;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    await resetDb();
    await resetRateLimits();
    me = await createUser("나");
    other = await createUser("남");
    loginAs(me);
    useAi(null);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("비로그인은 401이고 AI를 부르지 않는다", async () => {
    const ai = new ScriptedAi([text("안녕")]);
    useAi(ai);
    loginAs(null);
    expect((await chat({ message: "안녕" })).status).toBe(401);
    expect((await threadsGET(jsonRequest("GET", "/api/chat/threads"), {})).status).toBe(401);
    expect(ai.turnRequests).toHaveLength(0);
  });

  it("빈 메시지는 400", async () => {
    useAi(new ScriptedAi([text("안녕")]));
    const res = await chat({ message: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("ANTHROPIC_API_KEY가 없으면 503 AI_UNAVAILABLE이고 아무것도 저장하지 않는다", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FAKE;
    process.env.ANTHROPIC_MODEL = "test-model";
    const res = await chat({ message: "안녕" });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("AI_UNAVAILABLE");
    expect(await prisma.chatThread.count()).toBe(0);
    expect(await prisma.aiUsage.count()).toBe(0);
  });

  it("모델 ID(ANTHROPIC_MODEL)가 없어도 503", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.AI_FAKE;
    expect((await chat({ message: "안녕" })).status).toBe(503);
  });

  it("SSE로 스트리밍하고 스레드·메시지를 저장한다", async () => {
    useAi(new ScriptedAi([text("안녕하세요, 무엇을 도와드릴까요?")]));
    const res = await chat({ message: "안녕" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(res);

    expect(events[0]).toMatchObject({ type: "thread", title: "안녕" });
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e) => (e.type === "delta" ? e.text : "")).join("")).toBe("안녕하세요, 무엇을 도와드릴까요?");
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", content: "안녕하세요, 무엇을 도와드릴까요?", citations: [] });

    const thread = await prisma.chatThread.findFirstOrThrow({ include: { messages: { orderBy: { createdAt: "asc" } } } });
    expect(thread.userId).toBe(me.id);
    expect(thread.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "안녕"],
      ["assistant", "안녕하세요, 무엇을 도와드릴까요?"],
    ]);
  });

  it("threadId로 대화를 이어가면 이전 메시지가 모델에 전달된다", async () => {
    const ai = new ScriptedAi([text("첫 답"), text("둘째 답")]);
    useAi(ai);
    const first = await readSse(await chat({ message: "첫 질문" }));
    const threadId = first[0].type === "thread" ? first[0].threadId : "";
    await readSse(await chat({ message: "둘째 질문", threadId }));

    expect(ai.turnRequests[1].messages).toEqual([
      { role: "user", content: "첫 질문" },
      { role: "assistant", content: "첫 답" },
      { role: "user", content: "둘째 질문" },
    ]);
    expect(await prisma.chatThread.count()).toBe(1);
    expect(await prisma.chatMessage.count({ where: { threadId } })).toBe(4);

    const list = await (await threadsGET(jsonRequest("GET", "/api/chat/threads"), {})).json();
    expect(list.threads).toHaveLength(1);
    const detail = await (await threadGET(jsonRequest("GET", `/api/chat/threads/${threadId}`), ctx({ id: threadId }))).json();
    expect(detail.messages.map((m: { content: string }) => m.content)).toEqual(["첫 질문", "첫 답", "둘째 질문", "둘째 답"]);
  });

  it("남의 threadId는 404이고, 남의 스레드에 메시지가 추가되지 않는다", async () => {
    const theirs = await prisma.chatThread.create({
      data: { userId: other.id, title: "남의 대화", messages: { create: { role: "user", content: "남의 비밀 질문" } } },
    });
    const ai = new ScriptedAi([text("답")]);
    useAi(ai);

    const res = await chat({ message: "이어서", threadId: theirs.id });
    expect(res.status).toBe(404);
    expect(ai.turnRequests).toHaveLength(0);
    expect(await prisma.chatMessage.count({ where: { threadId: theirs.id } })).toBe(1);

    const read = await threadGET(jsonRequest("GET", `/api/chat/threads/${theirs.id}`), ctx({ id: theirs.id }));
    expect(read.status).toBe(404);
    const list = await (await threadsGET(jsonRequest("GET", "/api/chat/threads"), {})).json();
    expect(list.threads).toEqual([]);
  });

  it("내 문서 ID를 보내면 문서 내용과 선택 영역이 컨텍스트에 들어간다", async () => {
    const { document } = await createProjectWithDoc(me, { body: "음향 블랙홀의 감쇠 특성을 측정했다." });
    const ai = new ScriptedAi([text("답")]);
    useAi(ai);
    await readSse(await chat({ message: "이 문단 다듬어줘", documentId: document.id, selection: "감쇠 특성" }));

    const system = ai.turnRequests[0].system;
    expect(system).toContain("음향 블랙홀의 감쇠 특성을 측정했다.");
    expect(system).toContain("<selection>\n감쇠 특성\n</selection>");
    const thread = await prisma.chatThread.findFirstOrThrow();
    expect(thread.documentId).toBe(document.id);
  });

  it("내 프로젝트 ID를 보내면 프로젝트 설명·키워드가 컨텍스트에 들어간다", async () => {
    const { project } = await createProjectWithDoc(me, { description: "판의 진동을 줄이는 연구", keywords: ["음향 블랙홀", "감쇠"] });
    const ai = new ScriptedAi([text("답")]);
    useAi(ai);
    await readSse(await chat({ message: "주제 추천해줘", projectId: project.id }));

    const system = ai.turnRequests[0].system;
    expect(system).toContain("판의 진동을 줄이는 연구");
    expect(system).toContain("음향 블랙홀, 감쇠");
  });

  it("남의 문서·프로젝트 ID를 보내면 404이고 내용이 모델에 전달되지 않는다", async () => {
    const theirs = await createProjectWithDoc(other, { description: "남의 비밀 설명", body: "남의 비밀 본문" });
    const ai = new ScriptedAi([text("답"), text("답")]);
    useAi(ai);

    const byDoc = await chat({ message: "요약해줘", documentId: theirs.document.id });
    expect(byDoc.status).toBe(404);
    const byProject = await chat({ message: "요약해줘", projectId: theirs.project.id });
    expect(byProject.status).toBe(404);

    expect(ai.turnRequests).toHaveLength(0);
    expect(await prisma.chatThread.count()).toBe(0);
    // 실패한 요청은 일일 한도를 쓰지 않는다
    expect(await prisma.aiUsage.count()).toBe(0);
  });

  it("휴지통에 있는 내 문서도 컨텍스트로 쓰지 않는다 (404)", async () => {
    const { document } = await createProjectWithDoc(me);
    await prisma.document.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
    useAi(new ScriptedAi([text("답")]));
    expect((await chat({ message: "요약", documentId: document.id })).status).toBe(404);
  });

  it("사용자별 일일 한도(AI_DAILY_LIMIT_PER_USER)를 넘으면 429이고, 다른 사용자는 영향이 없다", async () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "2";
    const ai = new ScriptedAi([text("1"), text("2"), text("3")]);
    useAi(ai);
    expect((await chat({ message: "하나" })).status).toBe(200);
    expect((await chat({ message: "둘" })).status).toBe(200);

    const third = await chat({ message: "셋" });
    expect(third.status).toBe(429);
    const body = await third.json();
    expect(body.error).toMatchObject({ code: "RATE_LIMITED", reason: "DAILY_LIMIT" });
    expect(ai.turnRequests).toHaveLength(2);
    expect(await prisma.aiUsage.count({ where: { userId: me.id } })).toBe(2);

    loginAs(other);
    expect((await chat({ message: "남의 첫 질문" })).status).toBe(200);
  });

  it("어제 사용량은 오늘 한도에 포함하지 않는다", async () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "1";
    await prisma.aiUsage.create({ data: { userId: me.id, kind: "chat", createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    useAi(new ScriptedAi([text("답")]));
    expect((await chat({ message: "오늘 첫 질문" })).status).toBe(200);
  });

  it("짧은 시간에 요청이 몰리면 rate limit으로 429", async () => {
    const ai = new ScriptedAi(Array.from({ length: 20 }, () => text("답")));
    useAi(ai);
    for (let i = 0; i < 20; i++) expect((await chat({ message: `질문 ${i}` })).status).toBe(200);
    const res = await chat({ message: "스물한 번째" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(ai.turnRequests).toHaveLength(20);
  });

  describe("search_site 도구", () => {
    it("검색 결과를 출처 링크로 돌려주고 citationsJson에 저장한다 (익명 작성자 정보 없음)", async () => {
      const research = await prisma.research.create({
        data: { authorId: other.id, title: "음향 블랙홀 진동 감쇠", summary: "쐐기형 판으로 진동을 줄였다.", keywords: ["음향 블랙홀"] },
      });
      const pain = await prisma.painPost.create({
        data: { authorId: other.id, title: "음향 블랙홀 가공이 어려워요", body: "두께를 얇게 깎기 어렵습니다.", isAnonymous: true },
      });
      const ai = new ScriptedAi([toolCall("search_site", { query: "음향 블랙홀" }), text("사이트에서 2건을 찾았습니다.")]);
      useAi(ai);

      const events = await readSse(await chat({ message: "음향 블랙홀 관련 연구 있어?" }));
      expect(events.some((e) => e.type === "tool" && e.name === "search_site")).toBe(true);
      const done = events.at(-1);
      expect(done).toMatchObject({
        type: "done",
        citations: [
          { kind: "research", id: research.id, title: "음향 블랙홀 진동 감쇠", path: `/research/${research.id}` },
          { kind: "pain", id: pain.id, title: "음향 블랙홀 가공이 어려워요", path: `/pains/${pain.id}` },
        ],
      });

      // 모델에 돌려준 도구 결과와 클라이언트로 보낸 이벤트 어디에도 작성자 정보가 없다
      const [result] = toolResults(ai.turnRequests[1]);
      expect(result.is_error).toBeUndefined();
      const payload = JSON.parse(result.content as string);
      expect(payload.result_count).toBe(2);
      const everything = JSON.stringify([events, ai.turnRequests]);
      expect(everything).not.toContain(other.id);
      expect(everything).not.toContain(other.email);
      expect(everything).not.toContain("authorId");

      const saved = await prisma.chatMessage.findFirstOrThrow({ where: { role: "assistant" } });
      expect(saved.citationsJson).toHaveLength(2);
    });

    it("결과가 0건이면 출처가 비어 있고, 도구 결과가 '없다고 답하라'고 지시한다", async () => {
      const ai = new ScriptedAi([toolCall("search_site", { query: "양자 중력" }), text("사이트에는 관련 연구가 없습니다.")]);
      useAi(ai);
      const events = await readSse(await chat({ message: "양자 중력 관련 연구 있어?" }));

      expect(events.some((e) => e.type === "citations")).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: "done", citations: [] });
      const payload = JSON.parse(toolResults(ai.turnRequests[1])[0].content as string);
      expect(payload).toMatchObject({ result_count: 0, results: [], instruction: NO_RESULT_INSTRUCTION });
      const saved = await prisma.chatMessage.findFirstOrThrow({ where: { role: "assistant" } });
      expect(saved.citationsJson).toEqual([]);
    });

    it("시스템 프롬프트가 '사이트에 없는 연구를 있다고 말하지 않는다'를 강제한다", async () => {
      const ai = new ScriptedAi([text("답")]);
      useAi(ai);
      await readSse(await chat({ message: "안녕" }));
      expect(ai.turnRequests[0].system).toContain("사이트에 없는 연구를 있다고 말하지 않습니다");
      expect(ai.turnRequests[0].system).toContain("결과가 0건이면");
      expect(ai.turnRequests[0].tools?.map((t) => t.name)).toEqual([
        "search_site",
        "suggest_latex",
        "suggest_format",
        "suggest_chart",
        "insert_into_document",
      ]);
    });

    it("기본 검색 구현은 작성자 정보를 돌려주지 않는다", async () => {
      await prisma.painPost.create({
        data: { authorId: other.id, title: "실험 장비 대여 고충", body: "장비를 빌리기 어렵습니다.", isAnonymous: true, tags: ["장비"] },
      });
      const found = await defaultSiteSearch("장비");
      expect(found.pains).toHaveLength(1);
      expect(Object.keys(found.pains[0]).sort()).toEqual(["excerpt", "id", "path", "score", "title"]);
      expect(JSON.stringify(found)).not.toContain(other.id);
      expect(await defaultSiteSearch("없는주제어")).toEqual({ research: [], pains: [] });
    });
  });

  describe("제안 도구", () => {
    it("insert_into_document는 제안만 스트리밍하고 문서를 바꾸지 않는다", async () => {
      const { document } = await createProjectWithDoc(me, { body: "원래 문단" });
      const before = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      const ai = new ScriptedAi([
        toolCall("insert_into_document", { content: "다듬은 문단", mode: "replace_selection" }),
        text("제안을 준비했어요. 삽입 버튼을 눌러 주세요."),
      ]);
      useAi(ai);

      const events = await readSse(await chat({ message: "이 문단 다듬어줘", documentId: document.id, selection: "원래 문단" }));
      const suggestion = events.find((e) => e.type === "suggestion");
      expect(suggestion).toMatchObject({
        type: "suggestion",
        suggestion: { payload: { kind: "text", content: "다듬은 문단", mode: "replace_selection" } },
      });

      const after = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      expect(after.contentJson).toEqual(before.contentJson);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(toolResults(ai.turnRequests[1])[0].content).toContain("문서는 바뀌지 않았습니다");
    });

    it("suggest_latex·suggest_format은 제안으로 스트리밍된다", async () => {
      const ai = new ScriptedAi(
        [
          {
            stopReason: "tool_use",
            content: [
              { type: "tool_use", id: "t1", name: "suggest_latex", input: { description: "근의 공식" } },
              { type: "tool_use", id: "t2", name: "suggest_format", input: { text: "본문 10pt" } },
            ],
          },
          text("제안을 준비했어요."),
        ],
        [{ latex: "$x = 1$", display: "inline" }, { body: { sizePt: 10, fontSizePt: 99 } }],
      );
      useAi(ai);
      const events = await readSse(await chat({ message: "근의 공식 수식이랑 서식 만들어줘" }));
      const payloads = events.flatMap((e) => (e.type === "suggestion" ? [e.suggestion.payload] : []));
      expect(payloads).toEqual([
        { kind: "latex", latex: "x = 1", display: "inline" },
        { kind: "format", rules: { body: { sizePt: 10 } } },
      ]);
      // 병렬 도구 호출의 결과는 한 user 메시지에 모두 담아 돌려준다
      expect(toolResults(ai.turnRequests[1]).map((r) => r.tool_use_id)).toEqual(["t1", "t2"]);
    });

    it("suggest_chart에 남의 데이터셋 ID를 넣으면 도구 오류가 되고 열 정보가 새지 않는다", async () => {
      const theirs = await createProjectWithDoc(other);
      const asset = await prisma.asset.create({
        data: { projectId: theirs.project.id, ownerId: other.id, kind: "CSV", storageKey: "k1", filename: "d.csv", size: 1, mime: "text/csv" },
      });
      const dataset = await prisma.dataset.create({
        data: { projectId: theirs.project.id, assetId: asset.id, name: "남의 데이터", columnsJson: [{ name: "비밀열", type: "number" }], rowCount: 3 },
      });
      const ai = new ScriptedAi([toolCall("suggest_chart", { datasetId: dataset.id }), text("해당 자료를 찾을 수 없어요.")]);
      useAi(ai);

      const events = await readSse(await chat({ message: "그래프 추천해줘" }));
      expect(events.some((e) => e.type === "suggestion")).toBe(false);
      const [result] = toolResults(ai.turnRequests[1]);
      expect(result.is_error).toBe(true);
      expect(ai.jsonRequests).toHaveLength(0);
      expect(JSON.stringify([events, ai.turnRequests])).not.toContain("비밀열");
    });

    it("알 수 없는 도구와 잘못된 입력은 도구 오류로 모델에 돌려준다", async () => {
      const ai = new ScriptedAi([
        {
          stopReason: "tool_use",
          content: [
            { type: "tool_use", id: "t1", name: "delete_everything", input: {} },
            { type: "tool_use", id: "t2", name: "search_site", input: { query: 42 } },
          ],
        },
        text("죄송해요."),
      ]);
      useAi(ai);
      const events = await readSse(await chat({ message: "안녕" }));
      expect(events.at(-1)).toMatchObject({ type: "done" });
      expect(toolResults(ai.turnRequests[1]).map((r) => r.is_error)).toEqual([true, true]);
    });

    it("max_tokens로 끊긴 턴의 도구 호출은 실행하지 않는다", async () => {
      const ai = new ScriptedAi([
        {
          stopReason: "max_tokens",
          content: [
            { type: "text", text: "길게 쓰다가" },
            { type: "tool_use", id: "t1", name: "insert_into_document", input: { content: "잘린", mode: "insert" } },
          ],
        },
      ]);
      useAi(ai);
      const events = await readSse(await chat({ message: "길게 써줘" }));
      expect(events.some((e) => e.type === "suggestion")).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: "done", content: "길게 쓰다가" });
    });

    it("refusal이면 안내 문구로 답한다", async () => {
      useAi(new ScriptedAi([{ stopReason: "refusal", content: [] }]));
      const events = await readSse(await chat({ message: "안녕" }));
      expect(events.at(-1)).toMatchObject({ type: "done", content: "이 요청에는 답변할 수 없어요." });
    });
  });

  it("스트리밍 도중 AI가 실패하면 error 이벤트로 알린다", async () => {
    useAi(new ScriptedAi([]));
    const events = await readSse(await chat({ message: "안녕" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "INTERNAL_ERROR" });
    expect(await prisma.chatMessage.count({ where: { role: "assistant" } })).toBe(0);
  });
});
