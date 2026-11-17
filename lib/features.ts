/**
 * 배포 환경에 따라 켜고 끄는 서버 기능.
 *
 * Vercel 같은 서버리스에서는 LibreOffice·Chromium을 실행할 수 없으므로
 * 서버 HWP 변환(워커)과 PDF 내보내기를 끈다. 그 대신 HWP는 브라우저에서 직접 읽는다.
 *
 * - SERVER_CONVERSION=0|1, PDF_EXPORT=0|1 로 직접 지정할 수 있다.
 * - 지정하지 않으면 Vercel(VERCEL=1)에서는 끄고, 그 밖에서는 켠다.
 *
 * 서버 코드에서만 읽는다. 클라이언트 컴포넌트에는 서버 컴포넌트가 값을 props로 넘긴다.
 */
function flag(name: string): boolean {
  const v = process.env[name];
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return !process.env.VERCEL;
}

/** 서버(워커)에서 HWP/HWPX를 변환·가져오기 할 수 있는가 */
export function serverConversionEnabled(): boolean {
  return flag("SERVER_CONVERSION");
}

/** 서버에서 Chromium으로 PDF를 만들 수 있는가 */
export function pdfExportEnabled(): boolean {
  return flag("PDF_EXPORT");
}
