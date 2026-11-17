export type PresignOptions = {
  method: "GET" | "PUT";
  /** 초 단위 유효 시간 (기본 600) */
  expiresIn?: number;
  /** PUT일 때 업로드 Content-Type (클라이언트가 같은 값으로 보내야 한다) */
  contentType?: string;
};

export type GetOptions = {
  /** 앞에서부터 이 바이트 수만 읽는다 (매직바이트 검사용) */
  firstBytes?: number;
};

/** 파일 스토리지 드라이버. 사용법은 lib/storage/index.ts 참고. */
export interface Storage {
  readonly driver: "s3" | "local";
  put(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<void>;
  /** 없으면 StorageNotFoundError */
  get(key: string, opts?: GetOptions): Promise<Buffer>;
  /** 없으면 null */
  head(key: string): Promise<{ size: number } | null>;
  /** 없어도 오류를 내지 않는다 */
  delete(key: string): Promise<void>;
  /** 브라우저가 직접 올리거나 내려받을 수 있는 임시 URL */
  presign(key: string, opts: PresignOptions): Promise<string>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`storage object not found: ${key}`);
  }
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** 키는 영문·숫자·`._-`로 된 경로 조각만 허용한다 (`..`·절대 경로·역슬래시 차단). */
export function assertValidKey(key: string) {
  if (key.length > 512 || !KEY_PATTERN.test(key) || key.includes("..")) {
    throw new Error(`invalid storage key: ${key}`);
  }
}
