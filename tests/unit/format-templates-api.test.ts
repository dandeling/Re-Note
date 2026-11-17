import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/docs/[id]/route";
import { GET, POST } from "@/app/api/format-templates/route";
import { prisma } from "@/lib/db";
import { FORMAT_PRESETS } from "@/lib/format/presets";
import { DEFAULT_RULES } from "@/lib/format/rules";
import { ensureFormatPresets, rulesForDocument } from "@/server/format-templates";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);

const myRules = { ...DEFAULT_RULES, body: { ...DEFAULT_RULES.body, sizePt: 13 } };
const list = async (query = "") => {
  const res = await GET(jsonRequest("GET", `/api/format-templates${query}`), undefined);
  return { res, body: await res.json() };
};
const save = async (body: unknown) => {
  const res = await POST(jsonRequest("POST", "/api/format-templates", body), undefined);
  return { res, body: await res.json() };
};

describe("서식 템플릿 API (P2-5)", () => {
  let me: Awaited<ReturnType<typeof createUser>>;
  let other: Awaited<ReturnType<typeof createUser>>;
  let docId: string;

  beforeEach(async () => {
    await resetDb();
    me = await createUser("나");
    other = await createUser("남");
    loginAs(me);
    const project = await prisma.project.create({ data: { ownerId: me.id, title: "p" } });
    docId = (await prisma.document.create({ data: { projectId: project.id, title: "d", contentJson: { type: "doc" } } })).id;
  });

  it("로그인하지 않으면 401", async () => {
    loginAs(null);
    expect((await list()).res.status).toBe(401);
    expect((await save({ name: "x", rulesJson: myRules })).res.status).toBe(401);
  });

  it("시드를 돌리지 않은 DB에서도 프리셋 3종을 돌려주고, 시드는 여러 번 실행해도 3종이다", async () => {
    const { body } = await list();
    expect(body.presets.map((p: { name: string }) => p.name)).toEqual(["일반 보고서", "학술 논문형", "탐구 보고서형"]);
    expect(body.presets.every((p: { isPreset: boolean }) => p.isPreset)).toBe(true);
    expect(body.presets[1].rulesJson).toEqual(FORMAT_PRESETS[1].rules);
    expect(body.templates).toEqual([]);
    await ensureFormatPresets();
    await ensureFormatPresets();
    expect(await prisma.formatTemplate.count({ where: { isPreset: true } })).toBe(3);
  });

  it("내 템플릿을 저장하면 내 목록에만 보이고 남에게는 보이지 않는다", async () => {
    const created = await save({ name: "  우리 학교 양식 ", rulesJson: myRules });
    expect(created.res.status).toBe(201);
    expect(created.body.template).toMatchObject({ name: "우리 학교 양식", isPreset: false, rulesJson: myRules });
    expect((await list()).body.templates).toHaveLength(1);

    loginAs(other);
    const theirs = await list();
    expect(theirs.body.templates).toEqual([]);
    expect(theirs.body.presets).toHaveLength(3);
  });

  it("잘못된 규칙은 400으로 거부한다", async () => {
    const bad = await save({ name: "x", rulesJson: { ...myRules, body: { ...myRules.body, font: "함초롬바탕" } } });
    expect(bad.res.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect((await save({ name: "", rulesJson: myRules })).res.status).toBe(400);
    expect((await save({ name: "x" })).res.status).toBe(400);
  });

  it("내 템플릿은 수정할 수 있지만, 남의 템플릿과 프리셋은 수정할 수 없다(404)", async () => {
    await ensureFormatPresets();
    const mine = (await save({ name: "내 것", rulesJson: myRules })).body.template;
    const updated = await save({ id: mine.id, name: "내 것 v2", rulesJson: DEFAULT_RULES });
    expect(updated.res.status).toBe(200);
    expect(updated.body.template).toMatchObject({ id: mine.id, name: "내 것 v2", rulesJson: DEFAULT_RULES });

    loginAs(other);
    const hijack = await save({ id: mine.id, name: "탈취", rulesJson: myRules });
    expect(hijack.res.status).toBe(404);
    expect(hijack.body.error.code).toBe("NOT_FOUND");
    expect((await save({ id: FORMAT_PRESETS[0].id, name: "프리셋 변조", rulesJson: myRules })).res.status).toBe(404);
    expect((await prisma.formatTemplate.findUniqueOrThrow({ where: { id: mine.id } })).name).toBe("내 것 v2");
    expect((await prisma.formatTemplate.findUniqueOrThrow({ where: { id: FORMAT_PRESETS[0].id } })).name).toBe("일반 보고서");
  });

  it("문서에 템플릿을 적용하면 그 규칙이 문서의 규칙이 된다", async () => {
    await list();
    expect((await list(`?docId=${docId}`)).body.documentTemplateId).toBeNull();
    expect(await rulesForDocument({ formatTemplateId: null })).toEqual(DEFAULT_RULES);

    const apply = (formatTemplateId: string | null) => PATCH(jsonRequest("PATCH", "/x", { formatTemplateId }), ctx({ id: docId }));
    expect((await apply("preset-academic")).status).toBe(200);
    expect((await list(`?docId=${docId}`)).body.documentTemplateId).toBe("preset-academic");
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(await rulesForDocument(doc)).toEqual(FORMAT_PRESETS[1].rules);

    const mine = (await save({ name: "내 것", rulesJson: myRules })).body.template;
    expect((await apply(mine.id)).status).toBe(200);
    expect((await rulesForDocument(await prisma.document.findUniqueOrThrow({ where: { id: docId } }))).body.sizePt).toBe(13);
  });

  it("남의 템플릿은 내 문서에 적용할 수 없고, 남의 문서의 적용 템플릿도 볼 수 없다(404)", async () => {
    loginAs(other);
    const theirs = (await save({ name: "남의 것", rulesJson: myRules })).body.template;
    expect((await list(`?docId=${docId}`)).res.status).toBe(404);

    loginAs(me);
    const res = await PATCH(jsonRequest("PATCH", "/x", { formatTemplateId: theirs.id }), ctx({ id: docId }));
    expect(res.status).toBe(404);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: docId } })).formatTemplateId).toBeNull();
  });
});
