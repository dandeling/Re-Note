/** 브라우저 HWP 파서의 오류. code로 원인을 구분하고 message는 사용자에게 그대로 보여 줄 수 있는 문장이다. */

export const HWP_ERROR_MESSAGES = {
  not_hwp: "HWP나 HWPX 파일이 아니에요. 한글(.hwp, .hwpx) 파일을 골라 주세요.",
  old_hwp: "한글 97 이전(HWP 3.0 이하)의 옛 형식이라 열 수 없어요. 한글에서 .hwp(5.0)나 .hwpx로 다시 저장해 주세요.",
  bad_file: "파일이 손상되어 열 수 없어요. 원본 프로그램에서 다시 저장해 보세요.",
  encrypted: "암호가 걸린 문서라 열 수 없어요. 한글에서 암호를 풀고 다시 저장해 주세요.",
  distribution: "배포용 문서라 열 수 없어요. 한글에서 일반 문서로 저장해 주세요.",
  too_large: "파일이 너무 커서 열 수 없어요(50MB까지).",
  unsupported: "이 브라우저에서는 압축된 한글 파일을 열 수 없어요. 최신 브라우저에서 다시 해 보세요.",
} as const;

export type HwpErrorCode = keyof typeof HWP_ERROR_MESSAGES;

export class HwpParseError extends Error {
  readonly code: HwpErrorCode;
  /** 개발자용 세부 원인(화면에는 보이지 않는다) */
  readonly detail?: string;
  constructor(code: HwpErrorCode, detail?: string) {
    super(HWP_ERROR_MESSAGES[code] ?? HWP_ERROR_MESSAGES.bad_file);
    this.name = "HwpParseError";
    this.code = code;
    if (detail) this.detail = detail;
  }
}

export function fail(code: HwpErrorCode, detail?: string): never {
  throw new HwpParseError(code, detail);
}

export const isHwpError = (e: unknown, ...codes: HwpErrorCode[]): e is HwpParseError =>
  e instanceof HwpParseError && (codes.length === 0 || codes.includes(e.code));

/** 화면에 보일 오류 문장: 파서 오류는 그 문장, 한국어 메시지가 있는 오류는 그대로, 그 밖은 "손상" 안내 */
export function hwpErrorMessage(e: unknown): string {
  if (e instanceof HwpParseError) return e.message;
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message;
  return HWP_ERROR_MESSAGES.bad_file;
}
