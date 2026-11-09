import PgBoss from "pg-boss";

/**
 * Job queue on top of Postgres (pg-boss) so that no Redis is needed locally or on the VPS.
 * Two queues keep the editor fast: `media.process` makes an upload usable (poster, proxy, waveform)
 * within seconds; `media.renditions` does the slow device renditions afterwards (worker offloading, doc 11.1).
 */
export const QUEUES = { mediaProcess: "media.process", mediaRenditions: "media.renditions" } as const;

export interface MediaProcessJob {
  assetId: string;
}

export interface MediaRenditionsJob {
  assetId: string;
}

/** The API only needs to enqueue; the worker needs the full PgBoss instance. */
export interface JobSender {
  send(name: string, data: object, options?: PgBoss.SendOptions): Promise<string | null>;
}

export async function createQueue(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  boss.on("error", (err) => console.error("[queue]", err));
  await boss.start();
  await boss.createQueue(QUEUES.mediaProcess);
  await boss.createQueue(QUEUES.mediaRenditions);
  return boss;
}

export type { PgBoss };
