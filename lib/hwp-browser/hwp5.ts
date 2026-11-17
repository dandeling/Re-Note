import { ascii, fourCC, inflateRaw, makeTicker, MAX_FILE, MAX_INFLATED, sniff, toBytes, u16, u32, utf16, type Budget, type Bytes } from "./bytes";
import { readCfb, type CfbReader } from "./cfb";
import { finish, flatten, headingFromStyle, makeTable, newCtx, pushPara, type Ctx, type WorkBlock } from "./common";
import { fail, isHwpError } from "./errors";
import { imageInfo, resolveImages, type LoadedImage } from "./images";
import type { ParseOptions, ParseResult, TableBlock, TableCell } from "./types";

/**
 * HWP 5.x: Compound File → FileHeader → DocInfo(스타일·문단 모양·BinData) → BodyText/SectionN(raw deflate)
 * → 레코드 트리 → 문단·표·그림.
 */

const TAG = {
  BIN_DATA: 18,
  PARA_SHAPE: 25,
  STYLE: 26,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  SHAPE_COMPONENT: 76,
  TABLE: 77,
  OLE: 84,
  PICTURE: 85,
  EQEDIT: 88,
} as const;
// 1글자(WCHAR 하나)짜리 제어 문자. 나머지 0x01~0x1f는 8 WCHAR(인라인·확장 컨트롤)
const CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
const EXT_CTRL = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

type Rec = { tag: number; level: number; data: Bytes; children: Rec[] };
type HwpCtx = Ctx<number, number>;

/** 레코드 목록 → { list, truncated } (헤더: 태그 10비트·레벨 10비트·크기 12비트, 0xFFF면 다음 4바이트) */
function readRecords(d: Bytes): { list: Rec[]; truncated: boolean } {
  const list: Rec[] = [];
  let o = 0;
  let truncated = false;
  while (o + 4 <= d.length) {
    const hd = u32(d, o);
    o += 4;
    let size = hd >>> 20;
    if (size === 0xfff) {
      if (o + 4 > d.length) {
        truncated = true;
        break;
      }
      size = u32(d, o);
      o += 4;
    }
    if (o + size > d.length) {
      truncated = true;
      break;
    }
    list.push({ tag: hd & 0x3ff, level: (hd >>> 10) & 0x3ff, data: d.subarray(o, o + size), children: [] });
    o += size;
  }
  return { list, truncated };
}

/** 레벨로 트리를 만든다. 반환: 최상위 노드 배열 */
function buildTree(list: Rec[]): Rec[] {
  const top: Rec[] = [];
  const stack: Rec[] = [];
  for (const r of list) {
    r.children = [];
    while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : top).push(r);
    stack.push(r);
  }
  return top;
}

const chidOf = (node: Rec) => (node.data.length >= 4 ? fourCC(node.data, 0) : "");

/** 컨트롤 안의 문단(PARA_HEADER)을 차례로 모은다(문단 안으로는 들어가지 않는다) */
function collectParas(node: Rec, out: Rec[] = []): Rec[] {
  for (const c of node.children) {
    if (c.tag === TAG.PARA_HEADER) out.push(c);
    else collectParas(c, out);
  }
  return out;
}
const hasTag = (node: Rec, tag: number): boolean => node.children.some((c) => c.tag === tag || hasTag(c, tag));

/** 컨트롤 아래의 그림 개체 레코드(문단 안으로는 들어가지 않는다 — 그 안의 그림은 그 문단이 처리한다) */
function findPictures(node: Rec, out: Rec[] = []): Rec[] {
  for (const c of node.children) {
    if (c.tag === TAG.PARA_HEADER) continue;
    if (c.tag === TAG.PICTURE) out.push(c);
    findPictures(c, out);
  }
  return out;
}
// 그림 개체(HWPTAG_SHAPE_COMPONENT_PICTURE): 테두리 12 + 좌표 32 + 자르기 16 + 여백 8 + 밝기·명암·효과 3 → BinData id(UINT16, 1부터)
const pictureBinId = (rec: Rec) => (rec.data.length >= 73 ? u16(rec.data, 71) : 0);

function hwpParagraph(node: Rec, out: WorkBlock[], ctx: HwpCtx) {
  const d = node.data;
  const heading = ctx.headingOf(d.length > 10 ? d[10] : -1, d.length > 9 ? u16(d, 8) : -1);
  let textRec: Rec | null = null;
  const ctrls: Rec[] = [];
  for (const c of node.children) {
    if (c.tag === TAG.PARA_TEXT && !textRec) textRec = c;
    else if (c.tag === TAG.CTRL_HEADER) ctrls.push(c);
  }
  let buf = "";
  const after: WorkBlock[] = [];
  const used = new Set<number>();
  const flush = () => {
    pushPara(out, buf, heading);
    buf = "";
  };
  const take = (chid: string) => {
    for (let k = 0; k < ctrls.length; k++) {
      if (!used.has(k) && (!chid || chidOf(ctrls[k]) === chid)) {
        used.add(k);
        return ctrls[k];
      }
    }
    return null;
  };
  const subText = (ctrl: Rec) => {
    const sub: WorkBlock[] = [];
    for (const p of collectParas(ctrl)) hwpParagraph(p, sub, ctx);
    return flatten(sub, ctx);
  };
  const handle = (ctrl: Rec) => {
    const chid = chidOf(ctrl);
    switch (chid) {
      case "tbl ":
        flush();
        out.push(hwpTable(ctrl, ctx));
        break;
      case "eqed": {
        const eq = ctrl.children.find((c) => c.tag === TAG.EQEDIT);
        let script = "";
        if (eq && eq.data.length >= 6) {
          const n = u16(eq.data, 4);
          script = utf16.decode(eq.data.subarray(6, Math.min(eq.data.length, 6 + n * 2)));
        }
        ctx.stats.equations++;
        buf += `[수식: ${script.replace(/\s+/g, " ").trim()}]`;
        break;
      }
      case "gso ": {
        const sub: WorkBlock[] = [];
        for (const p of collectParas(ctrl)) hwpParagraph(p, sub, ctx);
        const pics = findPictures(ctrl);
        // 그림은 이 컨트롤이 속한 문단 바로 뒤에(캡션 문단보다 앞에) 자리 표시로 넣고, 읽은 뒤 실제 그림으로 바꾼다
        for (const pic of pics) {
          ctx.stats.pictures++;
          after.push({ type: "imageRef", ref: pictureBinId(pic) });
        }
        if (pics.length || hasTag(ctrl, TAG.PICTURE)) {
          /* 그림 */
        } else if (hasTag(ctrl, TAG.OLE)) ctx.stats.ole++;
        else if (sub.some((b) => b.type !== "image" && b.type !== "imageRef")) ctx.stats.textboxes++;
        else ctx.stats.shapes++;
        for (const b of sub) after.push(b);
        break;
      }
      case "head":
      case "foot":
        ctx.stats.headers++;
        break;
      case "fn  ":
      case "en  ": {
        const list = chid === "fn  " ? ctx.footnotes : ctx.endnotes;
        const n = list.length + 1;
        buf += chid === "fn  " ? `[각주 ${n}]` : `[미주 ${n}]`;
        list.push({ n, text: subText(ctrl) });
        break;
      }
      case "tcmt":
        ctx.stats.comments++;
        break;
      case "cold":
        if (ctrl.data.length >= 6 && ((u16(ctrl.data, 4) >> 2) & 0xff) > 1) ctx.stats.multicol = true;
        break;
      default: {
        // 덧말·필드·책갈피 등은 본문 글자에 이미 들어 있다. 그 밖에 문단을 품은 컨트롤은 아래에 문단으로.
        if (chid === "tdut" || chid.startsWith("%")) break;
        for (const p of collectParas(ctrl)) hwpParagraph(p, after, ctx);
      }
    }
  };
  if (textRec) {
    const t = textRec.data;
    const n = t.length >> 1;
    let i = 0;
    while (i < n) {
      const c = u16(t, i * 2);
      if (c >= 32) {
        let j = i + 1;
        while (j < n && u16(t, j * 2) >= 32) j++;
        buf += utf16.decode(t.subarray(i * 2, j * 2));
        i = j;
        continue;
      }
      if (CHAR_CTRL.has(c)) {
        if (c === 10) buf += "\n";
        else if (c === 24) buf += "-";
        else if (c === 30 || c === 31) buf += " ";
        i++;
        continue;
      }
      if (c === 9) buf += "\t";
      else if (EXT_CTRL.has(c)) {
        const chid = i * 2 + 6 <= t.length ? fourCC(t, i * 2 + 2) : "";
        const ctrl = take(chid);
        if (ctrl) handle(ctrl);
      }
      i += 8;
    }
  }
  // 글자 안에 자리가 없는(남은) 컨트롤도 놓치지 않는다
  for (let k = 0; k < ctrls.length; k++) if (!used.has(k)) handle(ctrls[k]);
  flush();
  for (const b of ctx.spill.splice(0)) after.push(b);
  for (const b of after) out.push(b);
}

function hwpTable(ctrl: Rec, ctx: HwpCtx): TableBlock {
  let declRows = 0;
  let declCols = 0;
  let seenTable = false;
  type RawCell = { col: number; row: number; colSpan: number; rowSpan: number; paras: Rec[] };
  let cur: { paras: Rec[] } | null = null;
  const cells: RawCell[] = [];
  const captionParas: Rec[] = [];
  for (const c of ctrl.children) {
    if (c.tag === TAG.TABLE && c.data.length >= 8) {
      declRows = u16(c.data, 4);
      declCols = u16(c.data, 6);
      seenTable = true;
    } else if (c.tag === TAG.LIST_HEADER) {
      if (seenTable && c.data.length >= 16) {
        const cell: RawCell = { col: u16(c.data, 8), row: u16(c.data, 10), colSpan: u16(c.data, 12), rowSpan: u16(c.data, 14), paras: [] };
        cells.push(cell);
        cur = cell;
      } else cur = { paras: captionParas };
    } else if (c.tag === TAG.PARA_HEADER && cur) cur.paras.push(c);
  }
  const text = (paras: Rec[]) => {
    const sub: WorkBlock[] = [];
    for (const p of paras) hwpParagraph(p, sub, ctx);
    return flatten(sub, ctx);
  };
  const out: TableCell[] = cells.map((c) => ({ row: c.row, col: c.col, rowSpan: c.rowSpan, colSpan: c.colSpan, text: text(c.paras) }));
  return makeTable(declRows, declCols, out, text(captionParas).replace(/\s+/g, " ").trim());
}

type BinDataEntry = { type: number; comp: number; storageId: number; ext: string };

/** DocInfo의 HWPTAG_BIN_DATA → { type: 0 연결|1 포함|2 OLE 저장소, comp: 0 문서 설정|1 압축|2 압축 안 함, storageId, ext } */
function readBinDataRecord(d: Bytes): BinDataEntry {
  if (d.length < 2) return { type: -1, comp: 0, storageId: 0, ext: "" };
  const f = u16(d, 0);
  const e: BinDataEntry = { type: f & 0xf, comp: (f >> 4) & 3, storageId: 0, ext: "" };
  if ((e.type === 1 || e.type === 2) && d.length >= 4) e.storageId = u16(d, 2);
  if (e.type === 1 && d.length >= 6) {
    const n = u16(d, 4);
    e.ext = utf16.decode(d.subarray(6, Math.min(d.length, 6 + n * 2))).trim().toLowerCase();
  }
  return e;
}

/** HWP 그림 개체의 BinData id(1부터, DocInfo 순서) → 그림 바이트 */
async function loadHwpBin(cfb: CfbReader, binData: BinDataEntry[], ref: number, docCompressed: boolean, budget: Budget): Promise<LoadedImage> {
  const e = ref > 0 ? binData[ref - 1] : null;
  if (!e || e.type === 0) return { missing: true }; // 연결된(밖에 있는) 그림
  if (e.type !== 1) return { unsupported: "OLE" };
  const base = "BinData/BIN" + e.storageId.toString(16).toUpperCase().padStart(4, "0");
  let path = base + "." + e.ext;
  if (!cfb.has(path)) {
    const want = path.toLowerCase();
    path = cfb.names().find((n) => n.toLowerCase() === want) || "";
    if (!path) return { missing: true };
  }
  const raw = cfb.read(path);
  if (!raw || !raw.length) return { missing: true };
  const compressed = e.comp === 1 || (e.comp === 0 && docCompressed);
  // 압축 표시가 있어도 실제로는 안 된 경우가 있어, 풀린 쪽이 알아볼 수 있는 형식일 때만 바꾼다
  let bytes = raw;
  const rawKnown = !!imageInfo(raw).kind;
  if (compressed || !rawKnown) {
    try {
      const r = await inflateRaw(raw, budget);
      if (r.data.length && (imageInfo(r.data).kind || !rawKnown)) bytes = r.data;
    } catch (err) {
      if (isHwpError(err, "too_large")) throw err;
      /* 그대로 써 본다 */
    }
  }
  return { bytes, ext: e.ext, source: path };
}

/** HWP 5.x 바이트 → { blocks, notes, stats } */
export async function parseHwp(input: ArrayBuffer | ArrayBufferView, opts: ParseOptions = {}): Promise<ParseResult> {
  const bytes = toBytes(input);
  if (bytes.length > MAX_FILE) fail("too_large");
  const kind = sniff(bytes);
  if (kind === "hwp3") fail("old_hwp");
  if (kind !== "hwp") fail(kind === "hwpx" ? "bad_file" : "not_hwp");
  const tick = makeTicker(opts.onProgress);
  const cfb = readCfb(bytes);
  const fh = cfb.read("FileHeader");
  if (!fh) {
    if (cfb.names().length) fail("not_hwp", "no FileHeader"); // 다른 프로그램의 OLE 파일(.doc 등)
    fail("bad_file", "empty cfb");
  }
  if (fh.length < 40 || ascii(fh, 0, 17) !== "HWP Document File") fail("not_hwp", "signature");
  const version = u32(fh, 32);
  const flags = u32(fh, 36);
  const major = version >>> 24;
  if (major && major < 5) fail("old_hwp");
  if (flags & 2) fail("encrypted");
  if (flags & 16) fail("encrypted", "drm");
  if (flags & 4 || (!cfb.has("BodyText/Section0") && cfb.has("ViewText/Section0"))) fail("distribution");
  const compressed = !!(flags & 1);
  const budget: Budget = { left: MAX_INFLATED };
  let partial = false;
  const unpack = async (raw: Bytes | null): Promise<Bytes> => {
    if (!raw) fail("bad_file", "missing stream");
    if (!compressed) return raw;
    // 끝까지 풀리지 않았어도 풀린 만큼은 쓰고, 실제로 잘렸는지는 레코드가 중간에 끊기는지로 판단한다.
    const r = await inflateRaw(raw, budget);
    if (!r.complete && !r.data.length) fail("bad_file", "inflate");
    return r.data;
  };

  // DocInfo: 스타일 이름과 문단 모양(개요 수준), BinData 목록
  const styles: { name: string; eng: string }[] = [];
  const paraShapes: number[] = [];
  const binData: BinDataEntry[] = [];
  const di = cfb.read("DocInfo");
  if (di) {
    try {
      const { list } = readRecords(await unpack(di));
      for (const r of list) {
        if (r.tag === TAG.PARA_SHAPE && r.data.length >= 4) paraShapes.push(u32(r.data, 0));
        else if (r.tag === TAG.BIN_DATA) binData.push(readBinDataRecord(r.data));
        else if (r.tag === TAG.STYLE && r.data.length >= 2) {
          const d = r.data;
          const n1 = u16(d, 0);
          const name = utf16.decode(d.subarray(2, Math.min(d.length, 2 + n1 * 2)));
          const o2 = 2 + n1 * 2;
          const n2 = o2 + 2 <= d.length ? u16(d, o2) : 0;
          const eng = utf16.decode(d.subarray(o2 + 2, Math.min(d.length, o2 + 2 + n2 * 2)));
          styles.push({ name, eng });
        }
      }
    } catch (e) {
      if (isHwpError(e, "too_large")) throw e;
      /* 스타일 없이도 본문은 읽는다 */
    }
  }
  const headingOf = (styleId: number, psId: number) => {
    const st = styles[styleId];
    let lvl = st ? headingFromStyle(st.name, st.eng) : 0;
    if (!lvl && paraShapes[psId] != null) {
      const f = paraShapes[psId];
      if (((f >>> 23) & 3) === 1) lvl = ((f >>> 25) & 7) + 1; // 문단 머리 모양 = 개요
    }
    return lvl;
  };

  const names: string[] = [];
  for (let i = 0; cfb.has("BodyText/Section" + i); i++) names.push("BodyText/Section" + i);
  if (!names.length) fail("bad_file", "no sections");
  const ctx: HwpCtx = newCtx(headingOf);
  const sections: WorkBlock[][] = [];
  for (let si = 0; si < names.length; si++) {
    await tick(si / names.length);
    let data: Bytes;
    try {
      data = await unpack(cfb.read(names[si]));
    } catch (e) {
      if (isHwpError(e, "too_large", "unsupported")) throw e;
      if (si === 0) fail("bad_file", "section");
      partial = true;
      break;
    }
    const { list, truncated } = readRecords(data);
    if (truncated) partial = true;
    if (!list.length && si === 0 && data.length) fail("bad_file", "no records");
    const top = buildTree(list);
    const out: WorkBlock[] = [];
    for (let k = 0; k < top.length; k++) {
      if (top[k].tag === TAG.PARA_HEADER) hwpParagraph(top[k], out, ctx);
      if ((k & 63) === 0) await tick((si + k / top.length) / names.length);
    }
    sections.push(out);
  }
  ctx.stats.partial = partial;
  const resolved = await resolveImages(sections, ctx, (ref) => loadHwpBin(cfb, binData, Number(ref), compressed, budget), opts.convertToPng);
  opts.onProgress?.(1);
  return finish(ctx, resolved);
}
