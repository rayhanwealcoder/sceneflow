import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { hmacSign, hmacVerify } from "../sign.js";
import { isSafeKey, type StorageProvider, type UploadTarget } from "./provider.js";

export interface LocalStorageOptions {
  /** Root folder. Originals live in <root>/originals, derived public files in <root>/public. */
  rootDir: string;
  /** e.g. http://localhost:4000/files  (served statically by the API) */
  publicBaseUrl: string;
  /** e.g. http://localhost:4000/uploads (PUT handler in the API) */
  uploadBaseUrl: string;
  secret: string;
}

export class UploadTooLargeError extends Error {
  constructor() {
    super("Upload exceeds the declared size");
    this.name = "UploadTooLargeError";
  }
}

export class LocalStorageProvider implements StorageProvider {
  readonly id = "local";
  readonly originalsDir: string;
  readonly publicDir: string;

  constructor(private readonly opts: LocalStorageOptions) {
    this.originalsDir = resolve(opts.rootDir, "originals");
    this.publicDir = resolve(opts.rootDir, "public");
  }

  async ensureDirs(): Promise<void> {
    await mkdir(this.originalsDir, { recursive: true });
    await mkdir(this.publicDir, { recursive: true });
  }

  private assertKey(key: string): void {
    if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${key}`);
  }

  originalPath(key: string): string {
    this.assertKey(key);
    return join(this.originalsDir, key);
  }

  private signaturePayload(key: string, sizeBytes: number, expiresAt: number): string {
    return `${key}\n${sizeBytes}\n${expiresAt}`;
  }

  async createUploadUrl(args: { key: string; mimeType: string; sizeBytes: number; expiresInSec?: number }): Promise<UploadTarget> {
    this.assertKey(args.key);
    const expiresAt = Math.floor(Date.now() / 1000) + (args.expiresInSec ?? 3600);
    const sig = hmacSign(this.opts.secret, this.signaturePayload(args.key, args.sizeBytes, expiresAt));
    const url = `${this.opts.uploadBaseUrl}/${args.key.split("/").map(encodeURIComponent).join("/")}?size=${args.sizeBytes}&exp=${expiresAt}&sig=${sig}`;
    return { url, method: "PUT", headers: { "content-type": args.mimeType }, expiresAt };
  }

  verifyUpload(key: string, sizeBytes: number, expiresAt: number, sig: string): boolean {
    if (!isSafeKey(key) || !Number.isInteger(sizeBytes) || !Number.isInteger(expiresAt)) return false;
    if (expiresAt < Math.floor(Date.now() / 1000)) return false;
    return hmacVerify(this.opts.secret, this.signaturePayload(key, sizeBytes, expiresAt), sig);
  }

  /**
   * Streams an upload to disk, rejecting once it passes maxBytes. Returns bytes written.
   * The source stream is deliberately not destroyed on failure so the HTTP layer can still
   * answer with a proper 413 instead of dropping the connection.
   */
  async writeOriginal(key: string, body: Readable, maxBytes: number): Promise<number> {
    const dest = this.originalPath(key);
    await mkdir(dirname(dest), { recursive: true });
    const out = createWriteStream(dest);
    let bytes = 0;
    try {
      for await (const chunk of body.iterator({ destroyOnReturn: false })) {
        const buf = chunk as Buffer;
        bytes += buf.length;
        if (bytes > maxBytes) throw new UploadTooLargeError();
        if (!out.write(buf)) await once(out, "drain");
      }
      await new Promise<void>((resolve, reject) => {
        out.once("error", reject);
        out.end(() => resolve());
      });
    } catch (err) {
      out.destroy();
      await rm(dest, { force: true });
      throw err;
    }
    return bytes;
  }

  async putOriginal(key: string, body: Buffer): Promise<number> {
    const dest = this.originalPath(key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
    return body.length;
  }

  async statOriginal(key: string): Promise<number | null> {
    try {
      return (await stat(this.originalPath(key))).size;
    } catch {
      return null;
    }
  }

  async readOriginal(key: string): Promise<string> {
    const p = this.originalPath(key);
    await stat(p);
    return p;
  }

  async putPublic(key: string, localFilePath: string): Promise<string> {
    this.assertKey(key);
    const dest = join(this.publicDir, key);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(localFilePath, dest);
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    this.assertKey(key);
    return `${this.opts.publicBaseUrl}/${key}`;
  }

  /** Base of every public URL this provider hands out (e.g. http://localhost:4800/files). */
  get publicBaseUrl(): string {
    return this.opts.publicBaseUrl;
  }

  /** Disk path of a public URL served by this provider, or null when the URL is not ours / not a safe key. */
  publicPathForUrl(url: string): string | null {
    const base = `${this.opts.publicBaseUrl}/`;
    if (!url.startsWith(base)) return null;
    let key: string;
    try {
      key = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0] ?? "");
    } catch {
      return null;
    }
    return isSafeKey(key) ? join(this.publicDir, key) : null;
  }

  async deleteObject(key: string): Promise<void> {
    this.assertKey(key);
    await rm(join(this.originalsDir, key), { force: true });
    await rm(join(this.publicDir, key), { force: true });
  }
}
