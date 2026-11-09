import { and, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { analyticsBatchSchema, type Project as ProjectConfig } from "@sceneflow/schema";
import { analyticsEvents, projects, projectVersions } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser } from "../lib/auth.js";
import { assertUuid } from "../lib/validate.js";

/*
 * Analytics (doc §24): public batch ingest for the runtime + a per-project summary for the dashboard.
 * Ingest is anonymous (no auth, CORS *, rate-limited), accepts text/plain JSON so browsers send it without
 * a preflight, and stores nothing personal. Duplicate event ids are ignored (safe retries).
 */

const TIMELINE_BUCKETS = 50;
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
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
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
    const products = productRows.filter((r) => r.productId).map((r) => ({ productId: r.productId!, title: productNames.get(r.productId!) ?? r.productId!, views: r.views, addToCarts: r.addToCarts, checkouts: r.checkouts })).sort((a, b) => b.addToCarts - a.addToCarts || b.views - a.views);

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
      },
      daily,
      timeline: { buckets: TIMELINE_BUCKETS, duration, values: timeline },
      scenes,
      elements,
      products,
      devices,
      pages: pageRows.map((r) => ({ host: r.host ?? "", path: r.path ?? "", loads: r.loads })),
    };
  });
}
