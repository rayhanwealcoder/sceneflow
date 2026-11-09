import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isSafeKey, type StorageProvider, type UploadTarget } from "./provider.js";

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  /** Custom endpoint for R2 / MinIO / B2, e.g. https://<account>.r2.cloudflarestorage.com. Omit for AWS. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL of the bucket's `public/` prefix (R2 public bucket / custom domain / CDN). */
  publicBaseUrl: string;
  /** Path-style URLs (MinIO, some S3 clones). R2 and AWS work with the default. */
  forcePathStyle?: boolean;
  /** Where originals are downloaded for processing. Default: OS temp dir. */
  cacheDir?: string;
}

/**
 * S3-compatible storage: Cloudflare R2, AWS S3, MinIO, Backblaze B2... Originals go under `originals/`
 * (never public), derived files under `public/`. Uploads are presigned PUTs straight from the browser.
 */
export class S3StorageProvider implements StorageProvider {
  readonly id = "s3";
  private readonly client: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      region: opts.region ?? "auto",
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle ?? false,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      // Plain PUTs with a known Content-Length: no aws-chunked encoding, so any S3 clone accepts them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  private assertKey(key: string): void {
    if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${key}`);
  }

  private originalKey(key: string): string {
    this.assertKey(key);
    return `originals/${key}`;
  }

  private publicKey(key: string): string {
    this.assertKey(key);
    return `public/${key}`;
  }

  async createUploadUrl(args: { key: string; mimeType: string; sizeBytes: number; expiresInSec?: number }): Promise<UploadTarget> {
    const expiresIn = args.expiresInSec ?? 3600;
    // Content-Type and Content-Length are part of the signature, so the browser cannot upload something else / bigger.
    const cmd = new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.originalKey(args.key), ContentType: args.mimeType, ContentLength: args.sizeBytes });
    const url = await getSignedUrl(this.client, cmd, { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) });
    return { url, method: "PUT", headers: { "content-type": args.mimeType }, expiresAt: Math.floor(Date.now() / 1000) + expiresIn };
  }

  async putOriginal(key: string, body: Buffer, contentType: string): Promise<number> {
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.originalKey(key), Body: body, ContentType: contentType, ContentLength: body.length }));
    return body.length;
  }

  async statOriginal(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: this.originalKey(key) }));
      return typeof head.ContentLength === "number" ? head.ContentLength : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound" || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async readOriginal(key: string): Promise<string> {
    const dir = join(this.opts.cacheDir ?? tmpdir(), "sceneflow-originals");
    await mkdir(dir, { recursive: true });
    const dest = join(dir, `${key.replace(/[^A-Za-z0-9._-]/g, "_")}-${basename(key)}`);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.originalKey(key) }));
    if (!res.Body) throw new Error(`Original ${key} has no body`);
    await pipeline(res.Body as Readable, createWriteStream(dest));
    return dest;
  }

  async putPublic(key: string, localFilePath: string, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.publicKey(key), Body: await readFile(localFilePath), ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }),
    );
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    this.assertKey(key);
    return `${this.opts.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    await Promise.all([this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.originalKey(key) })), this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.publicKey(key) }))]);
  }
}
