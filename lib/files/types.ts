/** 업로드를 허용하는 파일 형식. 확장자와 매직바이트를 모두 확인한다 (SPEC 9장 보안). */
export const FILE_TYPES = {
  png: { kind: "IMAGE", mime: "image/png" },
  jpg: { kind: "IMAGE", mime: "image/jpeg" },
  jpeg: { kind: "IMAGE", mime: "image/jpeg" },
  gif: { kind: "IMAGE", mime: "image/gif" },
  webp: { kind: "IMAGE", mime: "image/webp" },
  pdf: { kind: "PDF", mime: "application/pdf" },
  hwp: { kind: "HWP", mime: "application/x-hwp" },
  hwpx: { kind: "HWPX", mime: "application/hwp+zip" },
  csv: { kind: "CSV", mime: "text/csv" },
  docx: { kind: "OTHER", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  md: { kind: "OTHER", mime: "text/markdown" },
  txt: { kind: "OTHER", mime: "text/plain" },
} as const satisfies Record<string, { kind: "IMAGE" | "PDF" | "HWP" | "HWPX" | "CSV" | "OTHER"; mime: string }>;

export type FileExt = keyof typeof FILE_TYPES;

export function extensionOf(filename: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(filename.trim())?.[1]?.toLowerCase() ?? "";
}

export function fileTypeOf(filename: string): FileExt | null {
  const ext = extensionOf(filename);
  return Object.hasOwn(FILE_TYPES, ext) ? (ext as FileExt) : null;
}

function startsWith(head: Uint8Array, bytes: number[], offset = 0) {
  return bytes.every((b, i) => head[offset + i] === b);
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** 파일 앞부분(매직바이트)이 확장자와 맞는지 확인한다. head는 파일의 첫 4KB 정도면 충분하다. */
export function matchesMagic(ext: FileExt, head: Uint8Array): boolean {
  switch (ext) {
    case "png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(head, [0x47, 0x49, 0x46, 0x38]);
    case "webp":
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8);
    case "pdf":
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "hwp":
      return startsWith(head, OLE);
    case "hwpx":
    case "docx":
      return startsWith(head, ZIP);
    case "csv":
    case "md":
    case "txt":
      // 텍스트 형식: 바이너리(NUL 바이트)가 아니어야 한다. CP949 CSV도 통과한다.
      return head.length > 0 && !head.includes(0);
  }
}

/** 업로드 최대 크기 (바이트). MAX_UPLOAD_MB 환경변수, 기본 50MB. */
export function maxUploadBytes() {
  const mb = Number(process.env.MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 50) * 1024 * 1024;
}
