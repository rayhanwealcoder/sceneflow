import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { ConnectorError, decryptString, sites, type ConnectorSite } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";

export type SiteRow = typeof sites.$inferSelect;

/** Basic SSRF guard: in production only public hosts may be connected. */
export function assertAllowedSiteUrl(url: string, ctx: Ctx): void {
  const host = new URL(url).hostname.toLowerCase();
  if (ctx.cfg.allowPrivateSites) return;
  const privateHost =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    (isIP(host) && /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(host));
  if (privateHost) throw new HttpError(400, "PRIVATE_SITE_URL", "Private or local site URLs cannot be connected from this server");
}

export function toPublicSite(s: SiteRow) {
  const { secretEncrypted: _secret, ...rest } = s;
  return rest;
}

export async function loadSite(ctx: Ctx, siteId: string): Promise<SiteRow> {
  const site = await ctx.db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) throw new HttpError(404, "SITE_NOT_FOUND", "Site not found");
  return site;
}

export function connectorSite(ctx: Ctx, site: SiteRow): ConnectorSite {
  if (!site.secretEncrypted) throw new HttpError(409, "SITE_NOT_CONNECTED", "This site is not paired yet");
  return { siteId: site.id, url: site.url, restBase: site.restBase, secret: decryptString(site.secretEncrypted, ctx.siteSecretKey) };
}

export function connectorErrorMessage(err: unknown): string {
  if (err instanceof ConnectorError) return err.message;
  return err instanceof Error ? err.message : "Unknown error";
}
