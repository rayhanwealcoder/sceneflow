import { resolve } from "node:path";
import { storageConfigFromEnv, storageEnvSchema, type AiEnv, type StorageConfig } from "@sceneflow/server";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(4800),
    DATABASE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
    PUBLIC_URL: z.string().url().default("http://localhost:4800"),
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().default(2048),
    /** Allow connecting sites on localhost / private networks (needed for LocalWP). Default: on outside production. */
    ALLOW_PRIVATE_SITES: z.enum(["true", "false"]).optional(),
    /** Trust X-Forwarded-* headers — only when the API sits behind Nginx / Cloudflare. */
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    /** Folder with the built connector zips (pnpm build:connectors), served at /downloads/. */
    WP_PLUGIN_DIST_DIR: z.string().default("../../dist/connectors"),
    // ---- AI (all optional; without keys the product still works with starter text + built-in voices) ----
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().optional(),
    AI_TEXT_PROVIDER: z.enum(["auto", "anthropic", "starter"]).optional(),
    ELEVENLABS_API_KEY: z.string().optional(),
    ELEVENLABS_VOICE_ID: z.string().optional(),
    AI_SPEECH_PROVIDER: z.enum(["auto", "elevenlabs", "system", "off"]).optional(),
  })
  .merge(storageEnvSchema);

export interface AppConfig {
  databaseUrl: string;
  sessionSecret: string;
  publicUrl: string;
  webOrigin: string;
  /** Storage backend: local disk (default) or any S3-compatible bucket (R2, S3, MinIO). */
  storage: StorageConfig;
  maxUploadBytes: number;
  secureCookies: boolean;
  logger: boolean;
  allowPrivateSites: boolean;
  /** Behind a reverse proxy the client IP comes from X-Forwarded-For; otherwise that header is ignored. */
  trustProxy: boolean;
  wpPluginDistDir: string | null;
  /** Per-IP rate limits on auth/publish. Off in tests, where everything comes from one address. */
  rateLimits?: boolean;
  /** AI provider keys / choices (see packages/server/src/ai). */
  ai: AiEnv;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig & { port: number } {
  const e = envSchema.parse(env);
  const publicUrl = e.PUBLIC_URL.replace(/\/$/, "");
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    publicUrl,
    webOrigin: e.WEB_ORIGIN,
    storage: storageConfigFromEnv(e, { publicUrl, secret: e.SESSION_SECRET, resolveDir: (d) => resolve(process.cwd(), d) }),
    maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
    secureCookies: e.NODE_ENV === "production",
    logger: e.NODE_ENV !== "test",
    allowPrivateSites: e.ALLOW_PRIVATE_SITES ? e.ALLOW_PRIVATE_SITES === "true" : e.NODE_ENV !== "production",
    trustProxy: e.TRUST_PROXY === "true",
    wpPluginDistDir: resolve(process.cwd(), e.WP_PLUGIN_DIST_DIR),
    ai: { ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY, AI_MODEL: e.AI_MODEL, AI_TEXT_PROVIDER: e.AI_TEXT_PROVIDER, ELEVENLABS_API_KEY: e.ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID: e.ELEVENLABS_VOICE_ID, AI_SPEECH_PROVIDER: e.AI_SPEECH_PROVIDER },
  };
}

/** Config for tests: local storage in a temp folder, everything else minimal. */
export function testConfig(storageDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  const publicUrl = "http://localhost:4800";
  return {
    databaseUrl: process.env.DATABASE_URL_TEST ?? "postgresql://postgres:sceneflow_dev@localhost:5432/sceneflow_test",
    sessionSecret: "test-secret-test-secret",
    publicUrl,
    webOrigin: "http://localhost:3000",
    storage: { provider: "local", local: { rootDir: storageDir, publicBaseUrl: `${publicUrl}/files`, uploadBaseUrl: `${publicUrl}/uploads`, secret: "test-secret-test-secret" } },
    maxUploadBytes: 1024 * 1024,
    secureCookies: false,
    logger: false,
    allowPrivateSites: true,
    trustProxy: false,
    wpPluginDistDir: null,
    rateLimits: false,
    ai: { AI_TEXT_PROVIDER: "starter", AI_SPEECH_PROVIDER: "off" },
    ...overrides,
  };
}
