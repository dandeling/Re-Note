"use client";

import type { DocContent } from "@/lib/editor/content";
import { htmlToDoc } from "@/lib/importer/html-to-doc";
import { markdownToHtml } from "@/lib/importer/markdown";

/**
 * Markdown(.md)·텍스트(.txt)를 브라우저에서 읽어 문서 JSON으로 바꾼다(서버 변환을 끈 배포용).
 * 서버 가져오기와 같은 변환(marked → htmlToDoc 허용 목록)을 쓴다. 그림 주소는 가져오지 않는다.
 */

export type TextImport = {
  name: string;
  kind: "md" | "txt";
  doc: DocContent;
  text: string;
  stats: { paragraphs: number; headings: number; tables: number; images: number };
  droppedImages: number;
  hadHtml: boolean;
};

export const isTextFile = (name: string) => /\.(md|markdown|txt)$/i.test(name);

function decode(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(bytes); // 한글 Windows 메모장(CP949)
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function readTextFile(file: File): Promise<TextImport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) throw new Error("텍스트 파일이 아니에요. 파일이 손상되었는지 확인해 주세요.");
  const text = decode(bytes);
  const kind = /\.txt$/i.test(file.name) ? "txt" : "md";
  let html: string;
  let hadHtml = false;
  if (kind === "md") ({ html, hadHtml } = markdownToHtml(text));
  else
    html = text
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  const { doc, stats, droppedImages } = htmlToDoc(html);
  return { name: file.name, kind, doc, text, stats, droppedImages, hadHtml };
}
