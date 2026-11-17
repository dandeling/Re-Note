import { makeTicker, MAX_FILE, sniff, toBytes, utf8, type Bytes } from "./bytes";
import { finish, flatten, headingFromStyle, makeTable, newCtx, pushPara, type Ctx, type WorkBlock } from "./common";
import { fail, isHwpError } from "./errors";
import { resolveImages, type LoadedImage } from "./images";
import type { ParseOptions, ParseResult, TableBlock, TableCell } from "./types";
import { attr, child, descendants, kids, num, parseXml, textContent, type XmlElement } from "./xml";
import { readZip, type ZipReader } from "./zip";

/** HWPX: zip → Contents/header.xml(스타일) + Contents/sectionN.xml → 문단·표·그림 */

type HwpxCtx = Ctx<string | null, string | null>;

function readXml(bytes: Bytes | null): XmlElement {
  if (!bytes) fail("bad_file", "missing xml");
  return parseXml(utf8.decode(bytes));
}

function collectXParas(el: XmlElement, out: XmlElement[] = []): XmlElement[] {
  for (const c of kids(el)) {
    if (c.localName === "p") out.push(c);
    else collectXParas(c, out);
  }
  return out;
}

const SHAPES = new Set(["container", "rect", "ellipse", "arc", "polygon", "curve", "line", "connectLine", "textart", "ole", "chart", "video", "pic"]);

function xText(node: XmlElement): string {
  let s = "";
  for (const n of node.children) {
    if (typeof n === "string") s += n;
    else {
      switch (n.localName) {
        case "tab":
          s += "\t";
          break;
        case "lineBreak":
          s += "\n";
          break;
        case "hyphen":
          s += "-";
          break;
        case "nbSpace":
        case "fwSpace":
          s += " ";
          break;
        default:
          s += xText(n);
      }
    }
  }
  return s;
}

/** 도형 안의 그림 개체(hp:pic). 묶음(container) 안도 찾되 글상자 문단(hp:p) 안으로는 들어가지 않는다 */
function xPictures(el: XmlElement, out: XmlElement[] = []): XmlElement[] {
  if (el.localName === "pic") {
    out.push(el);
    return out;
  }
  for (const c of kids(el)) if (c.localName !== "p") xPictures(c, out);
  return out;
}

/** hp:pic 아래 hc:img(binaryItemIDRef). 채우기 무늬(fillBrush) 속 그림은 배경이라 보지 않는다 */
function xPicImage(pic: XmlElement): XmlElement | null {
  const queue = kids(pic);
  while (queue.length) {
    const c = queue.shift()!;
    if (c.localName === "img" && attr(c, "binaryItemIDRef")) return c;
    if (c.localName !== "p" && c.localName !== "fillBrush" && c.localName !== "pic") queue.push(...kids(c));
  }
  return null;
}

function xParagraph(p: XmlElement, out: WorkBlock[], ctx: HwpxCtx) {
  const heading = ctx.headingOf(attr(p, "styleIDRef"), attr(p, "paraPrIDRef"));
  let buf = "";
  const after: WorkBlock[] = [];
  const flush = () => {
    pushPara(out, buf, heading);
    buf = "";
  };
  const subText = (el: XmlElement) => {
    const sub: WorkBlock[] = [];
    for (const q of collectXParas(el)) xParagraph(q, sub, ctx);
    return flatten(sub, ctx);
  };
  const item = (c: XmlElement) => {
    const name = c.localName;
    if (name === "t") buf += xText(c);
    else if (name === "tbl") {
      flush();
      out.push(xTable(c, ctx));
    } else if (name === "equation") {
      const sc = child(c, "script");
      ctx.stats.equations++;
      buf += `[수식: ${(sc ? textContent(sc) : "").replace(/\s+/g, " ").trim()}]`;
    } else if (name === "ctrl") {
      for (const cc of kids(c)) {
        const k = cc.localName;
        if (k === "header" || k === "footer") ctx.stats.headers++;
        else if (k === "footNote" || k === "endNote") {
          const list = k === "footNote" ? ctx.footnotes : ctx.endnotes;
          const n = list.length + 1;
          buf += k === "footNote" ? `[각주 ${n}]` : `[미주 ${n}]`;
          list.push({ n, text: subText(cc) });
        } else if (k === "hiddenComment") ctx.stats.comments++;
        else if (k === "colPr" && num(cc, "colCount", 1) > 1) ctx.stats.multicol = true;
      }
    } else if (name === "secPr" || name === "linesegarray") {
      /* 쪽 설정·줄 배치 */
    } else if (SHAPES.has(name)) {
      const sub: WorkBlock[] = [];
      for (const q of collectXParas(c)) xParagraph(q, sub, ctx);
      const pics = xPictures(c);
      for (const pic of pics) {
        ctx.stats.pictures++;
        const img = xPicImage(pic);
        after.push({ type: "imageRef", ref: img ? attr(img, "binaryItemIDRef") || "" : "" });
      }
      if (pics.length) {
        /* 그림 */
      } else if (name === "ole" || name === "chart" || name === "video") ctx.stats.ole++;
      else if (sub.some((b) => b.type !== "image" && b.type !== "imageRef")) ctx.stats.textboxes++;
      else ctx.stats.shapes++;
      for (const b of sub) after.push(b);
    } else if (name === "compose" || name === "dutmal") buf += xText(c);
    else for (const q of collectXParas(c)) xParagraph(q, after, ctx);
  };
  for (const c of kids(p)) {
    if (c.localName === "run") kids(c).forEach(item);
    else if (c.localName !== "linesegarray") item(c);
  }
  flush();
  for (const b of ctx.spill.splice(0)) after.push(b);
  for (const b of after) out.push(b);
}

function xTable(tbl: XmlElement, ctx: HwpxCtx): TableBlock {
  const cells: TableCell[] = [];
  const text = (el: XmlElement) => {
    const sub: WorkBlock[] = [];
    for (const q of collectXParas(el)) xParagraph(q, sub, ctx);
    return flatten(sub, ctx);
  };
  let r = 0;
  for (const tr of kids(tbl).filter((x) => x.localName === "tr")) {
    let c = 0;
    for (const tc of kids(tr).filter((x) => x.localName === "tc")) {
      const addr = child(tc, "cellAddr");
      const span = child(tc, "cellSpan");
      const sub = child(tc, "subList") || tc;
      cells.push({ row: num(addr, "rowAddr", r), col: num(addr, "colAddr", c), rowSpan: num(span, "rowSpan", 1), colSpan: num(span, "colSpan", 1), text: text(sub) });
      c++;
    }
    r++;
  }
  const cap = child(tbl, "caption");
  return makeTable(num(tbl, "rowCnt", 0), num(tbl, "colCnt", 0), cells, cap ? text(cap).replace(/\s+/g, " ").trim() : "");
}

type ManifestItem = { href: string; mediaType: string; embedded: boolean };

/** Contents/content.hpf(OPF manifest) → Map(id → { href, mediaType, embedded }) */
async function readHpfManifest(zip: ZipReader): Promise<Map<string, ManifestItem>> {
  const map = new Map<string, ManifestItem>();
  const name = zip.has("Contents/content.hpf") ? "Contents/content.hpf" : zip.names().find((n) => /(^|\/)content\.hpf$/i.test(n));
  if (!name) return map;
  try {
    const doc = readXml(await zip.read(name));
    for (const it of descendants(doc, "item")) {
      const id = attr(it, "id");
      if (id) map.set(id, { href: attr(it, "href") || "", mediaType: attr(it, "media-type") || "", embedded: attr(it, "isEmbeded") !== "0" });
    }
  } catch (e) {
    if (isHwpError(e, "too_large")) throw e;
    /* manifest 없이 BinData/<id>.* 로 찾아 본다 */
  }
  return map;
}

/** HWPX 그림 id → 그림 바이트 */
async function loadHwpxBin(zip: ZipReader, manifest: Map<string, ManifestItem>, id: string): Promise<LoadedImage> {
  const names = zip.names();
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const m = manifest.get(id);
  let path = "";
  if (m) {
    if (!m.embedded) return { missing: true };
    let href = m.href.replace(/^\.?\//, "");
    try {
      href = decodeURIComponent(href);
    } catch {
      /* 그대로 */
    }
    for (const cand of [href, "Contents/" + href]) {
      const hit = lower.get(cand.toLowerCase());
      if (hit) {
        path = hit;
        break;
      }
    }
  }
  if (!path) {
    const want = String(id).toLowerCase();
    path = names.find((n) => /^bindata\//i.test(n) && n.slice(8).replace(/\.[^.]*$/, "").toLowerCase() === want) || "";
  }
  if (!path || !/^(Contents\/)?BinData\//i.test(path)) return { missing: true };
  const bytes = await zip.read(path);
  if (!bytes || !bytes.length) return { missing: true };
  return { bytes, ext: (/\.([^./]+)$/.exec(path) || [])[1] || "", source: path };
}

/** HWPX 바이트 → { blocks, notes, stats } */
export async function parseHwpx(input: ArrayBuffer | ArrayBufferView, opts: ParseOptions = {}): Promise<ParseResult> {
  const bytes = toBytes(input);
  if (bytes.length > MAX_FILE) fail("too_large");
  const kind = sniff(bytes);
  if (kind === "hwp3") fail("old_hwp");
  if (kind !== "hwpx") fail(kind === "hwp" ? "bad_file" : "not_hwp");
  const tick = makeTicker(opts.onProgress);
  const zip = await readZip(bytes);
  const sectionNames = zip
    .names()
    .map((n) => ({ n, m: /^Contents\/section(\d+)\.xml$/i.exec(n) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => !!x.m)
    .sort((a, z) => Number(a.m[1]) - Number(z.m[1]))
    .map((x) => x.n);
  let mime = "";
  if (zip.has("mimetype")) {
    try {
      mime = utf8.decode((await zip.read("mimetype")) ?? new Uint8Array(0)).trim();
    } catch {
      mime = "";
    }
  }
  if (!sectionNames.length) {
    if (zip.partial || /hwp/i.test(mime) || zip.has("Contents/header.xml") || zip.has("Contents/content.hpf")) fail("bad_file", "no sections");
    fail("not_hwp", "zip without sections");
  }
  if (zip.has("META-INF/manifest.xml")) {
    try {
      if (/encryption-data|EncryptionData/i.test(utf8.decode((await zip.read("META-INF/manifest.xml")) ?? new Uint8Array(0)))) fail("encrypted");
    } catch (e) {
      if (isHwpError(e, "encrypted")) throw e;
    }
  }

  // 스타일(이름 "개요 N")과 문단 모양(heading OUTLINE)
  const styles = new Map<string | null, number>();
  const paraHeads = new Map<string | null, number>();
  if (zip.has("Contents/header.xml")) {
    try {
      const hd = readXml(await zip.read("Contents/header.xml"));
      for (const st of descendants(hd, "style")) styles.set(attr(st, "id"), headingFromStyle(attr(st, "name"), attr(st, "engName")));
      for (const pp of descendants(hd, "paraPr")) {
        const hdg = child(pp, "heading");
        if (hdg && attr(hdg, "type") === "OUTLINE") paraHeads.set(attr(pp, "id"), num(hdg, "level", 0) + 1);
      }
    } catch (e) {
      if (isHwpError(e, "too_large")) throw e;
      /* 스타일 없이 */
    }
  }
  const headingOf = (styleId: string | null, paraPrId: string | null) => styles.get(styleId) || paraHeads.get(paraPrId) || 0;

  const ctx: HwpxCtx = newCtx(headingOf);
  const sections: WorkBlock[][] = [];
  for (let si = 0; si < sectionNames.length; si++) {
    await tick(si / sectionNames.length);
    let doc: XmlElement;
    try {
      doc = readXml(await zip.read(sectionNames[si]));
    } catch (e) {
      if (isHwpError(e, "too_large", "unsupported")) throw e;
      if (si === 0) throw e;
      ctx.stats.partial = true;
      break;
    }
    const out: WorkBlock[] = [];
    const paras = kids(doc).filter((c) => c.localName === "p");
    for (let k = 0; k < paras.length; k++) {
      xParagraph(paras[k], out, ctx);
      if ((k & 31) === 0) await tick((si + k / paras.length) / sectionNames.length);
    }
    sections.push(out);
  }
  if (zip.partial) ctx.stats.partial = true;
  let manifest: Promise<Map<string, ManifestItem>> | null = null;
  const resolved = await resolveImages(
    sections,
    ctx,
    async (ref) => {
      manifest ??= readHpfManifest(zip);
      return loadHwpxBin(zip, await manifest, String(ref));
    },
    opts.convertToPng,
  );
  opts.onProgress?.(1);
  return finish(ctx, resolved);
}
