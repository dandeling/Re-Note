import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { searchSite } from "@/lib/search";
import { seedResearchAndPains } from "@/prisma/seed-research";
import { createUser, resetDb } from "../setup/db";

// SPEC 7.2 완료 기준: 오타·띄어쓰기 차이가 있는 한국어 키워드도 검색된다 (trigram 테스트 포함)
const ABH = "음향 블랙홀 구조를 이용한 얇은 판의 진동 감쇠 효과 측정";

async function normalize(text: string) {
  const rows = await prisma.$queryRaw<{ n: string }[]>`SELECT rm_search_normalize(${text}) AS n`;
  return rows[0].n;
}

async function topResearch(q: string) {
  return (await searchSite(q)).research[0]?.title;
}

describe("한국어 정규화 (rm_search_normalize)", () => {
  it("한글 음절을 자모로 분해해 두벌식 ASCII로 바꾼다", async () => {
    expect(await normalize("음향")).toBe("dmagid");
    expect(await normalize("블랙홀")).toBe("qmfforghf");
    expect(await normalize("값")).toBe("rkqt"); // 겹받침
    expect(await normalize("꽃")).toBe("rrhc"); // 된소리
    expect(await normalize("의")).toBe("dml"); // 이중 모음
  });

  it("대소문자·기호·공백을 정리한다", async () => {
    expect(await normalize("  PID-제어 (v2)!  ")).toBe("pid wpdj v2");
    expect(await normalize("음향   블랙홀\n진동")).toBe("dmagid qmfforghf wlsehd");
    expect(await normalize("%_';--")).toBe("");
    expect(await normalize("")).toBe("");
  });

  it("자모 분해 덕분에 한 글자 오타의 trigram 유사도가 음절 단위보다 훨씬 높다", async () => {
    const [row] = await prisma.$queryRaw<{ syllable: number; jamo: number }[]>`
      SELECT similarity('초전도', '초전두')::float8 AS syllable,
             similarity(rm_search_normalize('초전도'), rm_search_normalize('초전두'))::float8 AS jamo`;
    expect(row.syllable).toBeLessThan(0.4);
    expect(row.jamo).toBeGreaterThanOrEqual(0.6);
  });
});

describe("오타·띄어쓰기 변형 검색", () => {
  beforeAll(async () => {
    await resetDb();
    await seedResearchAndPains(prisma);
  });

  it("띄어쓰기를 붙여 써도 찾는다: 음향블랙홀 ↔ 음향 블랙홀", async () => {
    expect(await topResearch("음향 블랙홀")).toBe(ABH);
    expect(await topResearch("음향블랙홀")).toBe(ABH);
    expect(await topResearch("음향블랙홀 진동감쇠")).toBe(ABH);
    expect(await topResearch("진동감쇠")).toBe(ABH);
    expect(await topResearch("태양광패널")).toContain("태양광 패널");
    expect(await topResearch("라인 트레이서")).toContain("라인트레이서");
  });

  it("붙여 쓴 글도 띄어 쓴 검색어로 찾는다: 바이오 디젤 → 바이오디젤", async () => {
    expect(await topResearch("바이오 디젤")).toContain("바이오디젤");
    expect(await topResearch("미세 먼지")).toContain("미세먼지");
    expect((await searchSite("화이트 밸런스")).pains[0].title).toContain("조명"); // 본문에만 있는 단어
  });

  it("한 글자 오타가 있어도 찾는다", async () => {
    expect(await topResearch("음향 블랙훌")).toBe(ABH); // 홀 → 훌
    expect(await topResearch("움향 블랙홀")).toBe(ABH); // 음 → 움
    expect(await topResearch("진동 감쇄")).toBe(ABH); // 쇠 → 쇄
    expect(await topResearch("미새먼지")).toContain("미세먼지"); // 세 → 새
    expect(await topResearch("바이오디잴")).toContain("바이오디젤");
    expect(await topResearch("안토시아난")).toContain("안토시아닌");
    expect(await topResearch("몬테카를루")).toContain("몬테카를로");
  });

  it("오타와 띄어쓰기 차이가 함께 있어도 찾는다", async () => {
    expect(await topResearch("음향블랙훌")).toBe(ABH);
    expect(await topResearch("유전알고리듬")).toContain("유전 알고리즘");
  });

  it("조사가 붙은 형태·영문 대소문자 차이도 찾는다", async () => {
    expect(await topResearch("블랙홀을")).toBe(ABH);
    expect(await topResearch("pid제어")).toContain("PID 제어");
    expect(await topResearch("led 광질")).toContain("LED 광질");
  });

  it("정확히 일치할수록 점수가 높다", async () => {
    const exact = (await searchSite("음향 블랙홀")).research[0].score;
    const spaced = (await searchSite("음향블랙홀")).research[0].score;
    const typo = (await searchSite("움향 블랙홀")).research[0].score;
    expect(exact).toBe(1);
    expect(spaced).toBeLessThan(exact);
    expect(spaced).toBeGreaterThan(0.6);
    expect(typo).toBeLessThan(exact);
    expect(typo).toBeGreaterThanOrEqual(0.5);
  });

  it("오타 허용이 엉뚱한 글을 끌어오지 않는다", async () => {
    for (const q of ["음식 블랙박스", "빛", "김차", "수명", "양자 컴퓨터", "블랙박스 영상"]) {
      const result = await searchSite(q);
      expect(result.research.map((r) => r.title), q).toEqual([]);
    }
  });

  it("새로 쓴 고충도 같은 방식으로 찾는다 (제목 오타, 본문 띄어쓰기)", async () => {
    const user = await createUser();
    const post = await prisma.painPost.create({
      data: {
        authorId: user.id,
        title: "질량분석기 진공 펌프가 자꾸 꺼집니다",
        body: "터보 분자 펌프의 회전수가 올라가다가 멈춥니다.",
        tags: ["질량 분석"],
      },
    });
    const ids = async (q: string) => (await searchSite(q)).pains.map((p) => p.id);
    expect(await ids("질량 분석기")).toContain(post.id);
    expect(await ids("질량분석끼")).toContain(post.id);
    expect(await ids("터보분자펌프")).toContain(post.id);
  });
});
