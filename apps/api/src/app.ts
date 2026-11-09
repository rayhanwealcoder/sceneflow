import { existsSync } from "node:fs";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { createDb, createQueue, createStorage, deriveKey, runMigrations, WordPressConnector, type JobSender } from "@sceneflow/server";
import type { AppConfig } from "./config.js";
import { HttpError, type Ctx } from "./context.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { commerceRoutes } from "./routes/commerce.js";
import { mediaRoutes } from "./routes/media.js";
import { presetRoutes } from "./routes/presets.js";
import { projectRoutes } from "./routes/projects.js";
import { publicRoutes } from "./routes/public.js";
import { siteRoutes } from "./routes/sites.js";

export interface BuildDeps {
  /** Inject a fake in tests; defaults to a pg-boss instance on the same database. */
  queue?: JobSender & { stop?: () => Promise<void> };
  connector?: WordPressConnector;
}

export async function buildApp(cfg: AppConfig, deps: BuildDeps = {}): Promise<FastifyInstance> {
  const { db, close } = createDb(cfg.databaseUrl);
  await runMigrations(db);

  const storage = await createStorage(cfg.storage);
  const queue = deps.queue ?? (await createQueue(cfg.databaseUrl));
  const connector = deps.connector ?? new WordPressConnector();
  const ctx: Ctx = { db, storage, queue, connector, siteSecretKey: deriveKey(cfg.sessionSecret, "site-secrets"), cfg };

  const app = Fastify({ logger: cfg.logger, trustProxy: true, bodyLimit: 1024 * 1024 });

  // The web app talks to the API with cookies; the public analytics ingest is open to every site that embeds a player.
  await app.register(cors, {
    delegator: (req, cb) => {
      const open = req.url?.startsWith("/api/v1/analytics/") ?? false;
      cb(null, open ? { origin: "*", credentials: false, methods: ["POST", "OPTIONS"] } : { origin: cfg.webOrigin, credentials: true });
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, allowList: () => cfg.rateLimits === false });

  // Raw streams for file uploads; JSON keeps Fastify's default parser.
  app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    const status = typeof e.statusCode === "number" && e.statusCode >= 400 ? e.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply
      .code(status)
      .send({ error: status >= 500 ? "INTERNAL_ERROR" : (e.code ?? "REQUEST_ERROR"), message: status >= 500 ? "Something went wrong" : (e.message ?? "Request failed") });
  });

  app.get("/health", async () => ({ ok: true, service: "sceneflow-api", storage: storage.id }));

  await app.register(authRoutes, { ctx });
  await app.register(projectRoutes, { ctx });
  await app.register(mediaRoutes, { ctx });
  await app.register(siteRoutes, { ctx });
  await app.register(commerceRoutes, { ctx });
  await app.register(presetRoutes, { ctx });
  await app.register(analyticsRoutes, { ctx });
  await app.register(publicRoutes, { ctx });

  // Built WordPress plugin zip (pnpm build:wp) for the "Download plugin" button.
  if (cfg.wpPluginDistDir && existsSync(cfg.wpPluginDistDir)) {
    await app.register(fastifyStatic, { root: cfg.wpPluginDistDir, prefix: "/downloads/", decorateReply: false, index: false, list: false, allowedPath: (p) => p.endsWith(".zip") });
  }

  app.addHook("onClose", async () => {
    await queue.stop?.();
    await close();
  });

  return app;
}
