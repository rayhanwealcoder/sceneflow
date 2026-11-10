import { and, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { analyticsBatchSchema, type Project as ProjectConfig } from "@sceneflow/schema";
import { analyticsEvents, projects, projectVersions, shopOrders } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";
import { csvCell } from "../lib/admin.js";
import { requireMember, requireUser } from "../lib/auth.js";
import { projectRevenue, syncWorkspaceOrders } from "../lib/orders.js";
import { assertUuid } from "../lib/validate.js";

/*
 * Analytics (doc §24): public batch ingest for the runtime + a per-project summary for the dashboard.
 * Ingest is anonymous (no auth, CORS *, rate-limited), accepts text/plain JSON so browsers send it without
 * a preflight, and stores nothing personal. Duplicate event ids are ignored (safe retries).
 */

const TIMELINE_BUCKETS = 50;
/** The Analytics page waits this long for fresh shop orders, then shows what is stored (the pull finishes anyway). */
const ORDER_SYNC_WAIT_MS = 4000;
/** Raw-event CSV cap. */
const CSV_EVENT_LIMIT = 100_000;
const pickDays = (v: unknown) => ([7, 30, 90, 365].includes(Number(v)) ? Number(v) : 7);
const PROJECT_CACHE_MS = 60_000;

export async function analyticsRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  /**
   * Published projects accept events. Positive answers are cached so a busy page does not hit the database
   * per batch; negatives are not, so a project starts collecting the moment it is published.
   */
  const known = new Map<string, number>();
  async function acceptsEvents(projectId: string): Promise<boolean> {
    const until = known.get(projectId);
    if (until && until > Date.now()) return true;
    const row = await ctx.db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { publishedVersion: true } });
    if (!row?.publishedVersion) return false;
    known.set(projectId, Date.now() + PROJECT_CACHE_MS);
    return true;
  }

  app.post("/api/v1/analytics/events", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    let raw: unknown = req.body;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "INVALID_BODY", "Body is not JSON");
      }
    }
    const parsed = analyticsBatchSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "INVALID_BODY", "Analytics batch failed validation", parsed.error.issues);
    const batch = parsed.data;
    if (!(await acceptsEvents(batch.projectId))) return reply.code(204).send();
    const now = Date.now();
    const rows = batch.events.map((e) => ({
      id: e.id,
      projectId: batch.projectId,
      version: batch.version ?? null,
      sessionId: batch.sessionId,
      type: e.type,
      // Client clocks drift; keep events within a day of now.
      occurredAt: new Date(Math.min(now + 60_000, Math.max(now - 86_400_000, e.at))),
      t: e.t ?? null,
      sceneId: e.sceneId ?? null,
      layerId: e.layerId ?? null,
      productId: e.productId ?? null,
      host: batch.host ?? null,
      path: batch.path ?? null,
      device: batch.device ?? null,
      payloadJson: e.payload ?? {},
    }));
    await ctx.db.insert(analyticsEvents).values(rows).onConflictDoNothing();
    return reply.code(204).send();
  });

  /** Dashboard summary for the last N days (7 / 30 / 90). */
  app.get<{ Params: { id: string }; Querystring: { days?: string } }>("/api/v1/projects/:id/analytics", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "project id");
    const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    await requireMember(ctx, user.id, project.workspaceId);
    const days = pickDays(req.query.days);
    // Fresh shop orders first (bounded wait): "revenue from this video" (doc 24.2).
    await Promise.race([syncWorkspaceOrders(ctx, project.workspaceId).catch(() => undefined), new Promise((r) => setTimeout(r, ORDER_SYNC_WAIT_MS))]);
    const from = new Date(Date.now() - days * 86_400_000);
    const scope = and(eq(analyticsEvents.projectId, id), gte(analyticsEvents.occurredAt, from));

    // Names for scenes / elements / products come from the published config.
    const version = project.publishedVersion ? await ctx.db.query.projectVersions.findFirst({ where: and(eq(projectVersions.projectId, id), eq(projectVersions.version, project.publishedVersion)) }) : null;
    const config: ProjectConfig | null = version?.configJson ?? null;
    const duration = config ? (config.video?.duration ?? config.scenes[config.scenes.length - 1]?.end ?? 0) : 0;
    const layerNames = new Map<string, { name: string; type: string; sceneId: string }>();
    const productNames = new Map<string, string>();
    for (const s of config?.scenes ?? []) {
      for (const l of s.layers) {
        layerNames.set(l.id, { name: l.name ?? l.type, type: l.type, sceneId: s.id });
        const ref = l.product ?? (l.action && "product" in l.action ? l.action.product : undefined);
        if (ref) productNames.set(ref.productId, ref.title);
      }
    }

    const [counts] = await ctx.db
      .select({
        loads: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'player_loaded')`.mapWith(Number),
        sessions: sql<number>`count(distinct ${analyticsEvents.sessionId})`.mapWith(Number),
        plays: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_play')`.mapWith(Number),
        q25: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_25')`.mapWith(Number),
        q50: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_50')`.mapWith(Number),
        q75: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_75')`.mapWith(Number),
        completes: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_complete')`.mapWith(Number),
        clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} in ('element_click','hotspot_click'))`.mapWith(Number),
        productViews: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'product_view')`.mapWith(Number),
        addToCarts: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'add_to_cart')`.mapWith(Number),
        checkouts: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'checkout_started')`.mapWith(Number),
        coupons: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'coupon_applied')`.mapWith(Number),
        errors: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'player_error')`.mapWith(Number),
        watchSeconds: sql<number>`coalesce(sum(case when ${analyticsEvents.type} = 'watch' then greatest(0, (${analyticsEvents.payloadJson}->>'to')::float - (${analyticsEvents.payloadJson}->>'from')::float) end), 0)`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(scope);

    const daily = await ctx.db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${analyticsEvents.occurredAt}), 'YYYY-MM-DD')`,
        loads: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'player_loaded')`.mapWith(Number),
        plays: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_play')`.mapWith(Number),
        completes: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_complete')`.mapWith(Number),
        clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} in ('element_click','hotspot_click','add_to_cart','checkout_started'))`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(scope)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Engagement timeline: how many sessions watched each slice of the video (from `watch` ranges).
    const bucketLen = duration > 0 ? duration / TIMELINE_BUCKETS : 0;
    const timeline: number[] = new Array(TIMELINE_BUCKETS).fill(0);
    if (bucketLen > 0) {
      const rows = await ctx.db.execute<{ bucket: number; sessions: number }>(sql`
        select b.bucket as bucket, count(distinct e.session_id)::int as sessions
        from generate_series(0, ${TIMELINE_BUCKETS - 1}::int) as b(bucket)
        join analytics_events e
          on e.project_id = ${id}::uuid and e.type = 'watch' and e.occurred_at >= ${from.toISOString()}::timestamptz
         and (e.payload_json->>'from')::float8 < (b.bucket + 1) * ${bucketLen}::float8
         and (e.payload_json->>'to')::float8 > b.bucket * ${bucketLen}::float8
        group by b.bucket`);
      for (const r of rows) if (r.bucket >= 0 && r.bucket < TIMELINE_BUCKETS) timeline[r.bucket] = Number(r.sessions);
    }

    const sceneRows = await ctx.db
      .select({ sceneId: analyticsEvents.sceneId, enters: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'scene_enter')`.mapWith(Number), sessions: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'scene_enter')`.mapWith(Number) })
      .from(analyticsEvents)
      .where(and(scope, eq(analyticsEvents.type, "scene_enter")))
      .groupBy(analyticsEvents.sceneId);
    const sceneStats = new Map(sceneRows.map((r) => [r.sceneId ?? "", r]));
    const scenes = (config?.scenes ?? []).map((s) => ({ sceneId: s.id, name: s.name, start: s.start, end: s.end, enters: sceneStats.get(s.id)?.enters ?? 0, sessions: sceneStats.get(s.id)?.sessions ?? 0 }));

    const elementRows = await ctx.db
      .select({
        layerId: analyticsEvents.layerId,
        impressions: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'element_impression')`.mapWith(Number),
        clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} in ('element_click','hotspot_click'))`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(and(scope, sql`${analyticsEvents.layerId} is not null`))
      .groupBy(analyticsEvents.layerId);
    const elements = elementRows
      .filter((r) => r.layerId)
      .map((r) => ({ layerId: r.layerId!, name: layerNames.get(r.layerId!)?.name ?? r.layerId!, type: layerNames.get(r.layerId!)?.type ?? "removed", impressions: r.impressions, clicks: r.clicks, ctr: r.impressions ? Math.round((r.clicks / r.impressions) * 1000) / 10 : null }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

    const productRows = await ctx.db
      .select({
        productId: analyticsEvents.productId,
        views: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'product_view')`.mapWith(Number),
        addToCarts: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'add_to_cart')`.mapWith(Number),
        checkouts: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'checkout_started')`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(and(scope, sql`${analyticsEvents.productId} is not null`))
      .groupBy(analyticsEvents.productId);
    const orderRows = await ctx.db
      .select({
        productId: shopOrders.productId,
        orders: sql<number>`count(distinct (${shopOrders.siteId}, ${shopOrders.orderId}))`.mapWith(Number),
        units: sql<number>`coalesce(sum(${shopOrders.quantity}), 0)`.mapWith(Number),
        revenue: sql<number>`coalesce(sum(${shopOrders.revenue}), 0)`.mapWith(Number),
      })
      .from(shopOrders)
      .where(and(eq(shopOrders.projectId, id), eq(shopOrders.status, "paid"), gte(shopOrders.paidAt, from)))
      .groupBy(shopOrders.productId);
    const sold = new Map(orderRows.map((r) => [r.productId ?? "", r]));
    const productIds = new Set([...productRows.map((r) => r.productId ?? ""), ...orderRows.map((r) => r.productId ?? "")].filter(Boolean));
    const byId = new Map(productRows.map((r) => [r.productId ?? "", r]));
    const products = [...productIds]
      .map((pid) => {
        const ev = byId.get(pid);
        const o = sold.get(pid);
        return { productId: pid, title: productNames.get(pid) ?? pid, views: ev?.views ?? 0, addToCarts: ev?.addToCarts ?? 0, checkouts: ev?.checkouts ?? 0, orders: o?.orders ?? 0, units: o?.units ?? 0, revenue: Math.round((o?.revenue ?? 0) * 100) / 100 };
      })
      .sort((a, b) => b.revenue - a.revenue || b.addToCarts - a.addToCarts || b.views - a.views);
    const revenue = (await projectRevenue(ctx, id, from)).map((r) => ({ currency: r.currency, orders: r.orders, items: r.items, revenue: Math.round(r.revenue * 100) / 100 })).sort((a, b) => b.revenue - a.revenue);
    const orders = revenue.reduce((n, r) => n + r.orders, 0);
    const dailyOrders = await ctx.db
      .select({ day: sql<string>`to_char(date_trunc('day', ${shopOrders.paidAt}), 'YYYY-MM-DD')`, orders: sql<number>`count(distinct (${shopOrders.siteId}, ${shopOrders.orderId}))`.mapWith(Number) })
      .from(shopOrders)
      .where(and(eq(shopOrders.projectId, id), eq(shopOrders.status, "paid"), gte(shopOrders.paidAt, from)))
      .groupBy(sql`1`);
    const ordersByDay = new Map(dailyOrders.map((d) => [d.day, d.orders]));

    const deviceRows = await ctx.db
      .select({ device: analyticsEvents.device, sessions: sql<number>`count(distinct ${analyticsEvents.sessionId})`.mapWith(Number) })
      .from(analyticsEvents)
      .where(scope)
      .groupBy(analyticsEvents.device);
    const devices = { desktop: 0, tablet: 0, mobile: 0 };
    for (const r of deviceRows) if (r.device === "desktop" || r.device === "tablet" || r.device === "mobile") devices[r.device] += r.sessions;

    const pageRows = await ctx.db
      .select({ host: analyticsEvents.host, path: analyticsEvents.path, loads: sql<number>`count(*)`.mapWith(Number) })
      .from(analyticsEvents)
      .where(and(scope, eq(analyticsEvents.type, "player_loaded")))
      .groupBy(analyticsEvents.host, analyticsEvents.path)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const c = counts!;
    return {
      range: { days, from: from.toISOString(), to: new Date().toISOString() },
      totals: {
        loads: c.loads,
        sessions: c.sessions,
        plays: c.plays,
        playRate: c.loads ? Math.round((c.plays / c.loads) * 1000) / 10 : null,
        quartiles: { q25: c.q25, q50: c.q50, q75: c.q75, complete: c.completes },
        completes: c.completes,
        completionRate: c.plays ? Math.round((c.completes / c.plays) * 1000) / 10 : null,
        avgWatchSeconds: c.plays ? Math.round((c.watchSeconds / c.plays) * 10) / 10 : 0,
        clicks: c.clicks,
        productViews: c.productViews,
        addToCarts: c.addToCarts,
        checkouts: c.checkouts,
        coupons: c.coupons,
        errors: c.errors,
        orders,
        /** Per currency: a shop can sell in several. */
        revenue,
        /** Orders per 100 viewers who pressed play. */
        conversionRate: c.plays ? Math.round((orders / c.plays) * 1000) / 10 : null,
      },
      // Days with orders but no player events (a visitor bought later) still get a row.
      daily: [...daily.map((d) => ({ ...d, orders: ordersByDay.get(d.day) ?? 0 })), ...[...ordersByDay].filter(([day]) => !daily.some((d) => d.day === day)).map(([day, orders]) => ({ day, loads: 0, plays: 0, completes: 0, clicks: 0, orders }))].sort((x, y) => x.day.localeCompare(y.day)),
      timeline: { buckets: TIMELINE_BUCKETS, duration, values: timeline },
      scenes,
      elements,
      products,
      devices,
      pages: pageRows.map((r) => ({ host: r.host ?? "", path: r.path ?? "", loads: r.loads })),
    };
  });

  /**
   * The project's numbers as CSV for spreadsheets: `view=daily` (one row per day: loads, plays, completions,
   * clicks, carts, orders, revenue) or `view=events` (raw anonymous events, newest first, capped). Same access
   * as the Analytics page; cells that a spreadsheet would run as formulas are neutralised.
   */
  app.get<{ Params: { id: string }; Querystring: { days?: string; view?: string } }>("/api/v1/projects/:id/analytics.csv", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "project id");
    const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    await requireMember(ctx, user.id, project.workspaceId);
    const days = pickDays(req.query.days);
    const view = req.query.view === "events" ? "events" : "daily";
    const from = new Date(Date.now() - days * 86_400_000);
    const scope = and(eq(analyticsEvents.projectId, id), gte(analyticsEvents.occurredAt, from));
    let header: string[];
    let lines: unknown[][];
    if (view === "daily") {
      const daily = await ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${analyticsEvents.occurredAt}), 'YYYY-MM-DD')`,
          loads: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'player_loaded')`.mapWith(Number),
          viewers: sql<number>`count(distinct ${analyticsEvents.sessionId})`.mapWith(Number),
          plays: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_play')`.mapWith(Number),
          completes: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_complete')`.mapWith(Number),
          clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} in ('element_click','hotspot_click'))`.mapWith(Number),
          carts: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'add_to_cart')`.mapWith(Number),
          checkouts: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'checkout_started')`.mapWith(Number),
        })
        .from(analyticsEvents)
        .where(scope)
        .groupBy(sql`1`);
      const sales = await ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${shopOrders.paidAt}), 'YYYY-MM-DD')`,
          currency: shopOrders.currency,
          orders: sql<number>`count(distinct (${shopOrders.siteId}, ${shopOrders.orderId}))`.mapWith(Number),
          revenue: sql<number>`coalesce(sum(${shopOrders.revenue}), 0)`.mapWith(Number),
        })
        .from(shopOrders)
        .where(and(eq(shopOrders.projectId, id), eq(shopOrders.status, "paid"), gte(shopOrders.paidAt, from)))
        .groupBy(sql`1`, shopOrders.currency);
      const dayKeys = [...new Set([...daily.map((d) => d.day), ...sales.map((d) => d.day)])].sort();
      const ev = new Map(daily.map((d) => [d.day, d]));
      header = ["date", "player_loads", "viewers", "plays", "completions", "clicks", "add_to_cart", "checkouts", "orders", "revenue", "currency"];
      lines = [];
      for (const day of dayKeys) {
        const e = ev.get(day);
        const base = [day, e?.loads ?? 0, e?.viewers ?? 0, e?.plays ?? 0, e?.completes ?? 0, e?.clicks ?? 0, e?.carts ?? 0, e?.checkouts ?? 0];
        const daySales = sales.filter((x) => x.day === day);
        if (daySales.length === 0) lines.push([...base, 0, 0, ""]);
        for (const x of daySales) lines.push([...base, x.orders, Math.round(x.revenue * 100) / 100, x.currency]);
      }
    } else {
      const rowsOut = await ctx.db
        .select({ at: analyticsEvents.occurredAt, type: analyticsEvents.type, session: analyticsEvents.sessionId, version: analyticsEvents.version, t: analyticsEvents.t, scene: analyticsEvents.sceneId, layer: analyticsEvents.layerId, product: analyticsEvents.productId, device: analyticsEvents.device, host: analyticsEvents.host, path: analyticsEvents.path, payload: analyticsEvents.payloadJson })
        .from(analyticsEvents)
        .where(scope)
        .orderBy(sql`${analyticsEvents.occurredAt} desc`)
        .limit(CSV_EVENT_LIMIT);
      header = ["time", "event", "session", "version", "video_time", "scene", "element", "product", "device", "host", "path", "details"];
      lines = rowsOut.map((e) => [e.at, e.type, e.session, e.version, e.t, e.scene, e.layer, e.product, e.device, e.host, e.path, Object.keys(e.payload ?? {}).length ? JSON.stringify(e.payload) : ""]);
    }
    const safeName = project.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "project";
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${safeName}-${view}-${days}d-${new Date().toISOString().slice(0, 10)}.csv"`);
    return "\ufeff" + [header.join(","), ...lines.map((l) => l.map(csvCell).join(","))].join("\r\n") + "\r\n";
  });
}
