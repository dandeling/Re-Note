import { ascii, be16, be32, sniff, toBytes, u16, u32 } from "./bytes";
import { MAX_IMAGE_BYTES, MAX_IMAGES, type CtxBase, type WorkBlock } from "./common";
import { isHwpError } from "./errors";
import type { Block, ImageBlock, ImageConverter, ImageMime } from "./types";

/** 그림: 형식 확인·크기·자리 표시 → 그림 블록 */

const RASTER: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
export const EXT_OF: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export type ImageInfo = { kind: string; mime: string; supported: boolean; label: string; width: number; height: number };

/**
 * 머리 바이트로 그림 형식 판별.
 * 브라우저가 그릴 수 있는 래스터(PNG·JPEG·GIF·WebP·BMP)만 supported. SVG·XML 등 글자로 된 형식은 절대 받지 않는다.
 */
export function imageInfo(input: ArrayBuffer | ArrayBufferView): ImageInfo {
  const b = toBytes(input);
  const out = (kind: string, w?: number, hgt?: number): ImageInfo => ({ kind, mime: RASTER[kind] || "", supported: !!RASTER[kind], label: kind.toUpperCase(), width: w || 0, height: hgt || 0 });
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return out("png", be32(b, 16), be32(b, 20));
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let w = 0;
    let hgt = 0;
    for (let o = 2; o + 9 < b.length; ) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const m = b[o + 1];
      if (m === 0xff) {
        o++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        o += 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        hgt = be16(b, o + 5);
        w = be16(b, o + 7);
        break;
      }
      if (m === 0xd9 || m === 0xda) break;
      o += 2 + be16(b, o + 2);
    }
    return out("jpeg", w, hgt);
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return out("gif", u16(b, 6), u16(b, 8));
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const c = ascii(b, 12, 4);
    if (c === "VP8 ") return out("webp", u16(b, 26) & 0x3fff, u16(b, 28) & 0x3fff);
    if (c === "VP8L") {
      const v = u32(b, 21);
      return out("webp", (v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1);
    }
    if (c === "VP8X") return out("webp", 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    return out("webp");
  }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d && [12, 40, 52, 56, 64, 108, 124].includes(u32(b, 14))) {
    if (u32(b, 14) === 12) return out("bmp", u16(b, 18), u16(b, 20));
    const hh = u32(b, 22);
    return out("bmp", u32(b, 18), hh > 0x7fffffff ? 0x100000000 - hh : hh);
  }
  const no = (label: string): ImageInfo => ({ kind: label.toLowerCase(), mime: "", supported: false, label, width: 0, height: 0 });
  if (b.length >= 4 && u32(b, 0) === 0x9ac6cdd7) return no("WMF");
  if (b.length >= 18 && (u16(b, 0) === 1 || u16(b, 0) === 2) && u16(b, 2) === 9) return no("WMF");
  if (b.length >= 44 && u32(b, 0) === 1 && ascii(b, 40, 4) === " EMF") return no("EMF");
  if (b.length >= 4 && (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*")) return no("TIFF");
  if (sniff(b) === "hwp") return no("OLE");
  if (b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b) return no("ZIP");
  let i = 0;
  while (i < b.length && i < 64 && (b[i] <= 0x20 || b[i] === 0xef || b[i] === 0xbb || b[i] === 0xbf)) i++;
  if (b[i] === 0x3c) return no(/svg/i.test(ascii(b, i, 512)) ? "SVG" : "XML");
  return { kind: "", mime: "", supported: false, label: "", width: 0, height: 0 };
}

/** 그림 로더 결과 */
export type LoadedImage = { bytes: Uint8Array; ext: string; source: string } | { missing: true } | { unsupported: string };

type Resolved =
  | { ok: true; mime: ImageMime; bytes: Uint8Array; width: number; height: number; source: string }
  | { missing: true }
  | { unsupported: string }
  | { limit: true };

/**
 * 자리 표시 { type: "imageRef", ref } 를 실제 그림 블록으로 바꾸거나 빼고, 못 가져온 수를 ctx.stats에 적는다.
 * 같은 그림(ref)을 여러 곳에서 쓰면 바이트를 함께 쓴다(개수·크기 제한은 한 번만 센다).
 */
export async function resolveImages(
  sections: WorkBlock[][],
  ctx: CtxBase,
  loader: (ref: number | string) => Promise<LoadedImage>,
  convertToPng?: ImageConverter,
): Promise<Block[][]> {
  const cache = new Map<number | string, Resolved>();
  const s = ctx.stats;
  let used = 0;
  let usedBytes = 0;
  let n = 0;
  const kinds = new Set<string>();
  const load = async (ref: number | string): Promise<Resolved> => {
    if (ref == null || ref === 0 || ref === "") return { missing: true };
    let got: LoadedImage;
    try {
      got = await loader(ref);
    } catch (e) {
      if (isHwpError(e, "too_large")) throw e;
      return { missing: true };
    }
    if (!got || "missing" in got || "unsupported" in got) return got || { missing: true };
    const info = imageInfo(got.bytes);
    if (!info.supported) return { unsupported: info.label || (got.ext ? got.ext.toUpperCase() : "알 수 없음") };
    if (used + 1 > MAX_IMAGES || usedBytes + got.bytes.length > MAX_IMAGE_BYTES) return { limit: true };
    used++;
    usedBytes += got.bytes.length;
    let mime = info.mime;
    let { width, height } = info;
    let bytes = got.bytes;
    if (info.kind === "bmp") {
      const png = convertToPng ? await convertToPng(bytes, mime).catch(() => null) : null;
      if (!png) return { unsupported: "BMP" };
      bytes = png.bytes;
      mime = "image/png";
      width = png.width;
      height = png.height;
    }
    if (bytes.byteLength !== bytes.buffer.byteLength) bytes = bytes.slice(); // 파일 전체 버퍼를 붙잡지 않게
    return { ok: true, mime: mime as ImageMime, bytes, width, height, source: got.source || "" };
  };

  const out: Block[][] = [];
  for (const list of sections) {
    const next: Block[] = [];
    for (const b of list) {
      if (b.type !== "imageRef") {
        next.push(b);
        continue;
      }
      let r = cache.get(b.ref);
      if (!r) {
        r = await load(b.ref);
        cache.set(b.ref, r);
      }
      if ("ok" in r) {
        n++;
        const img: ImageBlock = { type: "image", mime: r.mime, bytes: r.bytes, name: `그림 ${n}.${EXT_OF[r.mime]}`, n, source: r.source };
        if (r.width && r.height) {
          img.width = r.width;
          img.height = r.height;
        }
        next.push(img);
        continue;
      }
      if ("unsupported" in r) {
        s.imgUnsupported++;
        kinds.add(r.unsupported);
      } else if ("limit" in r) s.imgLimit++;
      else s.imgMissing++;
    }
    out.push(next);
  }
  s.images = n;
  s.imgUnsupportedKinds = [...kinds];
  return out;
}
