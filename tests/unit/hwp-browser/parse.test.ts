import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docContentSchema } from "@/lib/editor/content";
import {
  blocksToDoc,
  blocksToText,
  imageInfo,
  parseAny,
  parseHwp,
  parseHwpx,
  sniff,
  type Block,
  type ImageBlock,
  type ParseResult,
  type TableBlock,
} from "@/lib/hwp-browser";
import { parseXml } from "@/lib/hwp-browser/xml";
import { buildCfb, buildHwp, buildHwpImages, buildHwpx, buildHwpxImages, buildZip, TINY_PNG } from "./builders";

const FIX = path.join(process.cwd(), "tests", "fixtures");
const HWP = path.join(FIX, "hwp");
const THIRD = path.join(HWP, "third-party");
const read = (...p: string[]) => fs.readFileSync(path.join(...p));
const sha256 = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
const tablesOf = (r: ParseResult) => r.blocks.filter((b): b is TableBlock => b.type === "table");
const imagesOf = (blocks: Block[]) => blocks.filter((b): b is ImageBlock => b.type === "image");
const cellAt = (t: TableBlock, row: number, col: number) => t.cells.find((c) => c.row === row && c.col === col)?.text;
const squash = (s: string) => s.replace(//g, "한").replace(/\s+/g, "");

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

describe("판별·오류", () => {
  it("sniff: CFB·zip·HWP 3.0·그 밖", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    expect([
      sniff(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])),
      sniff(enc("PK\u0003\u0004xx")),
      sniff(enc("HWP Document File V3.00 \u001a\u0001\u0002")),
      sniff(enc("%PDF-1.4")),
      sniff(new Uint8Array(0)),
    ]).toEqual(["hwp", "hwpx", "hwp3", null, null]);
    expect(sniff(read(HWP, "sample.hwp"))).toBe("hwp");
    expect(sniff(read(HWP, "sample.hwpx"))).toBe("hwpx");
  });

  it("손상·잘린·형식 아님·옛 형식·암호·배포용·50MB 초과는 각각 알기 쉬운 오류", async () => {
    const cases: [Buffer, string, RegExp][] = [
      [read(HWP, "corrupt.hwp"), "bad_file", /손상/],
      [read(HWP, "corrupt.hwpx"), "bad_file", /손상/],
      [read(HWP, "truncated.hwpx"), "bad_file", /손상/],
      [Buffer.from("a,b,c\n1,2,3\n"), "not_hwp", /HWP나 HWPX 파일이 아니에요/],
      [Buffer.concat([Buffer.from("HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05", "latin1"), Buffer.alloc(200)]), "old_hwp", /옛 형식/],
      [buildHwp({ flags: 1 | 2 }), "encrypted", /암호/],
      [buildHwp({ flags: 1 | 4 }), "distribution", /배포용/],
      [buildZip([{ name: "word/document.xml", data: "<w/>" }]), "not_hwp", /아니에요/],
      [buildCfb([{ path: "WordDocument", data: Buffer.alloc(100) }]), "not_hwp", /아니에요/],
    ];
    for (const [bytes, code, re] of cases) {
      const e = await errorOf(parseAny(bytes));
      expect(e?.code, code).toBe(code);
      expect(e?.message).toMatch(re);
    }
    const big = new Uint8Array(50 * 1024 * 1024 + 1);
    big.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect((await errorOf(parseHwp(big)))?.code).toBe("too_large");
  });
});

describe("픽스처 sample.hwp / sample.hwpx", () => {
  it("sample.hwp: 제목·문단·표(3×2)", async () => {
    const r = await parseHwp(read(HWP, "sample.hwp"));
    const b = r.blocks;
    expect(b[0]).toEqual({ type: "heading", level: 1, text: "음향 블랙홀 진동 감쇠 실험 보고서" });
    expect(b.find((x) => x.type === "heading" && x.text === "실험 방법")).toEqual({ type: "heading", level: 2, text: "실험 방법" });
    expect(b.find((x) => x.type === "paragraph" && /^이 문서는/.test(x.text))?.type, "마침표로 끝나는 개요 문단은 제목으로 보지 않는다").toBe("paragraph");
    const [t] = tablesOf(r);
    expect([t.rows, t.cols]).toEqual([3, 2]);
    expect([cellAt(t, 0, 0), cellAt(t, 0, 1), cellAt(t, 1, 0), cellAt(t, 1, 1), cellAt(t, 2, 0), cellAt(t, 2, 1)]).toEqual([
      "조건",
      "감쇠율",
      "기준 보",
      "12.5",
      "음향 블랙홀 보",
      "31.0",
    ]);
    expect(r.notes).toEqual([]);
  });

  it("sample.hwpx: 같은 문서라 sample.hwp와 같은 결과", async () => {
    const a = await parseHwp(read(HWP, "sample.hwp"));
    const b = await parseHwpx(read(HWP, "sample.hwpx"));
    expect(b.blocks).toEqual(a.blocks);
  });
});

describe("합성 파일(수식·병합·각주·머리말)", () => {
  const checkSynthetic = (r: ParseResult) => {
    const b = r.blocks;
    expect(b[0]).toEqual({ type: "heading", level: 1, text: "서론" });
    expect(b[1]).toEqual({ type: "paragraph", text: "첫 줄\n둘째 줄\t탭 뒤[수식: a over b]끝[각주 1]" });
    expect(blocksToText(b)).not.toContain("머리말 글자");
    expect(b.find((x) => x.type === "heading" && x.text === "실험 결과")).toEqual({ type: "heading", level: 2, text: "실험 결과" });
    const [t] = tablesOf(r);
    expect([t.rows, t.cols]).toEqual([2, 3]);
    expect(t.cells[0]).toEqual({ row: 0, col: 0, rowSpan: 1, colSpan: 2, text: "병합 머리" });
    expect(cellAt(t, 1, 1)).toBe("b|c");
    expect(b).toContainEqual({ type: "heading", level: 2, text: "각주", extra: true });
    expect(b).toContainEqual({ type: "paragraph", text: "(1) 각주 내용", note: true });
    expect(r.notes.some((n) => /수식 1개/.test(n))).toBe(true);
    expect(r.notes.some((n) => /각주·미주 1개/.test(n))).toBe(true);
    expect(r.notes.some((n) => /머리말·꼬리말 1개/.test(n))).toBe(true);
  };

  it("HWP(압축): 개요 스타일 제목·줄바꿈·탭·수식·각주·병합 셀·머리말 건너뜀", async () => {
    const r = await parseHwp(buildHwp({ flags: 1 }));
    checkSynthetic(r);
    expect(r.blocks.find((x) => x.type === "paragraph" && x.text === "이것은 문장입니다.")).toBeTruthy();
  });

  it("HWP: 압축 안 함·꼬리 없음·크기 아닌 꼬리도 같은 결과(큰 구역 포함)", async () => {
    for (const extraParas of [0, 3000]) {
      const a = await parseHwp(buildHwp({ flags: 1, extraParas }));
      expect(a.notes.some((n) => /손상/.test(n))).toBe(false);
      for (const opt of [{ flags: 0 }, { flags: 1, trailer: "none" as const }, { flags: 1, trailer: "junk" as const }]) {
        const b = await parseHwp(buildHwp({ ...opt, extraParas }));
        expect(b.blocks, JSON.stringify(opt)).toEqual(a.blocks);
        expect(b.notes).toEqual(a.notes);
      }
    }
  });

  it("HWPX: 구역 순서·수식·각주·병합·글상자·그림 안내·다단 안내", async () => {
    const r = await parseHwpx(buildHwpx());
    checkSynthetic(r);
    expect(blocksToText(r.blocks)).toContain("글상자 안 글자");
    const sec1 = r.blocks.findIndex((x) => x.type === "paragraph" && x.text === "둘째 구역 & 끝");
    expect(sec1).toBeGreaterThan(r.blocks.findIndex((x) => x.type === "table"));
    expect(r.notes.some((n) => /그림 1개/.test(n))).toBe(true);
    expect(r.notes.some((n) => /글상자 1개/.test(n))).toBe(true);
    expect(r.notes.some((n) => /여러 단/.test(n))).toBe(true);
  });

  it("진행 알림을 보낸다", async () => {
    const progress: number[] = [];
    const r = await parseHwp(buildHwp({ flags: 1, extraParas: 20000 }), { onProgress: (f) => progress.push(f) });
    expect(r.blocks.length).toBeGreaterThan(20000);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((f) => f >= 0 && f <= 1)).toBe(true);
  });
});

describe("제3자 샘플", () => {
  // pyhwp(hwp5proc) 결과에서 뽑은 기준값(artifact/tests/d-convert.spec.cjs의 내장 기준값)
  const BUILTIN: Record<string, { chunks: string[]; tables: [number, number][] }> = {
    "sample-5017.hwp": { chunks: ["한글 2005 예제 파일입니다.", "표끝", "다음 문단", "미주입니다.", "이건 각주이지요.", "다음 페이지"], tables: [[2, 2], [1, 1], [2, 2]] },
    "footnote-endnote.hwp": { chunks: ["각주참조", "각주입니다.", "각주 두 번째입니다.", "미주참조", "미주입니다.", "미주 두 번째입니다."], tables: [] },
    "multicolumns.hwp": { chunks: ["다단 다단"], tables: [] },
    "pagedefs.hwp": { chunks: ["Section 1: A4 portrait", "Section 2: A4 landscape"], tables: [] },
    "charshape.hwp": { chunks: ["기울임진하게", "점선밑줄"], tables: [] },
    "facename.hwp": { chunks: ["ko휴먼명조en바탕cn바탕jp바탕other바탕symbol바탕user바탕"], tables: [] },
    "textbox.hwp": { chunks: ["글상자"], tables: [] },
    "matrix.hwp": { chunks: [], tables: [] },
    "shapepict-scaled.hwp": { chunks: [], tables: [] },
  };
  for (const [name, ref] of Object.entries(BUILTIN)) {
    it.skipIf(!fs.existsSync(path.join(THIRD, name)))(`${name}: 글자 조각·표 행·열`, async () => {
      const r = await parseHwp(read(THIRD, name));
      const mine = squash(blocksToText(r.blocks));
      expect(ref.chunks.filter((c) => !mine.includes(squash(c)))).toEqual([]);
      expect(tablesOf(r).map((t) => [t.rows, t.cols])).toEqual(ref.tables);
      if (name === "sample-5017.hwp") expect(blocksToText(r.blocks)).toContain("한글 워드 프로세서"); // U+F53A → 한
    });
  }

  const JPG_5017 = { source: "BinData/BIN0002.jpg", length: 15895, sha: "ec8fe383b6e15ed56abd24a8b8bc112317bd770c2de2fc770081a160d652ab67" };
  const PNG_5017 = { source: "BinData/BIN0003.png", length: 989, sha: "175ef81be06278b02193605bedee6ff5fabe62b3265624cff03e42be97d19d59" };
  it.skipIf(!fs.existsSync(path.join(THIRD, "sample-5017.hwp")))("sample-5017.hwp: 그림 개체가 가리키는 그림만, 바이트 그대로", async () => {
    const r = await parseHwp(read(THIRD, "sample-5017.hwp"));
    const imgs = imagesOf(r.blocks);
    expect(imgs.map((b) => ({ source: b.source, length: b.bytes.length, sha: sha256(b.bytes) }))).toEqual([JPG_5017, PNG_5017]);
    expect(imgs.map((b) => [b.mime, b.name, b.n, b.width, b.height])).toEqual([
      ["image/jpeg", "그림 1.jpg", 1, 500, 300],
      ["image/png", "그림 2.png", 2, 16, 16],
    ]);
    expect(r.stats.images).toBe(2);
    // 첫 그림은 "본 문서는 먼저 …" 문단 뒤, "미주입니다." 문단 앞
    const i = r.blocks.indexOf(imgs[0]);
    const before = r.blocks.slice(0, i).reverse().find((b) => b.type !== "image");
    expect(before && "text" in before && squash(before.text).includes(squash("본 문서는 먼저"))).toBe(true);
  });
});

describe("그림", () => {
  it("HWP: 압축·비압축 BinData, 표 칸 안 그림, BMP→PNG(변환기 있을 때), WMF 안내, 안 쓰는 BinData 제외, 같은 그림 두 번", async () => {
    const png = Uint8Array.from(TINY_PNG);
    const r = await parseHwp(buildHwpImages(), { convertToPng: async () => ({ bytes: png, width: 2, height: 2 }) });
    const texts = r.blocks.map((b) => (b.type === "image" ? `[${b.source}]` : b.type === "table" ? b.cells.map((c) => c.text).join(" ") : b.text));
    expect(texts).toEqual(["그림 앞 문단", "그림 설명 글", "[BinData/BIN0001.png]", "그림 뒤 문단", "칸 글자", "[BinData/BIN0002.bmp]", "표 뒤 문단", "[BinData/BIN0001.png]", "끝 문단"]);
    const imgs = imagesOf(r.blocks);
    expect(sha256(imgs[0].bytes)).toBe(sha256(TINY_PNG));
    expect([imgs[0].width, imgs[0].height]).toEqual([4, 3]);
    expect([imgs[1].mime, imgs[1].width]).toEqual(["image/png", 2]);
    expect(imgs[2].bytes).toBe(imgs[0].bytes);
    expect(imgs.map((b) => b.n)).toEqual([1, 2, 3]);
    expect(r.notes).toContain("그림 1개는 형식(WMF)을 지원하지 않아 가져오지 않았어요.");
  });

  it("HWP: 변환기가 없으면 BMP는 지원하지 않는 형식으로 센다", async () => {
    const r = await parseHwp(buildHwpImages());
    expect(imagesOf(r.blocks).map((b) => b.source)).toEqual(["BinData/BIN0001.png", "BinData/BIN0001.png"]);
    expect(r.notes).toContain("그림 2개는 형식(BMP, WMF)을 지원하지 않아 가져오지 않았어요.");
  });

  it("HWPX: content.hpf → BinData, 배경 그림 제외, WMF·SVG 거부", async () => {
    const r = await parseHwpx(buildHwpxImages());
    const texts = r.blocks.map((b) => (b.type === "image" ? `[${b.source}]` : "text" in b ? b.text : ""));
    expect(texts).toEqual(["그림 앞 문단", "[BinData/image1.png]", "그림 뒤 문단", "끝 문단"]);
    expect(r.notes.some((n) => /그림 2개는 형식\((WMF, SVG|SVG, WMF)\)/.test(n))).toBe(true);
    expect(r.notes.some((n) => /도형·개체 1개/.test(n))).toBe(true);
  });

  it("imageInfo: 머리 바이트로 형식·크기", () => {
    expect(imageInfo(TINY_PNG)).toMatchObject({ kind: "png", supported: true, width: 4, height: 3 });
    expect(imageInfo(Buffer.from("<svg/>")).supported).toBe(false);
  });
});

describe("XML", () => {
  it("문자 참조·CDATA·주석·접두사", () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><a:r x="1 &amp; 2"><b>&#xAC00;&lt;<![CDATA[<i>]]></b><c/></a:r>');
    expect(root.localName).toBe("r");
    expect(root.attrs.x).toBe("1 & 2");
    expect(root.children[0]).toMatchObject({ localName: "b", children: ["가<", "<i>"] });
  });
  it("잘못된 XML은 손상 오류", () => {
    for (const bad of ["<a><b></a>", "<a>", "<a x=1/>", "<a/><b/>"]) expect(() => parseXml(bad), bad).toThrow(/손상/);
  });
});

describe("문서(Tiptap JSON)로 바꾸기", () => {
  it("sample.hwp → 제목·문단·표, 문서 스키마 통과", async () => {
    const r = await parseHwp(read(HWP, "sample.hwp"));
    const { doc, stats, truncated } = blocksToDoc(r.blocks);
    expect(docContentSchema.safeParse(doc).success).toBe(true);
    expect(truncated).toBe(false);
    expect(doc.content?.[0]).toEqual({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "음향 블랙홀 진동 감쇠 실험 보고서" }] });
    const table = doc.content?.find((n) => n.type === "table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0].content?.[0]).toEqual({
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: "paragraph", content: [{ type: "text", text: "조건" }] }],
    });
    expect(stats).toMatchObject({ headings: 2, tables: 1, images: 0 });
  });

  it("줄바꿈 → hardBreak, 수식 → code 마크, 병합 칸, 제목 수준은 4까지", () => {
    const { doc } = blocksToDoc([
      { type: "heading", level: 6, text: "깊은 제목" },
      { type: "paragraph", text: "첫 줄\n둘째[수식: a over b]끝" },
      { type: "table", rows: 2, cols: 3, caption: "", cells: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 2, text: "병합" },
        { row: 0, col: 2, rowSpan: 2, colSpan: 1, text: "세로" },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "a" },
      ] },
    ]);
    const [h, p, t] = doc.content!;
    expect(h.attrs).toEqual({ level: 4 });
    expect(p.content).toEqual([
      { type: "text", text: "첫 줄" },
      { type: "hardBreak" },
      { type: "text", text: "둘째" },
      { type: "text", text: "[수식: a over b]", marks: [{ type: "code" }] },
      { type: "text", text: "끝" },
    ]);
    // (1,1)은 비어 있어 빈 칸으로 채운다
    expect(t.content!.map((row) => row.content!.map((c) => [c.attrs!.colspan, c.attrs!.rowspan]))).toEqual([
      [[2, 1], [1, 2]],
      [[1, 1], [1, 1]],
    ]);
  });

  it("병합에 완전히 가려진 행은 빼고 rowspan을 줄인다", () => {
    const { doc } = blocksToDoc([
      { type: "table", rows: 3, cols: 1, caption: "", cells: [
        { row: 0, col: 0, rowSpan: 2, colSpan: 1, text: "위" },
        { row: 2, col: 0, rowSpan: 1, colSpan: 1, text: "아래" },
      ] },
    ]);
    const t = doc.content![0];
    expect(t.content).toHaveLength(2);
    expect(t.content![0].content![0].attrs!.rowspan).toBe(1);
  });

  it("그림: URL이 있으면 image 노드, 없으면 안내 문단", () => {
    const img: ImageBlock = { type: "image", mime: "image/png", bytes: TINY_PNG, name: "그림 1.png", n: 1, source: "x" };
    const ok = blocksToDoc([img], { imageUrl: () => "/api/assets/abc" });
    expect(ok.doc.content).toEqual([{ type: "image", attrs: { src: "/api/assets/abc", alt: "그림 1", title: null } }]);
    const failed = blocksToDoc([img], { imageUrl: () => null });
    expect(failed.doc.content?.[0].type).toBe("paragraph");
    expect(failed.doc.content?.[0].content?.[0].text).toMatch(/그림 1: 그림을 올리지 못해/);
    expect(failed.stats.imagePlaceholders).toBe(1);
  });

  it("문서 크기 한도를 넘으면 뒤쪽을 잘라 낸다", () => {
    const long = "가".repeat(100_000);
    const blocks: Block[] = Array.from({ length: 80 }, () => ({ type: "paragraph", text: long }));
    const r = blocksToDoc(blocks);
    expect(r.truncated).toBe(true);
    expect(docContentSchema.safeParse(r.doc).success).toBe(true);
  });
});
