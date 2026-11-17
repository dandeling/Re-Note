/**
 * 브라우저에서 HWP/HWPX를 직접 읽는 파서 (서버 변환 워커를 쓸 수 없는 배포 — Vercel 등 — 용).
 * artifact/mod-convert.js의 파서를 옮긴 것이다. DOM을 쓰지 않으므로 Node(테스트)·Web Worker에서도 돈다.
 * 압축 풀기는 DecompressionStream("deflate-raw")을 쓴다.
 *
 * 글자·표·그림을 뽑는다(쪽 배치·글꼴은 다루지 않는다). 그림은 그림 개체가 가리키는 것만, 머리 바이트로 확인한
 * 래스터 형식(PNG·JPEG·GIF·WebP, BMP는 convertToPng가 있으면 PNG로)만 쓴다.
 */
import { sniff, toBytes } from "./bytes";
import { tableText } from "./common";
import { HwpParseError } from "./errors";
import { parseHwp } from "./hwp5";
import { parseHwpx } from "./hwpx";
import type { Block, ParseOptions, ParseResult } from "./types";

export * from "./types";
export { HWP_ERROR_MESSAGES, HwpParseError, hwpErrorMessage, isHwpError, type HwpErrorCode } from "./errors";
export { MAX_FILE, sniff, type FileKind } from "./bytes";
export { MAX_IMAGE_BYTES, MAX_IMAGES } from "./common";
export { imageInfo, type ImageInfo } from "./images";
export { blocksToDoc, imagePlaceholderText, type BlocksToDocOptions, type BlocksToDocResult } from "./to-doc";
export { parseHwp, parseHwpx };

/** 형식을 보고 알맞은 파서로 */
export async function parseAny(input: ArrayBuffer | ArrayBufferView, opts?: ParseOptions): Promise<ParseResult> {
  const bytes = toBytes(input);
  const kind = sniff(bytes);
  if (kind === "hwp") return parseHwp(bytes, opts);
  if (kind === "hwpx") return parseHwpx(bytes, opts);
  throw new HwpParseError(kind === "hwp3" ? "old_hwp" : "not_hwp");
}

/** 블록 → 사람이 읽는 글자(검사·텍스트 저장용) */
export function blocksToText(blocks: Block[]): string {
  return blocks.map((b) => (b.type === "table" ? tableText(b) : b.type === "image" ? `(그림 ${b.n})` : b.text)).join("\n\n");
}

/** 블록 개수 요약 */
export function summarize(blocks: Block[]) {
  let paragraphs = 0;
  let headings = 0;
  let tables = 0;
  let images = 0;
  for (const b of blocks) {
    if (b.type === "heading") headings++;
    else if (b.type === "paragraph") paragraphs++;
    else if (b.type === "table") tables++;
    else images++;
  }
  return { paragraphs, headings, tables, images };
}
