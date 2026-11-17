import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { ConversionError } from "@/lib/conversion/to-pdf";
import { describeRun, runProcess } from "@/lib/conversion/run";

/**
 * PDF → 중간 형식 HTML (poppler, 별도 프로세스).
 *
 * - `pdftotext -bbox-layout`: 블록(문단)·줄·단어와 좌표. 블록 하나를 문단 하나로 본다.
 * - `pdftohtml -xml`: 글자 조각의 글꼴 크기와 그림(파일 + 위치). 본문보다 큰 글꼴의 짧은 블록을 제목으로 본다.
 * - 표: 같은 높이에 한 줄짜리 블록이 둘 이상 나란히 있는 줄이 연속되면 표로 묶는다 (칸 위치 추정).
 * - 스캔 PDF: 쪽은 있는데 글자가 거의 없으면 scanned=true.
 */

type Box = { xMin: number; yMin: number; xMax: number; yMax: number };
type TextBlock = Box & { page: number; lines: string[]; size: number };
type PdfImage = { page: number; top: number; left: number; file: string };
type Fragment = { page: number; top: number; left: number; width: number; height: number; size: number; chars: number };

export type PdfExtraction = {
  html: string;
  images: Map<string, { filename: string; bytes: Uint8Array }>;
  pages: number;
  scanned: boolean;
  tables: number;
};

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.ChildNode;
const isElement = (node: Node): node is Element => "tagName" in node;
const num = (el: Element, name: string) => Number(el.attrs.find((a) => a.name === name)?.value ?? 0);
const textOf = (node: Node): string =>
  node.nodeName === "#text" ? (node as DefaultTreeAdapterTypes.TextNode).value : isElement(node) ? node.childNodes.map(textOf).join("") : "";

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 이 글자 수보다 적으면 스캔 PDF로 본다 (쪽 번호 같은 몇 글자는 무시) */
const SCANNED_MAX_CHARS = 20;
const MAX_IMAGES = 200;

function elements(root: Node, tag: string): Element[] {
  const out: Element[] = [];
  const walk = (node: Node) => {
    if (isElement(node) && node.tagName === tag) out.push(node);
    else if ("childNodes" in node) (node.childNodes as Node[]).forEach(walk);
  };
  walk(root);
  return out;
}

/** pdftotext -bbox-layout 결과 → 쪽별 블록 */
function parseBlocks(xhtml: string): { blocks: TextBlock[]; pages: number } {
  const doc = parse(xhtml);
  const pages = elements(doc as unknown as Node, "page");
  const blocks: TextBlock[] = [];
  pages.forEach((page, index) => {
    for (const block of elements(page, "block")) {
      const lines = elements(block, "line")
        .map((line) => elements(line, "word").map((w) => textOf(w).trim()).filter(Boolean).join(" "))
        .filter(Boolean);
      if (!lines.length) continue;
      blocks.push({ page: index + 1, lines, size: 0, xMin: num(block, "xmin"), yMin: num(block, "ymin"), xMax: num(block, "xmax"), yMax: num(block, "ymax") });
    }
  });
  return { blocks, pages: pages.length };
}

/** pdftohtml -xml 결과 → 글자 조각(글꼴 크기)과 그림 */
function parseXml(xml: string): { fragments: Fragment[]; images: PdfImage[] } {
  const fragments: Fragment[] = [];
  const images: PdfImage[] = [];
  const sizes = new Map<string, number>();
  let page = 0;
  const tag = /<(page|fontspec|image)\b([^>]*)>|<(text)\b([^>]*)>([\s\S]*?)<\/text>/g;
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";
  for (const match of xml.matchAll(tag)) {
    const kind = match[1] ?? match[3];
    const attrs = match[2] ?? match[4] ?? "";
    const inner = match[5];
    if (kind === "page") page = Number(attr(attrs, "number")) || page + 1;
    else if (kind === "fontspec") sizes.set(attr(attrs, "id"), Number(attr(attrs, "size")));
    else if (kind === "text") {
      const chars = (inner ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
      if (!chars) continue;
      fragments.push({
        page,
        top: Number(attr(attrs, "top")),
        left: Number(attr(attrs, "left")),
        width: Number(attr(attrs, "width")),
        height: Number(attr(attrs, "height")),
        size: sizes.get(attr(attrs, "font")) ?? 0,
        chars,
      });
    } else if (kind === "image") {
      images.push({ page, top: Number(attr(attrs, "top")), left: Number(attr(attrs, "left")), file: attr(attrs, "src") });
    }
  }
  return { fragments, images };
}

/** 블록마다 가장 많은 글자가 쓴 글꼴 크기 */
function assignSizes(blocks: TextBlock[], fragments: Fragment[]) {
  for (const block of blocks) {
    const weights = new Map<number, number>();
    for (const f of fragments) {
      if (f.page !== block.page) continue;
      const cx = f.left + f.width / 2;
      const cy = f.top + f.height / 2;
      if (cx < block.xMin - 2 || cx > block.xMax + 2 || cy < block.yMin - 2 || cy > block.yMax + 2) continue;
      weights.set(f.size, (weights.get(f.size) ?? 0) + f.chars);
    }
    block.size = [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  }
}

function bodySize(blocks: TextBlock[]) {
  const weights = new Map<number, number>();
  for (const b of blocks) weights.set(b.size, (weights.get(b.size) ?? 0) + b.lines.join("").length);
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

type Item = { kind: "block"; block: TextBlock } | { kind: "row"; cells: TextBlock[] } | { kind: "image"; src: string; page: number };

/** 같은 높이에 나란히 놓인 한 줄짜리 블록들을 표의 행으로 묶는다 */
function groupRows(blocks: TextBlock[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < blocks.length; ) {
    const first = blocks[i];
    const row = [first];
    let j = i + 1;
    while (
      j < blocks.length &&
      blocks[j].page === first.page &&
      Math.abs(blocks[j].yMin - first.yMin) <= 3 &&
      blocks[j].xMin > row.at(-1)!.xMax - 1
    ) {
      row.push(blocks[j]);
      j += 1;
    }
    if (row.length >= 2 && row.every((b) => b.lines.length <= 2)) items.push({ kind: "row", cells: row });
    else items.push({ kind: "block", block: first });
    i = row.length >= 2 && items.at(-1)?.kind === "row" ? j : i + 1;
  }
  return items;
}

export async function extractPdfStructure(input: string, workDir: string, deadline: number): Promise<PdfExtraction> {
  const pdfPath = path.resolve(input);
  const remaining = () => Math.max(1000, deadline - Date.now());
  const bboxPath = path.join(workDir, "bbox.html");
  const bbox = await runProcess(process.env.PDFTOTEXT_BIN || "pdftotext", ["-q", "-bbox-layout", pdfPath, bboxPath], { timeoutMs: remaining() });
  if (bbox.outcome === "unavailable") throw new ConversionError("NO_ENGINE", [{ engine: "pdftotext", outcome: "unavailable", ms: bbox.ms }]);
  if (bbox.outcome === "timeout") throw new ConversionError("TIMEOUT", [{ engine: "pdftotext", outcome: "timeout", ms: bbox.ms }]);
  if (bbox.outcome !== "ok") throw new ConversionError("CORRUPT", [{ engine: "pdftotext", outcome: bbox.outcome, ms: bbox.ms, detail: describeRun(bbox) }]);
  const { blocks, pages } = parseBlocks(await readFile(bboxPath, "utf8"));
  if (pages === 0) throw new ConversionError("CORRUPT");

  const xmlDir = path.join(workDir, "xml");
  await mkdir(xmlDir, { recursive: true });
  const xmlRun = await runProcess(process.env.PDFTOHTML_BIN || "pdftohtml", ["-xml", "-q", "-nodrm", "-zoom", "1", pdfPath, path.join(xmlDir, "out")], {
    timeoutMs: remaining(),
    cwd: workDir,
  }).catch(() => null);
  let fragments: Fragment[] = [];
  let pdfImages: PdfImage[] = [];
  if (xmlRun?.outcome === "ok") {
    ({ fragments, images: pdfImages } = parseXml(await readFile(path.join(xmlDir, "out.xml"), "utf8").catch(() => "")));
  }

  const totalChars = blocks.reduce((sum, b) => sum + b.lines.join("").replace(/\s+/g, "").length, 0);
  if (totalChars < SCANNED_MAX_CHARS) return { html: "", images: new Map(), pages, scanned: true, tables: 0 };

  assignSizes(blocks, fragments);
  const body = bodySize(blocks);
  const headingSizes = [...new Set(blocks.filter((b) => isHeading(b, body)).map((b) => b.size))].sort((a, b) => b - a);
  const level = (size: number) => Math.min(4, headingSizes.indexOf(size) + 1);

  // 그림: 같은 쪽에서 그림보다 아래에 있는 첫 블록 앞에 끼운다
  const images = new Map<string, { filename: string; bytes: Uint8Array }>();
  const files = new Set(await readdir(xmlDir).catch(() => [] as string[]));
  const items = groupRows(blocks);
  const placed: Item[] = [];
  const pending = pdfImages.filter((img) => files.has(path.basename(img.file))).slice(0, MAX_IMAGES);
  for (const img of pending) {
    const src = `pdf-image:${images.size + 1}`;
    const ext = path.extname(img.file).toLowerCase() === ".jpg" ? "jpg" : "png";
    images.set(src, { filename: `pdf-image-${images.size + 1}.${ext}`, bytes: new Uint8Array(await readFile(path.join(xmlDir, path.basename(img.file)))) });
    (img as PdfImage & { src?: string }).src = src;
  }
  const queue = [...pending] as (PdfImage & { src: string })[];
  for (const item of items) {
    const anchor = item.kind === "block" ? item.block : item.kind === "row" ? item.cells[0] : null;
    if (anchor) {
      while (queue.length && (queue[0].page < anchor.page || (queue[0].page === anchor.page && queue[0].top <= anchor.yMin))) {
        const img = queue.shift()!;
        placed.push({ kind: "image", src: img.src, page: img.page });
      }
    }
    placed.push(item);
  }
  for (const img of queue) placed.push({ kind: "image", src: img.src, page: img.page });

  // HTML로 쓴다. 연속된 행은 하나의 표로 묶는다.
  let html = "";
  let tables = 0;
  for (let i = 0; i < placed.length; i++) {
    const item = placed[i];
    if (item.kind === "image") html += `<img src="${escapeHtml(item.src)}" alt="">`;
    else if (item.kind === "block") {
      const text = escapeHtml(item.block.lines.join(" "));
      html += isHeading(item.block, body) ? `<h${level(item.block.size)}>${text}</h${level(item.block.size)}>` : `<p>${text}</p>`;
    } else {
      const rows: TextBlock[][] = [item.cells];
      while (placed[i + 1]?.kind === "row") rows.push((placed[++i] as Extract<Item, { kind: "row" }>).cells);
      if (rows.length === 1) {
        html += `<p>${escapeHtml(item.cells.map((c) => c.lines.join(" ")).join(" "))}</p>`;
        continue;
      }
      tables += 1;
      html += "<table>";
      for (const row of rows) html += `<tr>${row.map((c) => `<td>${escapeHtml(c.lines.join(" "))}</td>`).join("")}</tr>`;
      html += "</table>";
    }
  }
  return { html, images, pages, scanned: false, tables };
}

function isHeading(block: TextBlock, body: number) {
  const text = block.lines.join(" ");
  return body > 0 && block.size >= body * 1.25 && block.lines.length <= 3 && text.length <= 150;
}
