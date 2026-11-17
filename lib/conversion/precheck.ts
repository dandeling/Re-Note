/**
 * 엔진에 넘기기 전의 구조 검사. 매직바이트만 맞는 쓰레기 파일을 미리 걸러낸다.
 * (LibreOffice는 HWP 필터가 실패하면 파일을 일반 텍스트로 읽어 "쓰레기 글자 PDF"를 만들어 버린다.)
 */
export function looksLikeHwp(bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 1536) return false;
  // OLE 복합 문서 헤더: 바이트 순서 표시(0xFFFE)와 섹터 크기(512 또는 4096)
  if (buf.readUInt16LE(28) !== 0xfffe) return false;
  const sectorShift = buf.readUInt16LE(30);
  if (sectorShift !== 9 && sectorShift !== 12) return false;
  // HWP 5.x의 FileHeader 스트림은 "HWP Document File" 서명으로 시작한다 (압축되지 않는다).
  return buf.includes("HWP Document File", 0, "latin1");
}

export function looksLikeZip(bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  // ZIP 끝의 중앙 디렉터리 종료 레코드(EOCD). 잘린 파일에는 없다.
  const tail = buf.subarray(Math.max(0, buf.length - 66_000));
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > tail.length) return false;
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  return directoryOffset < buf.length;
}

export function looksLikeHwpx(bytes: Uint8Array): boolean {
  if (!looksLikeZip(bytes)) return false;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // HWPX(OWPML) 패키지는 Contents/ 아래에 본문이 있다. 파일 이름은 ZIP 디렉터리에 평문으로 남는다.
  return buf.includes("Contents/", 0, "latin1");
}

export function looksLikeDocx(bytes: Uint8Array): boolean {
  if (!looksLikeZip(bytes)) return false;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buf.includes("word/document.xml", 0, "latin1");
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buf.subarray(0, 5).toString("latin1") === "%PDF-" && buf.subarray(-2048).includes("%%EOF", 0, "latin1");
}
