import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { fileTypeOf, matchesMagic, maxUploadBytes } from "@/lib/files/types";
import { getStorage, newStorageKey, StorageNotFoundError } from "@/lib/storage";
import { LocalStorage, verifyLocalSignature } from "@/lib/storage/local";
import { S3Storage } from "@/lib/storage/s3";
import { fixture } from "../setup/storage";

describe("로컬 스토리지 드라이버", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rm-local-"));
  const storage = new LocalStorage(dir);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("put/get/head/delete가 동작한다", async () => {
    const key = newStorageKey("t", "데이터.CSV");
    expect(key).toMatch(/^t\/[0-9a-f]{32}\/file\.csv$/);
    await storage.put(key, Buffer.from("a,b\n1,2\n"));
    expect((await storage.get(key)).toString()).toBe("a,b\n1,2\n");
    expect((await storage.get(key, { firstBytes: 3 })).toString()).toBe("a,b");
    expect(await storage.head(key)).toEqual({ size: 8 });
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
    await storage.delete(key); // 없어도 오류 없음
  });

  it("디렉터리를 벗어나는 키를 거부한다", async () => {
    for (const key of ["../etc/passwd", "/etc/passwd", "a/../../b", "a\\b", "a//b", ""]) {
      await expect(storage.put(key, Buffer.from("x"))).rejects.toThrow(/invalid storage key/);
    }
  });

  it("presigned URL은 메서드·키·만료 시간에 묶인 서명을 가진다", async () => {
    const url = new URL(await storage.presign("t/abc/file.pdf", { method: "PUT", expiresIn: 60 }), "http://localhost");
    expect(url.pathname).toBe("/api/storage/local/t/abc/file.pdf");
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(verifyLocalSignature("PUT", "t/abc/file.pdf", exp, sig)).toBe(true);
    expect(verifyLocalSignature("GET", "t/abc/file.pdf", exp, sig)).toBe(false);
    expect(verifyLocalSignature("PUT", "t/other/file.pdf", exp, sig)).toBe(false);
    expect(verifyLocalSignature("PUT", "t/abc/file.pdf", exp, sig, Date.now() + 61_000)).toBe(false);
  });
});

describe("S3 호환 드라이버 (단위 수준 — 실제 MinIO 검증은 하지 않음)", () => {
  const config = {
    endpoint: "http://minio:9000",
    publicEndpoint: "http://localhost:9000",
    region: "us-east-1",
    bucket: "researchmate",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
  };

  it("presigned URL은 공개 엔드포인트·버킷·키·SigV4 서명을 담는다 (네트워크 호출 없음)", async () => {
    const send = vi.fn(async () => ({}));
    const storage = new S3Storage(config, { client: { send } as unknown as S3Client });
    const get = new URL(await storage.presign("uploads/u1/abc/file.pdf", { method: "GET", expiresIn: 120 }));
    expect(get.origin).toBe("http://localhost:9000");
    expect(get.pathname).toBe("/researchmate/uploads/u1/abc/file.pdf");
    expect(get.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(get.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(get.searchParams.get("X-Amz-Credential")).toContain("test-access/");
    expect(get.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(get.href).not.toContain("test-secret");
    const put = new URL(await storage.presign("uploads/u1/abc/file.pdf", { method: "PUT", contentType: "application/pdf" }));
    expect(put.searchParams.get("X-Amz-Signature")).not.toBe(get.searchParams.get("X-Amz-Signature"));
  });

  it("put/get/head/delete가 올바른 명령을 보낸다", async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      calls.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "GetObjectCommand") {
        return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      }
      if (command.constructor.name === "HeadObjectCommand") return { ContentLength: 3 };
      return {};
    });
    const storage = new S3Storage(config, { client: { send } as unknown as S3Client });
    await storage.put("a/b/file.bin", new Uint8Array([1, 2, 3]), { contentType: "application/octet-stream" });
    expect([...(await storage.get("a/b/file.bin", { firstBytes: 2 }))]).toEqual([1, 2, 3]);
    expect(await storage.head("a/b/file.bin")).toEqual({ size: 3 });
    await storage.delete("a/b/file.bin");
    expect(calls.map((c) => c.name)).toEqual(["HeadBucketCommand", "PutObjectCommand", "GetObjectCommand", "HeadObjectCommand", "DeleteObjectCommand"]);
    expect(calls[1].input).toMatchObject({ Bucket: "researchmate", Key: "a/b/file.bin", ContentType: "application/octet-stream" });
    expect(calls[2].input).toMatchObject({ Range: "bytes=0-1" });
  });

  it("없는 객체는 head가 null, get이 StorageNotFoundError다. 버킷이 없으면 만든다", async () => {
    const names: string[] = [];
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      names.push(command.constructor.name);
      if (["GetObjectCommand", "HeadObjectCommand", "HeadBucketCommand"].includes(command.constructor.name)) {
        throw Object.assign(new Error("nope"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      }
      return {};
    });
    const storage = new S3Storage(config, { client: { send } as unknown as S3Client });
    expect(await storage.head("x/file.bin")).toBeNull();
    await expect(storage.get("x/file.bin")).rejects.toBeInstanceOf(StorageNotFoundError);
    await storage.put("x/file.bin", new Uint8Array([1]));
    expect(names).toContain("CreateBucketCommand");
  });

  it("getStorage()는 S3 환경변수가 모두 있을 때만 S3 드라이버를 고른다", () => {
    const saved = { ...process.env };
    try {
      delete process.env.S3_BUCKET;
      expect(getStorage().driver).toBe("local");
      Object.assign(process.env, { S3_BUCKET: "b", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s", S3_ENDPOINT: "http://minio:9000" });
      expect(getStorage().driver).toBe("s3");
    } finally {
      for (const name of ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_ENDPOINT"]) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});

describe("파일 형식 검사 (확장자 + 매직바이트)", () => {
  it("허용 확장자만 인식한다", () => {
    expect(fileTypeOf("보고서.HWP")).toBe("hwp");
    expect(fileTypeOf("a.b.hwpx")).toBe("hwpx");
    for (const name of ["evil.exe", "page.html", "image.svg", "noext", "script.js", "a.constructor"]) {
      expect(fileTypeOf(name)).toBeNull();
    }
  });

  it("fixture의 매직바이트가 확장자와 맞는다", () => {
    expect(matchesMagic("hwp", fixture("hwp/sample.hwp"))).toBe(true);
    expect(matchesMagic("hwpx", fixture("hwp/sample.hwpx"))).toBe(true);
    expect(matchesMagic("pdf", fixture("import/sample.pdf"))).toBe(true);
    expect(matchesMagic("docx", fixture("import/sample.docx"))).toBe(true);
    expect(matchesMagic("png", fixture("import/pixel.png"))).toBe(true);
    expect(matchesMagic("md", fixture("import/sample.md"))).toBe(true);
  });

  it("확장자만 바꾼 파일을 걸러낸다", () => {
    expect(matchesMagic("pdf", fixture("import/fake.pdf"))).toBe(false);
    expect(matchesMagic("hwp", fixture("hwp/sample.hwpx"))).toBe(false);
    expect(matchesMagic("hwpx", fixture("hwp/sample.hwp"))).toBe(false);
    expect(matchesMagic("png", fixture("import/sample.pdf"))).toBe(false);
    expect(matchesMagic("csv", fixture("import/pixel.png"))).toBe(false);
    expect(matchesMagic("jpg", new Uint8Array())).toBe(false);
  });

  it("MAX_UPLOAD_MB로 최대 크기를 정한다 (기본 50MB)", () => {
    const saved = process.env.MAX_UPLOAD_MB;
    delete process.env.MAX_UPLOAD_MB;
    expect(maxUploadBytes()).toBe(50 * 1024 * 1024);
    process.env.MAX_UPLOAD_MB = "2";
    expect(maxUploadBytes()).toBe(2 * 1024 * 1024);
    if (saved === undefined) delete process.env.MAX_UPLOAD_MB;
    else process.env.MAX_UPLOAD_MB = saved;
  });
});
