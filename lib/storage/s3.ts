import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertValidKey, StorageNotFoundError, type GetOptions, type PresignOptions, type Storage } from "./types";

export type S3Config = {
  endpoint?: string;
  /** 브라우저가 접근하는 주소 (presigned URL용). 없으면 endpoint와 같다. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function isNotFound(err: unknown) {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/** S3 호환 드라이버 (운영: S3, 로컬 compose: MinIO). endpoint가 있으면 MinIO용 path-style 주소를 쓴다. */
export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private bucketReady: Promise<void> | null = null;

  constructor(
    private readonly config: S3Config,
    clients?: { client: S3Client; presignClient?: S3Client },
  ) {
    const make = (endpoint?: string) =>
      new S3Client({
        endpoint,
        region: config.region,
        forcePathStyle: Boolean(endpoint),
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      });
    this.client = clients?.client ?? make(config.endpoint);
    this.presignClient = clients?.presignClient ?? make(config.publicEndpoint ?? config.endpoint);
  }

  /** 버킷이 없으면 만든다 (MinIO 첫 기동). 실패해도 이후 요청에서 원래 오류가 드러난다. */
  private ensureBucket() {
    this.bucketReady ??= this.client
      .send(new HeadBucketCommand({ Bucket: this.config.bucket }))
      .then(() => undefined)
      .catch(async (err) => {
        if (!isNotFound(err)) return;
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket })).catch(() => undefined);
      });
    return this.bucketReady;
  }

  async put(key: string, body: Uint8Array, opts: { contentType?: string } = {}) {
    assertValidKey(key);
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: opts.contentType }),
    );
  }

  async get(key: string, opts: GetOptions = {}) {
    assertValidKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Range: opts.firstBytes === undefined ? undefined : `bytes=0-${opts.firstBytes - 1}`,
        }),
      );
      if (!res.Body) throw new StorageNotFoundError(key);
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async head(key: string) {
    assertValidKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string) {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async presign(key: string, opts: PresignOptions) {
    assertValidKey(key);
    if (opts.method === "PUT") await this.ensureBucket();
    const command =
      opts.method === "PUT"
        ? new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: opts.contentType })
        : new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    return getSignedUrl(this.presignClient, command, { expiresIn: opts.expiresIn ?? 600 });
  }
}
