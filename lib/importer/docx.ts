import mammoth from "mammoth";

/**
 * DOCX → 중간 형식 HTML (mammoth). 제목 스타일·목록·표·굵게·기울임·링크·그림을 옮긴다.
 * 그림은 data: URI로 들어오고, 가져오기 작업이 프로젝트 자산으로 올린 뒤 주소를 바꿔 넣는다.
 * 외부 파일 참조(링크된 그림)는 읽지 않는다.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<{ html: string; warnings: number }> {
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
    { externalFileAccess: false, ignoreEmptyParagraphs: true },
  );
  return { html: result.value, warnings: result.messages.filter((m) => m.type === "warning").length };
}
