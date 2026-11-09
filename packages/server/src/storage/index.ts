import { z } from "zod";
import { LocalStorageProvider } from "./local.js";
import type { StorageProvider } from "./provider.js";
import { S3StorageProvider } from "./s3.js";

/** Environment variables shared by the API and the worker (both must point at the same storage). */
export const storageEnvSchema = z.object({
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("../../data"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public URL of the bucket's `public/` prefix, e.g. https://media.yourdomain.com/public */
  S3_PUBLIC_URL: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
});
export type StorageEnv = z.infer<typeof storageEnvSchema>;

export interface StorageConfig {
  provider: "local" | "s3";
  local: { rootDir: string; publicBaseUrl: string; uploadBaseUrl: string; secret: string };
  s3?: { bucket: string; region?: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; publicBaseUrl: string; forcePathStyle?: boolean };
}

/** Turns parsed env into a storage config. `publicUrl` is the API origin (used by the local provider). */
export function storageConfigFromEnv(env: StorageEnv, args: { publicUrl: string; secret: string; resolveDir: (dir: string) => string }): StorageConfig {
  const local = { rootDir: args.resolveDir(env.STORAGE_DIR), publicBaseUrl: `${args.publicUrl}/files`, uploadBaseUrl: `${args.publicUrl}/uploads`, secret: args.secret };
  if (env.STORAGE_PROVIDER !== "s3") return { provider: "local", local };
  const missing = (["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const).filter((k) => !env[k]);
  if (missing.length) throw new Error(`STORAGE_PROVIDER=s3 needs ${missing.join(", ")}`);
  return {
    provider: "s3",
    local,
    s3: { bucket: env.S3_BUCKET!, region: env.S3_REGION, endpoint: env.S3_ENDPOINT, accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!, publicBaseUrl: env.S3_PUBLIC_URL!, forcePathStyle: env.S3_FORCE_PATH_STYLE === "true" },
  };
}

/** Builds the configured provider. The local provider also creates its folders. */
export async function createStorage(cfg: StorageConfig): Promise<StorageProvider> {
  if (cfg.provider === "s3" && cfg.s3) return new S3StorageProvider({ ...cfg.s3, cacheDir: cfg.local.rootDir });
  const local = new LocalStorageProvider(cfg.local);
  await local.ensureDirs();
  return local;
}
