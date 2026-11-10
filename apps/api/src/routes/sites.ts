import { randomBytes, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ConnectorError, encryptString, normalizeSiteUrl, sitePublications, sites } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser } from "../lib/auth.js";
import { assertAllowedSiteUrl, connectorErrorMessage, connectorSite, loadSite, refreshSiteHealth, toPublicSite } from "../lib/sites.js";
import { assertUuid, parseBody } from "../lib/validate.js";

const connectSchema = z.object({
  workspaceId: z.string().uuid(),
  url: z.string().trim().min(4).max(500),
  pairingCode: z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{8}$/, "Pairing code is 8 letters/numbers")),
});

export async function siteRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  /** Pairs a WordPress site: the plugin shows a one-time code; we generate the shared secret and hand it over. */
  app.post("/api/v1/sites/connect", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(connectSchema, req.body);
    await requireMember(ctx, user.id, body.workspaceId, "editor");
    let url: string;
    try {
      url = normalizeSiteUrl(body.url.includes("://") ? body.url : `https://${body.url}`);
    } catch (err) {
      throw new HttpError(400, "INVALID_SITE_URL", connectorErrorMessage(err));
    }
    assertAllowedSiteUrl(url, ctx);

    const siteId = randomUUID();
    const secret = randomBytes(32).toString("hex");
    let restBase: "pretty" | "plain";
    let result;
    try {
      const h = await ctx.connector.health(url);
      restBase = h.restBase;
      result = await ctx.connector.connect(url, restBase, { pairingCode: body.pairingCode, siteId, secret, saasUrl: ctx.cfg.publicUrl, appUrl: ctx.cfg.webOrigin });
    } catch (err) {
      const code = err instanceof ConnectorError ? err.code : "connect_failed";
      throw new HttpError(code === "unreachable" || code === "plugin_missing" ? 502 : 400, `SITE_${code.toUpperCase()}`, connectorErrorMessage(err));
    }

    const [site] = await ctx.db
      .insert(sites)
      .values({
        id: siteId,
        workspaceId: body.workspaceId,
        url,
        name: result.siteName || new URL(url).hostname,
        platform: "wordpress",
        connectionStatus: "connected",
        restBase,
        secretEncrypted: encryptString(secret, ctx.siteSecretKey),
        connectorVersion: result.pluginVersion,
        platformVersion: result.wpVersion,
        capabilitiesJson: result.capabilities,
        lastSeenAt: new Date(),
      })
      .returning();
    return reply.code(201).send({ site: toPublicSite(site!) });
  });

  app.get<{ Querystring: { workspaceId?: string } }>("/api/v1/sites", async (req) => {
    const user = await requireUser(ctx, req);
    const workspaceId = assertUuid(req.query.workspaceId ?? "", "workspaceId");
    await requireMember(ctx, user.id, workspaceId);
    const rows = await ctx.db.select().from(sites).where(eq(sites.workspaceId, workspaceId)).orderBy(desc(sites.createdAt));
    return { sites: rows.map(toPublicSite) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/sites/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const site = await loadSite(ctx, assertUuid(req.params.id, "site id"));
    await requireMember(ctx, user.id, site.workspaceId);
    const publications = await ctx.db.select().from(sitePublications).where(eq(sitePublications.siteId, site.id)).orderBy(desc(sitePublications.createdAt)).limit(20);
    return { site: toPublicSite(site), publications };
  });

  /** Re-checks the plugin and refreshes versions / status. */
  app.post<{ Params: { id: string } }>("/api/v1/sites/:id/check", async (req) => {
    const user = await requireUser(ctx, req);
    const site = await loadSite(ctx, assertUuid(req.params.id, "site id"));
    await requireMember(ctx, user.id, site.workspaceId);
    return { site: toPublicSite(await refreshSiteHealth(ctx, site)) };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/sites/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const site = await loadSite(ctx, assertUuid(req.params.id, "site id"));
    await requireMember(ctx, user.id, site.workspaceId, "admin");
    await ctx.db.delete(sites).where(eq(sites.id, site.id));
    return { ok: true };
  });

  /** Pages/posts of the site, for choosing where to place a player. */
  app.get<{ Params: { id: string }; Querystring: { search?: string } }>("/api/v1/sites/:id/pages", async (req) => {
    const user = await requireUser(ctx, req);
    const site = await loadSite(ctx, assertUuid(req.params.id, "site id"));
    await requireMember(ctx, user.id, site.workspaceId);
    try {
      return await ctx.connector.listPages(connectorSite(ctx, site), req.query.search?.slice(0, 100));
    } catch (err) {
      throw new HttpError(502, "SITE_REQUEST_FAILED", connectorErrorMessage(err));
    }
  });

  /** Opens an element-picking session on one page of the site. */
  app.post<{ Params: { id: string } }>("/api/v1/sites/:id/pick-session", async (req) => {
    const user = await requireUser(ctx, req);
    const site = await loadSite(ctx, assertUuid(req.params.id, "site id"));
    await requireMember(ctx, user.id, site.workspaceId, "editor");
    const body = parseBody(z.object({ postId: z.number().int().positive().optional(), pageUrl: z.string().url().max(500).optional() }), req.body ?? {});
    try {
      const r = await ctx.connector.pickSession(connectorSite(ctx, site), body);
      return { pickUrl: r.pickUrl, expiresIn: r.expiresIn, siteOrigin: new URL(site.url).origin };
    } catch (err) {
      throw new HttpError(502, "SITE_REQUEST_FAILED", connectorErrorMessage(err));
    }
  });

  /** Browse the site's media library (images/videos) through the signed connector. */
  app.get<{ Params: { id: string }; Querystring: { search?: string; type?: "image" | "video"; page?: string } }>("/api/v1/sites/:id/media", async (req) => {
    const user = await requireUser(ctx, req);
    const site = await loadSite(ctx, assertUuid(req.params.id, "site id"));
    await requireMember(ctx, user.id, site.workspaceId);
    try {
      return await ctx.connector.listMedia(connectorSite(ctx, site), { search: req.query.search?.slice(0, 100), type: req.query.type === "image" || req.query.type === "video" ? req.query.type : undefined, page: Number(req.query.page) || 1 });
    } catch (err) {
      throw new HttpError(502, "SITE_REQUEST_FAILED", connectorErrorMessage(err));
    }
  });
}
