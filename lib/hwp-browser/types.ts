/** 브라우저 HWP/HWPX 파서의 결과 타입 */

export type HeadingBlock = {
  type: "heading";
  /** 1~6 (개요 수준) */
  level: number;
  text: string;
  /** 파서가 덧붙인 제목("각주", "미주") */
  extra?: true;
};

export type ParagraphBlock = {
  type: "paragraph";
  /** 줄바꿈(\n)·탭(\t)이 들어 있을 수 있다. 수식은 "[수식: …]", 각주 자리는 "[각주 N]" 글자로 들어 있다. */
  text: string;
  /** 문서 끝에 모은 각주·미주 문단 */
  note?: true;
};

export type TableCell = { row: number; col: number; rowSpan: number; colSpan: number; text: string };

export type TableBlock = {
  type: "table";
  rows: number;
  cols: number;
  /** 행·열 순으로 정렬. 병합된 칸은 왼쪽 위 칸 하나로만 들어 있다(가려진 칸은 없다). */
  cells: TableCell[];
  caption: string;
};

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type ImageBlock = {
  type: "image";
  mime: ImageMime;
  bytes: Uint8Array;
  /** "그림 1.png" */
  name: string;
  /** 문서 안 순번(1부터) */
  n: number;
  /** 파일 안 위치(BinData/BIN0001.png 등) */
  source: string;
  width?: number;
  height?: number;
};

export type Block = HeadingBlock | ParagraphBlock | TableBlock | ImageBlock;

export type ParseStats = {
  /** 본문의 그림 개체 수 */
  pictures: number;
  /** 실제로 가져온 그림 수 */
  images: number;
  imgMissing: number;
  imgUnsupported: number;
  imgUnsupportedKinds: string[];
  imgLimit: number;
  shapes: number;
  textboxes: number;
  equations: number;
  headers: number;
  comments: number;
  multicol: boolean;
  /** 파일 일부가 손상되어 읽을 수 있는 부분만 가져왔다 */
  partial: boolean;
  ole: number;
  footnotes: number;
  endnotes: number;
};

export type ParseResult = {
  blocks: Block[];
  /** 사용자에게 보일 안내 문장(빠진 것, 바뀐 것) */
  notes: string[];
  stats: ParseStats;
};

/** 캔버스 등으로 그림을 PNG로 바꾸는 함수(BMP처럼 문서에 넣을 수 없는 래스터). 못 하면 null. */
export type ImageConverter = (bytes: Uint8Array, mime: string) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

export type ParseOptions = {
  onProgress?: (fraction: number) => void;
  /** 없으면 BMP 그림은 "지원하지 않는 형식"으로 센다 */
  convertToPng?: ImageConverter;
};
