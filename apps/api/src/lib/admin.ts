import type { FastifyRequest } from "fastify";
import { adminAudit, type ADMIN_TARGETS } from "@sceneflow/server";
import type { SQL } from "drizzle-orm";
import type { Ctx } from "../context.js";
import type { AuthUser } from "./auth.js";

/** Raw aggregate queries: drizzle's postgres-js `execute` returns the rows as plain objects. */
export async function rows<T>(ctx: Ctx, query: SQL): Promise<T[]> {
  return (await ctx.db.execute(query)) as unknown as T[];
}

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** One audit row per super admin change. Failing to write it fails the request: no silent admin actions. */
export async function audit(
  ctx: Ctx,
  req: FastifyRequest,
  actor: AuthUser,
  entry: { action: string; targetType: (typeof ADMIN_TARGETS)[number]; targetId: string; targetLabel?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  await ctx.db.insert(adminAudit).values({
    actorId: actor.id,
    actorEmail: actor.email,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetLabel: entry.targetLabel ?? null,
    detailJson: entry.detail ?? {},
    ip: req.ip ?? null,
  });
}

/** `?page=` (1-based) and a fixed page size; `total` comes back so the UI can page. */
export function paging(query: unknown, size = 25): { page: number; size: number; offset: number } {
  const raw = Number((query as { page?: string } | undefined)?.page ?? 1);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 10000) : 1;
  return { page, size, offset: (page - 1) * size };
}

/** One CSV cell: quoted, and a leading = + - @ (or tab / CR) neutralised so spreadsheets never run it as a formula. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** `?q=` for ILIKE, with the LIKE wildcards escaped (a search for "50%" means the text "50%"). */
export function likePattern(q: unknown): string | null {
  const s = typeof q === "string" ? q.trim().slice(0, 100) : "";
  return s ? `%${s.replace(/[\%_]/g, (c) => `\${c}`)}%` : null;
}
