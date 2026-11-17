import { inflateRaw, MAX_INFLATED, u16, u32, utf8, type Bytes } from "./bytes";
import { fail } from "./errors";

/** zip 읽기(중앙 디렉터리 → 로컬 헤더, 저장/deflate) — HWPX의 컨테이너 */

type ZipEntry = { method: number; csize: number; usize: number; at: number };

export type ZipReader = {
  /** 중앙 디렉터리 없이 로컬 헤더로만 읽었는가(잘린 파일) */
  partial: boolean;
  names(): string[];
  has(name: string): boolean;
  read(name: string): Promise<Bytes | null>;
};

export async function readZip(b: Bytes): Promise<ZipReader> {
  const entries = new Map<string, ZipEntry>();
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b[i] === 0x50 && u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  let partial = false;
  if (eocd >= 0) {
    const n = u16(b, eocd + 10);
    let o = u32(b, eocd + 16);
    for (let k = 0; k < n; k++) {
      if (o + 46 > b.length || u32(b, o) !== 0x02014b50) fail("bad_file", "central dir");
      const nl = u16(b, o + 28);
      const xl = u16(b, o + 30);
      const cl = u16(b, o + 32);
      const name = utf8.decode(b.subarray(o + 46, o + 46 + nl));
      entries.set(name, { method: u16(b, o + 10), csize: u32(b, o + 20), usize: u32(b, o + 24), at: u32(b, o + 42) });
      o += 46 + nl + xl + cl;
    }
  } else {
    // 중앙 디렉터리가 없으면(잘린 파일) 로컬 헤더를 앞에서부터 따라가 본다
    partial = true;
    let o = 0;
    while (o + 30 <= b.length && u32(b, o) === 0x04034b50) {
      const fl = u16(b, o + 6);
      const nl = u16(b, o + 26);
      const xl = u16(b, o + 28);
      const csize = u32(b, o + 18);
      if (fl & 8) break; // 크기를 뒤에 적는 형식은 따라갈 수 없다
      const name = utf8.decode(b.subarray(o + 30, Math.min(b.length, o + 30 + nl)));
      entries.set(name, { method: u16(b, o + 8), csize, usize: u32(b, o + 22), at: o });
      o += 30 + nl + xl + csize;
    }
    if (!entries.size) fail("bad_file", "no entries");
  }
  const budget = { left: MAX_INFLATED };
  return {
    partial,
    names: () => [...entries.keys()],
    has: (n) => entries.has(n),
    async read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.at + 30 > b.length || u32(b, e.at) !== 0x04034b50) fail("bad_file", "local header");
      const start = e.at + 30 + u16(b, e.at + 26) + u16(b, e.at + 28);
      const end = start + e.csize;
      if (end > b.length) fail("bad_file", "entry past end");
      const raw = b.subarray(start, end);
      if (e.method === 0) return raw;
      if (e.method !== 8) fail("bad_file", "method " + e.method);
      const r = await inflateRaw(raw, budget);
      if (!r.complete) fail("bad_file", "inflate");
      return r.data;
    },
  };
}
