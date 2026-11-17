import { fail, isHwpError } from "./errors";

/** 바이트 도우미와 압축 풀기. DOM에 의존하지 않는다(DecompressionStream·TextDecoder는 브라우저·Node 모두 있다). */

export type Bytes = Uint8Array;

export const MAX_FILE = 50 * 1024 * 1024;
/** 압축 폭탄 방지(풀린 크기 합) */
export const MAX_INFLATED = 400 * 1024 * 1024;

export const u16 = (b: Bytes, o: number) => b[o] | (b[o + 1] << 8);
export const u32 = (b: Bytes, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
export const be16 = (b: Bytes, o: number) => (b[o] << 8) | b[o + 1];
export const be32 = (b: Bytes, o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

export const utf16 = new TextDecoder("utf-16le");
export const utf8 = new TextDecoder("utf-8");

/** HWP 컨트롤 id는 거꾸로 저장된다 */
export const fourCC = (b: Bytes, o: number) => String.fromCharCode(b[o + 3], b[o + 2], b[o + 1], b[o]);

export function ascii(b: Bytes, o: number, n: number): string {
  let s = "";
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function toBytes(x: ArrayBuffer | ArrayBufferView | Bytes | null | undefined): Bytes {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x && ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new Uint8Array(0);
}

export type FileKind = "hwp" | "hwpx" | "hwp3";

/** 머리 바이트로 형식 판별: "hwp"(CFB), "hwpx"(zip), "hwp3"(HWP 3.0 이하), 그 밖은 null */
export function sniff(input: ArrayBuffer | ArrayBufferView): FileKind | null {
  const b = toBytes(input);
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1) return "hwp";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "hwpx";
  if (b.length >= 17 && ascii(b, 0, 17) === "HWP Document File") return "hwp3";
  return null;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** 화면을 멈추지 않게 오래 걸리는 반복 중간에 양보한다(약 24ms마다). onProgress는 0~1. */
export function makeTicker(onProgress?: (fraction: number) => void) {
  let last = now();
  return async (fraction?: number) => {
    if (now() - last < 24) return;
    if (onProgress && fraction != null) {
      try {
        onProgress(Math.max(0, Math.min(1, fraction)));
      } catch {
        /* 무시 */
      }
    }
    await new Promise((r) => setTimeout(r, 0));
    last = now();
  };
}

/** 풀린 크기 합을 세는 예산 */
export type Budget = { left: number };
export type Inflated = { data: Bytes; complete: boolean };

/**
 * raw deflate 풀기 → { data, complete }.
 * 한글이 저장한 스트림은 deflate 끝 뒤에 8바이트(체크섬 4 + 풀린 크기 4)가 더 붙어 있다. 브라우저는 그 군더더기를
 * 오류로 보고 마지막 출력까지 버리므로, 꼬리 8바이트를 떼고 먼저 풀어 본다(풀린 크기가 꼬리의 값과 같으면 성공).
 */
export async function inflateRaw(bytes: Bytes, budget?: Budget): Promise<Inflated> {
  if (bytes.length > 8) {
    const tailSize = u32(bytes, bytes.length - 4);
    if (tailSize > 0 && (!budget || tailSize <= budget.left)) {
      const r = await inflateOnce(bytes.subarray(0, bytes.length - 8), budget);
      if (r.complete && r.data.length === tailSize) return r;
      if (budget) budget.left += r.data.length;
    }
  }
  const r = await inflateOnce(bytes, budget);
  if (r.complete || bytes.length <= 8) return r;
  // 꼬리 크기를 모르는 군더더기: 떼고 다시 풀어 더 많이 나온 쪽을 쓴다
  if (budget) budget.left += r.data.length;
  const r2 = await inflateOnce(bytes.subarray(0, bytes.length - 8), budget);
  if (r2.complete || r2.data.length >= r.data.length) return r2;
  if (budget) budget.left += r2.data.length - r.data.length;
  return r;
}

async function inflateOnce(bytes: Bytes, budget?: Budget): Promise<Inflated> {
  if (typeof DecompressionStream === "undefined") fail("unsupported");
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  // 입력을 새 ArrayBuffer로 복사해 넘긴다(SharedArrayBuffer 뷰·큰 파일 버퍼를 스트림에 넘기지 않게)
  writer.write(bytes.slice()).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Bytes[] = [];
  let total = 0;
  let complete = true;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (budget && total > budget.left) {
        try {
          void reader.cancel();
        } catch {
          /* 무시 */
        }
        fail("too_large");
      }
    }
  } catch (e) {
    if (isHwpError(e, "too_large")) throw e;
    complete = false;
  }
  if (budget) budget.left -= total;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return { data: out, complete };
}
