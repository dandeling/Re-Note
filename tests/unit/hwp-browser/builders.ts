/**
 * 브라우저 HWP 파서 테스트용 합성 파일(CFB/HWP 5, ZIP/HWPX). artifact/tests/d-convert.spec.cjs의 만들기 함수를 옮겼다.
 * 픽스처에 없는 경우(수식·병합·각주·머리말·암호·배포용·그림 형식)를 시험한다.
 */
import zlib from "node:zlib";

const le16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const le32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const wstr = (s: string) => Buffer.from(s, "utf16le");
const bstr = (s: string) => Buffer.concat([le16(s.length), wstr(s)]);
const chidBytes = (id: string) => Buffer.from(id.split("").reverse().join(""), "latin1");

function rec(tag: number, level: number, data: Buffer) {
  const size = data.length;
  return size < 0xfff
    ? Buffer.concat([le32(tag | (level << 10) | (size << 20)), data])
    : Buffer.concat([le32(tag | (level << 10) | (0xfff << 20)), le32(size), data]);
}

type TextPart = string | { ctrl: number; id?: string } | { ch: number };

function paraText(parts: TextPart[]) {
  const bufs: Buffer[] = [];
  for (const p of parts) {
    if (typeof p === "string") bufs.push(wstr(p));
    else if ("ctrl" in p) bufs.push(Buffer.concat([le16(p.ctrl), chidBytes(p.id || "\0\0\0\0"), Buffer.alloc(8), le16(p.ctrl)]));
    else bufs.push(le16(p.ch));
  }
  bufs.push(le16(13));
  return Buffer.concat(bufs);
}

function paragraph(level: number, parts: TextPart[], { style = 0, parashape = 0, ctrls = [] as Buffer[] } = {}) {
  const text = paraText(parts);
  const hdr = Buffer.concat([le32(text.length / 2), le32(0), le16(parashape), Buffer.from([style, 0]), le16(1), le16(0), le16(0), le32(0)]);
  return Buffer.concat([rec(66, level, hdr), rec(67, level + 1, text), ...ctrls]);
}
const ctrlHeader = (level: number, id: string, children: Buffer[] = []) => Buffer.concat([rec(71, level, Buffer.concat([chidBytes(id), Buffer.alloc(40)])), ...children]);
const listHeader = (level: number, nparas: number, extra = Buffer.alloc(0)) => rec(72, level, Buffer.concat([le16(nparas), le16(0), le32(0), extra]));

type CellSpec = [row: number, col: number, rowSpan: number, colSpan: number, text: string];
function cell(level: number, [row, col, rowSpan, colSpan, text]: CellSpec) {
  return Buffer.concat([listHeader(level, 1, Buffer.concat([le16(col), le16(row), le16(colSpan), le16(rowSpan), Buffer.alloc(22)])), paragraph(level, [text])]);
}
function tableCtrl(level: number, rows: number, cols: number, cells: CellSpec[]) {
  return ctrlHeader(level, "tbl ", [rec(77, level + 1, Buffer.concat([le32(0), le16(rows), le16(cols), Buffer.alloc(20)])), ...cells.map((c) => cell(level + 1, c))]);
}
function docInfo() {
  const style = (name: string, eng: string) => rec(26, 0, Buffer.concat([bstr(name), bstr(eng), Buffer.from([0, 0]), le16(1042), le16(0), le16(0), Buffer.alloc(2)]));
  return Buffer.concat([rec(25, 0, Buffer.concat([le32(0), Buffer.alloc(50)])), style("바탕글", "Normal"), style("개요 1", "Outline 1"), style("개요 2", "Outline 2")]);
}
function section(extraParas = 0) {
  const parts = [
    paragraph(0, ["서론"], { style: 1 }),
    paragraph(0, ["첫 줄", { ch: 10 }, "둘째 줄", { ctrl: 9 }, "탭 뒤", { ctrl: 11, id: "eqed" }, "끝", { ctrl: 17, id: "fn  " }], {
      ctrls: [
        ctrlHeader(1, "eqed", [rec(88, 2, Buffer.concat([le32(0), le16(8), wstr("a over b"), Buffer.alloc(10)]))]),
        ctrlHeader(1, "fn  ", [listHeader(2, 1), paragraph(2, ["각주 내용"])]),
      ],
    }),
    paragraph(0, [{ ctrl: 16, id: "head" }], { ctrls: [ctrlHeader(1, "head", [listHeader(2, 1), paragraph(2, ["머리말 글자"])])] }),
    paragraph(0, ["실험 결과"], { style: 2 }),
    paragraph(0, [{ ctrl: 11, id: "tbl " }], {
      ctrls: [
        tableCtrl(1, 2, 3, [
          [0, 0, 1, 2, "병합 머리"],
          [0, 2, 1, 1, "C"],
          [1, 0, 1, 1, "a"],
          [1, 1, 1, 1, "b|c"],
          [1, 2, 1, 1, "c"],
        ]),
      ],
    }),
    paragraph(0, ["이것은 문장입니다."], { style: 1 }),
    paragraph(0, ["1. 번호처럼 보이는 문단"]),
  ];
  for (let i = 0; i < extraParas; i++) parts.push(paragraph(0, [`반복 문단 ${i} — 화면이 멈추지 않는지 보는 긴 글입니다.`]));
  return Buffer.concat(parts);
}
function fileHeader(flags: number) {
  const b = Buffer.alloc(256);
  b.write("HWP Document File", 0, "latin1");
  b.writeUInt32LE(0x05000300, 32);
  b.writeUInt32LE(flags, 36);
  return b;
}

type CfbEntry = { name: string; type: number; children: CfbEntry[]; data?: Buffer; idx?: number; mini?: boolean; start?: number; off?: number };

/** 최소한의 CFB(v3, 512바이트 섹터, 4096 미만은 미니 스트림) */
export function buildCfb(streams: { path: string; data: Buffer }[]) {
  const SS = 512;
  const MSS = 64;
  const CUT = 4096;
  const FREE = 0xffffffff;
  const END = 0xfffffffe;
  const FATSEC = 0xfffffffd;
  const root: CfbEntry = { name: "Root Entry", type: 5, children: [] };
  const entries: CfbEntry[] = [root];
  const dirs = new Map<string, CfbEntry>([["", root]]);
  for (const s of streams) {
    const parts = s.path.split("/");
    let parent = root;
    let pre = "";
    for (let i = 0; i < parts.length - 1; i++) {
      pre += parts[i] + "/";
      if (!dirs.has(pre)) {
        const e: CfbEntry = { name: parts[i], type: 1, children: [] };
        entries.push(e);
        parent.children.push(e);
        dirs.set(pre, e);
      }
      parent = dirs.get(pre)!;
    }
    const e: CfbEntry = { name: parts[parts.length - 1], type: 2, data: s.data, children: [] };
    entries.push(e);
    parent.children.push(e);
  }
  entries.forEach((e, i) => {
    e.idx = i;
  });
  const miniFat: number[] = [];
  let miniLen = 0;
  for (const e of entries) {
    if (e.type !== 2 || e.data!.length >= CUT) continue;
    const n = Math.ceil(e.data!.length / MSS);
    e.mini = true;
    e.start = n ? miniFat.length : END;
    e.off = miniLen;
    for (let k = 0; k < n; k++) miniFat.push(k === n - 1 ? END : miniFat.length + 1);
    miniLen += n * MSS;
  }
  const bigs = entries.filter((e) => e.type === 2 && !e.mini);
  const nDir = Math.ceil((entries.length * 128) / SS);
  const nMiniFat = Math.ceil((miniFat.length * 4) / SS);
  const nMini = Math.ceil(miniLen / SS);
  const bigCounts = bigs.map((e) => Math.ceil(e.data!.length / SS));
  const nonFat = nDir + nMiniFat + nMini + bigCounts.reduce((a, b) => a + b, 0);
  let nFat = 1;
  while (nFat * 128 < nFat + nonFat) nFat++;
  const fat: number[] = new Array(nFat * 128).fill(FREE);
  let cur = 0;
  for (let k = 0; k < nFat; k++) fat[cur++] = FATSEC;
  const alloc = (n: number) => {
    if (!n) return END;
    const s = cur;
    for (let k = 0; k < n; k++) fat[cur + k] = k === n - 1 ? END : cur + k + 1;
    cur += n;
    return s;
  };
  const dirStart = alloc(nDir);
  const miniFatStart = alloc(nMiniFat);
  const miniStart = alloc(nMini);
  bigs.forEach((e, i) => {
    e.start = alloc(bigCounts[i]);
  });
  const out = Buffer.alloc(SS * (1 + cur));
  const sec = (n: number) => SS * (n + 1);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(out, 0);
  out.writeUInt16LE(0x3e, 0x18);
  out.writeUInt16LE(3, 0x1a);
  out.writeUInt16LE(0xfffe, 0x1c);
  out.writeUInt16LE(9, 0x1e);
  out.writeUInt16LE(6, 0x20);
  out.writeUInt32LE(nFat, 0x2c);
  out.writeUInt32LE(dirStart, 0x30);
  out.writeUInt32LE(CUT, 0x38);
  out.writeUInt32LE(nMiniFat ? miniFatStart : END, 0x3c);
  out.writeUInt32LE(nMiniFat, 0x40);
  out.writeUInt32LE(END, 0x44);
  out.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) out.writeUInt32LE(i < nFat ? i : FREE, 0x4c + i * 4);
  fat.forEach((v, i) => out.writeUInt32LE(v, sec(0) + i * 4));
  for (const e of entries) {
    const o = sec(dirStart) + e.idx! * 128;
    wstr(e.name).copy(out, o);
    out.writeUInt16LE((e.name.length + 1) * 2, o + 0x40);
    out[o + 0x42] = e.type;
    out[o + 0x43] = 1;
    out.writeUInt32LE(FREE, o + 0x44);
    out.writeUInt32LE(FREE, o + 0x48);
    out.writeUInt32LE(e.children.length ? e.children[0].idx! : FREE, o + 0x4c);
    if (e.type === 5) {
      out.writeUInt32LE(nMini ? miniStart : END, o + 0x74);
      out.writeUInt32LE(miniLen, o + 0x78);
    }
    if (e.type === 2) {
      out.writeUInt32LE(e.start!, o + 0x74);
      out.writeUInt32LE(e.data!.length, o + 0x78);
    }
  }
  for (const e of entries)
    e.children.forEach((c, i) => {
      if (i + 1 < e.children.length) out.writeUInt32LE(e.children[i + 1].idx!, sec(dirStart) + c.idx! * 128 + 0x48);
    });
  miniFat.forEach((v, i) => out.writeUInt32LE(v, sec(miniFatStart) + i * 4));
  for (const e of entries) if (e.mini) Buffer.from(e.data!).copy(out, sec(miniStart) + e.off!);
  for (const e of bigs) Buffer.from(e.data!).copy(out, sec(e.start!));
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** 합성 HWP: flags 1=압축, 2=암호, 4=배포용. trailer: 한글처럼 deflate 뒤 8바이트 꼬리("hancom") | 군더더기("junk") | 없음("none") */
export function buildHwp({ flags = 1, extraParas = 0, trailer = "hancom" }: { flags?: number; extraParas?: number; trailer?: "hancom" | "junk" | "none" } = {}) {
  const tail = (b: Buffer) => (trailer === "hancom" ? Buffer.concat([le32(crc32(b)), le32(b.length)]) : trailer === "junk" ? Buffer.alloc(8) : Buffer.alloc(0));
  const z = (b: Buffer) => (flags & 1 ? Buffer.concat([zlib.deflateRawSync(b), tail(b)]) : b);
  return buildCfb([
    { path: "FileHeader", data: fileHeader(flags) },
    { path: "DocInfo", data: z(docInfo()) },
    { path: flags & 4 ? "ViewText/Section0" : "BodyText/Section0", data: z(section(extraParas)) },
  ]);
}

export function buildZip(files: { name: string; data: string | Buffer; store?: boolean }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const method = f.store ? 0 : 8;
    const data = f.store ? raw : zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, name, data);
    centrals.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** 합성 HWPX: buildHwp()와 같은 내용 + 글상자·그림 개체(데이터 없음)·다단, 구역 2개(zip 안 순서는 거꾸로) */
export function buildHwpx() {
  const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"';
  const header = `<?xml version="1.0" encoding="UTF-8"?><hh:head ${NS}><hh:refList><hh:paraProperties><hh:paraPr id="0"/><hh:paraPr id="5"><hh:heading type="OUTLINE" idRef="0" level="1"/></hh:paraPr></hh:paraProperties>
    <hh:styles><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0"/><hh:style id="2" type="PARA" name="개요 1" engName="Outline 1" paraPrIDRef="0"/></hh:styles></hh:refList></hh:head>`;
  const p = (inner: string, attrs = 'styleIDRef="0" paraPrIDRef="0"') => `<hp:p ${attrs}><hp:run>${inner}</hp:run></hp:p>`;
  const tc = (r: number, c: number, rs: number, cs: number, text: string) =>
    `<hp:tc><hp:subList>${p(`<hp:t>${text}</hp:t>`)}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/></hp:tc>`;
  const sec0 = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}>
    ${p('<hp:secPr/><hp:ctrl><hp:colPr colCount="2"/></hp:ctrl><hp:t/>')}
    ${p("<hp:t>서론</hp:t>", 'styleIDRef="2" paraPrIDRef="0"')}
    ${p("<hp:t>첫 줄<hp:lineBreak/>둘째 줄<hp:tab/>탭 뒤</hp:t><hp:equation><hp:script>a over b</hp:script></hp:equation><hp:t>끝</hp:t><hp:ctrl><hp:footNote><hp:subList>" + p("<hp:t>각주 내용</hp:t>") + "</hp:subList></hp:footNote></hp:ctrl>")}
    ${p("<hp:ctrl><hp:header><hp:subList>" + p("<hp:t>머리말 글자</hp:t>") + "</hp:subList></hp:header></hp:ctrl>")}
    ${p("<hp:t>실험 결과</hp:t>", 'styleIDRef="0" paraPrIDRef="5"')}
    ${p(`<hp:tbl rowCnt="2" colCnt="3"><hp:tr>${tc(0, 0, 1, 2, "병합 머리")}${tc(0, 2, 1, 1, "C")}</hp:tr><hp:tr>${tc(1, 0, 1, 1, "a")}${tc(1, 1, 1, 1, "b|c")}${tc(1, 2, 1, 1, "c")}</hp:tr></hp:tbl>`)}
    ${p("<hp:pic/><hp:rect><hp:drawText><hp:subList>" + p("<hp:t>글상자 안 글자</hp:t>") + "</hp:subList></hp:drawText></hp:rect>")}
  </hs:sec>`;
  const sec1 = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}>${p("<hp:t>둘째 구역 &amp; 끝</hp:t>")}</hs:sec>`;
  return buildZip([
    { name: "mimetype", data: "application/hwp+zip", store: true },
    { name: "Contents/header.xml", data: header },
    { name: "Contents/section1.xml", data: sec1 },
    { name: "Contents/section0.xml", data: sec0, store: true },
  ]);
}

/** PNG 만들기: pixel(x, y) → [r, g, b, a] */
export function makePng(w: number, hgt: number, pixel: (x: number, y: number) => number[], alpha = true) {
  const bpp = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * bpp + 1) * hgt);
  for (let y = 0; y < hgt; y++) {
    const row = y * (w * bpp + 1);
    for (let x = 0; x < w; x++) {
      const px = pixel(x, y);
      for (let k = 0; k < bpp; k++) raw[row + 1 + x * bpp + k] = px[k];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type, "latin1");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(hgt, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
export const TINY_PNG = makePng(4, 3, (x, y) => [x * 60, y * 80, 200, 255]);

/** 2×2 24비트 BMP */
export function makeBmp() {
  const row = Buffer.from([0, 0, 255, 0, 255, 0, 0, 0]); // 픽셀 2개 + 줄 맞춤 2바이트
  const pixels = Buffer.concat([row, row]);
  const hd = Buffer.alloc(54);
  hd.write("BM", 0, "latin1");
  hd.writeUInt32LE(54 + pixels.length, 2);
  hd.writeUInt32LE(54, 10);
  hd.writeUInt32LE(40, 14);
  hd.writeInt32LE(2, 18);
  hd.writeInt32LE(2, 22);
  hd.writeUInt16LE(1, 26);
  hd.writeUInt16LE(24, 28);
  hd.writeUInt32LE(pixels.length, 34);
  return Buffer.concat([hd, pixels]);
}
export const FAKE_WMF = Buffer.concat([Buffer.from([0xd7, 0xcd, 0xc6, 0x9a]), Buffer.alloc(60, 1)]);
export const FAKE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** 그림 개체 레코드(HWPTAG_SHAPE_COMPONENT_PICTURE): 71번째 바이트에 BinData id */
const picRec = (level: number, binId: number) => {
  const d = Buffer.alloc(80);
  d.writeUInt16LE(binId, 71);
  return rec(85, level, d);
};
const gsoPicture = (level: number, binId: number) => ctrlHeader(level, "gso ", [rec(76, level + 1, Buffer.alloc(120)), picRec(level + 2, binId)]);
/** HWPTAG_BIN_DATA: 포함(1) + 압축 방식(0 문서 설정, 1 압축, 2 안 함) + 저장 번호 + 확장자 */
const binDataRec = (storageId: number, ext: string, comp = 0) => rec(18, 0, Buffer.concat([le16(1 | (comp << 4)), le16(storageId), bstr(ext)]));

/**
 * 합성 HWP(압축): "그림 앞 문단" → 그림(PNG, 압축) → "그림 뒤 문단" → 표 칸 안 그림(BMP, 압축 안 함) → WMF 그림 → 같은 PNG를 한 번 더.
 * BIN0009.png는 DocInfo에 있지만 어떤 그림 개체도 가리키지 않는다(넣지 않아야 한다).
 */
export function buildHwpImages() {
  const hancom = (b: Buffer) => Buffer.concat([zlib.deflateRawSync(b), le32(crc32(b)), le32(b.length)]);
  const info = Buffer.concat([docInfo(), binDataRec(1, "png", 0), binDataRec(2, "bmp", 2), binDataRec(3, "wmf", 0), binDataRec(9, "png", 0)]);
  const body = Buffer.concat([
    paragraph(0, ["그림 앞 문단"]),
    paragraph(0, ["그림 설명 글", { ctrl: 11, id: "gso " }], { ctrls: [gsoPicture(1, 1)] }),
    paragraph(0, ["그림 뒤 문단"]),
    paragraph(0, [{ ctrl: 11, id: "tbl " }], {
      ctrls: [
        ctrlHeader(1, "tbl ", [
          rec(77, 2, Buffer.concat([le32(0), le16(1), le16(1), Buffer.alloc(20)])),
          listHeader(2, 1, Buffer.concat([le16(0), le16(0), le16(1), le16(1), Buffer.alloc(22)])),
          paragraph(2, ["칸 글자", { ctrl: 11, id: "gso " }], { ctrls: [gsoPicture(3, 2)] }),
        ]),
      ],
    }),
    paragraph(0, ["표 뒤 문단"]),
    paragraph(0, [{ ctrl: 11, id: "gso " }], { ctrls: [gsoPicture(1, 3)] }),
    paragraph(0, [{ ctrl: 11, id: "gso " }], { ctrls: [gsoPicture(1, 1)] }),
    paragraph(0, ["끝 문단"]),
  ]);
  return buildCfb([
    { path: "FileHeader", data: fileHeader(1) },
    { path: "DocInfo", data: hancom(info) },
    { path: "BodyText/Section0", data: hancom(body) },
    { path: "BinData/BIN0001.png", data: hancom(TINY_PNG) },
    { path: "BinData/BIN0002.bmp", data: makeBmp() },
    { path: "BinData/BIN0003.wmf", data: hancom(FAKE_WMF) },
    { path: "BinData/BIN0009.png", data: hancom(TINY_PNG) },
  ]);
}

const HX_NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"';
/** 합성 HWPX: items = [{ id, path, data, mediaType }], body = section0의 문단 XML */
export function buildHwpxWith(items: { id: string; path: string; data: Buffer; mediaType?: string; store?: boolean }[], body: string) {
  const hpf = `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>${items
    .map((it) => `<opf:item id="${it.id}" href="${it.path}" media-type="${it.mediaType || "image/png"}" isEmbeded="1"/>`)
    .join("")}</opf:manifest></opf:package>`;
  return buildZip([
    { name: "mimetype", data: "application/hwp+zip", store: true },
    { name: "Contents/content.hpf", data: hpf },
    { name: "Contents/section0.xml", data: `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${HX_NS}>${body}</hs:sec>` },
    ...items.map((it) => ({ name: it.path, data: it.data, store: it.store })),
  ]);
}
const hxP = (inner: string) => `<hp:p><hp:run>${inner}</hp:run></hp:p>`;
const hxPic = (id: string) => `<hp:pic id="${id}"><hp:offset x="0" y="0"/><hp:imgRect/><hc:img binaryItemIDRef="${id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/></hp:pic>`;

export function buildHwpxImages() {
  return buildHwpxWith(
    [
      { id: "image1", path: "BinData/image1.png", data: TINY_PNG },
      { id: "image2", path: "BinData/image2.wmf", data: FAKE_WMF, mediaType: "image/x-wmf" },
      { id: "image3", path: "BinData/image3.png", data: TINY_PNG, store: true },
      { id: "image4", path: "BinData/image4.png", data: FAKE_SVG },
    ],
    [
      hxP("<hp:t>그림 앞 문단</hp:t>"),
      hxP(hxPic("image1")),
      hxP("<hp:t>그림 뒤 문단</hp:t>"),
      hxP('<hp:rect><hc:fillBrush><hc:imgBrush mode="TILE"><hc:img binaryItemIDRef="image3"/></hc:imgBrush></hc:fillBrush></hp:rect>'), // 배경 그림: 넣지 않는다
      hxP(hxPic("image2")), // WMF: 지원 안 함
      hxP(hxPic("image4")), // 확장자는 png지만 SVG: 절대 그림으로 쓰지 않는다
      hxP("<hp:t>끝 문단</hp:t>"),
    ].join(""),
  );
}
