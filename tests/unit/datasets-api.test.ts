import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as previewGET } from "@/app/api/datasets/[id]/preview/route";
import { GET as listGET, POST as datasetsPOST } from "@/app/api/datasets/route";
import { prisma } from "@/lib/db";
import { createAssetFromBytes } from "@/server/assets";
import { createUser, resetDb } from "../setup/db";
import { ctx, jsonRequest, loginAs } from "../setup/session";
import { fixture, tempStorage } from "../setup/storage";

vi.mock("@/server/session", async () => (await import("../setup/session")).sessionMock);
tempStorage();

type User = Awaited<ReturnType<typeof createUser>>;

describe("데이터셋 API (P4-1)", () => {
  let owner: User;
  let other: User;
  let projectId: string;

  const create = (body: unknown) => datasetsPOST(jsonRequest("POST", "/api/datasets", body), ctx({}));
  const preview = (id: string, query = "") =>
    previewGET(jsonRequest("GET", `/api/datasets/${id}/preview${query}`), ctx({ id }));
  const list = (pid: string) => listGET(jsonRequest("GET", `/api/datasets?projectId=${pid}`), ctx({}));

  async function csvAsset(user: User, name: string, bytes: Uint8Array, pid: string | null = projectId) {
    return createAssetFromBytes({ ownerId: user.id, projectId: pid, filename: name, bytes });
  }

  beforeEach(async () => {
    await resetDb();
    owner = await createUser("소유자");
    other = await createUser("다른 사용자");
    projectId = (await prisma.project.create({ data: { ownerId: owner.id, title: "프로젝트" } })).id;
    loginAs(owner);
  });

  it("로그인하지 않으면 401", async () => {
    loginAs(null);
    expect((await create({ assetId: "x" })).status).toBe(401);
    expect((await preview("x")).status).toBe(401);
    expect((await list(projectId)).status).toBe(401);
  });

  it("CP949 CSV 자산으로 Dataset을 만들면 열 정보와 행 수가 저장된다", async () => {
    const asset = await csvAsset(owner, "진동 측정.csv", fixture("csv/korean-cp949.csv"));
    const res = await create({ assetId: asset.id });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.encoding).toBe("euc-kr");
    expect(body.dataset).toMatchObject({ projectId, name: "진동 측정", rowCount: 5 });
    expect(body.dataset.columns).toEqual([
      { name: "시간(s)", type: "number", unit: null, missing: 0 },
      { name: "진폭", type: "number", unit: "mm", missing: 0 },
      { name: "온도", type: "number", unit: null, missing: 1 },
      { name: "비고", type: "string", unit: null, missing: 2 },
    ]);
    const row = await prisma.dataset.findUniqueOrThrow({ where: { id: body.dataset.id } });
    expect(row.rowCount).toBe(5);
    expect(row.assetId).toBe(asset.id);
    expect(row.columnsJson).toEqual(body.dataset.columns);
  });

  it("미리보기는 한글이 깨지지 않은 행을 limit만큼 돌려준다", async () => {
    const asset = await csvAsset(owner, "a.csv", fixture("csv/korean-cp949.csv"));
    const { dataset } = await (await create({ assetId: asset.id, name: "감쇠 실험" })).json();
    expect(dataset.name).toBe("감쇠 실험");

    const all = await (await preview(dataset.id)).json();
    expect(all.rowCount).toBe(5);
    expect(all.truncated).toBe(false);
    expect(all.rows[0]).toEqual(["0", "12.5 mm", "21.3", "시작"]);
    expect(all.rows[2]).toEqual(["2", "8.3 mm", "", "감쇠 구간"]);
    expect(all.columns.map((c: { name: string }) => c.name)).toEqual(["시간(s)", "진폭", "온도", "비고"]);

    const two = await (await preview(dataset.id, "?limit=2")).json();
    expect(two.rows).toHaveLength(2);
    expect(two.truncated).toBe(true);
    expect(two.rowCount).toBe(5);
  });

  it("단위가 섞인 열은 문자로 처리하고 경고를 돌려준다", async () => {
    const asset = await csvAsset(owner, "mixed.csv", fixture("csv/mixed-units.csv"));
    const body = await (await create({ assetId: asset.id })).json();
    const byName = Object.fromEntries(body.dataset.columns.map((c: { name: string; type: string; unit: string | null }) => [c.name, c]));
    expect(byName["길이"]).toMatchObject({ type: "string", unit: null });
    expect(byName["질량"]).toMatchObject({ type: "number", unit: "g" });
    expect(byName["측정일"]).toMatchObject({ type: "date" });
    expect(body.warnings.some((w: string) => w.includes("길이"))).toBe(true);
  });

  it("프로젝트의 데이터셋 목록을 최신순으로 돌려준다", async () => {
    const a = await csvAsset(owner, "a.csv", fixture("csv/missing.csv"));
    const b = await csvAsset(owner, "b.csv", fixture("csv/korean-utf8-bom.csv"));
    await create({ assetId: a.id });
    await create({ assetId: b.id });
    const body = await (await list(projectId)).json();
    expect(body.datasets.map((d: { name: string }) => d.name)).toEqual(["b", "a"]);
  });

  it("프로젝트가 없는 자산은 projectId를 함께 보내야 한다", async () => {
    const asset = await csvAsset(owner, "a.csv", fixture("csv/missing.csv"), null);
    expect((await create({ assetId: asset.id })).status).toBe(400);
    const res = await create({ assetId: asset.id, projectId });
    expect(res.status).toBe(201);
    expect((await res.json()).dataset.projectId).toBe(projectId);
  });

  it("CSV가 아닌 자산은 415, 데이터 행이 없으면 400", async () => {
    const png = await createAssetFromBytes({ ownerId: owner.id, projectId, filename: "a.png", bytes: fixture("import/pixel.png") });
    const res = await create({ assetId: png.id });
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_FILE");

    const headerOnly = await csvAsset(owner, "h.csv", new TextEncoder().encode("x,y\n"));
    const res2 = await create({ assetId: headerOnly.id });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.dataset.count()).toBe(0);
  });

  it("입력 검증: assetId 없음, limit 범위 밖은 400", async () => {
    expect((await create({})).status).toBe(400);
    const asset = await csvAsset(owner, "a.csv", fixture("csv/missing.csv"));
    const { dataset } = await (await create({ assetId: asset.id })).json();
    expect((await preview(dataset.id, "?limit=0")).status).toBe(400);
    expect((await preview(dataset.id, "?limit=abc")).status).toBe(400);
  });

  describe("소유자 검사 (남의 자원은 404)", () => {
    it("다른 사용자의 자산으로는 Dataset을 만들 수 없다", async () => {
      const asset = await csvAsset(owner, "a.csv", fixture("csv/missing.csv"));
      loginAs(other);
      const res = await create({ assetId: asset.id });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("NOT_FOUND");
      expect(await prisma.dataset.count()).toBe(0);
    });

    it("자기 자산이라도 다른 사용자의 프로젝트에는 넣을 수 없다", async () => {
      loginAs(other);
      const mine = await csvAsset(other, "a.csv", fixture("csv/missing.csv"), null);
      expect((await create({ assetId: mine.id, projectId })).status).toBe(404);
      expect(await prisma.dataset.count()).toBe(0);
    });

    it("자산이 속한 프로젝트와 다른 projectId를 보내면 404", async () => {
      const otherProject = await prisma.project.create({ data: { ownerId: owner.id, title: "다른 프로젝트" } });
      const asset = await csvAsset(owner, "a.csv", fixture("csv/missing.csv"));
      expect((await create({ assetId: asset.id, projectId: otherProject.id })).status).toBe(404);
    });

    it("다른 사용자의 데이터셋 미리보기·목록은 404", async () => {
      const asset = await csvAsset(owner, "a.csv", fixture("csv/missing.csv"));
      const { dataset } = await (await create({ assetId: asset.id })).json();
      loginAs(other);
      expect((await preview(dataset.id)).status).toBe(404);
      expect((await list(projectId)).status).toBe(404);
      expect((await preview("없는아이디")).status).toBe(404);
    });

    it("휴지통에 있는 프로젝트의 데이터셋은 404", async () => {
      const asset = await csvAsset(owner, "a.csv", fixture("csv/missing.csv"));
      const { dataset } = await (await create({ assetId: asset.id })).json();
      await prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
      expect((await preview(dataset.id)).status).toBe(404);
      expect((await list(projectId)).status).toBe(404);
    });
  });
});
