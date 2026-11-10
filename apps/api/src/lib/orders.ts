/*
 * Revenue attribution (doc 24.2): shop orders that contain products added to the cart from a SceneFlow video.
 * The site's plugin records which video (and anonymous playback session) a cart line came from; the cloud pulls
 * those orders with a signed request and keeps one row per order line (`shop_orders`). Pulls are incremental
 * (the shop's "modified" time is the cursor) and happen when someone opens a project's Analytics page, at most
 * once a minute per site. A site whose plugin does not know the route yet (older than 0.8.0) is skipped
 * quietly until its next pull window.
 */
import { and, eq, sql } from "drizzle-orm";
import { ConnectorError, projects, shopOrders, sites, type RemoteOrder } from "@sceneflow/server";
import type { Ctx } from "../context.js";
import { connectorSite, type SiteRow } from "./sites.js";

/** How often one site is asked, at most. */
export const ORDER_SYNC_INTERVAL_MS = 60 * 1000;
const PAGE = 100;
const MAX_PAGES = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Order lines worth storing: known projects of the site's own workspace, sane numbers. */
export function orderRows(siteId: string, orders: RemoteOrder[], allowedProjects: Set<string>) {
  const rows: Array<typeof shopOrders.$inferInsert> = [];
  for (const o of orders) {
    if (!o || typeof o.id !== "string" || !["paid", "refunded", "cancelled"].includes(o.status) || !Number.isFinite(o.paidAt) || o.paidAt <= 0) continue;
    const currency = String(o.currency ?? "").toUpperCase().slice(0, 8);
    for (const l of o.lines ?? []) {
      const projectId = String(l.projectId ?? "").toLowerCase();
      if (!UUID_RE.test(projectId) || !allowedProjects.has(projectId)) continue;
      const total = Number(l.total);
      rows.push({
        siteId,
        orderId: o.id.slice(0, 64),
        lineId: String(l.id).slice(0, 64),
        projectId,
        sessionId: l.sessionId && SESSION_RE.test(l.sessionId) ? l.sessionId : null,
        productId: l.productId ? String(l.productId).slice(0, 64) : null,
        quantity: Math.max(0, Math.min(100_000, Math.round(Number(l.quantity) || 0))),
        revenue: Number.isFinite(total) ? Math.max(0, Math.round(total * 100) / 100) : 0,
        currency: currency || "XXX",
        status: o.status,
        paidAt: new Date(o.paidAt * 1000),
        updatedAt: new Date(),
      });
    }
  }
  return rows;
}

/** Pulls new / changed orders from one site. Never throws: the result says what happened. */
export async function syncSiteOrders(ctx: Ctx, site: SiteRow, opts: { force?: boolean } = {}): Promise<{ pulled: number; skipped?: string }> {
  if (site.platform !== "wordpress" || site.connectionStatus !== "connected" || !site.secretEncrypted) return { pulled: 0, skipped: "not connected" };
  if (!opts.force && site.ordersSyncedAt && Date.now() - site.ordersSyncedAt.getTime() < ORDER_SYNC_INTERVAL_MS) return { pulled: 0, skipped: "recent" };
  // Claim the window first so parallel page loads do not ask the same site twice.
  await ctx.db.update(sites).set({ ordersSyncedAt: new Date() }).where(eq(sites.id, site.id));
  const own = await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, site.workspaceId));
  const allowed = new Set(own.map((p) => p.id));
  let cursor = site.ordersCursor ?? 0;
  let pulled = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await ctx.connector.orders(connectorSite(ctx, site), cursor, PAGE);
      if (!res.enabled) return { pulled, skipped: "analytics off on the site" };
      const rows = orderRows(site.id, res.orders, allowed);
      if (rows.length) {
        await ctx.db
          .insert(shopOrders)
          .values(rows)
          .onConflictDoUpdate({
            target: [shopOrders.siteId, shopOrders.lineId],
            set: { quantity: sql`excluded.quantity`, revenue: sql`excluded.revenue`, status: sql`excluded.status`, currency: sql`excluded.currency`, paidAt: sql`excluded.paid_at`, updatedAt: sql`excluded.updated_at` },
          });
      }
      pulled += rows.length;
      const newest = res.orders.reduce((m, o) => Math.max(m, Number(o.modifiedAt) || 0), cursor);
      // ">=" on the shop side: an unchanged cursor on a full page would loop forever, so step past it.
      cursor = res.orders.length === PAGE && newest === cursor ? cursor + 1 : newest;
      if (res.orders.length < PAGE) break;
    }
    await ctx.db.update(sites).set({ ordersCursor: cursor }).where(eq(sites.id, site.id));
    return { pulled };
  } catch (err) {
    // 404 = plugin older than the orders route; anything else = the site is down right now. Both: try later.
    return { pulled, skipped: err instanceof ConnectorError ? `site answered ${err.status ?? err.code}` : "site unreachable" };
  }
}

/** Before showing a project's numbers: refresh the orders of every WooCommerce site in its workspace. */
export async function syncWorkspaceOrders(ctx: Ctx, workspaceId: string): Promise<void> {
  const list = await ctx.db.select().from(sites).where(and(eq(sites.workspaceId, workspaceId), eq(sites.connectionStatus, "connected")));
  const shops = list.filter((s) => s.capabilitiesJson.includes("woocommerce"));
  await Promise.all(shops.map((s) => syncSiteOrders(ctx, s)));
}

/** Revenue per currency for a project since `from`: paid orders (partial refunds already reduce the line totals). */
export async function projectRevenue(ctx: Ctx, projectId: string, from: Date) {
  return ctx.db
    .select({
      currency: shopOrders.currency,
      orders: sql<number>`count(distinct (${shopOrders.siteId}, ${shopOrders.orderId}))`.mapWith(Number),
      items: sql<number>`coalesce(sum(${shopOrders.quantity}), 0)`.mapWith(Number),
      revenue: sql<number>`coalesce(sum(${shopOrders.revenue}), 0)`.mapWith(Number),
    })
    .from(shopOrders)
    .where(and(eq(shopOrders.projectId, projectId), eq(shopOrders.status, "paid"), sql`${shopOrders.paidAt} >= ${from.toISOString()}::timestamptz`))
    .groupBy(shopOrders.currency);
}
