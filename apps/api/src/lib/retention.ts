/*
 * Analytics retention: raw playback events older than ANALYTICS_RETENTION_DAYS are deleted in small batches,
 * a minute after start and then every 6 hours, so the events table does not grow forever. 0 = keep forever.
 * Shop orders (revenue) are not touched: they are few and the numbers a business keeps.
 */
import { sql } from "drizzle-orm";
import type { Ctx } from "../context.js";

const BATCH = 5_000;
const MAX_BATCHES_PER_RUN = 200; // 1 M rows per run at most; the rest waits for the next run
const EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_AFTER_MS = 60 * 1000;

/** Deletes one run's worth of old events; returns how many rows went. */
export async function pruneAnalytics(ctx: Ctx, days: number, now = new Date()): Promise<number> {
  if (!days || days <= 0) return 0;
  const before = new Date(now.getTime() - days * 86_400_000).toISOString();
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const rows = (await ctx.db.execute(sql`
      delete from analytics_events where ctid in (
        select ctid from analytics_events where occurred_at < ${before}::timestamptz limit ${BATCH}
      ) returning 1`)) as unknown as unknown[];
    total += rows.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

export function startAnalyticsRetention(ctx: Ctx, log: (line: string) => void): { stop: () => void } {
  const days = ctx.cfg.analyticsRetentionDays;
  if (!days) return { stop: () => {} };
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const n = await pruneAnalytics(ctx, days);
      if (n) log(`analytics retention: deleted ${n} events older than ${days} days`);
    } catch (err) {
      log(`analytics retention failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), FIRST_AFTER_MS);
  const timer = setInterval(() => void run(), EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
