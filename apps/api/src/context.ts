import type { AiServices, Db, JobSender, StorageProvider, WordPressConnector } from "@sceneflow/server";
import type { AppConfig } from "./config.js";

export interface Ctx {
  db: Db;
  storage: StorageProvider;
  queue: JobSender;
  connector: WordPressConnector;
  /** Script / copy / voiceover / captions providers (doc §10.2); always present, degrades without keys. */
  ai: AiServices;
  /** Key for encrypting per-site shared secrets at rest. */
  siteSecretKey: Buffer;
  cfg: AppConfig;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}
