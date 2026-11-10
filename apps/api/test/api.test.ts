import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseProject } from "@sceneflow/schema";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";

let app: FastifyInstance;
let storageDir: string;
const queue = { send: vi.fn(async () => "job-1") };

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-api-"));
  app = await buildApp(testConfig(storageDir), { queue });
});

afterAll(async () => {
  await app.close();
  await rm(storageDir, { recursive: true, force: true });
});

const email = () => `u-${crypto.randomUUID()}@test.dev`;

async function register(name = "Tester") {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: email(), password: "password123", name } });
  expect(res.statusCode).toBe(201);
  const cookie = res.cookies.find((c) => c.name === "sf_session");
  expect(cookie).toBeDefined();
  return { cookies: { sf_session: cookie!.value }, workspaceId: res.json().workspaceId as string };
}

describe("auth", () => {
  it("registers, reports the session and logs out", async () => {
    const { cookies } = await register();
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies });
    expect(me.json().user.name).toBe("Tester");
    const out = await app.inject({ method: "POST", url: "/api/v1/auth/logout", cookies });
    expect(out.statusCode).toBe(200);
    const me2 = await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies });
    expect(me2.json().user).toBeNull();
  });

  it("rejects wrong passwords and unauthenticated access", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "nobody@test.dev", password: "nope12345" } });
    expect(res.statusCode).toBe(401);
    const list = await app.inject({ method: "GET", url: "/api/v1/projects?workspaceId=00000000-0000-0000-0000-000000000000" });
    expect(list.statusCode).toBe(401);
  });
});

describe("projects: create -> save version -> publish -> public config", () => {
  it("runs the full vertical slice", async () => {
    const { cookies, workspaceId } = await register();
    const created = await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "Launch video" } });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    // Not published yet.
    expect((await app.inject({ method: "GET", url: `/p/${projectId}.json` })).statusCode).toBe(404);

    const config = {
      video: { provider: "local", assetId: "a1", src: "https://cdn.test/v.mp4", poster: "https://cdn.test/p.jpg", duration: 10 },
      scenes: [{ id: "s1", name: "Intro", start: 0, end: 10, background: { type: "color", color: "#000" }, layers: [{ id: "l1", type: "commerce-button", frame: { x: 10, y: 80, w: 30, h: 10 }, content: { label: "Get Mine" }, action: { type: "ADD_TO_CART", productId: "182" } }] }],
    };
    const saved = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/versions`, cookies, payload: { config } });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().version).toBe(1);
    expect(saved.json().config.projectId).toBe(projectId);

    const bad = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/versions`, cookies, payload: { config: { ...config, video: { ...config.video, src: "javascript:alert(1)" } } } });
    expect(bad.statusCode).toBe(422);

    const published = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/publish`, cookies, payload: {} });
    expect(published.statusCode).toBe(200);
    expect(published.json().publishedVersion).toBe(1);

    const pub = await app.inject({ method: "GET", url: `/p/${projectId}.json` });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers["access-control-allow-origin"]).toBe("*");
    const parsed = parseProject(pub.body);
    expect(parsed.ok).toBe(true);

    // Saving v2 does not change what is live until it is published (AC-003: same id, no shortcode change).
    await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/versions`, cookies, payload: { config: { ...config, scenes: [{ ...config.scenes[0], name: "Intro v2" }] } } });
    expect((await app.inject({ method: "GET", url: `/p/${projectId}.json` })).json().scenes[0].name).toBe("Intro");

    const demo = await app.inject({ method: "GET", url: `/demo/${projectId}` });
    expect(demo.statusCode).toBe(200);
    expect(demo.body).toContain("/runtime/sceneflow.runtime.min.js");
    const runtime = await app.inject({ method: "GET", url: "/runtime/sceneflow.runtime.min.js" });
    expect(runtime.statusCode).toBe(200);
    expect(runtime.body).toContain("SceneFlow");
  });

  it("autosave reuses the draft version until it is published", async () => {
    const { cookies, workspaceId } = await register();
    const created = await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "Autosave" } });
    const id = created.json().project.id as string;
    const config = { scenes: [{ id: "s1", name: "A", start: 0, end: 5, background: { type: "color", color: "#000" } }] };

    const a = await app.inject({ method: "PUT", url: `/api/v1/projects/${id}/draft`, cookies, payload: { config } });
    expect(a.statusCode).toBe(200);
    expect(a.json().version).toBe(1);
    const b = await app.inject({ method: "PUT", url: `/api/v1/projects/${id}/draft`, cookies, payload: { config: { ...config, scenes: [{ ...config.scenes[0], name: "B" }] } } });
    expect(b.json().version).toBe(1);
    expect(b.json().checksum).not.toBe(a.json().checksum);

    await app.inject({ method: "POST", url: `/api/v1/projects/${id}/publish`, cookies, payload: {} });
    const c = await app.inject({ method: "PUT", url: `/api/v1/projects/${id}/draft`, cookies, payload: { config: { ...config, scenes: [{ ...config.scenes[0], name: "C" }] } } });
    expect(c.json().version).toBe(2);
    // The published v1 is untouched.
    expect((await app.inject({ method: "GET", url: `/p/${id}.json` })).json().scenes[0].name).toBe("B");
    const versions = await app.inject({ method: "GET", url: `/api/v1/projects/${id}/versions`, cookies });
    expect(versions.json().versions.map((v: { version: number; state: string }) => [v.version, v.state])).toEqual([
      [2, "draft"],
      [1, "published"],
    ]);
  });

  it("denies access to another user's project", async () => {
    const a = await register("A");
    const b = await register("B");
    const created = await app.inject({ method: "POST", url: "/api/v1/projects", cookies: a.cookies, payload: { workspaceId: a.workspaceId, name: "Private" } });
    const id = created.json().project.id;
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${id}`, cookies: b.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/projects", cookies: b.cookies, payload: { workspaceId: a.workspaceId, name: "Hijack" } })).statusCode).toBe(403);
  });
});

describe("media upload", () => {
  it("issues a signed upload URL, accepts the PUT and enqueues processing", async () => {
    const { cookies, workspaceId } = await register();
    const bytes = Buffer.from("fake-mp4-bytes");
    const res = await app.inject({ method: "POST", url: "/api/v1/media/uploads", cookies, payload: { workspaceId, filename: "clip.mp4", mimeType: "video/mp4", sizeBytes: bytes.length } });
    expect(res.statusCode).toBe(201);
    const { assetId, upload } = res.json();
    expect(upload.method).toBe("PUT");

    const url = new URL(upload.url);
    const put = await app.inject({ method: "PUT", url: url.pathname + url.search, headers: { "content-type": "video/mp4" }, payload: bytes });
    expect(put.statusCode).toBe(200);
    expect(queue.send).toHaveBeenCalledWith("media.process", { assetId }, expect.anything());

    const asset = await app.inject({ method: "GET", url: `/api/v1/media/${assetId}`, cookies });
    expect(asset.json().asset.status).toBe("uploaded");
    expect(asset.json().asset.providerAssetId).toBeUndefined();
    const stored = await readFile(join(storageDir, "originals", workspaceId, assetId, "original.mp4"));
    expect(stored.equals(bytes)).toBe(true);

    // Tampered signature and oversize body are rejected.
    const tampered = await app.inject({ method: "PUT", url: url.pathname + url.search.replace(/sig=.{4}/, "sig=0000"), payload: bytes });
    expect(tampered.statusCode).toBe(403);
    const res2 = await app.inject({ method: "POST", url: "/api/v1/media/uploads", cookies, payload: { workspaceId, filename: "big.mp4", mimeType: "video/mp4", sizeBytes: 4 } });
    const u2 = new URL(res2.json().upload.url);
    const big = await app.inject({ method: "PUT", url: u2.pathname + u2.search, payload: Buffer.alloc(64) });
    expect(big.statusCode).toBe(413);
  });

  it("rejects unsupported file types", async () => {
    const { cookies, workspaceId } = await register();
    const res = await app.inject({ method: "POST", url: "/api/v1/media/uploads", cookies, payload: { workspaceId, filename: "x.exe", mimeType: "application/octet-stream", sizeBytes: 10 } });
    expect(res.statusCode).toBe(400);
  });

  it("the completion callback is a no-op for finished local uploads and 409 while the file is missing", async () => {
    const { cookies, workspaceId } = await register();
    const res = await app.inject({ method: "POST", url: "/api/v1/media/uploads", cookies, payload: { workspaceId, filename: "clip.mp4", mimeType: "video/mp4", sizeBytes: 4 } });
    expect(res.json().complete).toBeNull(); // local provider completes in the PUT handler
    const { assetId } = res.json();
    const early = await app.inject({ method: "POST", url: `/api/v1/media/uploads/${assetId}/complete`, cookies });
    expect(early.statusCode).toBe(409);
  });
});

describe("publish-time media resolution + diagnostics", () => {
  it("hands out a video frame for a custom thumbnail: known frames at once, unprocessed videos refused", async () => {
    const { cookies, workspaceId } = await register();
    const up = await app.inject({ method: "POST", url: "/api/v1/media/uploads", cookies, payload: { workspaceId, filename: "hero.mp4", mimeType: "video/mp4", sizeBytes: 10 } });
    const assetId = up.json().assetId as string;
    const url = new URL(up.json().upload.url);
    await app.inject({ method: "PUT", url: url.pathname + url.search, headers: { "content-type": "video/mp4" }, payload: Buffer.alloc(10) });
    // Still "uploaded" (no worker in this test): no frames yet.
    const early = await app.inject({ method: "POST", url: `/api/v1/media/${assetId}/frame`, cookies, payload: { time: 2 } });
    expect(early.statusCode).toBe(409);
    const { mediaAssets, createDb } = await import("@sceneflow/server");
    const { eq } = await import("drizzle-orm");
    const conn = createDb(process.env.DATABASE_URL_TEST ?? "postgresql://postgres:sceneflow_dev@localhost:5432/sceneflow_test");
    await conn.db
      .update(mediaAssets)
      .set({ status: "ready", metadataJson: { duration: 12, width: 1920, height: 1080, frames: [{ time: 2, url: "http://localhost:4800/files/x/frame-2000.jpg" }] } })
      .where(eq(mediaAssets.id, assetId));
    await conn.close();
    queue.send.mockClear();
    // A frame the worker already produced comes straight back, nothing is queued.
    const known = await app.inject({ method: "POST", url: `/api/v1/media/${assetId}/frame`, cookies, payload: { time: 2 } });
    expect(known.statusCode).toBe(200);
    expect(known.json().frame).toEqual({ time: 2, url: "http://localhost:4800/files/x/frame-2000.jpg" });
    expect(queue.send).not.toHaveBeenCalled();
    // Times are clamped into the video; a request past the end asks for the last moment.
    const bad = await app.inject({ method: "POST", url: `/api/v1/media/${assetId}/frame`, cookies, payload: { time: -1 } });
    expect(bad.statusCode).toBe(400);
    // Another workspace's member cannot take frames from this video.
    const stranger = await register("Stranger");
    const denied = await app.inject({ method: "POST", url: `/api/v1/media/${assetId}/frame`, cookies: stranger.cookies, payload: { time: 2 } });
    expect(denied.statusCode).toBe(403);
  });

  it("attaches renditions to the published config and explains what is missing", async () => {
    const { cookies, workspaceId } = await register();
    // A "processed" video asset with renditions, as the worker would leave it.
    const up = await app.inject({ method: "POST", url: "/api/v1/media/uploads", cookies, payload: { workspaceId, filename: "hero.mp4", mimeType: "video/mp4", sizeBytes: 10 } });
    const assetId = up.json().assetId as string;
    const url = new URL(up.json().upload.url);
    await app.inject({ method: "PUT", url: url.pathname + url.search, headers: { "content-type": "video/mp4" }, payload: Buffer.alloc(10) });
    const { mediaAssets } = await import("@sceneflow/server");
    const { createDb } = await import("@sceneflow/server");
    const { eq } = await import("drizzle-orm");
    const conn = createDb(process.env.DATABASE_URL_TEST ?? "postgresql://postgres:sceneflow_dev@localhost:5432/sceneflow_test");
    await conn.db
      .update(mediaAssets)
      .set({
        status: "ready",
        metadataJson: {
          duration: 12,
          width: 1920,
          height: 1080,
          hasAudio: true,
          proxyUrl: "http://localhost:4800/files/x/proxy-540.mp4",
          posterUrl: "http://localhost:4800/files/x/poster.jpg",
          renditions: {
            status: "ready",
            items: [
              { src: "http://localhost:4800/files/x/video-720.mp4", width: 1280, height: 720, kind: "progressive", sizeBytes: 100 },
              { src: "http://localhost:4800/files/x/video-1080.mp4", width: 1920, height: 1080, kind: "progressive", sizeBytes: 200 },
              { src: "http://localhost:4800/files/x/scrub-720.mp4", width: 1280, height: 720, kind: "scrub", sizeBytes: 300 },
            ],
          },
        },
      })
      .where(eq(mediaAssets.id, assetId));
    await conn.close();

    const created = await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "HD" } });
    const projectId = created.json().project.id as string;

    const before = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/diagnostics`, cookies });
    expect(before.json().checks[0]).toMatchObject({ id: "draft", status: "fail", fix: { href: `/projects/${projectId}/editor` } });

    const config = {
      video: { provider: "local", assetId, src: "http://localhost:4800/files/x/proxy-540.mp4", poster: "http://localhost:4800/files/x/poster.jpg", duration: 12 },
      scenes: [{ id: "s1", name: "A", start: 0, end: 12, background: { type: "video", assetId, src: "http://localhost:4800/files/x/proxy-540.mp4", sourceStart: 0 } }],
    };
    await app.inject({ method: "PUT", url: `/api/v1/projects/${projectId}/draft`, cookies, payload: { config } });
    const mid = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/diagnostics`, cookies });
    const ids = (mid.json().checks as Array<{ id: string; status: string }>).map((c) => `${c.id}:${c.status}`);
    expect(ids).toEqual(["draft:ok", "media:ok", "published:fail", "site:info"]);

    const published = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/publish`, cookies, payload: {} });
    expect(published.json().media).toMatchObject({ ready: 1, hdPending: 0 });
    const live = (await app.inject({ method: "GET", url: `/p/${projectId}.json` })).json();
    expect(live.video.src).toBe("http://localhost:4800/files/x/video-720.mp4"); // best default
    expect(live.video.sources.map((s: { height: number; kind: string }) => `${s.kind}@${s.height}`)).toEqual(["progressive@540", "progressive@720", "progressive@1080", "scrub@720"]);
    expect(live.video.sources[0].width).toBe(960); // proxy width derived from the source aspect
    expect(live.scenes[0].background.sources).toHaveLength(4);

    const after = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/diagnostics`, cookies });
    expect((after.json().checks as Array<{ id: string; status: string }>).find((c) => c.id === "published")).toMatchObject({ status: "ok" });
  });
});

describe("commerce: manual catalog", () => {
  it("creates, lists, picks and deletes hand-entered products; projects without a shop site only see the manual catalog", async () => {
    const { cookies, workspaceId } = await register();
    const created = await app.inject({ method: "POST", url: "/api/v1/products", cookies, payload: { workspaceId, name: "Studio Lamp", priceAmount: 59, regularPriceAmount: 79, currency: "usd", productUrl: "https://shop.test/lamp", imageUrl: "https://shop.test/lamp.jpg" } });
    expect(created.statusCode, created.body).toBe(201);
    const product = created.json().product;
    expect(product).toMatchObject({ source: "manual", name: "Studio Lamp", price: "$59.00", regularPrice: "$79.00", currency: "USD", stockStatus: "instock", purchasable: true });

    const bad = await app.inject({ method: "POST", url: "/api/v1/products", cookies, payload: { workspaceId, name: "Evil", priceAmount: 1, productUrl: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);

    const project = await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "Shop video" } });
    const projectId = project.json().project.id as string;
    const providers = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/commerce`, cookies });
    expect(providers.json()).toEqual({ providers: [{ id: "manual", label: "My products", editable: true }], default: "manual" });
    const list = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/products?search=lamp`, cookies });
    expect(list.json().items.map((p: { id: string }) => p.id)).toEqual([product.id]);
    const one = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/products/${product.id}?provider=manual`, cookies });
    expect(one.json().product.name).toBe("Studio Lamp");
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/products?provider=woocommerce`, cookies })).statusCode).toBe(404);

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/products/${product.id}`, cookies, payload: { inStock: false } });
    expect(patched.json().product.stockStatus).toBe("outofstock");

    const other = await register("Other");
    expect((await app.inject({ method: "DELETE", url: `/api/v1/products/${product.id}`, cookies: other.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/products/${product.id}`, cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/products?workspaceId=${workspaceId}`, cookies })).json().items).toHaveLength(0);
  });
});
