import { resolve } from "node:path";
import { createDb, createQueue, createStorage, QUEUES, storageConfigFromEnv, storageEnvSchema, type MediaProcessJob, type MediaRenditionsJob, type PgBoss } from "@sceneflow/server";
import { z } from "zod";
import { processMedia, processRenditions } from "./process.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    PUBLIC_URL: z.string().url().default("http://localhost:4800"),
    SESSION_SECRET: z.string().min(16),
    /** Parallel fast-path jobs (poster/proxy). Renditions always run one at a time: they saturate the CPU on their own. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  })
  .merge(storageEnvSchema)
  .parse(process.env);

const publicUrl = env.PUBLIC_URL.replace(/\/$/, "");
const { db, close } = createDb(env.DATABASE_URL);
// Same storage config as the API (local disk or S3-compatible bucket) so both read and write the same place.
const storage = await createStorage(storageConfigFromEnv(env, { publicUrl, secret: env.SESSION_SECRET, resolveDir: (d) => resolve(process.cwd(), d) }));

const boss = await createQueue(env.DATABASE_URL);

/**
 * Runs a batch of jobs in parallel. pg-boss completes the whole batch when the handler returns, so jobs
 * that failed are marked individually (they retry on their own) and the rest complete normally.
 */
function parallel<T extends object>(queue: string, handler: (data: T) => Promise<void>) {
  return async (jobs: PgBoss.Job<T>[]) => {
    const results = await Promise.allSettled(jobs.map((job) => handler(job.data)));
    await Promise.all(
      results.map((r, i) => {
        if (r.status === "rejected") {
          console.error(`[worker] ${queue} ${jobs[i]!.id} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
          return boss.fail(queue, jobs[i]!.id, r.reason instanceof Error ? { message: r.reason.message } : { message: String(r.reason) });
        }
        return Promise.resolve();
      }),
    );
  };
}

await boss.work<MediaProcessJob>(
  QUEUES.mediaProcess,
  { batchSize: env.WORKER_CONCURRENCY, pollingIntervalSeconds: 2 },
  parallel<MediaProcessJob>(QUEUES.mediaProcess, async (data) => {
    console.log(`[worker] processing asset ${data.assetId}`);
    const started = Date.now();
    await processMedia({ db, storage, queue: boss }, data.assetId);
    console.log(`[worker] ready ${data.assetId} in ${Date.now() - started}ms`);
  }),
);

await boss.work<MediaRenditionsJob>(
  QUEUES.mediaRenditions,
  { batchSize: 1, pollingIntervalSeconds: 3 },
  parallel<MediaRenditionsJob>(QUEUES.mediaRenditions, async (data) => {
    console.log(`[worker] renditions for ${data.assetId}`);
    const started = Date.now();
    const items = await processRenditions({ db, storage }, data.assetId);
    console.log(`[worker] renditions done ${data.assetId}: ${items.map((r) => `${r.kind}@${r.height}p`).join(", ") || "none"} in ${Date.now() - started}ms`);
  }),
);
console.log(`[worker] listening on "${QUEUES.mediaProcess}" (x${env.WORKER_CONCURRENCY}) and "${QUEUES.mediaRenditions}" (x1), storage: ${storage.id}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void boss.stop({ graceful: true, timeout: 30_000 }).then(close).then(() => process.exit(0));
  });
}
