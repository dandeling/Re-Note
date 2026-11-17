// 한글 파일 열기(mod-convert.js) 테스트 — node tests/d-convert.spec.cjs
// dev-server를 4105 포트로 띄우고 Playwright(chromium)로 확인한다. localhost 밖으로 나가는 요청은 모두 막는다
// (index.html이 쓰는 KaTeX·PapaParse만 node_modules의 같은 파일로 돌려준다).
//
// 대조 기준값: pyhwp의 `hwp5proc models --json`(HWP 레코드를 pyhwp가 직접 해석한 결과)에서
//   - 문단 글자 조각(ParaText의 문자열 조각) — 머리말·꼬리말·숨은 설명 안의 것은 뺀다(파서가 건너뛰므로)
//   - 표(TableBody의 행·열 수, TableCell의 행·열 주소와 셀 글자)
// 를 뽑아, 파서 결과가 그 글자를 (공백 차이 제외) 빠짐없이 담는지, 표 모양과 셀 내용이 같은지 본다.
// hwp5txt는 sample.hwp에서 실패하고 표 글자를 "<표>"로만 내므로 쓰지 않는다.
// hwp5proc 위치: 환경 변수 HWP5PROC, 없으면 아래 기본 경로. 없으면 이 대조는 내장 기준값(일부 글자)으로 대신한다.
// 제3자 샘플: /home/user/tests/fixtures/hwp/third-party/*.hwp (없으면 /home/user/worker/spike/fetch-samples.sh)
// 그림 대조: pyhwp의 DocInfo BinData(id → 저장 번호·확장자)와 본문 그림 개체(bindata_id)로 그림이 놓인 문단을 찾고,
//   `hwp5proc cat`으로 꺼낸 BinData 스트림의 길이·SHA-256과 파서가 꺼낸 그림 바이트를 비교한다(pyhwp 없으면 내장 기준값).
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const zlib = require("node:zlib");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const PORT = 4105;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/dev.html`;
const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "..", "node_modules");
const FIX = path.join(ROOT, "..", "tests", "fixtures");
const HWP = path.join(FIX, "hwp");
const THIRD = path.join(HWP, "third-party");
const HWP5PROC = process.env.HWP5PROC || "/tmp/claude-0/-home-user/1a787d55-751f-5ca7-8bd0-0eb03fb80c81/scratchpad/v312/bin/hwp5proc";

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, e }); console.log(`  FAIL ${name}\n       ${(e && e.stack) || e}`); }
}
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, ["dev-server.mjs", String(PORT)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    srv.stdout.on("data", (d) => { if (String(d).includes("http://")) resolve(srv); });
    srv.stderr.on("data", (d) => process.stderr.write(d));
    srv.on("exit", (c) => reject(new Error("server exited " + c)));
    setTimeout(() => reject(new Error("server start timeout")), 10000);
  });
}

// =====================================================================
// 합성 파일 만들기 (CFB/HWP, ZIP/HWPX) — 수식·병합·각주·머리말·암호 등 샘플에 없는 경우를 시험한다
// =====================================================================
const le16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const wstr = (s) => Buffer.from(s, "utf16le");
const bstr = (s) => Buffer.concat([le16(s.length), wstr(s)]);
const chidBytes = (id) => Buffer.from(id.split("").reverse().join(""), "latin1");
function rec(tag, level, data) {
  const size = data.length;
  return size < 0xfff ? Buffer.concat([le32(tag | (level << 10) | (size << 20)), data]) : Buffer.concat([le32(tag | (level << 10) | (0xfff << 20)), le32(size), data]);
}
/** PARA_TEXT 조각: 문자열 또는 { ctrl: 코드, id: "tbl " } 또는 { ch: 코드 } */
function paraText(parts) {
  const bufs = [];
  for (const p of parts) {
    if (typeof p === "string") bufs.push(wstr(p));
    else if (p.ctrl != null) bufs.push(Buffer.concat([le16(p.ctrl), chidBytes(p.id || "\0\0\0\0"), Buffer.alloc(8), le16(p.ctrl)]));
    else bufs.push(le16(p.ch));
  }
  bufs.push(le16(13));
  return Buffer.concat(bufs);
}
function paragraph(level, parts, { style = 0, parashape = 0, ctrls = [] } = {}) {
  const text = paraText(parts);
  const hdr = Buffer.concat([le32(text.length / 2), le32(0), le16(parashape), Buffer.from([style, 0]), le16(1), le16(0), le16(0), le32(0)]);
  return Buffer.concat([rec(66, level, hdr), rec(67, level + 1, text), ...ctrls]);
}
const ctrlHeader = (level, id, children = []) => Buffer.concat([rec(71, level, Buffer.concat([chidBytes(id), Buffer.alloc(40)])), ...children]);
const listHeader = (level, nparas, extra = Buffer.alloc(0)) => rec(72, level, Buffer.concat([le16(nparas), le16(0), le32(0), extra]));
function cell(level, row, col, rowSpan, colSpan, text) {
  return Buffer.concat([listHeader(level, 1, Buffer.concat([le16(col), le16(row), le16(colSpan), le16(rowSpan), Buffer.alloc(22)])), paragraph(level, [text])]);
}
function tableCtrl(level, rows, cols, cells) {
  return ctrlHeader(level, "tbl ", [rec(77, level + 1, Buffer.concat([le32(0), le16(rows), le16(cols), Buffer.alloc(20)])), ...cells.map((c) => cell(level + 1, ...c))]);
}
function docInfo() {
  const style = (name, eng) => rec(26, 0, Buffer.concat([bstr(name), bstr(eng), Buffer.from([0, 0]), le16(1042), le16(0), le16(0), Buffer.alloc(2)]));
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
    paragraph(0, [{ ctrl: 11, id: "tbl " }], { ctrls: [tableCtrl(1, 2, 3, [[0, 0, 1, 2, "병합 머리"], [0, 2, 1, 1, "C"], [1, 0, 1, 1, "a"], [1, 1, 1, 1, "b|c"], [1, 2, 1, 1, "c"]])] }),
    paragraph(0, ["이것은 문장입니다."], { style: 1 }),
    paragraph(0, ["1. 번호처럼 보이는 문단"]),
  ];
  for (let i = 0; i < extraParas; i++) parts.push(paragraph(0, [`반복 문단 ${i} — 화면이 멈추지 않는지 보는 긴 글입니다.`]));
  return Buffer.concat(parts);
}
function fileHeader(flags) {
  const b = Buffer.alloc(256);
  b.write("HWP Document File", 0, "latin1");
  b.writeUInt32LE(0x05000300, 32);
  b.writeUInt32LE(flags, 36);
  return b;
}
/** 최소한의 CFB(v3, 512바이트 섹터, 4096 미만은 미니 스트림) */
function buildCfb(streams) {
  const SS = 512, MSS = 64, CUT = 4096, FREE = 0xffffffff, END = 0xfffffffe, FATSEC = 0xfffffffd;
  const root = { name: "Root Entry", type: 5, children: [] };
  const entries = [root];
  const dirs = new Map([["", root]]);
  for (const s of streams) {
    const parts = s.path.split("/");
    let parent = root, pre = "";
    for (let i = 0; i < parts.length - 1; i++) {
      pre += parts[i] + "/";
      if (!dirs.has(pre)) { const e = { name: parts[i], type: 1, children: [] }; entries.push(e); parent.children.push(e); dirs.set(pre, e); }
      parent = dirs.get(pre);
    }
    const e = { name: parts[parts.length - 1], type: 2, data: s.data, children: [] };
    entries.push(e); parent.children.push(e);
  }
  entries.forEach((e, i) => { e.idx = i; });
  const miniFat = [];
  let miniLen = 0;
  for (const e of entries) {
    if (e.type !== 2 || e.data.length >= CUT) continue;
    const n = Math.ceil(e.data.length / MSS);
    e.mini = true; e.start = n ? miniFat.length : END; e.off = miniLen;
    for (let k = 0; k < n; k++) miniFat.push(k === n - 1 ? END : miniFat.length + 1);
    miniLen += n * MSS;
  }
  const bigs = entries.filter((e) => e.type === 2 && !e.mini);
  const nDir = Math.ceil(entries.length * 128 / SS), nMiniFat = Math.ceil(miniFat.length * 4 / SS), nMini = Math.ceil(miniLen / SS);
  const bigCounts = bigs.map((e) => Math.ceil(e.data.length / SS));
  const nonFat = nDir + nMiniFat + nMini + bigCounts.reduce((a, b) => a + b, 0);
  let nFat = 1;
  while (nFat * 128 < nFat + nonFat) nFat++;
  const fat = new Array(nFat * 128).fill(FREE);
  let cur = 0;
  for (let k = 0; k < nFat; k++) fat[cur++] = FATSEC;
  const alloc = (n) => { if (!n) return END; const s = cur; for (let k = 0; k < n; k++) fat[cur + k] = k === n - 1 ? END : cur + k + 1; cur += n; return s; };
  const dirStart = alloc(nDir), miniFatStart = alloc(nMiniFat), miniStart = alloc(nMini);
  bigs.forEach((e, i) => { e.start = alloc(bigCounts[i]); });
  const out = Buffer.alloc(SS * (1 + cur));
  const sec = (n) => SS * (n + 1);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(out, 0);
  out.writeUInt16LE(0x3e, 0x18); out.writeUInt16LE(3, 0x1a); out.writeUInt16LE(0xfffe, 0x1c); out.writeUInt16LE(9, 0x1e); out.writeUInt16LE(6, 0x20);
  out.writeUInt32LE(nFat, 0x2c); out.writeUInt32LE(dirStart, 0x30); out.writeUInt32LE(CUT, 0x38);
  out.writeUInt32LE(nMiniFat ? miniFatStart : END, 0x3c); out.writeUInt32LE(nMiniFat, 0x40); out.writeUInt32LE(END, 0x44); out.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) out.writeUInt32LE(i < nFat ? i : FREE, 0x4c + i * 4);
  fat.forEach((v, i) => out.writeUInt32LE(v, sec(0) + i * 4));
  for (const e of entries) {
    const o = sec(dirStart) + e.idx * 128;
    wstr(e.name).copy(out, o);
    out.writeUInt16LE((e.name.length + 1) * 2, o + 0x40);
    out[o + 0x42] = e.type; out[o + 0x43] = 1;
    out.writeUInt32LE(FREE, o + 0x44); out.writeUInt32LE(FREE, o + 0x48);
    out.writeUInt32LE(e.children.length ? e.children[0].idx : FREE, o + 0x4c);
    if (e.type === 5) { out.writeUInt32LE(nMini ? miniStart : END, o + 0x74); out.writeUInt32LE(miniLen, o + 0x78); }
    if (e.type === 2) { out.writeUInt32LE(e.start, o + 0x74); out.writeUInt32LE(e.data.length, o + 0x78); }
  }
  for (const e of entries) e.children.forEach((c, i) => { if (i + 1 < e.children.length) out.writeUInt32LE(e.children[i + 1].idx, sec(dirStart) + c.idx * 128 + 0x48); });
  miniFat.forEach((v, i) => out.writeUInt32LE(v, sec(miniFatStart) + i * 4));
  for (const e of entries) if (e.mini) Buffer.from(e.data).copy(out, sec(miniStart) + e.off);
  for (const e of bigs) Buffer.from(e.data).copy(out, sec(e.start));
  return out;
}
/** 합성 HWP: flags 1=압축, 2=암호, 4=배포용 */
function buildHwp({ flags = 1, extraParas = 0, trailer = "hancom" } = {}) {
  // 한글처럼 deflate 끝 뒤에 8바이트(체크섬 + 풀린 크기)를 덧붙인다. trailer: "hancom" | "junk"(크기 아닌 군더더기) | "none"
  const tail = (b) => (trailer === "hancom" ? Buffer.concat([le32(crc32(b)), le32(b.length)]) : trailer === "junk" ? Buffer.alloc(8) : Buffer.alloc(0));
  const z = (b) => (flags & 1 ? Buffer.concat([zlib.deflateRawSync(b), tail(b)]) : b);
  return buildCfb([
    { path: "FileHeader", data: fileHeader(flags) },
    { path: "DocInfo", data: z(docInfo()) },
    { path: flags & 4 ? "ViewText/Section0" : "BodyText/Section0", data: z(section(extraParas)) },
  ]);
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function buildZip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"), raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const method = f.store ? 0 : 8, data = f.store ? raw : zlib.deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, data); centrals.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
function buildHwpx() {
  const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"';
  const header = `<?xml version="1.0" encoding="UTF-8"?><hh:head ${NS}><hh:refList><hh:paraProperties><hh:paraPr id="0"/><hh:paraPr id="5"><hh:heading type="OUTLINE" idRef="0" level="1"/></hh:paraPr></hh:paraProperties>
    <hh:styles><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0"/><hh:style id="2" type="PARA" name="개요 1" engName="Outline 1" paraPrIDRef="0"/></hh:styles></hh:refList></hh:head>`;
  const p = (inner, attrs = 'styleIDRef="0" paraPrIDRef="0"') => `<hp:p ${attrs}><hp:run>${inner}</hp:run></hp:p>`;
  const tc = (r, c, rs, cs, text) => `<hp:tc><hp:subList>${p(`<hp:t>${text}</hp:t>`)}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/></hp:tc>`;
  const sec0 = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}>
    ${p('<hp:secPr/><hp:ctrl><hp:colPr colCount="2"/></hp:ctrl><hp:t/>')}
    ${p("<hp:t>서론</hp:t>", 'styleIDRef="2" paraPrIDRef="0"')}
    ${p('<hp:t>첫 줄<hp:lineBreak/>둘째 줄<hp:tab/>탭 뒤</hp:t><hp:equation><hp:script>a over b</hp:script></hp:equation><hp:t>끝</hp:t><hp:ctrl><hp:footNote><hp:subList>' + p("<hp:t>각주 내용</hp:t>") + "</hp:subList></hp:footNote></hp:ctrl>")}
    ${p("<hp:ctrl><hp:header><hp:subList>" + p("<hp:t>머리말 글자</hp:t>") + "</hp:subList></hp:header></hp:ctrl>")}
    ${p("<hp:t>실험 결과</hp:t>", 'styleIDRef="0" paraPrIDRef="5"')}
    ${p(`<hp:tbl rowCnt="2" colCnt="3"><hp:tr>${tc(0, 0, 1, 2, "병합 머리")}${tc(0, 2, 1, 1, "C")}</hp:tr><hp:tr>${tc(1, 0, 1, 1, "a")}${tc(1, 1, 1, 1, "b|c")}${tc(1, 2, 1, 1, "c")}</hp:tr></hp:tbl>`)}
    ${p('<hp:pic/><hp:rect><hp:drawText><hp:subList>' + p("<hp:t>글상자 안 글자</hp:t>") + "</hp:subList></hp:drawText></hp:rect>")}
  </hs:sec>`;
  const sec1 = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}>${p("<hp:t>둘째 구역 &amp; 끝</hp:t>")}</hs:sec>`;
  return buildZip([
    { name: "mimetype", data: "application/hwp+zip", store: true },
    { name: "Contents/header.xml", data: header },
    { name: "Contents/section1.xml", data: sec1 },
    { name: "Contents/section0.xml", data: sec0, store: true },
  ]);
}

// =====================================================================
// 그림이 든 합성 파일
// =====================================================================
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
/** PNG 만들기: pixel(x, y) → [r, g, b, a] */
function makePng(w, hgt, pixel, alpha = true) {
  const bpp = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * bpp + 1) * hgt);
  for (let y = 0; y < hgt; y++) {
    const row = y * (w * bpp + 1);
    for (let x = 0; x < w; x++) { const px = pixel(x, y); for (let k = 0; k < bpp; k++) raw[row + 1 + x * bpp + k] = px[k]; }
  }
  const chunk = (type, data) => { const t = Buffer.from(type, "latin1"); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const TINY_PNG = makePng(4, 3, (x, y) => [x * 60, y * 80, 200, 255]);
/** 2×2 24비트 BMP */
function makeBmp() {
  const row = Buffer.from([0, 0, 255, 0, 255, 0, 0, 0]); // 픽셀 2개 + 줄 맞춤 2바이트
  const pixels = Buffer.concat([row, row]);
  const hd = Buffer.alloc(54);
  hd.write("BM", 0, "latin1"); hd.writeUInt32LE(54 + pixels.length, 2); hd.writeUInt32LE(54, 10);
  hd.writeUInt32LE(40, 14); hd.writeInt32LE(2, 18); hd.writeInt32LE(2, 22); hd.writeUInt16LE(1, 26); hd.writeUInt16LE(24, 28); hd.writeUInt32LE(pixels.length, 34);
  return Buffer.concat([hd, pixels]);
}
const FAKE_WMF = Buffer.concat([Buffer.from([0xd7, 0xcd, 0xc6, 0x9a]), Buffer.alloc(60, 1)]);
const FAKE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
/** 그림 개체 레코드(HWPTAG_SHAPE_COMPONENT_PICTURE): 71번째 바이트에 BinData id */
const picRec = (level, binId) => { const d = Buffer.alloc(80); d.writeUInt16LE(binId, 71); return rec(85, level, d); };
const gsoPicture = (level, binId) => ctrlHeader(level, "gso ", [rec(76, level + 1, Buffer.alloc(120)), picRec(level + 2, binId)]);
/** HWPTAG_BIN_DATA: 포함(1) + 압축 방식(0 문서 설정, 1 압축, 2 안 함) + 저장 번호 + 확장자 */
const binDataRec = (storageId, ext, comp = 0) => rec(18, 0, Buffer.concat([le16(1 | (comp << 4)), le16(storageId), bstr(ext)]));
/**
 * 합성 HWP(압축): 문단 "그림 앞 문단" → 그림(PNG, 압축) → "그림 뒤 문단" → 표 칸 안 그림(BMP, 압축 안 함) → WMF 그림 → 같은 PNG를 한 번 더.
 * BIN0009.png는 DocInfo에 있지만 어떤 그림 개체도 가리키지 않는다(넣지 않아야 한다).
 */
function buildHwpImages() {
  const hancom = (b) => Buffer.concat([zlib.deflateRawSync(b), le32(crc32(b)), le32(b.length)]);
  const info = Buffer.concat([docInfo(), binDataRec(1, "png", 0), binDataRec(2, "bmp", 2), binDataRec(3, "wmf", 0), binDataRec(9, "png", 0)]);
  const body = Buffer.concat([
    paragraph(0, ["그림 앞 문단"]),
    paragraph(0, ["그림 설명 글", { ctrl: 11, id: "gso " }], { ctrls: [gsoPicture(1, 1)] }),
    paragraph(0, ["그림 뒤 문단"]),
    paragraph(0, [{ ctrl: 11, id: "tbl " }], { ctrls: [ctrlHeader(1, "tbl ", [
      rec(77, 2, Buffer.concat([le32(0), le16(1), le16(1), Buffer.alloc(20)])),
      listHeader(2, 1, Buffer.concat([le16(0), le16(0), le16(1), le16(1), Buffer.alloc(22)])),
      paragraph(2, ["칸 글자", { ctrl: 11, id: "gso " }], { ctrls: [gsoPicture(3, 2)] }),
    ])] }),
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
function buildHwpxWith(items, body) {
  const hpf = `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>${items.map((it) => `<opf:item id="${it.id}" href="${it.path}" media-type="${it.mediaType || "image/png"}" isEmbeded="1"/>`).join("")}</opf:manifest></opf:package>`;
  return buildZip([
    { name: "mimetype", data: "application/hwp+zip", store: true },
    { name: "Contents/content.hpf", data: hpf },
    { name: "Contents/section0.xml", data: `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${HX_NS}>${body}</hs:sec>` },
    ...items.map((it) => ({ name: it.path, data: it.data, store: it.store })),
  ]);
}
const hxP = (inner) => `<hp:p><hp:run>${inner}</hp:run></hp:p>`;
const hxPic = (id) => `<hp:pic id="${id}"><hp:offset x="0" y="0"/><hp:imgRect/><hc:img binaryItemIDRef="${id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/></hp:pic>`;
function buildHwpxImages() {
  return buildHwpxWith([
    { id: "image1", path: "BinData/image1.png", data: TINY_PNG },
    { id: "image2", path: "BinData/image2.wmf", data: FAKE_WMF, mediaType: "image/x-wmf" },
    { id: "image3", path: "BinData/image3.png", data: TINY_PNG, store: true },
    { id: "image4", path: "BinData/image4.png", data: FAKE_SVG },
    { id: "image5", path: "BinData/image5.png", data: TINY_PNG },
  ], [
    hxP("<hp:t>그림 앞 문단</hp:t>"),
    hxP(hxPic("image1")),
    hxP("<hp:t>그림 뒤 문단</hp:t>"),
    hxP('<hp:rect><hc:fillBrush><hc:imgBrush mode="TILE"><hc:img binaryItemIDRef="image3"/></hc:imgBrush></hc:fillBrush></hp:rect>'), // 배경 그림: 넣지 않는다
    hxP(hxPic("image2")), // WMF: 지원 안 함
    hxP(hxPic("image4")), // 확장자는 png지만 SVG: 절대 그림으로 쓰지 않는다
    hxP("<hp:t>끝 문단</hp:t>"),
  ].join(""));
}
/** 줄이기 확인용: 큰 잡음 사진(불투명) + 큰 투명 그러데이션 PNG */
function buildHwpxBig() {
  const noise = crypto.randomBytes(1600 * 1000 * 3);
  const photo = makePng(1600, 1000, (x, y) => { const i = (y * 1600 + x) * 3; return [noise[i], noise[i + 1], noise[i + 2]]; }, false);
  const clear = makePng(1000, 1000, (x, y) => [x % 256, y % 256, 120, Math.round((x / 1000) * 255)]);
  return buildHwpxWith([
    { id: "image1", path: "BinData/image1.png", data: photo, store: true },
    { id: "image2", path: "BinData/image2.png", data: clear, store: true },
    { id: "image3", path: "BinData/image3.wmf", data: FAKE_WMF },
  ], [hxP("<hp:t>큰 그림 앞</hp:t>"), hxP(hxPic("image1")), hxP("<hp:t>투명 그림 앞</hp:t>"), hxP(hxPic("image2")), hxP(hxPic("image3")), hxP("<hp:t>끝</hp:t>")].join(""));
}
/** 그림 블록을 페이지 안에서 요약(바이트는 넘기지 않는다): 순서·글자 블록·그림의 길이·SHA-256·머리 형식 */
async function parseImagesIn(page, bytes) {
  return page.evaluate(async (b64) => {
    const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try {
      const res = await RN._convert.parseAny(u);
      const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const flow = [];
      for (const b of res.blocks) {
        if (b.type === "image") {
          const info = RN._convert.imageInfo(b.bytes);
          flow.push({ type: "image", n: b.n, name: b.name, mime: b.mime, source: b.source, width: b.width, height: b.height, length: b.bytes.length, sha: await hex(b.bytes), kind: info.kind, supported: info.supported, isU8: b.bytes instanceof Uint8Array });
        } else flow.push({ type: b.type, text: b.type === "table" ? b.cells.map((c) => c.text).join(" ") : b.text });
      }
      return { ok: true, flow, notes: res.notes, stats: res.stats, md: RN._convert.toMarkdown(res.blocks), mdText: RN._convert.toMarkdown(res.blocks, { images: "placeholder" }) };
    } catch (e) { return { ok: false, code: e && e.code, message: e && e.message, stack: e && e.stack }; }
  }, Buffer.from(bytes).toString("base64"));
}
/** 그림 바로 앞·뒤의 글자 블록 */
function around(flow, idx) {
  let before = null, after = null;
  for (let i = idx - 1; i >= 0; i--) if (flow[i].type !== "image") { before = flow[i].text; break; }
  for (let i = idx + 1; i < flow.length; i++) if (flow[i].type !== "image") { after = flow[i].text; break; }
  return { before, after };
}

// =====================================================================
// pyhwp 기준값
// =====================================================================
function pyhwpReference(file) {
  if (!fs.existsSync(HWP5PROC)) return null;
  const ls = spawnSync(HWP5PROC, ["ls", file], { encoding: "utf8" });
  if (ls.status !== 0) return null;
  const sections = ls.stdout.split("\n").filter((l) => /^BodyText\/Section\d+$/.test(l.trim())).map((l) => l.trim());
  const chunks = [], tables = [];
  for (const s of sections) {
    const r = spawnSync(HWP5PROC, ["models", "--json", file, s], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) return null;
    const models = JSON.parse(r.stdout);
    const ctrlStack = [], tableStack = [];
    for (const m of models) {
      while (ctrlStack.length && ctrlStack[ctrlStack.length - 1].level >= m.level) ctrlStack.pop();
      while (tableStack.length && tableStack[tableStack.length - 1].ctrlLevel >= m.level) tableStack.pop();
      if (m.tagname === "HWPTAG_CTRL_HEADER") ctrlStack.push({ level: m.level, chid: m.content && m.content.chid });
      const skipped = ctrlStack.some((c) => ["head", "foot", "tcmt"].includes(c.chid));
      if (m.type === "TableBody") { const t = { ctrlLevel: m.level - 1, rows: m.content.rows, cols: m.content.cols, cells: [] }; tables.push(t); tableStack.push(t); }
      if (m.type === "TableCell" && tableStack.length) tableStack[tableStack.length - 1].cells.push({ row: m.content.row, col: m.content.col, rowSpan: m.content.rowspan, colSpan: m.content.colspan, text: "" });
      if (m.type === "ParaText" && !skipped) {
        const strs = m.content.chunks.map((c) => c[1]).filter((x) => typeof x === "string");
        chunks.push(...strs);
        const t = tableStack[tableStack.length - 1];
        if (t && t.cells.length && m.level >= t.ctrlLevel + 2) t.cells[t.cells.length - 1].text += strs.join("");
      }
    }
  }
  return { chunks, tables: tables.map(({ rows, cols, cells }) => ({ rows, cols, cells })) };
}
/** pyhwp로 그림 기준값: 그림 개체마다 { stream, length, sha, before(그 그림이 든 최상위 문단까지의 마지막 글자), after(다음 최상위 문단 글자) } */
function pyhwpImages(file) {
  if (!fs.existsSync(HWP5PROC)) return null;
  const run = (args, enc = "utf8") => { const r = spawnSync(HWP5PROC, args, { encoding: enc, maxBuffer: 256 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; };
  const di = run(["models", "--json", file, "DocInfo"]);
  const ls = run(["ls", file]);
  if (!di || !ls) return null;
  const bins = JSON.parse(di).filter((m) => m.tagname === "HWPTAG_BIN_DATA").map((m) => m.content.bindata || {});
  const out = [];
  for (const sec of ls.split("\n").map((l) => l.trim()).filter((l) => /^BodyText\/Section\d+$/.test(l))) {
    const models = JSON.parse(run(["models", "--json", file, sec]));
    const top = []; // 최상위 문단 글자
    const pics = [];
    for (const m of models) {
      if (m.tagname === "HWPTAG_PARA_HEADER" && m.level === 0) top.push("");
      if (m.type === "ParaText" && m.level === 1 && top.length) top[top.length - 1] += m.content.chunks.map((c) => c[1]).filter((x) => typeof x === "string").join("");
      if (m.tagname === "HWPTAG_SHAPE_COMPONENT_PICTURE") pics.push({ para: top.length - 1, id: m.content.picture.bindata_id });
    }
    for (const p of pics) {
      const b = bins[p.id - 1];
      const stream = `BinData/BIN${b.storage_id.toString(16).toUpperCase().padStart(4, "0")}.${b.ext}`;
      const data = run(["cat", file, stream], "buffer");
      let before = null, after = null;
      for (let i = p.para; i >= 0; i--) if (top[i].trim()) { before = top[i]; break; }
      for (let i = p.para + 1; i < top.length; i++) if (top[i].trim()) { after = top[i]; break; }
      out.push({ stream, length: data.length, sha: sha256(data), before, after });
    }
  }
  return out;
}
const JPG_5017 = { stream: "BinData/BIN0002.jpg", length: 15895, sha: "ec8fe383b6e15ed56abd24a8b8bc112317bd770c2de2fc770081a160d652ab67" };
const PNG_5017 = { stream: "BinData/BIN0003.png", length: 989, sha: "175ef81be06278b02193605bedee6ff5fabe62b3265624cff03e42be97d19d59" };
const BUILTIN_IMAGES = {
  "sample-5017.hwp": [
    { ...JPG_5017, before: "본 문서는 먼저", after: "미주입니다." },
    { ...PNG_5017, before: "다음 페이지", after: null },
  ],
  "shapepict-scaled.hwp": [{ ...JPG_5017, before: null, after: null }, { ...JPG_5017, before: null, after: null }],
};

// pyhwp가 없을 때 쓰는 내장 기준값(일부 글자와 표 모양)
const BUILTIN = {
  "sample.hwp": { chunks: ["음향 블랙홀 진동 감쇠 실험 보고서", "알루미늄 보의 끝단 두께를 점차 줄여 진동 에너지를 모았다.", "표 아래 문단: 감쇠율은 세 번 측정한 평균이다."], tables: [[3, 2]] },
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
// 파서는 U+F53A(한컴 "한" 로고 글자)를 "한"으로 바꾼다 — 기준값도 같게 맞춘다
const squash = (s) => String(s).replace(/\uf53a/g, "한").replace(/\s+/g, "");
function charCounts(s) { const m = new Map(); for (const ch of squash(s)) m.set(ch, (m.get(ch) || 0) + 1); return m; }

// =====================================================================
let browser;
const pageErrors = [];
const external = [];
async function newContext(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, ...opts });
  await ctx.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN + "/")) {
      if (/\/vendor\/|\.wasm(\?|$)/.test(u)) external.push(u); // 엔진 파일을 받으려 하면 안 된다
      return r.continue();
    }
    if (u.startsWith("https://cdnjs.cloudflare.com/")) {
      const f = u.includes("papaparse") ? path.join(NM, "papaparse", "papaparse.min.js") : u.includes("katex") ? path.join(NM, "katex", "dist", "katex.min.js") : null;
      if (f && fs.existsSync(f)) return r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(f) });
    }
    if (!u.startsWith("https://fonts.googleapis.com/") && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
    return r.abort();
  });
  return ctx;
}
async function open(ctx, query = "", hash = "home") {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));
  await page.goto(`${BASE}${query ? "?" + query : ""}#${hash}`);
  await page.waitForFunction(() => window.RN && window.RN._convert && window.RN.caps && document.querySelector("#rn-view h1, #rn-view .rn-notice"));
  await page.evaluate(() => RN.ready);
  return page;
}
/** 바이트를 페이지로 넘겨 RN._convert 함수를 부른다 */
async function parseIn(page, bytes, fn = "parseAny") {
  return page.evaluate(async ([b64, fname]) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
    try {
      const res = await RN._convert[fname](u);
      return { ok: true, blocks: res.blocks, notes: res.notes, stats: res.stats, md: RN._convert.toMarkdown(res.blocks), text: RN._convert.toText(res.blocks) };
    } catch (e) { return { ok: false, code: e && e.code, message: e && e.message }; }
  }, [Buffer.from(bytes).toString("base64"), fn]);
}
const tablesOf = (r) => r.blocks.filter((b) => b.type === "table");
const cellAt = (t, row, col) => (t.cells.find((c) => c.row === row && c.col === col) || {}).text;

(async () => {
  const srv = await startServer();
  browser = await chromium.launch();
  try {
    const ctx = await newContext();
    const page = await open(ctx);

    console.log("파일 판별·오류");
    await test("sniff: CFB·zip·HWP 3.0·그 밖", async () => {
      const kinds = await page.evaluate(() => {
        const s = RN._convert.sniff;
        const enc = (t) => new TextEncoder().encode(t);
        return [s(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), s(enc("PK\u0003\u0004xx")), s(enc("HWP Document File V3.00 \u001a\u0001\u0002")), s(enc("%PDF-1.4")), s(new Uint8Array(0))];
      });
      assert.deepEqual(kinds, ["hwp", "hwpx", "hwp3", null, null]);
      for (const [f, k] of [["sample.hwp", "hwp"], ["sample.hwpx", "hwpx"], ["corrupt.hwp", "hwp"], ["corrupt.hwpx", "hwpx"]]) {
        const got = await page.evaluate((b64) => RN._convert.sniff(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), fs.readFileSync(path.join(HWP, f)).toString("base64"));
        assert.equal(got, k, f);
      }
    });
    await test("손상·잘린·형식 아님·옛 형식·암호·배포용·50MB 초과는 각각 알기 쉬운 오류", async () => {
      const cases = [
        [fs.readFileSync(path.join(HWP, "corrupt.hwp")), "bad_file", /손상/],
        [fs.readFileSync(path.join(HWP, "corrupt.hwpx")), "bad_file", /손상/],
        [fs.readFileSync(path.join(HWP, "truncated.hwpx")), "bad_file", /손상/],
        [fs.readFileSync(path.join(FIX, "csv", "missing.csv")), "not_hwp", /HWP나 HWPX 파일이 아니에요/],
        [Buffer.concat([Buffer.from("HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05", "latin1"), Buffer.alloc(200)]), "old_hwp", /옛 형식/],
        [buildHwp({ flags: 1 | 2 }), "encrypted", /암호/],
        [buildHwp({ flags: 1 | 4 }), "distribution", /배포용/],
        [buildZip([{ name: "word/document.xml", data: "<w/>" }]), "not_hwp", /아니에요/],
        [buildCfb([{ path: "WordDocument", data: Buffer.alloc(100) }]), "not_hwp", /아니에요/],
      ];
      for (const [bytes, code, re] of cases) {
        const r = await parseIn(page, bytes);
        assert.equal(r.ok, false, code);
        assert.equal(r.code, code, `${code}: ${r.code} ${r.message}`);
        assert.match(r.message, re);
      }
      const big = await page.evaluate(async () => {
        const u = new Uint8Array(50 * 1024 * 1024 + 1); u.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        try { await RN._convert.parseHwp(u); return "parsed"; } catch (e) { return e.code; }
      });
      assert.equal(big, "too_large");
    });

    console.log("픽스처 sample.hwp / sample.hwpx");
    let sampleHwp, sampleHwpx;
    await test("sample.hwp: 제목·문단·표(3×2)", async () => {
      sampleHwp = await parseIn(page, fs.readFileSync(path.join(HWP, "sample.hwp")), "parseHwp");
      assert.ok(sampleHwp.ok, sampleHwp.message);
      const b = sampleHwp.blocks;
      assert.deepEqual(b[0], { type: "heading", level: 1, text: "음향 블랙홀 진동 감쇠 실험 보고서" });
      assert.deepEqual(b.find((x) => x.text === "실험 방법"), { type: "heading", level: 2, text: "실험 방법" });
      assert.equal(b.find((x) => /^이 문서는/.test(x.text || "")).type, "paragraph", "마침표로 끝나는 개요 문단은 제목으로 보지 않는다");
      const [t] = tablesOf(sampleHwp);
      assert.equal(t.rows, 3); assert.equal(t.cols, 2);
      assert.deepEqual([cellAt(t, 0, 0), cellAt(t, 0, 1), cellAt(t, 1, 0), cellAt(t, 1, 1), cellAt(t, 2, 0), cellAt(t, 2, 1)], ["조건", "감쇠율", "기준 보", "12.5", "음향 블랙홀 보", "31.0"]);
      assert.ok(sampleHwp.md.includes("| 조건 | 감쇠율 |\n| --- | --- |\n| 기준 보 | 12.5 |"), sampleHwp.md);
      assert.ok(sampleHwp.md.startsWith("# 음향 블랙홀 진동 감쇠 실험 보고서\n\n"));
      assert.deepEqual(sampleHwp.notes, []);
    });
    await test("sample.hwpx: 같은 문서라 sample.hwp와 같은 결과", async () => {
      sampleHwpx = await parseIn(page, fs.readFileSync(path.join(HWP, "sample.hwpx")), "parseHwpx");
      assert.ok(sampleHwpx.ok, sampleHwpx.message);
      assert.deepEqual(sampleHwpx.blocks, sampleHwp.blocks);
      assert.equal(sampleHwpx.md, sampleHwp.md);
    });

    console.log("합성 파일(수식·병합·각주·머리말)");
    const checkSynthetic = (r, label) => {
      assert.ok(r.ok, `${label}: ${r.message}`);
      const b = r.blocks;
      assert.deepEqual(b[0], { type: "heading", level: 1, text: "서론" }, label);
      const p = b[1];
      assert.equal(p.type, "paragraph");
      assert.equal(p.text, "첫 줄\n둘째 줄\t탭 뒤[수식: a over b]끝[각주 1]", label);
      assert.ok(!r.text.includes("머리말 글자"), "머리말은 건너뛴다");
      assert.deepEqual(b.find((x) => x.text === "실험 결과"), { type: "heading", level: 2, text: "실험 결과" }, label);
      const [t] = tablesOf(r);
      assert.equal(t.rows, 2); assert.equal(t.cols, 3);
      assert.deepEqual(t.cells[0], { row: 0, col: 0, rowSpan: 1, colSpan: 2, text: "병합 머리" });
      assert.equal(cellAt(t, 1, 1), "b|c");
      assert.ok(r.md.includes("| 병합 머리 |   | C |\n| --- | --- | --- |\n| a | b\\|c | c |"), r.md);
      assert.ok(b.some((x) => x.type === "heading" && x.text === "각주"));
      assert.ok(b.some((x) => x.text === "(1) 각주 내용"));
      assert.ok(r.notes.some((n) => /수식 1개/.test(n)) && r.notes.some((n) => /각주·미주 1개/.test(n)) && r.notes.some((n) => /머리말·꼬리말 1개/.test(n)), r.notes.join(" / "));
    };
    await test("합성 HWP(압축): 개요 스타일 제목·줄바꿈·탭·수식·각주·병합 셀·머리말 건너뜀", async () => {
      const r = await parseIn(page, buildHwp({ flags: 1 }), "parseHwp");
      checkSynthetic(r, "hwp");
      assert.equal(r.blocks.find((x) => x.text === "이것은 문장입니다.").type, "paragraph");
      assert.ok(r.md.includes("\n1.⁠ 번호처럼 보이는 문단"), "목록으로 바뀌지 않게");
      assert.ok(r.md.includes("탭 뒤\\[수식: a over b\\]끝\\[각주 1\\]"));
    });
    await test("합성 HWP: 압축 안 함·꼬리 없음·크기 아닌 꼬리도 같은 결과(큰 구역 포함)", async () => {
      for (const extraParas of [0, 3000]) {
        const a = await parseIn(page, buildHwp({ flags: 1, extraParas }), "parseHwp");
        assert.ok(a.ok && !a.notes.some((n) => /손상/.test(n)), a.message || a.notes.join(" / "));
        for (const opt of [{ flags: 0 }, { flags: 1, trailer: "none" }, { flags: 1, trailer: "junk" }]) {
          const b = await parseIn(page, buildHwp({ ...opt, extraParas }), "parseHwp");
          assert.ok(b.ok, b.message);
          assert.deepEqual(b.blocks, a.blocks, JSON.stringify(opt));
          assert.deepEqual(b.notes, a.notes, JSON.stringify(opt));
        }
      }
    });
    await test("합성 HWPX: 구역 순서·수식·각주·병합·글상자·그림 안내·다단 안내", async () => {
      const r = await parseIn(page, buildHwpx(), "parseHwpx");
      checkSynthetic(r, "hwpx");
      assert.ok(r.text.includes("글상자 안 글자"));
      assert.ok(r.blocks.findIndex((x) => x.text === "둘째 구역 & 끝") > r.blocks.findIndex((x) => x.type === "table"), "section0 다음 section1");
      assert.ok(r.notes.some((n) => /그림 1개/.test(n)) && r.notes.some((n) => /글상자 1개/.test(n)) && r.notes.some((n) => /여러 단/.test(n)), r.notes.join(" / "));
    });
    await test("큰 파일도 화면을 멈추지 않고 진행을 알린다", async () => {
      const bytes = buildHwp({ flags: 1, extraParas: 60000 });
      const r = await page.evaluate(async (b64) => {
        const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        let last = performance.now(), maxGap = 0;
        const iv = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 5);
        const progress = [];
        const t0 = performance.now();
        const res = await RN._convert.parseHwp(u, { onProgress: (f) => progress.push(f) });
        clearInterval(iv);
        return { ms: performance.now() - t0, maxGap, progress: progress.length, blocks: res.blocks.length, notes: res.notes };
      }, bytes.toString("base64"));
      console.log(`       (${(bytes.length / 1024).toFixed(0)}KB, 문단 6만 개: ${r.ms.toFixed(0)}ms, 가장 긴 멈춤 ${r.maxGap.toFixed(0)}ms, 진행 알림 ${r.progress}번)`);
      assert.ok(r.blocks > 60000, "블록 " + r.blocks);
      assert.ok(!r.notes.length || !r.notes.some((n) => /손상/.test(n)), r.notes.join(" / "));
      assert.ok(r.progress >= 3, "진행 알림");
      assert.ok(r.maxGap < 300, "멈춤 " + r.maxGap);
    });

    console.log("제3자 샘플 대조 (pyhwp 기준값)");
    const thirdFiles = fs.existsSync(THIRD) ? fs.readdirSync(THIRD).filter((f) => /\.hwp$/i.test(f)).sort().map((f) => path.join(THIRD, f)) : [];
    if (!thirdFiles.length) console.log("       (제3자 샘플 없음 — /home/user/worker/spike/fetch-samples.sh 로 받을 수 있다)");
    if (!fs.existsSync(HWP5PROC)) console.log("       (hwp5proc 없음 — 내장 기준값으로 대조)");
    for (const file of [path.join(HWP, "sample.hwp"), ...thirdFiles]) {
      const name = path.basename(file);
      await test(`${name}: 문단 글자 빠짐없음·표 행·열·셀`, async () => {
        const r = await parseIn(page, fs.readFileSync(file), "parseHwp");
        assert.ok(r.ok, r.message);
        if (name === "sample-5017.hwp") assert.ok(r.text.includes("한글 워드 프로세서"), "한컴 로고 글자 U+F53A → 한");
        const mine = squash(r.text);
        let ref = pyhwpReference(file), source = "pyhwp";
        if (!ref) {
          const b = BUILTIN[name];
          if (!b) { console.log("       (기준값 없음 — 열리는지만 확인)"); return; }
          ref = { chunks: b.chunks, tables: b.tables.map(([rows, cols]) => ({ rows, cols, cells: null })) };
          source = "내장";
        }
        const missing = ref.chunks.filter((c) => squash(c) && !mine.includes(squash(c)));
        assert.deepEqual(missing, [], "빠진 글자 조각");
        const want = charCounts(ref.chunks.join("")), have = charCounts(r.text);
        const short = [...want].filter(([ch, n]) => (have.get(ch) || 0) < n);
        assert.deepEqual(short, [], "글자 수가 모자람");
        const tables = tablesOf(r);
        assert.equal(tables.length, ref.tables.length, "표 개수");
        ref.tables.forEach((t, i) => {
          assert.equal(tables[i].rows, t.rows, `표 ${i + 1} 행 수`);
          assert.equal(tables[i].cols, t.cols, `표 ${i + 1} 열 수`);
          if (t.cells) for (const c of t.cells) assert.equal(squash(cellAt(tables[i], c.row, c.col) || ""), squash(c.text), `표 ${i + 1} (${c.row},${c.col})`);
        });
        const nChars = [...want.values()].reduce((a, b) => a + b, 0);
        console.log(`       [${source}] 글자 조각 ${ref.chunks.length}개(${nChars}자) 모두 포함, 표 ${tables.length}개 일치${r.notes.length ? " · 안내: " + r.notes.join(" / ") : ""}`);
      });
    }

    console.log("그림 추출");
    for (const name of ["sample-5017.hwp", "shapepict-scaled.hwp"]) {
      const file = path.join(THIRD, name);
      if (!fs.existsSync(file)) { console.log(`       (${name} 없음 — 건너뜀)`); continue; }
      await test(`${name}: 그림 수·형식·바이트(길이·SHA-256)·문서 속 자리`, async () => {
        const r = await parseImagesIn(page, fs.readFileSync(file));
        assert.ok(r.ok, r.message);
        let ref = pyhwpImages(file), source = "pyhwp";
        if (!ref) { ref = BUILTIN_IMAGES[name]; source = "내장"; }
        const imgs = r.flow.map((b, i) => [b, i]).filter(([b]) => b.type === "image");
        assert.equal(imgs.length, ref.length, "그림 수");
        assert.equal(r.stats.images, ref.length);
        imgs.forEach(([b, i], k) => {
          const want = ref[k];
          assert.ok(b.isU8 && b.supported && ["png", "jpeg", "gif", "webp"].includes(b.kind), `그림 ${k + 1} 머리 바이트 ${b.kind}`);
          assert.equal(b.mime, { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[b.kind]);
          assert.equal(b.source, want.stream, `그림 ${k + 1} 스트림`);
          assert.equal(b.length, want.length, `그림 ${k + 1} 길이`);
          assert.equal(b.sha, want.sha, `그림 ${k + 1} SHA-256`);
          assert.equal(b.n, k + 1); assert.equal(b.name, `그림 ${k + 1}.${b.kind === "jpeg" ? "jpg" : b.kind}`);
          assert.ok(b.width > 0 && b.height > 0, "픽셀 크기");
          const { before, after } = around(r.flow, i);
          if (want.before) assert.ok(before && squash(before).includes(squash(want.before)), `그림 ${k + 1} 앞 문단: ${before}`);
          if (want.after) assert.ok(after && squash(after).startsWith(squash(want.after)), `그림 ${k + 1} 뒤 문단: ${after}`);
        });
        assert.ok(!r.notes.some((n) => /그림/.test(n)), r.notes.join(" / "));
        const lines = r.md.split("\n").filter((l) => l.startsWith("!["));
        assert.equal(lines.length, ref.length);
        assert.match(lines[0], /^!\[그림 1\]\(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+\)$/);
        assert.ok(!r.mdText.includes("data:") && r.mdText.includes("(그림 1)"), "텍스트로 저장에는 자리 표시만");
        console.log(`       [${source}] 그림 ${imgs.length}개: ${imgs.map(([b]) => `${b.source} ${b.mime} ${b.width}×${b.height} ${b.length}B`).join(", ")}`);
      });
    }
    if (fs.existsSync(path.join(THIRD, "sample-5017.hwp"))) {
      await test("sample-5017.hwp: 그림 개체가 가리키지 않는 BinData(BIN0002.png)는 넣지 않는다", async () => {
        const r = await parseImagesIn(page, fs.readFileSync(path.join(THIRD, "sample-5017.hwp")));
        assert.deepEqual(r.flow.filter((b) => b.type === "image").map((b) => b.source), ["BinData/BIN0002.jpg", "BinData/BIN0003.png"]);
      });
    }
    await test("합성 HWP: 압축·비압축 BinData, 표 칸 안 그림, BMP→PNG, WMF 안내, 안 쓰는 BinData 제외, 같은 그림 두 번", async () => {
      const r = await parseImagesIn(page, buildHwpImages());
      assert.ok(r.ok, r.message + r.stack);
      const f = r.flow;
      const texts = f.map((b) => (b.type === "image" ? `[${b.source}]` : b.text));
      assert.deepEqual(texts, ["그림 앞 문단", "그림 설명 글", "[BinData/BIN0001.png]", "그림 뒤 문단", "칸 글자", "[BinData/BIN0002.bmp]", "표 뒤 문단", "[BinData/BIN0001.png]", "끝 문단"]);
      const imgs = f.filter((b) => b.type === "image");
      assert.equal(imgs[0].sha, sha256(TINY_PNG)); assert.equal(imgs[0].width, 4); assert.equal(imgs[0].height, 3);
      assert.equal(imgs[1].mime, "image/png"); assert.equal(imgs[1].kind, "png", "BMP는 PNG로 바뀐다"); assert.equal(imgs[1].width, 2);
      assert.equal(imgs[2].sha, imgs[0].sha); assert.deepEqual(imgs.map((b) => b.n), [1, 2, 3]);
      assert.ok(r.notes.includes("그림 1개는 형식(WMF)을 지원하지 않아 가져오지 않았어요."), r.notes.join(" / "));
      // 기존 글자·표 결과는 그대로
      const plain = await parseIn(page, buildHwp({ flags: 1 }), "parseHwp");
      assert.ok(plain.ok && !plain.blocks.some((b) => b.type === "image"));
    });
    await test("합성 HWPX: content.hpf → BinData, 배경 그림 제외, WMF·SVG 거부", async () => {
      const r = await parseImagesIn(page, buildHwpxImages());
      assert.ok(r.ok, r.message + r.stack);
      const texts = r.flow.map((b) => (b.type === "image" ? `[${b.source}]` : b.text));
      assert.deepEqual(texts, ["그림 앞 문단", "[BinData/image1.png]", "그림 뒤 문단", "끝 문단"]);
      const [img] = r.flow.filter((b) => b.type === "image");
      assert.equal(img.sha, sha256(TINY_PNG)); assert.equal(img.mime, "image/png"); assert.equal(img.name, "그림 1.png");
      assert.ok(r.notes.includes("그림 2개는 형식(WMF, SVG)을 지원하지 않아 가져오지 않았어요."), r.notes.join(" / "));
      assert.ok(!r.md.includes("svg"), "SVG는 어디에도 넣지 않는다");
      const kinds = await page.evaluate(([w, s]) => [RN._convert.imageInfo(Uint8Array.from(atob(w), (c) => c.charCodeAt(0))), RN._convert.imageInfo(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))].map((x) => [x.label, x.supported]), [FAKE_WMF.toString("base64"), FAKE_SVG.toString("base64")]);
      assert.deepEqual(kinds, [["WMF", false], ["SVG", false]]);
    });
    await test("그림 수 제한: 200개까지만, 나머지는 안내", async () => {
      const n = 205;
      const items = Array.from({ length: n }, (_, i) => ({ id: "im" + i, path: `BinData/im${i}.png`, data: makePng(1, 1, () => [i % 256, 0, 0, 255]), store: true }));
      const r = await parseImagesIn(page, buildHwpxWith(items, items.map((it) => hxP(hxPic(it.id))).join("")));
      assert.ok(r.ok, r.message);
      assert.equal(r.flow.filter((b) => b.type === "image").length, 200);
      assert.ok(r.notes.some((x) => /^그림 5개는 .*200개, 60MB.*건너뛰었어요/.test(x)), r.notes.join(" / "));
    });
    await test("extractImages: 그림 블록만 문서 순서대로", async () => {
      const r = await page.evaluate(async (b64) => {
        const res = await RN._convert.extractImages(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        return res.images.map((b) => [b.type, b.n, b.mime, b.bytes.length]);
      }, buildHwpImages().toString("base64"));
      assert.deepEqual(r, [["image", 1, "image/png", TINY_PNG.length], ["image", 2, "image/png", r[1][3]], ["image", 3, "image/png", TINY_PNG.length]]);
    });

    console.log("화면 convert");
    await test("처음 화면: 제목·한 줄 안내·파일 고르기만", async () => {
      await page.evaluate(() => RN.go("convert"));
      await page.waitForSelector("#convert-file");
      assert.equal(await page.locator("#rn-view h1").innerText(), "한글 파일 열기");
      assert.equal(await page.locator("#convert-hint").innerText(), "글자·표·그림을 읽어 옵니다. 쪽 배치와 글꼴은 원본과 다릅니다.");
      assert.equal(await page.locator("#rn-view button").count(), 0, "파일을 열기 전에는 버튼이 없다");
      assert.equal(await page.locator('label[for="convert-file"]').count(), 1);
    });
    await test("형식 아님·손상 파일은 오류 안내", async () => {
      await page.setInputFiles("#convert-file", path.join(FIX, "csv", "missing.csv"));
      await page.waitForFunction(() => /HWP나 HWPX 파일이 아니에요/.test(document.querySelector("#convert-status").innerText));
      for (const f of ["corrupt.hwp", "corrupt.hwpx", "truncated.hwpx"]) {
        await page.evaluate(() => { document.querySelector("#convert-status").textContent = ""; });
        await page.setInputFiles("#convert-file", path.join(HWP, f));
        await page.waitForFunction(() => /손상되어 열 수 없어요/.test(document.querySelector("#convert-status").innerText));
        assert.equal(await page.locator("#convert-paper").count(), 0, f);
      }
    });
    await test("sample.hwp 열기 → 흰 종이에 제목·문단·표, 버튼 두 개", async () => {
      await page.setInputFiles("#convert-file", path.join(HWP, "sample.hwp"));
      await page.waitForSelector("#convert-paper");
      assert.match(await page.locator("#convert-summary").innerText(), /sample\.hwp · 문단 5개 · 표 1개/);
      assert.equal(await page.locator("#convert-paper h2").first().innerText(), "음향 블랙홀 진동 감쇠 실험 보고서");
      assert.equal(await page.locator("#convert-paper td").count(), 6);
      assert.equal(await page.locator("#convert-paper td").nth(3).innerText(), "12.5");
      assert.match(await page.locator("#convert-paper").innerText(), /표 아래 문단: 감쇠율은 세 번 측정한 평균이다\./);
      const bg = await page.locator("#convert-paper").evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(bg, "rgb(255, 255, 255)");
      const buttons = await page.locator("#rn-view button").allInnerTexts();
      assert.deepEqual(buttons, ["텍스트로 저장", "내 프로젝트로 가져오기"]);
      assert.equal(await page.locator("#convert-status").innerText(), "");
      assert.equal(await page.locator("#convert-unsaved").innerText(), "아직 저장되지 않았어요. ‘내 프로젝트로 가져오기’를 누르면 문서로 저장되고, 그 뒤로는 자동 저장돼요.");
      assert.equal(await page.locator("#convert-paper img").count(), 0);
    });
    await test("끌어다 놓기로 sample.hwpx 열기", async () => {
      const b64 = fs.readFileSync(path.join(HWP, "sample.hwpx")).toString("base64");
      await page.evaluate((b64) => {
        const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([u], "끌어온.hwpx"));
        const zone = document.querySelector(".cv-drop");
        zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
        zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, b64);
      await page.waitForFunction(() => /끌어온\.hwpx/.test((document.querySelector("#convert-summary") || {}).innerText || ""));
      assert.equal(await page.locator("#convert-paper td").count(), 6);
    });
    await test("텍스트로 저장 → .md (downloads)", async () => {
      await page.setInputFiles("#convert-file", path.join(HWP, "sample.hwp"));
      await page.waitForFunction(() => /sample\.hwp/.test((document.querySelector("#convert-summary") || {}).innerText || ""));
      await page.evaluate(() => { window.__downloads = []; });
      await page.click("#convert-save");
      await page.waitForFunction(() => window.__downloads.length === 1);
      const d = await page.evaluate(() => window.__downloads[0]);
      assert.equal(d.filename, "sample.md");
      assert.ok(d.data.startsWith("# 음향 블랙홀 진동 감쇠 실험 보고서"));
      assert.ok(d.data.includes("| 조건 | 감쇠율 |"));
    });
    await test("내 프로젝트로 가져오기 → RN.docs.createDoc(pid, {title, markdown, reason: IMPORT, sourceName}) → 에디터", async () => {
      await page.evaluate(() => {
        window.__created = []; window.__went = [];
        window.__realDocs = RN.docs; window.__realGo = RN.go;
        RN.docs = {
          listProjects: async () => [{ id: "p1", title: "진자 실험" }, { id: "p2", title: "삭제됨", deletedAt: 1 }, { id: "p3", title: "보관됨", archivedAt: 1 }, { id: "p4", title: "음향 연구" }],
          createDoc: async (pid, input) => { window.__created.push([pid, input]); return "newdoc"; },
        };
        RN.go = (name, params) => window.__went.push([name, params]);
      });
      await page.click("#convert-import");
      await page.waitForSelector("#convert-dialog[open]");
      await page.waitForFunction(() => document.querySelectorAll("#convert-project option").length === 2);
      assert.deepEqual(await page.locator("#convert-project option").allInnerTexts(), ["진자 실험", "음향 연구"]);
      assert.equal(await page.inputValue("#convert-title"), "sample");
      await page.selectOption("#convert-project", "p4");
      await page.fill("#convert-title", "가져온 보고서");
      await page.click("#convert-import-ok");
      await page.waitForFunction(() => window.__created.length === 1 && window.__went.length === 1);
      const [[pid, input]] = await page.evaluate(() => window.__created);
      assert.equal(pid, "p4");
      assert.deepEqual(Object.keys(input).sort(), ["markdown", "reason", "sourceName", "title"]);
      assert.equal(input.title, "가져온 보고서"); assert.equal(input.reason, "IMPORT"); assert.equal(input.sourceName, "sample.hwp");
      assert.ok(input.markdown.includes("## 실험 방법")); assert.ok(input.markdown.includes("| 조건 | 감쇠율 |"));
      assert.deepEqual(await page.evaluate(() => window.__went), [["editor", { projectId: "p4", docId: "newdoc" }]]);
      assert.equal(await page.locator("#convert-dialog").count(), 0);
    });
    await test("프로젝트가 없으면 안내하고 가져오기 버튼을 막는다", async () => {
      await page.evaluate(() => { RN.docs.listProjects = async () => []; });
      await page.click("#convert-import");
      await page.waitForFunction(() => /프로젝트를 만드세요/.test(document.querySelector("#convert-dialog").innerText));
      assert.equal(await page.locator("#convert-import-ok").isDisabled(), true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("#convert-dialog"));
      await page.evaluate(() => { RN.go = window.__realGo; });
    });

    if (fs.existsSync(path.join(THIRD, "sample-5017.hwp"))) {
      await test("sample-5017.hwp 열기 → 종이 위 그 자리에 그림, 요약 \"그림 2개\", 그림 저장 → downloads", async () => {
        await page.setInputFiles("#convert-file", path.join(THIRD, "sample-5017.hwp"));
        await page.waitForFunction(() => /sample-5017\.hwp/.test((document.querySelector("#convert-summary") || {}).innerText || ""));
        assert.match(await page.locator("#convert-summary").innerText(), / · 그림 2개$/);
        await page.waitForFunction(() => [...document.querySelectorAll("#convert-paper img")].every((i) => i.complete && i.naturalWidth > 0));
        const imgs = await page.locator("#convert-paper img").evaluateAll((els) => els.map((i) => ({ alt: i.alt, w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 5), maxW: getComputedStyle(i).maxWidth, prev: (i.closest("figure").previousElementSibling || {}).textContent })));
        assert.equal(imgs.length, 2);
        assert.deepEqual(imgs.map((i) => i.alt), ["그림 1", "그림 2"]);
        assert.ok(imgs.every((i) => i.w > 0 && i.h > 0 && i.src === "blob:" && i.maxW === "100%"), JSON.stringify(imgs));
        assert.match(imgs[0].prev, /^본 문서는 먼저/);
        assert.deepEqual(await page.locator("#rn-view .cv-bar button").allInnerTexts(), ["텍스트로 저장", "그림 저장", "내 프로젝트로 가져오기"]);
        assert.equal(await page.locator("#convert-images").isVisible(), false);
        await page.click("#convert-images-btn");
        assert.equal(await page.getAttribute("#convert-images-btn", "aria-expanded"), "true");
        assert.equal(await page.locator("#convert-images li").count(), 2);
        assert.match(await page.locator("#convert-images li").first().innerText(), /그림 1[\s\S]*×[\s\S]*KB/);
        assert.ok(await page.locator("#convert-images li img").first().evaluate((i) => i.naturalWidth > 0 || new Promise((r) => i.onload = () => r(i.naturalWidth > 0))));
        await page.evaluate(() => { window.__downloads = []; });
        await page.click("#convert-img-save-1");
        await page.waitForFunction(() => window.__downloads.length === 1);
        const d = await page.evaluate(async () => { const x = window.__downloads[0]; const b = new Uint8Array(await x.data.arrayBuffer()); return { filename: x.filename, blob: x.data instanceof Blob, size: x.data.size, head: [...b.slice(0, 4)] }; });
        assert.deepEqual(d, { filename: "sample-5017-그림2.png", blob: true, size: PNG_5017.length, head: [0x89, 0x50, 0x4e, 0x47] });
        // 거절은 오류가 아니다
        await page.evaluate(() => { window.__realDl = RN.caps.downloads.save; RN.caps.downloads.save = async () => { throw { code: "declined" }; }; });
        await page.click("#convert-img-save-0");
        await page.waitForTimeout(100);
        assert.ok(!/저장하지 못했어요/.test(await page.locator("#rn-toast").innerText().catch(() => "")));
        await page.evaluate(() => { RN.caps.downloads.save = window.__realDl; });
        // 텍스트로 저장에는 그림 data URL 없이 자리 표시만
        await page.evaluate(() => { window.__downloads = []; });
        await page.click("#convert-save");
        await page.waitForFunction(() => window.__downloads.length === 1);
        const md = await page.evaluate(() => window.__downloads[0].data);
        assert.ok(md.includes("(그림 1)") && md.includes("(그림 2)") && !md.includes("data:"), md.slice(0, 300));
      });
    }
    await test("그림을 가져오기: 줄인 그림(한 장 60KB 이하) data URL 줄, 생략 수 안내, 지원 안 하는 형식 안내, 화면을 떠나면 URL 해제", async () => {
      await page.evaluate(() => RN.go("convert"));
      await page.waitForSelector("#convert-file");
      await page.setInputFiles("#convert-file", { name: "큰그림.hwpx", mimeType: "application/octet-stream", buffer: buildHwpxBig() });
      await page.waitForFunction(() => /큰그림\.hwpx/.test((document.querySelector("#convert-summary") || {}).innerText || ""), null, { timeout: 30000 });
      assert.match(await page.locator("#convert-summary").innerText(), /그림 2개/);
      assert.match(await page.locator("#convert-notes").innerText(), /그림 1개는 형식\(WMF\)을 지원하지 않아 가져오지 않았어요\./);
      await page.waitForFunction(() => [...document.querySelectorAll("#convert-paper img")].length === 2 && [...document.querySelectorAll("#convert-paper img")].every((i) => i.complete && i.naturalWidth > 0));
      const shown = await page.locator("#convert-paper img").evaluateAll((els) => els.map((i) => [i.naturalWidth, i.naturalHeight, i.getBoundingClientRect().width <= i.closest("article").clientWidth]));
      assert.deepEqual(shown, [[1600, 1000, true], [1000, 1000, true]]);
      await page.evaluate(() => {
        window.__created = []; window.__went = []; window.__realDocs2 = RN.docs; window.__realGo2 = RN.go;
        RN.docs = {
          listProjects: async () => [{ id: "p1", title: "진자 실험" }],
          createDoc: async (pid, input) => { window.__created.push([pid, input]); RN.docs.lastImportInfo = { imagesSkipped: 1 }; return "imgdoc"; },
        };
        RN.go = (name, params) => window.__went.push([name, params]);
      });
      await page.click("#convert-import");
      await page.waitForFunction(() => document.querySelectorAll("#convert-project option").length === 1 && !document.querySelector("#convert-import-ok").disabled);
      await page.click("#convert-import-ok");
      await page.waitForFunction(() => window.__created.length === 1 && window.__went.length === 1, null, { timeout: 30000 });
      const [[pid, input]] = await page.evaluate(() => window.__created);
      assert.equal(pid, "p1");
      assert.deepEqual(Object.keys(input).sort(), ["markdown", "reason", "sourceName", "title"]);
      const lines = input.markdown.split("\n").filter((l) => l.startsWith("!["));
      assert.equal(lines.length, 2, input.markdown.slice(0, 200));
      const parsed = lines.map((l) => /^!\[(그림 \d+)\]\(data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)\)$/.exec(l));
      assert.ok(parsed.every(Boolean), "독립된 줄 ![그림 N](data:image/…;base64,…)");
      const sizes = parsed.map((m) => [m[1], m[2], Buffer.from(m[3], "base64")]);
      assert.deepEqual(sizes.map((x) => [x[0], x[1]]), [["그림 1", "image/jpeg"], ["그림 2", "image/png"]], "불투명은 JPEG, 투명은 PNG");
      for (const [label, , buf] of sizes) assert.ok(buf.length <= 60 * 1024, `${label} ${buf.length}B`);
      const dims = await page.evaluate(async (list) => Promise.all(list.map(async ([mime, b64]) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime })); return Math.max(bmp.width, bmp.height); })), parsed.map((m) => [m[2], m[3]]));
      assert.ok(dims[0] <= 1200 && dims[1] <= 800, JSON.stringify(dims));
      console.log(`       (1600×1000 잡음 사진 → ${sizes[0][2].length}B JPEG 긴 변 ${dims[0]}px, 1000×1000 투명 → ${sizes[1][2].length}B PNG 긴 변 ${dims[1]}px)`);
      assert.match(await page.locator("#rn-toast").innerText(), /그림 1개는 문서 크기 제한으로 빠졌어요/);
      // 화면을 떠나면 미리보기 blob: URL을 놓아 준다
      await page.evaluate(() => { RN.go = window.__realGo2; RN.docs = window.__realDocs2; });
      const url = await page.locator("#convert-paper img").first().getAttribute("src");
      await page.evaluate(() => RN.go("home"));
      await page.waitForFunction(() => !document.querySelector("#convert-paper"));
      const gone = await page.evaluate(async (u) => { try { await fetch(u); return false; } catch { return true; } }, url);
      assert.ok(gone, "revokeObjectURL");
      await page.evaluate(() => RN.go("convert"));
      await page.waitForSelector("#convert-file");
    });

    console.log("프로젝트 섹션 \"가져오기\"");
    await test(".md·.txt·.hwp·.hwpx → 새 문서, 손상·지원 안 함은 오류", async () => {
      await page.evaluate(() => {
        window.__created = [];
        RN.docs.createDoc = async (pid, input) => { window.__created.push([pid, input]); return "d" + window.__created.length; };
        const host = document.createElement("div"); host.id = "host-import";
        document.getElementById("rn-view").replaceChildren(host);
        RN.projectSections.find((x) => x.id === "import").mount(host, { id: "p1", title: "진자 실험" });
      });
      assert.equal(await page.locator("#host-import input[type=file]").count(), 1);
      assert.equal(await page.locator("#host-import p.rn-small").count(), 1, "한 줄 설명");
      const up = (f) => page.setInputFiles("#import-file", f);
      await up({ name: "메모.md", mimeType: "text/markdown", buffer: Buffer.from("# 제목\n\n본문") });
      await page.waitForFunction(() => window.__created.length === 1);
      await up({ name: "노트.txt", mimeType: "text/plain", buffer: Buffer.from("첫 줄\n둘째 줄") });
      await page.waitForFunction(() => window.__created.length === 2);
      await up(path.join(HWP, "sample.hwp"));
      await page.waitForFunction(() => window.__created.length === 3);
      await up(path.join(HWP, "sample.hwpx"));
      await page.waitForFunction(() => window.__created.length === 4);
      await up(path.join(HWP, "corrupt.hwp"));
      await page.waitForFunction(() => /손상되어 열 수 없어요/.test(document.querySelector("#import-status").innerText));
      await up({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
      await page.waitForFunction(() => /가져올 수 없는 파일/.test(document.querySelector("#import-status").innerText));
      const c = await page.evaluate(() => window.__created);
      assert.deepEqual(c[0], ["p1", { reason: "IMPORT", title: "메모", markdown: "# 제목\n\n본문", sourceName: "메모.md" }]);
      assert.equal(c[1][1].text, "첫 줄\n둘째 줄"); assert.equal(c[1][1].markdown, undefined);
      assert.equal(c[2][1].title, "sample"); assert.equal(c[2][1].sourceName, "sample.hwp"); assert.ok(c[2][1].markdown.includes("| 기준 보 | 12.5 |"));
      assert.equal(c[3][1].sourceName, "sample.hwpx"); assert.equal(c[3][1].markdown, c[2][1].markdown);
      assert.equal(c.length, 4);
      await up({ name: "그림.hwpx", mimeType: "application/octet-stream", buffer: buildHwpxImages() });
      await page.waitForFunction(() => window.__created.length === 5);
      const md5 = await page.evaluate(() => window.__created[4][1].markdown);
      assert.match(md5, /\n\n!\[그림 1\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\)\n\n/);
      await page.evaluate(() => { RN.docs = window.__realDocs; });
    });

    console.log("비로그인·휴대폰 폭");
    await test("비로그인이면 가져오기 버튼 대신 안내, 보기와 저장은 된다", async () => {
      const p = await open(ctx, "anon=1", "convert");
      await p.waitForSelector("#convert-file");
      await p.setInputFiles("#convert-file", path.join(HWP, "sample.hwp"));
      await p.waitForSelector("#convert-paper");
      assert.equal(await p.locator("#convert-import").count(), 0);
      assert.match(await p.locator("#convert-out").innerText(), /로그인/);
      assert.equal(await p.locator("#convert-unsaved").innerText(), await p.evaluate(() => RN.connectionHelp()));
      await p.evaluate(() => {
        const host = document.createElement("div"); host.id = "host-import";
        document.getElementById("rn-view").replaceChildren(host);
        RN.projectSections.find((x) => x.id === "import").mount(host, { id: "p1" });
      });
      assert.equal(await p.locator("#import-file").count(), 0);
      assert.match(await p.locator("#host-import").innerText(), /로그인/);
      await p.close();
    });
    await test("400px 폭에서 가로 스크롤 없음(넓은 표가 든 문서 포함)", async () => {
      const pctx = await newContext({ viewport: { width: 400, height: 800 } });
      const p = await open(pctx, "", "convert");
      await p.waitForSelector("#convert-file");
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 400), "빈 화면 " + (await p.evaluate(() => document.documentElement.scrollWidth)));
      const wide = Buffer.from(buildZip([
        { name: "mimetype", data: "application/hwp+zip", store: true },
        { name: "Contents/section0.xml", data: `<hs:sec xmlns:hp="urn:p" xmlns:hs="urn:s"><hp:p><hp:run><hp:tbl rowCnt="1" colCnt="8"><hp:tr>${Array.from({ length: 8 }, (_, i) => `<hp:tc><hp:subList><hp:p><hp:run><hp:t>아주긴셀내용${i}아주긴셀내용아주긴셀내용</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="${i}" rowAddr="0"/></hp:tc>`).join("")}</hp:tr></hp:tbl></hp:run></hp:p><hp:p><hp:run><hp:t>${"띄어쓰기없는아주긴문장".repeat(20)}</hp:t></hp:run></hp:p></hs:sec>` },
      ]));
      for (const f of [path.join(HWP, "sample.hwp"), { name: "넓은표.hwpx", mimeType: "application/octet-stream", buffer: wide }, { name: "큰그림.hwpx", mimeType: "application/octet-stream", buffer: buildHwpxBig() }, ...(fs.existsSync(path.join(THIRD, "sample-5017.hwp")) ? [path.join(THIRD, "sample-5017.hwp")] : [])]) {
        await p.setInputFiles("#convert-file", f);
        const name = typeof f === "string" ? path.basename(f) : f.name;
        await p.waitForFunction((n) => ((document.querySelector("#convert-summary") || {}).innerText || "").includes(n), name);
        await p.waitForFunction(() => [...document.querySelectorAll("#convert-paper img")].every((i) => i.complete));
        if (await p.locator("#convert-images-btn").count()) await p.click("#convert-images-btn");
        const sw = await p.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(sw <= 400, `${name} scrollWidth ${sw}`);
      }
      await p.close();
      await pctx.close();
    });

    await test("외부 요청·엔진 파일 요청 없음, 페이지 오류 없음", async () => {
      assert.deepEqual(external, []);
      const src = fs.readFileSync(path.join(ROOT, "mod-convert.js"), "utf8");
      assert.ok(!/vendor\/|rhwp|import\(/.test(src), "rhwp·vendor 참조가 남아 있다");
      const mine = pageErrors.filter((e) => /mod-convert/.test(e));
      assert.deepEqual(mine, []);
      if (pageErrors.length) console.log("       (다른 모듈 오류 " + pageErrors.length + "개 무시)");
    });
    await ctx.close();
  } finally {
    await browser.close();
    srv.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})();
