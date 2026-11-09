import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256Hex, verifyConnectorSignature, WordPressConnector } from "@sceneflow/server";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";

const WOO_PRODUCTS = [
  { id: 182, source: "woocommerce", type: "variable", name: "Runner Pro", image: "http://fake.local/shoe.jpg", price: "$129.00 – $149.00", priceAmount: 129, currency: "USD", stockStatus: "instock", purchasable: true, productUrl: "http://fake.local/product/runner-pro/", variations: [{ id: 190, title: "M", price: "$129.00", priceAmount: 129, inStock: true }] },
  { id: 7, source: "woocommerce", type: "simple", name: "Studio Lamp", price: "$59.00", priceAmount: 59, currency: "USD", stockStatus: "outofstock", purchasable: false, productUrl: "javascript:alert(1)", variations: [] },
];

/**
 * A fake WordPress site implementing the connector routes with the same signature rules
 * as the PHP plugin. Lets us test pairing, publish push and preview end to end over HTTP.
 */
function fakeWordPress() {
  const wp = Fastify({ logger: false });
  const state = { siteId: "", secret: "", appUrl: "", nonces: new Set<string>(), published: new Map<string, { version: number; config: unknown; name: string }>(), previews: new Map<string, string>(), placements: new Map<string, Record<string, unknown>>() };
  wp.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : null);
    } catch (e) {
      done(e as Error);
    }
  });
  const verify = (req: { method: string; headers: Record<string, unknown>; url: string; rawBody?: string }) => {
    const h = req.headers as Record<string, string>;
    const route = new URL(req.url, "http://x").pathname.replace(/^\/wp-json/, "");
    const r = verifyConnectorSignature({ secret: state.secret, method: req.method, route, body: req.rawBody ?? "", timestamp: h["x-sceneflow-timestamp"] ?? "", nonce: h["x-sceneflow-nonce"] ?? "", signature: h["x-sceneflow-signature"] ?? "" });
    if (!r.ok) return r.error;
    if (state.nonces.has(h["x-sceneflow-nonce"]!)) return "replay";
    state.nonces.add(h["x-sceneflow-nonce"]!);
    return null;
  };
  const caps = ["publish", "preview", "media", "woocommerce"];
  wp.get("/wp-json/sceneflow/v1/health", async () => ({ version: "0.1.0", wp: "6.7.1", php: "8.2.27", siteName: "Fake WP", connected: Boolean(state.secret), capabilities: caps }));
  wp.post<{ Body: { pairingCode: string; siteId: string; secret: string; saasUrl: string; appUrl: string } }>("/wp-json/sceneflow/v1/connect", async (req, reply) => {
    if (req.body.pairingCode !== "ABCD1234") return reply.code(403).send({ ok: false, code: "bad_pairing_code", message: "Pairing code is wrong or expired" });
    state.siteId = req.body.siteId;
    state.secret = req.body.secret;
    state.appUrl = req.body.appUrl;
    return { ok: true, siteName: "Fake WP", wpVersion: "6.7.1", pluginVersion: "0.1.0", capabilities: caps };
  });
  wp.get<{ Querystring: { search?: string } }>("/wp-json/sceneflow/v1/products", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    const items = WOO_PRODUCTS.filter((p) => !req.query.search || p.name.toLowerCase().includes(req.query.search.toLowerCase()));
    return { ok: true, items, total: items.length };
  });
  wp.get<{ Params: { id: string } }>("/wp-json/sceneflow/v1/products/:id", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    return { ok: true, product: WOO_PRODUCTS.find((p) => String(p.id) === req.params.id) ?? null };
  });
  wp.get("/wp-json/sceneflow/v1/pages", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    return { ok: true, items: [{ id: 0, title: "Home page", url: "http://fake.local/", type: "home", path: "/" }, { id: 12, title: "Shop", url: "http://fake.local/shop/", type: "page", path: "/shop/" }] };
  });
  wp.post<{ Body: { postId?: number; pageUrl?: string } }>("/wp-json/sceneflow/v1/pick-session", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    return { ok: true, token: "p".repeat(32), pickUrl: `http://fake.local/shop/?sceneflow_pick=${"p".repeat(32)}`, expiresIn: 1800 };
  });
  wp.post<{ Body: Record<string, unknown> & { id: string } }>("/wp-json/sceneflow/v1/placements", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    state.placements.set(req.body.id, req.body);
    return { ok: true, id: req.body.id };
  });
  wp.delete<{ Params: { id: string } }>("/wp-json/sceneflow/v1/placements/:id", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    state.placements.delete(req.params.id);
    return { ok: true };
  });
  wp.post<{ Body: { projectId: string; name: string; version: number; checksum: string; configJson: string } }>("/wp-json/sceneflow/v1/publish", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err, message: `Signature rejected: ${err}` });
    if (sha256Hex(req.body.configJson) !== req.body.checksum) return reply.code(422).send({ ok: false, code: "checksum_mismatch", message: "Checksum mismatch" });
    state.published.set(req.body.projectId, { version: req.body.version, config: JSON.parse(req.body.configJson), name: req.body.name });
    return { ok: true, projectId: req.body.projectId, version: req.body.version, shortcode: `[sceneflow id="${req.body.projectId}"]` };
  });
  wp.post<{ Body: { projectId: string; checksum: string; configJson: string } }>("/wp-json/sceneflow/v1/preview-session", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    const token = "t".repeat(32);
    state.previews.set(token, req.body.configJson);
    return { ok: true, token, previewUrl: `http://fake.local/?sceneflow_preview=${token}&sceneflow_embed=1`, expiresIn: 1800 };
  });
  wp.get("/wp-json/sceneflow/v1/media", async (req, reply) => {
    const err = verify(req as never);
    if (err) return reply.code(401).send({ ok: false, code: err });
    return { ok: true, items: [{ id: 7, title: "hero", url: "http://fake.local/hero.jpg", mime: "image/jpeg", width: 1200, height: 800 }], total: 1 };
  });
  return { wp, state };
}

let app: FastifyInstance;
let storageDir: string;
let fake: ReturnType<typeof fakeWordPress>;
let fakeUrl: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-sites-"));
  fake = fakeWordPress();
  await fake.wp.listen({ port: 0, host: "127.0.0.1" });
  const addr = fake.wp.server.address();
  fakeUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  app = await buildApp(testConfig(storageDir), { queue: { send: vi.fn(async () => "job") }, connector: new WordPressConnector({ timeoutMs: 5000 }) });
});

afterAll(async () => {
  await app.close();
  await fake.wp.close();
  await rm(storageDir, { recursive: true, force: true });
});

async function register() {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: `s-${crypto.randomUUID()}@test.dev`, password: "password123", name: "Sites" } });
  return { cookies: { sf_session: res.cookies.find((c) => c.name === "sf_session")!.value }, workspaceId: res.json().workspaceId as string };
}

describe("WordPress sites", () => {
  it("pairs a site, publishes a project to it, opens a preview and lists media", async () => {
    const { cookies, workspaceId } = await register();

    const bad = await app.inject({ method: "POST", url: "/api/v1/sites/connect", cookies, payload: { workspaceId, url: fakeUrl, pairingCode: "WRONG000" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("SITE_BAD_PAIRING_CODE");

    const missing = await app.inject({ method: "POST", url: "/api/v1/sites/connect", cookies, payload: { workspaceId, url: "http://127.0.0.1:9", pairingCode: "ABCD1234" } });
    expect(missing.statusCode).toBe(502);

    const connected = await app.inject({ method: "POST", url: "/api/v1/sites/connect", cookies, payload: { workspaceId, url: `${fakeUrl}/wp-admin/`, pairingCode: "abcd-1234" } });
    expect(connected.statusCode).toBe(201);
    const site = connected.json().site;
    expect(site.url).toBe(fakeUrl);
    expect(site.name).toBe("Fake WP");
    expect(site.connectionStatus).toBe("connected");
    expect(site.secretEncrypted).toBeUndefined();
    expect(fake.state.siteId).toBe(site.id);

    const list = await app.inject({ method: "GET", url: `/api/v1/sites?workspaceId=${workspaceId}`, cookies });
    expect(list.json().sites).toHaveLength(1);

    // Create + assign + save + publish → pushed to the site.
    const created = await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "WP launch" } });
    const projectId = created.json().project.id as string;
    const assigned = await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectId}`, cookies, payload: { siteId: site.id } });
    expect(assigned.json().project.siteId).toBe(site.id);
    const config = { scenes: [{ id: "s1", name: "Intro", start: 0, end: 5, background: { type: "color", color: "#000" }, layers: [{ id: "l1", type: "text", frame: { x: 0, y: 0, w: 50, h: 10 }, content: { text: "Hi" } }] }] };
    await app.inject({ method: "PUT", url: `/api/v1/projects/${projectId}/draft`, cookies, payload: { config } });

    const published = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/publish`, cookies, payload: {} });
    expect(published.statusCode).toBe(200);
    expect(published.json().sites).toEqual([{ siteId: site.id, siteName: "Fake WP", ok: true, shortcode: `[sceneflow id="${projectId}"]` }]);
    const stored = fake.state.published.get(projectId)!;
    expect(stored.version).toBe(1);
    expect(stored.name).toBe("WP launch");
    expect((stored.config as { projectId: string; scenes: unknown[] }).projectId).toBe(projectId);

    const detail = await app.inject({ method: "GET", url: `/api/v1/sites/${site.id}`, cookies });
    expect(detail.json().publications[0]).toMatchObject({ projectId, version: 1, status: "ok" });

    // Draft preview on the site.
    await app.inject({ method: "PUT", url: `/api/v1/projects/${projectId}/draft`, cookies, payload: { config: { ...config, scenes: [{ ...config.scenes[0], name: "Draft" }] } } });
    const preview = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/preview-session`, cookies, payload: {} });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().previewUrl).toContain("sceneflow_preview=");
    expect(JSON.parse([...fake.state.previews.values()][0]!).scenes[0].name).toBe("Draft");

    // Media browsing through the signed GET.
    const media = await app.inject({ method: "GET", url: `/api/v1/sites/${site.id}/media?type=image`, cookies });
    expect(media.json().items[0].url).toBe("http://fake.local/hero.jpg");
    expect(fake.state.appUrl).toBe("http://localhost:3000");

    // Element placement: pages → pick session → save → listed on both sides → delete.
    const pages = await app.inject({ method: "GET", url: `/api/v1/sites/${site.id}/pages?search=sh`, cookies });
    expect(pages.json().items.map((p: { title: string }) => p.title)).toEqual(["Home page", "Shop"]);
    const pick = await app.inject({ method: "POST", url: `/api/v1/sites/${site.id}/pick-session`, cookies, payload: { postId: 12 } });
    expect(pick.json().pickUrl).toContain("sceneflow_pick=");
    expect(pick.json().siteOrigin).toBe(fakeUrl);
    const placed = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/placements`, cookies, payload: { postId: 12, path: "/shop/", pageUrl: "http://fake.local/shop/", pageTitle: "Shop", selector: "#hero > .wp-block-cover", mode: "after" } });
    expect(placed.statusCode, placed.body).toBe(201);
    const placementId = placed.json().placement.id as string;
    expect(fake.state.placements.get(placementId)).toMatchObject({ projectId, postId: 12, selector: "#hero > .wp-block-cover", mode: "after" });
    const listed = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/placements`, cookies });
    expect(listed.json().placements).toHaveLength(1);
    const badSel = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/placements`, cookies, payload: { postId: 12, selector: "<img onerror=1>", mode: "replace" } });
    expect(badSel.statusCode).toBe(400);
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/projects/${projectId}/placements/${placementId}`, cookies });
    expect(removed.json()).toEqual({ ok: true, remoteOk: true });
    expect(fake.state.placements.size).toBe(0);

    // WooCommerce catalog through the signed connector (plus the manual catalog), normalized server side.
    const providers = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/commerce`, cookies });
    expect(providers.json().providers.map((p: { id: string }) => p.id)).toEqual(["woocommerce", "manual"]);
    const products = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/products?provider=woocommerce&search=run`, cookies });
    expect(products.statusCode, products.body).toBe(200);
    expect(products.json().items).toHaveLength(1);
    expect(products.json().items[0]).toMatchObject({ id: "182", type: "variable", name: "Runner Pro", stockStatus: "instock", variations: [{ id: "190", title: "M", inStock: true }] });
    const lamp = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/products/7?provider=woocommerce`, cookies });
    expect(lamp.json().product.productUrl).toBeUndefined(); // javascript: URL dropped during normalization
    expect(lamp.json().product.stockStatus).toBe("outofstock");
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/products/999?provider=woocommerce`, cookies })).statusCode).toBe(404);

    // Health check refresh + disconnect.
    const check = await app.inject({ method: "POST", url: `/api/v1/sites/${site.id}/check`, cookies });
    expect(check.json().site.connectionStatus).toBe("connected");
    const del = await app.inject({ method: "DELETE", url: `/api/v1/sites/${site.id}`, cookies });
    expect(del.statusCode).toBe(200);
  });

  it("records a failed push when the site rejects the signature", async () => {
    const { cookies, workspaceId } = await register();
    const connected = await app.inject({ method: "POST", url: "/api/v1/sites/connect", cookies, payload: { workspaceId, url: fakeUrl, pairingCode: "ABCD1234" } });
    const site = connected.json().site;
    fake.state.secret = "f".repeat(64); // site lost / rotated its secret
    const created = await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "Broken" } });
    const projectId = created.json().project.id as string;
    await app.inject({ method: "PATCH", url: `/api/v1/projects/${projectId}`, cookies, payload: { siteId: site.id } });
    await app.inject({ method: "PUT", url: `/api/v1/projects/${projectId}/draft`, cookies, payload: { config: { scenes: [{ id: "s1", name: "A", start: 0, end: 5, background: { type: "color", color: "#000" } }] } } });
    const published = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/publish`, cookies, payload: {} });
    expect(published.statusCode).toBe(200); // the SaaS publish still succeeds
    expect(published.json().sites[0].ok).toBe(false);
    expect(published.json().sites[0].error).toContain("bad_signature");
    const detail = await app.inject({ method: "GET", url: `/api/v1/sites/${site.id}`, cookies });
    expect(detail.json().site.connectionStatus).toBe("error");
    expect(detail.json().publications[0].status).toBe("failed");
  });
});
