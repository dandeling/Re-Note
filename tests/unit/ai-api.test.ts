import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chartPOST } from "@/app/api/ai/chart-suggest/route";
import { POST as formatPOST } from "@/app/api/ai/format/route";
import { POST as latexPOST } from "@/app/api/ai/latex/route";
import { chartSuggestionSchema, suggestFormatRules } from "@/lib/ai/assist";
import { extractJson, getAiClient, isFakeAiMode } from "@/lib/ai/client";
import { FakeAiClient } from "@/lib/ai/fake";
import { defaultChartConfig } from "@/lib/data/chart";
import { firstApplicableSuggestion, type ChartSuggestResponse } from "@/lib/data/chart-suggestion";
import { prisma } from "@/lib/db";
import { ApiError } from "@/server/api";
import { rateLimit, resetRateLimits } from "@/server/rate-limit";
import { ScriptedAi, useAi } from "../setup/ai";
import { createUser, resetDb } from "../setup/db";
import { jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
vi.mock("@/lib/ai/client", async (orig) => (await import("../setup/ai")).aiClientMock(orig));

type User = Awaited<ReturnType<typeof createUser>>;

const latex = (body: unknown) => latexPOST(jsonRequest("POST", "/api/ai/latex", body), {});
const format = (body: unknown) => formatPOST(jsonRequest("POST", "/api/ai/format", body), {});
const chart = (body: unknown) => chartPOST(jsonRequest("POST", "/api/ai/chart-suggest", body), {});

// 1x1 PNG
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function createDataset(owner: User, columns: unknown, rowCount = 12) {
  const project = await prisma.project.create({ data: { ownerId: owner.id, title: "실험" } });
  const asset = await prisma.asset.create({
    data: { projectId: project.id, ownerId: owner.id, kind: "CSV", storageKey: `k-${project.id}`, filename: "d.csv", size: 1, mime: "text/csv" },
  });
  return prisma.dataset.create({ data: { projectId: project.id, assetId: asset.id, name: "감쇠 측정", columnsJson: columns as object, rowCount } });
}

const COLUMNS = [
  { name: "주파수", type: "number", unit: "Hz" },
  { name: "감쇠율", type: "number", unit: "dB" },
  { name: "시료", type: "string", unit: null },
];
const scatter = {
  chartType: "scatter",
  x: "주파수",
  y: ["감쇠율"],
  errorBar: null,
  logX: true,
  logY: false,
  trendline: true,
  xTitle: "주파수 (Hz)",
  yTitle: "감쇠율 (dB)",
  reason: "두 숫자 열의 관계를 봅니다.",
};

describe("AI 보조 API", () => {
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

  it("세 엔드포인트 모두 비로그인은 401이고 AI를 부르지 않는다", async () => {
    const ai = new ScriptedAi([], [{}, {}, {}]);
    useAi(ai);
    loginAs(null);
    expect((await latex({ description: "근의 공식" })).status).toBe(401);
    expect((await format({ text: "본문 10pt" })).status).toBe(401);
    expect((await chart({ datasetId: "x" })).status).toBe(401);
    expect(ai.jsonRequests).toHaveLength(0);
  });

  it("API 키가 없으면 세 엔드포인트 모두 503 AI_UNAVAILABLE", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FAKE;
    const dataset = await createDataset(me, COLUMNS);
    for (const res of [await latex({ description: "근의 공식" }), await format({ text: "본문 10pt" }), await chart({ datasetId: dataset.id })]) {
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("AI_UNAVAILABLE");
    }
    expect(await prisma.aiUsage.count()).toBe(0);
  });

  it("일일 한도는 챗봇·보조 API가 함께 쓴다", async () => {
    process.env.AI_DAILY_LIMIT_PER_USER = "2";
    useAi(new ScriptedAi([], [{ latex: "x", display: "inline" }, { body: { sizePt: 10 } }, { latex: "y", display: "inline" }]));
    expect((await latex({ description: "하나" })).status).toBe(200);
    expect((await format({ text: "둘" })).status).toBe(200);
    const res = await latex({ description: "셋" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.reason).toBe("DAILY_LIMIT");
  });

  it("rate limit: 1분에 20회를 넘으면 429", async () => {
    useAi(new ScriptedAi([], Array.from({ length: 20 }, () => ({ latex: "x", display: "inline" }))));
    for (let i = 0; i < 20; i++) expect((await latex({ description: `식 ${i}` })).status).toBe(200);
    expect((await latex({ description: "하나 더" })).status).toBe(429);
  });

  describe("POST /api/ai/latex", () => {
    it("자연어 설명을 LaTeX로 바꾼다 (구분자 제거)", async () => {
      const ai = new ScriptedAi([], [{ latex: "$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$", display: "block" }]);
      useAi(ai);
      const res = await latex({ description: "2차 방정식 근의 공식" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ latex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", display: "block" });
      expect(ai.jsonRequests[0].content).toEqual([{ type: "text", text: expect.stringContaining("2차 방정식 근의 공식") }]);
    });

    it("이미지를 비전 입력(base64 image 블록)으로 보낸다", async () => {
      const ai = new ScriptedAi([], [{ latex: "E = mc^2", display: "block" }]);
      useAi(ai);
      const res = await latex({ image: { mediaType: "image/png", data: PNG } });
      expect(res.status).toBe(200);
      expect((await res.json()).latex).toBe("E = mc^2");
      const content = ai.jsonRequests[0].content;
      expect(Array.isArray(content) && content[0]).toEqual({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: PNG },
      });
    });

    it("선언한 형식과 실제 이미지가 다르면 415이고 AI를 부르지 않는다", async () => {
      const ai = new ScriptedAi([], [{ latex: "x", display: "inline" }]);
      useAi(ai);
      const res = await latex({ image: { mediaType: "image/jpeg", data: PNG } });
      expect(res.status).toBe(415);
      expect(ai.jsonRequests).toHaveLength(0);
    });

    it("입력 검증: 둘 다 없거나 둘 다 있으면 400, base64가 아니면 400", async () => {
      useAi(new ScriptedAi([], []));
      expect((await latex({})).status).toBe(400);
      expect((await latex({ description: "식", image: { mediaType: "image/png", data: PNG } })).status).toBe(400);
      expect((await latex({ image: { mediaType: "image/png", data: "<script>alert(1)</script>!!" } })).status).toBe(400);
      expect((await latex({ image: { mediaType: "image/svg+xml", data: PNG } })).status).toBe(400);
      expect(await prisma.aiUsage.count()).toBe(0);
    });

    it("수식을 찾지 못하면 400, 모델 출력이 스키마와 다르면 503", async () => {
      useAi(new ScriptedAi([], [{ latex: "", display: "inline" }, { formula: "x" }]));
      expect((await latex({ description: "수식 아님" })).status).toBe(400);
      expect((await latex({ description: "수식" })).status).toBe(503);
    });
  });

  describe("POST /api/ai/format", () => {
    it("자유 텍스트를 서식 규칙 스키마로 검증한 규칙 조각으로 돌려준다", async () => {
      const ai = new ScriptedAi([], [
        {
          body: { font: "함초롬바탕", sizePt: 10, lineHeight: 160, fontSizePt: 12 },
          headings: { h1: { sizePt: 16, bold: true, align: "center" }, "2": { sizePt: 14 } },
          junk: { a: 1 },
        },
      ]);
      useAi(ai);
      const res = await format({ text: "본문 함초롬바탕 10pt, 줄간격 160%, 제목은 가운데 정렬 16pt 굵게" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        rules: {
          // 대체가 필요한 글꼴은 이름을 남겨 두어, 폼에 채울 때 대체 글꼴 안내가 나온다
          body: { font: "함초롬바탕", sizePt: 10, lineHeight: 160 },
          headings: { h1: { sizePt: 16, bold: true, align: "center" } },
        },
        validated: true,
      });
      expect(ai.jsonRequests[0].content).toContain("줄간격 160%");
    });

    it("범위를 벗어난 값·스키마에 없는 키는 버리고, 남는 항목이 없으면 503", async () => {
      useAi(new ScriptedAi([], [{ body: { sizePt: 200, lineHeight: 150, align: "center", font: "Noto Serif KR" }, page: { size: "A3" } }]));
      const res = await format({ text: "본문 200pt" });
      expect(await res.json()).toEqual({ rules: { body: { lineHeight: 150, font: "noto-serif-kr" } }, validated: true });

      useAi(new ScriptedAi([], [{ body: { fontSizePt: 10, lineHeightPercent: 160 } }]));
      expect((await format({ text: "본문 10pt" })).status).toBe(503);
    });

    it("가짜 AI(AI_FAKE)도 검증을 통과하는 결정적 규칙을 낸다", async () => {
      useAi(new FakeAiClient());
      const res = await format({ text: "본문 함초롬바탕 10pt, 줄간격 160%, 제목은 가운데 정렬 16pt 굵게" });
      expect(res.status).toBe(200);
      expect((await res.json()).rules).toEqual({
        body: { font: "함초롬바탕", sizePt: 10, lineHeight: 160 },
        headings: { h1: { sizePt: 16, bold: true, align: "center" } },
      });
    });

    it("모델이 객체가 아닌 값을 내면 503, 빈 텍스트는 400", async () => {
      useAi(new ScriptedAi([], [["배열"]]));
      expect((await format({ text: "본문 10pt" })).status).toBe(503);
      expect((await format({ text: "  " })).status).toBe(400);
    });

    it("검증 훅을 넘기면 통과한 값만 돌려주고, 실패하면 AI_UNAVAILABLE", async () => {
      const validate = (raw: unknown) => {
        const size = (raw as { body?: { fontSizePt?: unknown } }).body?.fontSizePt;
        if (typeof size !== "number") throw new Error("invalid");
        return { body: { fontSizePt: size } };
      };
      const ok = await suggestFormatRules(new ScriptedAi([], [{ body: { fontSizePt: 11, junk: true } }]), "본문 11pt", validate);
      expect(ok).toEqual({ rules: { body: { fontSizePt: 11 } }, validated: true });
      await expect(suggestFormatRules(new ScriptedAi([], [{ body: { fontSizePt: "크게" } }]), "본문 크게", validate)).rejects.toMatchObject({
        code: "AI_UNAVAILABLE",
      });
    });
  });

  describe("POST /api/ai/chart-suggest", () => {
    it("열 정보만 모델에 보내고 유형·축 구성을 돌려준다", async () => {
      const dataset = await createDataset(me, COLUMNS);
      const ai = new ScriptedAi([], [{ suggestions: [scatter] }]);
      useAi(ai);
      const res = await chart({ datasetId: dataset.id });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ datasetId: dataset.id, suggestions: [scatter] });

      const sent = ai.jsonRequests[0].content as string;
      expect(sent).toContain(JSON.stringify(COLUMNS));
      expect(sent).toContain("행 수: 12");
    });

    it("응답 스키마에 수치 필드가 없고, 모델이 덧붙인 수치는 버려진다", async () => {
      const allowed = Object.keys(chartSuggestionSchema.shape).sort();
      expect(allowed).toEqual(["chartType", "errorBar", "logX", "logY", "reason", "trendline", "x", "xTitle", "y", "yTitle"]);

      const dataset = await createDataset(me, COLUMNS);
      useAi(new ScriptedAi([], [{ suggestions: [{ ...scatter, data: [[1, 2], [3, 4]], values: [9.9], slope: 0.5, r2: 0.99 }], stats: { mean: 3 } }]));
      const body = await (await chart({ datasetId: dataset.id })).json();
      expect(Object.keys(body).sort()).toEqual(["datasetId", "suggestions"]);
      expect(Object.keys(body.suggestions[0]).sort()).toEqual(allowed);
    });

    it("응답 형식이 그래프 만들기 화면의 추천 적용(chartConfigFromSuggestion)과 맞는다", async () => {
      const dataset = await createDataset(me, COLUMNS);
      useAi(new FakeAiClient());
      const body = (await (await chart({ datasetId: dataset.id })).json()) as ChartSuggestResponse;
      const columns = COLUMNS.map((c) => ({ ...c, type: c.type as "number" | "string", missing: 0 }));
      const picked = firstApplicableSuggestion(defaultChartConfig(columns, "line"), body, columns);
      expect(picked?.config).toMatchObject({
        type: "scatter",
        x: "주파수",
        y: "감쇠율",
        trendline: true,
        xTitle: "주파수",
        xUnit: "Hz",
        yTitle: "감쇠율",
        yUnit: "dB",
      });
    });

    it("데이터에 없는 열을 쓴 추천은 버린다", async () => {
      const dataset = await createDataset(me, COLUMNS);
      useAi(new ScriptedAi([], [{ suggestions: [{ ...scatter, y: ["없는 열"] }, scatter] }]));
      const body = await (await chart({ datasetId: dataset.id })).json();
      expect(body.suggestions).toEqual([scatter]);
    });

    it("모델이 스키마에 맞지 않는 유형을 내면 503", async () => {
      const dataset = await createDataset(me, COLUMNS);
      useAi(new ScriptedAi([], [{ suggestions: [{ ...scatter, chartType: "pie" }] }]));
      expect((await chart({ datasetId: dataset.id })).status).toBe(503);
    });

    it("남의 데이터셋은 404이고 AI를 부르지 않으며 한도도 쓰지 않는다", async () => {
      const theirs = await createDataset(other, COLUMNS);
      const ai = new ScriptedAi([], [{ suggestions: [scatter] }]);
      useAi(ai);
      const res = await chart({ datasetId: theirs.id });
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("주파수");
      expect(ai.jsonRequests).toHaveLength(0);
      expect(await prisma.aiUsage.count()).toBe(0);
    });
  });
});

describe("AI 클라이언트", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...savedEnv };
    useAi(null);
  });

  it("extractJson은 코드 펜스·설명이 붙은 JSON을 꺼내고, JSON이 없으면 AI_UNAVAILABLE", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('결과입니다: {"a": {"b": 2}} 끝')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("JSON 없음")).toThrow(ApiError);
    expect(() => extractJson("{깨진")).toThrow(ApiError);
  });

  it("AI_FAKE=1은 테스트·개발에서만 켜지고 운영(NODE_ENV=production)에서는 무시된다", () => {
    useAi(null);
    delete process.env.ANTHROPIC_API_KEY;
    vi.stubEnv("AI_FAKE", "1");
    vi.stubEnv("NODE_ENV", "test");
    expect(isFakeAiMode()).toBe(true);
    expect(getAiClient()).toBeInstanceOf(FakeAiClient);

    vi.stubEnv("NODE_ENV", "production");
    expect(isFakeAiMode()).toBe(false);
    expect(() => getAiClient()).toThrow(expect.objectContaining({ code: "AI_UNAVAILABLE" }));
  });
});

describe("rateLimit", () => {
  beforeEach(async () => {
    await resetRateLimits();
  });
  afterEach(() => vi.useRealTimers());

  it("창 안에서 limit번까지 통과하고 넘으면 RATE_LIMITED, 창이 지나면 다시 통과한다", async () => {
    vi.useFakeTimers();
    const opts = { limit: 2, windowMs: 1000 };
    await rateLimit("k", opts);
    await rateLimit("k", opts);
    await expect(rateLimit("k", opts)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    // 키가 다르면 서로 영향이 없다
    await expect(rateLimit("other", opts)).resolves.toBeUndefined();
    vi.advanceTimersByTime(1001);
    await expect(rateLimit("k", opts)).resolves.toBeUndefined();
  });
});

describe("모델 ID·API 키 취급", () => {
  it("모델 ID를 코드에 적지 않고, 키는 lib/ai/client.ts에서만 읽으며, lib/ai 서버 모듈은 server-only 가드를 둔다", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../..");
    const walk = (dir: string): string[] =>
      readdirSync(path.join(root, dir)).flatMap((name) => {
        const rel = `${dir}/${name}`;
        if (name === "node_modules" || name.startsWith(".")) return [];
        return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
      });
    const files = ["app", "components", "lib", "server"].flatMap(walk);
    const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

    for (const rel of files) expect(read(rel), rel).not.toMatch(/claude-(opus|sonnet|haiku|fable|mythos|\d)/i);
    expect(files.filter((rel) => read(rel).includes("ANTHROPIC_API_KEY"))).toEqual(["lib/ai/client.ts"]);

    // shared.ts는 클라이언트와 함께 쓰는 타입 전용 파일이라 가드 대상이 아니다.
    const serverModules = files.filter((rel) => rel.startsWith("lib/ai/") && rel !== "lib/ai/shared.ts");
    expect(serverModules.length).toBeGreaterThan(0);
    for (const rel of serverModules) expect(read(rel), rel).toMatch(/^import "server-only";/);
    expect(read("lib/ai/shared.ts")).not.toMatch(/^import (?!type)/m);
  });
});
