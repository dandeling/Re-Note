import { sniff, u16, u32, utf16, type Bytes } from "./bytes";
import { fail } from "./errors";

/** Compound File Binary(OLE2) 읽기 — HWP 5.x의 컨테이너 */

const ENDCHAIN = 0xfffffffa; // 이 값 이상은 특수 표시(끝·빈 칸 등)

type DirEntry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };

export type CfbReader = {
  has(path: string): boolean;
  names(): string[];
  /** "BodyText/Section0" 같은 경로의 스트림 바이트. 없으면 null */
  read(path: string): Bytes | null;
};

export function readCfb(b: Bytes): CfbReader {
  if (b.length < 512 || sniff(b) !== "hwp") fail("bad_file", "cfb header");
  const shift = u16(b, 0x1e);
  const miniShift = u16(b, 0x20);
  if ((shift !== 9 && shift !== 12) || miniShift !== 6) fail("bad_file", "sector size");
  const ss = 1 << shift;
  const mss = 1 << miniShift;
  const maxSectors = Math.ceil((b.length - 512) / ss) + 1;
  const nFat = u32(b, 0x2c);
  const dirStart = u32(b, 0x30);
  const cutoff = u32(b, 0x38);
  const miniFatStart = u32(b, 0x3c);
  const nMiniFat = u32(b, 0x40);
  let difat = u32(b, 0x44);
  if (nFat > maxSectors || nMiniFat > maxSectors) fail("bad_file", "fat count");
  const sectorOff = (n: number) => (n + 1) * ss; // v3: 512바이트 헤더, v4: 4096바이트 헤더 = 한 섹터

  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(u32(b, 0x4c + i * 4));
  let guard = 0;
  while (fatSectors.length < nFat && difat < ENDCHAIN) {
    if (++guard > maxSectors || sectorOff(difat) + ss > b.length) fail("bad_file", "difat");
    const o = sectorOff(difat);
    for (let k = 0; k < ss / 4 - 1 && fatSectors.length < nFat; k++) fatSectors.push(u32(b, o + k * 4));
    difat = u32(b, o + ss - 4);
  }
  const per = ss / 4;
  const fat = new Uint32Array(fatSectors.length * per);
  fatSectors.forEach((s, i) => {
    const o = sectorOff(s);
    if (s >= ENDCHAIN || o + ss > b.length) fail("bad_file", "fat sector");
    for (let k = 0; k < per; k++) fat[i * per + k] = u32(b, o + k * 4);
  });

  function chain(start: number, table: Uint32Array, limit: number): number[] {
    const out: number[] = [];
    let s = start;
    while (s < ENDCHAIN) {
      if (s >= table.length || out.length > limit) fail("bad_file", "chain");
      out.push(s);
      s = table[s];
    }
    return out;
  }
  function readBig(start: number, size: number | null): Bytes {
    const secs = chain(start, fat, maxSectors);
    const want = size == null ? secs.length * ss : size;
    if (secs.length * ss < want) fail("bad_file", "short stream");
    const out = new Uint8Array(want);
    let o = 0;
    for (const s of secs) {
      if (o >= want) break;
      const from = sectorOff(s);
      const n = Math.min(ss, want - o);
      if (from + n > b.length) fail("bad_file", "sector past end");
      out.set(b.subarray(from, from + n), o);
      o += n;
    }
    return out;
  }

  const dir = readBig(dirStart, null);
  const entries: DirEntry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = Math.min(64, u16(dir, o + 0x40));
    entries.push({
      name: nameLen >= 2 ? utf16.decode(dir.subarray(o, o + nameLen - 2)) : "",
      type: dir[o + 0x42],
      left: u32(dir, o + 0x44),
      right: u32(dir, o + 0x48),
      child: u32(dir, o + 0x4c),
      start: u32(dir, o + 0x74),
      size: u32(dir, o + 0x78),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) fail("bad_file", "root");
  let mini: Bytes | null = null;
  let miniFat: Uint32Array | null = null;
  const getMini = (): { mini: Bytes; miniFat: Uint32Array } => {
    if (!mini || !miniFat) {
      mini = root.start < ENDCHAIN ? readBig(root.start, root.size) : new Uint8Array(0);
      const raw = nMiniFat && miniFatStart < ENDCHAIN ? readBig(miniFatStart, null) : new Uint8Array(0);
      miniFat = new Uint32Array(raw.length >> 2);
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32(raw, i * 4);
    }
    return { mini, miniFat };
  };

  // 디렉터리 트리(형제는 좌우 트리, 하위는 child) → "BodyText/Section0" 같은 경로
  const streams = new Map<string, DirEntry>();
  const seen = new Set<number>();
  const walk = (idx: number, prefix: string) => {
    const stack = [idx];
    while (stack.length) {
      const i = stack.pop()!;
      if (i >= entries.length || seen.has(i)) continue;
      seen.add(i);
      const e = entries[i];
      stack.push(e.left, e.right);
      if (e.type === 2) streams.set(prefix + e.name, e);
      else if (e.type === 1) walk(e.child, prefix + e.name + "/");
    }
  };
  walk(root.child, "");

  return {
    has: (path) => streams.has(path),
    names: () => [...streams.keys()],
    read(path) {
      const e = streams.get(path);
      if (!e) return null;
      if (e.size > b.length * 2 + 4096) fail("bad_file", "size");
      if (e.size >= cutoff) return readBig(e.start, e.size);
      const m = getMini();
      const secs = chain(e.start, m.miniFat, m.miniFat.length + 1);
      const out = new Uint8Array(e.size);
      let o = 0;
      for (const s of secs) {
        if (o >= e.size) break;
        const from = s * mss;
        const n = Math.min(mss, e.size - o);
        if (from + n > m.mini.length) fail("bad_file", "mini past end");
        out.set(m.mini.subarray(from, from + n), o);
        o += n;
      }
      if (o < e.size) fail("bad_file", "mini short");
      return out;
    },
  };
}
