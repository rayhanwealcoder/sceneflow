export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: number;
}

/**
 * Storage boundary. The API and worker only talk to this interface so that the local-disk provider
 * (dev + small VPS) and the S3-compatible provider (Cloudflare R2, AWS S3, MinIO, Backblaze B2...) are
 * interchangeable through configuration alone (`STORAGE_PROVIDER=local|s3`).
 */
export interface StorageProvider {
  readonly id: string;
  /** Signed URL the browser uploads the original file to. The API server never proxies the bytes. */
  createUploadUrl(args: { key: string; mimeType: string; sizeBytes: number; expiresInSec?: number }): Promise<UploadTarget>;
  /**
   * Confirms an upload landed and returns its size, or null when nothing is there yet.
   * Local uploads are confirmed by the PUT handler itself; remote providers answer with a HEAD request.
   */
  statOriginal(key: string): Promise<number | null>;
  /** Local filesystem path of an original, downloading it first for remote providers. */
  readOriginal(key: string): Promise<string>;
  /** Server-side write of an original (generated media such as AI voiceovers). Returns bytes written. */
  putOriginal(key: string, body: Buffer, contentType: string): Promise<number>;
  /** Publishes a derived file (proxy, poster, thumbnail) and returns its public URL. */
  putPublic(key: string, localFilePath: string, contentType: string): Promise<string>;
  publicUrl(key: string): string;
  deleteObject(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;

/** Keys are path-like but must never escape the storage root. */
export function isSafeKey(key: string): boolean {
  return KEY_RE.test(key) && !key.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}
