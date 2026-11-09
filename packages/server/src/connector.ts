import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Product } from "@sceneflow/schema";

/*
 * SaaS -> WordPress connector protocol. The PHP plugin implements the mirror image
 * (wordpress/sceneflow/includes/class-sceneflow-signature.php). Both sides share
 * the fixture in wordpress/sceneflow/tests/fixtures/signature.json.
 *
 * canonical = METHOD \n ROUTE \n TIMESTAMP \n NONCE \n sha256hex(BODY)
 * signature = hex(hmac_sha256(secret, canonical))
 * ROUTE is the REST route relative to the host, e.g. "/sceneflow/v1/publish".
 */

export const CONNECTOR_NAMESPACE = "/sceneflow/v1";
export const CONNECTOR_MAX_SKEW_SEC = 300;

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export function canonicalString(method: string, route: string, timestamp: number | string, nonce: string, body: string): string {
  return `${method.toUpperCase()}\n${route}\n${timestamp}\n${nonce}\n${sha256Hex(body)}`;
}

export interface SignedHeaders {
  "content-type": "application/json";
  "x-sceneflow-site": string;
  "x-sceneflow-timestamp": string;
  "x-sceneflow-nonce": string;
  "x-sceneflow-signature": string;
}

export function signConnectorRequest(args: { secret: string; siteId: string; method: string; route: string; body: string; timestamp?: number; nonce?: string }): SignedHeaders {
  const timestamp = args.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = args.nonce ?? randomBytes(16).toString("hex");
  const signature = createHmac("sha256", args.secret).update(canonicalString(args.method, args.route, timestamp, nonce, args.body)).digest("hex");
  return { "content-type": "application/json", "x-sceneflow-site": args.siteId, "x-sceneflow-timestamp": String(timestamp), "x-sceneflow-nonce": nonce, "x-sceneflow-signature": signature };
}

export type VerifyResult = { ok: true } | { ok: false; error: "invalid_signature" | "stale_timestamp" | "invalid_nonce" | "bad_signature" };

/** Used by tests and by any Node-side receiver (e.g. a fake WordPress). */
export function verifyConnectorSignature(args: { secret: string; method: string; route: string; body: string; timestamp: string | number; nonce: string; signature: string; now?: number; maxSkew?: number }): VerifyResult {
  if (!/^[a-f0-9]{64}$/.test(args.signature)) return { ok: false, error: "invalid_signature" };
  const ts = Number(args.timestamp);
  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (args.maxSkew ?? CONNECTOR_MAX_SKEW_SEC)) return { ok: false, error: "stale_timestamp" };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(args.nonce)) return { ok: false, error: "invalid_nonce" };
  const expected = createHmac("sha256", args.secret).update(canonicalString(args.method, args.route, ts, args.nonce, args.body)).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(args.signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, error: "bad_signature" };
}

// ---------- HTTP client ----------

export type RestBase = "pretty" | "plain";

export interface ConnectorSite {
  siteId: string;
  url: string;
  restBase: RestBase;
  secret: string;
}

export interface HealthInfo {
  version: string;
  wp: string;
  php: string;
  siteName: string;
  connected: boolean;
  capabilities: string[];
}

export interface ConnectResult {
  ok: true;
  siteName: string;
  wpVersion: string;
  pluginVersion: string;
  capabilities: string[];
}

export interface PublishResult {
  ok: true;
  projectId: string;
  version: number;
  shortcode: string;
}

export interface PreviewSessionResult {
  ok: true;
  token: string;
  previewUrl: string;
  expiresIn: number;
}

export interface RemoteMedia {
  id: number;
  title: string;
  url: string;
  mime: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

export class ConnectorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export function normalizeSiteUrl(input: string): string {
  const u = new URL(input.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ConnectorError("invalid_url", "Site URL must start with http:// or https://");
  u.hash = "";
  u.search = "";
  let path = u.pathname.replace(/\/+$/, "");
  path = path.replace(/\/wp-admin.*$/, "").replace(/\/wp-json.*$/, "");
  return `${u.origin}${path}`;
}

export function restUrl(siteUrl: string, restBase: RestBase, route: string, query?: Record<string, string>): string {
  const url = restBase === "pretty" ? new URL(`${siteUrl}/wp-json${route}`) : new URL(`${siteUrl}/`);
  if (restBase === "plain") url.searchParams.set("rest_route", route);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new ConnectorError("bad_response", `The site did not return JSON (status ${res.status}). Is the SceneFlow plugin active?`, res.status);
  }
}

/** Minimal client for the WordPress connector plugin. All requests time out. */
export class WordPressConnector {
  constructor(private readonly opts: { timeoutMs?: number; fetch?: typeof fetch } = {}) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    const f = this.opts.fetch ?? fetch;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 10_000);
    try {
      return await f(url, { ...init, signal: ctl.signal, redirect: "manual" });
    } catch (err) {
      throw new ConnectorError("unreachable", `Could not reach the site (${err instanceof Error ? err.message : "network error"})`);
    } finally {
      clearTimeout(t);
    }
  }

  /** Detects the REST base (pretty permalinks or ?rest_route=) and returns the plugin's health info. */
  async health(siteUrl: string): Promise<{ restBase: RestBase; health: HealthInfo }> {
    let lastErr: ConnectorError | null = null;
    for (const restBase of ["pretty", "plain"] as const) {
      try {
        const res = await this.request(restUrl(siteUrl, restBase, `${CONNECTOR_NAMESPACE}/health`), { method: "GET", headers: { accept: "application/json" } });
        if (res.status === 404) {
          lastErr = new ConnectorError("plugin_missing", "SceneFlow plugin not found on this site. Install and activate it first.", 404);
          continue;
        }
        const data = (await readJson(res)) as Partial<HealthInfo> & { code?: string };
        if (!res.ok || typeof data?.version !== "string") {
          lastErr = new ConnectorError("bad_health", `Unexpected health response (${res.status})`, res.status);
          continue;
        }
        return { restBase, health: { version: data.version, wp: String(data.wp ?? ""), php: String(data.php ?? ""), siteName: String(data.siteName ?? ""), connected: Boolean(data.connected), capabilities: Array.isArray(data.capabilities) ? data.capabilities.map(String) : [] } };
      } catch (err) {
        lastErr = err instanceof ConnectorError ? err : new ConnectorError("unreachable", String(err));
      }
    }
    throw lastErr ?? new ConnectorError("unreachable", "Could not reach the site");
  }

  async connect(siteUrl: string, restBase: RestBase, payload: { pairingCode: string; siteId: string; secret: string; saasUrl: string; appUrl: string }): Promise<ConnectResult> {
    const res = await this.request(restUrl(siteUrl, restBase, `${CONNECTOR_NAMESPACE}/connect`), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) });
    const data = (await readJson(res)) as { ok?: boolean; code?: string; message?: string; siteName?: string; wpVersion?: string; pluginVersion?: string; capabilities?: string[] };
    if (!res.ok || !data?.ok) throw new ConnectorError(data?.code ?? "connect_failed", data?.message ?? `Pairing failed (${res.status})`, res.status);
    return { ok: true, siteName: String(data.siteName ?? ""), wpVersion: String(data.wpVersion ?? ""), pluginVersion: String(data.pluginVersion ?? ""), capabilities: Array.isArray(data.capabilities) ? data.capabilities.map(String) : [] };
  }

  /** Sends a signed request. GET requests sign an empty body. */
  async signed<T>(site: ConnectorSite, method: "GET" | "POST" | "DELETE", route: string, body?: object, query?: Record<string, string>): Promise<T> {
    const raw = body ? JSON.stringify(body) : "";
    const headers = signConnectorRequest({ secret: site.secret, siteId: site.siteId, method, route, body: raw });
    const res = await this.request(restUrl(site.url, site.restBase, route, query), { method, headers: { ...headers, accept: "application/json" }, body: body ? raw : undefined });
    const data = (await readJson(res)) as { ok?: boolean; code?: string; message?: string } | null;
    if (!res.ok) throw new ConnectorError(data?.code ?? "request_failed", data?.message ?? `Site returned ${res.status}`, res.status);
    return data as T;
  }

  publish(site: ConnectorSite, body: { projectId: string; name: string; version: number; configJson: string }): Promise<PublishResult> {
    return this.signed<PublishResult>(site, "POST", `${CONNECTOR_NAMESPACE}/publish`, { ...body, checksum: sha256Hex(body.configJson) });
  }

  unpublish(site: ConnectorSite, projectId: string): Promise<{ ok: true }> {
    return this.signed(site, "DELETE", `${CONNECTOR_NAMESPACE}/publish/${encodeURIComponent(projectId)}`);
  }

  previewSession(site: ConnectorSite, body: { projectId: string; configJson: string }): Promise<PreviewSessionResult> {
    return this.signed<PreviewSessionResult>(site, "POST", `${CONNECTOR_NAMESPACE}/preview-session`, { ...body, checksum: sha256Hex(body.configJson) });
  }

  listMedia(site: ConnectorSite, query: { search?: string; type?: "image" | "video"; page?: number }): Promise<{ ok: true; items: RemoteMedia[]; total: number }> {
    const q: Record<string, string> = {};
    if (query.search) q.search = query.search;
    if (query.type) q.type = query.type;
    if (query.page) q.page = String(query.page);
    return this.signed(site, "GET", `${CONNECTOR_NAMESPACE}/media`, undefined, q);
  }

  listPages(site: ConnectorSite, search?: string): Promise<{ ok: true; items: RemotePage[] }> {
    return this.signed(site, "GET", `${CONNECTOR_NAMESPACE}/pages`, undefined, search ? { search } : undefined);
  }

  /** Starts an element-picking session; the returned URL is opened in an iframe by the web app. */
  pickSession(site: ConnectorSite, body: { postId?: number; pageUrl?: string }): Promise<{ ok: true; token: string; pickUrl: string; expiresIn: number }> {
    return this.signed(site, "POST", `${CONNECTOR_NAMESPACE}/pick-session`, body);
  }

  savePlacement(site: ConnectorSite, body: { id: string; projectId: string; postId?: number | null; path?: string | null; selector: string; mode: string }): Promise<{ ok: true; id: string }> {
    return this.signed(site, "POST", `${CONNECTOR_NAMESPACE}/placements`, body);
  }

  deletePlacement(site: ConnectorSite, id: string): Promise<{ ok: true }> {
    return this.signed(site, "DELETE", `${CONNECTOR_NAMESPACE}/placements/${encodeURIComponent(id)}`);
  }

  /** Unsigned check that a published project is actually served by the site (used by diagnostics). */
  async publicProject(site: { url: string; restBase: RestBase }, projectId: string): Promise<{ status: number; version?: number; checksum?: string }> {
    const res = await this.request(restUrl(site.url, site.restBase, `${CONNECTOR_NAMESPACE}/project/${encodeURIComponent(projectId)}`), { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return { status: res.status };
    const data = (await readJson(res)) as { version?: number } | null;
    return { status: res.status, version: typeof data?.version === "number" ? data.version : undefined, checksum: res.headers.get("etag")?.replace(/"/g, "") ?? undefined };
  }

  /** WooCommerce products of the site (requires the `woocommerce` capability). */
  listProducts(site: ConnectorSite, query: { search?: string; page?: number }): Promise<{ ok: true; items: RemoteProduct[]; total: number }> {
    const q: Record<string, string> = {};
    if (query.search) q.search = query.search;
    if (query.page) q.page = String(query.page);
    return this.signed(site, "GET", `${CONNECTOR_NAMESPACE}/products`, undefined, q);
  }

  getProduct(site: ConnectorSite, productId: string): Promise<{ ok: true; product: RemoteProduct | null }> {
    return this.signed(site, "GET", `${CONNECTOR_NAMESPACE}/products/${encodeURIComponent(productId)}`);
  }
}

/** Product as the plugin sends it (doc §14.1 shape; normalized again server side). */
export type RemoteProduct = Partial<Product> & { id: string | number; name?: string };

export interface RemotePage {
  id: number;
  title: string;
  url: string;
  type: string;
  path: string;
}
