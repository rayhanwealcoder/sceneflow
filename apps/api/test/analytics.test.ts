import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";

let app: FastifyInstance;
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-analytics-"));
  app = await buildApp(testConfig(storageDir), { queue: { send: vi.fn(async () => "job") } });
});

afterAll(async () => {
  await app.close();
  await rm(storageDir, { recursive: true, force: true });
});

async function register(name = "Tester") {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: `u-${crypto.randomUUID()}@test.dev`, password: "password123", name } });
  const cookie = res.cookies.find((c) => c.name === "sf_session")!;
  return { cookies: { sf_session: cookie.value }, workspaceId: res.json().workspaceId as string };
}

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), type, at: Date.now(), ...extra });

describe("analytics (doc §24)", () => {
  it("publish stamps the ingest endpoint; batches from any origin are stored once; the summary aggregates them", async () => {
    const { cookies, workspaceId } = await register();
    const created = await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "Analytics" } });
    const projectId = created.json().project.id as string;
    const config = {
      scenes: [
        { id: "a", name: "Intro", start: 0, end: 5, background: { type: "color", color: "#000" }, layers: [{ id: "cta", name: "Shop now", type: "button", frame: { x: 0, y: 0, w: 20, h: 10 }, content: { label: "Shop" }, action: { type: "ADD_TO_CART", product: { provider: "manual", productId: "p1", title: "Lamp", price: "$10", priceAmount: 10 }, quantity: 1 } }] },
        { id: "b", name: "Outro", start: 5, end: 10, background: { type: "color", color: "#111" } },
      ],
    };
    await app.inject({ method: "PUT", url: `/api/v1/projects/${projectId}/draft`, cookies, payload: { config } });

    // Before publishing nothing is stored (the project is unknown to visitors), but the request is still accepted quietly.
    const early = await app.inject({ method: "POST", url: "/api/v1/analytics/events", headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://shop.example" }, payload: JSON.stringify({ projectId, sessionId: "sess-early-1", events: [ev("player_loaded")] }) });
    expect(early.statusCode).toBe(204);
    expect(early.headers["access-control-allow-origin"]).toBe("*");

    await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/publish`, cookies, payload: {} });
    const live = (await app.inject({ method: "GET", url: `/p/${projectId}.json` })).json();
    expect(live.analytics).toEqual({ endpoint: "http://localhost:4800/api/v1/analytics/events", enabled: true });

    const dup = ev("player_loaded");
    const s1 = {
      projectId,
      version: 1,
      sessionId: "sess-000001",
      host: "shop.example",
      path: "/landing",
      device: "mobile",
      events: [
        dup,
        ev("video_play", { t: 0, sceneId: "a" }),
        ev("scene_enter", { t: 0, sceneId: "a" }),
        ev("element_impression", { sceneId: "a", layerId: "cta" }),
        ev("watch", { t: 0, payload: { from: 0, to: 4.5 } }),
        ev("video_25", { t: 2.5 }),
        ev("element_click", { sceneId: "a", layerId: "cta", productId: "p1", payload: { action: "ADD_TO_CART" } }),
        ev("add_to_cart", { layerId: "cta", productId: "p1" }),
        ev("scene_exit", { t: 5, sceneId: "a" }),
        ev("scene_enter", { t: 5, sceneId: "b" }),
        ev("watch", { t: 5, payload: { from: 5, to: 10 } }),
        ev("video_50", { t: 5 }),
        ev("video_75", { t: 7.5 }),
        ev("video_complete", { t: 10 }),
      ],
    };
    const s2 = { projectId, version: 1, sessionId: "sess-000002", host: "shop.example", path: "/landing", device: "desktop", events: [ev("player_loaded"), ev("video_play", { t: 0 }), ev("scene_enter", { sceneId: "a" }), ev("watch", { payload: { from: 0, to: 2 } }), ev("video_pause", { t: 2 })] };
    for (const batch of [s1, s2, { ...s1, events: [dup] }]) {
      const res = await app.inject({ method: "POST", url: "/api/v1/analytics/events", headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://shop.example" }, payload: JSON.stringify(batch) });
      expect(res.statusCode, res.body).toBe(204);
    }
    // Preflight from a foreign origin is allowed for the ingest route only.
    const pre = await app.inject({ method: "OPTIONS", url: "/api/v1/analytics/events", headers: { origin: "https://shop.example", "access-control-request-method": "POST" } });
    expect(pre.headers["access-control-allow-origin"]).toBe("*");
    const preApi = await app.inject({ method: "OPTIONS", url: "/api/v1/projects", headers: { origin: "https://shop.example", "access-control-request-method": "GET" } });
    expect(preApi.headers["access-control-allow-origin"]).not.toBe("*");

    expect((await app.inject({ method: "POST", url: "/api/v1/analytics/events", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ projectId, sessionId: "sess-000003", events: [ev("purchase")] }) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/analytics/events", headers: { "content-type": "text/plain" }, payload: "not json" })).statusCode).toBe(400);

    const summaryRes = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics?days=7`, cookies });
    expect(summaryRes.statusCode, summaryRes.body).toBe(200);
    const summary = summaryRes.json();
    expect(summary.totals).toMatchObject({ loads: 2, sessions: 2, plays: 2, completes: 1, completionRate: 50, clicks: 1, addToCarts: 1, playRate: 100 });
    expect(summary.totals.quartiles).toEqual({ q25: 1, q50: 1, q75: 1, complete: 1 });
    expect(summary.totals.avgWatchSeconds).toBe(5.8); // (4.5 + 5 + 2) / 2 plays
    expect(summary.daily).toHaveLength(1);
    expect(summary.daily[0]).toMatchObject({ loads: 2, plays: 2, completes: 1 });
    expect(summary.timeline.buckets).toBe(50);
    expect(summary.timeline.duration).toBe(10);
    // First 2 s watched by both sessions, 2–4.5 s by one, 4.5–5 s by none, 5–10 s by one.
    expect(summary.timeline.values[0]).toBe(2);
    expect(summary.timeline.values[15]).toBe(1); // 3.0–3.2 s
    expect(summary.timeline.values[23]).toBe(0); // 4.6–4.8 s
    expect(summary.timeline.values[40]).toBe(1); // 8.0–8.2 s
    expect(summary.scenes.map((s: { name: string; enters: number }) => [s.name, s.enters])).toEqual([
      ["Intro", 2],
      ["Outro", 1],
    ]);
    expect(summary.elements[0]).toMatchObject({ layerId: "cta", name: "Shop now", type: "button", impressions: 1, clicks: 1, ctr: 100 });
    expect(summary.products[0]).toMatchObject({ productId: "p1", title: "Lamp", addToCarts: 1 });
    expect(summary.devices).toEqual({ desktop: 1, tablet: 0, mobile: 1 });
    expect(summary.pages[0]).toMatchObject({ host: "shop.example", path: "/landing", loads: 2 });

    const other = await register("Other");
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics`, cookies: other.cookies })).statusCode).toBe(403);
  });
});
