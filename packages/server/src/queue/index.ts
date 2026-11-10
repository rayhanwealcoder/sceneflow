import PgBoss from "pg-boss";

/**
 * Job queue on top of Postgres (pg-boss) so that no Redis is needed locally or on the VPS.
 * Three queues keep the editor fast: `media.process` makes an upload usable (poster, proxy, waveform)
 * within seconds; `media.renditions` does the slow device renditions afterwards (worker offloading, doc 11.1);
 * `export.render` renders MP4 exports (headless Chrome + FFmpeg), one at a time.
 */
export const QUEUES = { mediaProcess: "media.process", mediaRenditions: "media.renditions", mediaFrame: "media.frame", exportRender: "export.render" } as const;

export interface MediaProcessJob {
  assetId: string;
}

/** One full-size still from a video at `time` seconds (custom thumbnail / poster). */
export interface MediaFrameJob {
  assetId: string;
  time: number;
}

export interface MediaRenditionsJob {
  assetId: string;
}

export interface ExportRenderJob {
  exportId: string;
}

/** The API only needs to enqueue; the worker needs the full PgBoss instance. */
export interface JobSender {
  send(name: string, data: object, options?: PgBoss.SendOptions): Promise<string | null>;
}

export async function createQueue(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  boss.on("error", (err) => console.error("[queue]", err));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);
  return boss;
}

export type { PgBoss };
