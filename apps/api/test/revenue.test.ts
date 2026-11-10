/*
 * Phase 16 analytics: orders credited to a video (pulled from the shop through the connector), CSV export,
 * retention of raw events.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { analyticsEvents, createDb, deriveKey, encryptString, shopOrders, sites, type RemoteOrder, type WordPressConnector } from "@sceneflow/server";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { orderRows } from "../src/lib/orders.js";
import { pruneAnalytics } from "../src/lib/retention.js";

let app: FastifyInstance;
let storageDir: string;
let db: ReturnType<typeof createDb>;
let shop: { enabled: boolean; orders: RemoteOrder[] } = { enabled: true, orders: [] };
const orders = vi.fn(async (_site?: unknown, _after?: number, _limit?: number) => ({ ok: true as const, ...shop }));
const connector = { orders } as unknown as WordPressConnector;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-revenue-"));
  const cfg = testConfig(storageDir);
  app = await buildApp(cfg, { queue: { send: vi.fn(async () => "job") }, connector });
  db = createDb(cfg.databaseUrl);
});
afterAll(async () => {
  await app.close();
  await db.close();
  await rm(storageDir, { recursive: true, force: true });
});

async function register() {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: `u-${crypto.randomUUID()}@test.dev`, password: "password123", name: "Shop Owner" } });
  return { cookies: { sf_session: res.cookies.find((c) => c.name === "sf_session")!.value }, workspaceId: res.json().workspaceId as string };
}
async function publishedProject(cookies: Record<string, string>, workspaceId: string, name = "Lamp launch") {
  const { project } = (await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name } })).json();
  await app.inject({
    method: "PUT",
    url: `/api/v1/projects/${project.id}/draft`,
    cookies,
    payload: { config: { scenes: [{ id: "a", name: "Intro", start: 0, end: 5, background: { type: "color", color: "#000" }, layers: [{ id: "cta", type: "button", frame: { x: 0, y: 0, w: 20, h: 10 }, content: { label: "Buy" }, action: { type: "ADD_TO_CART", product: { provider: "woocommerce", productId: "41", title: "Desk lamp", price: "$24.75", priceAmount: 24.75 }, quantity: 1 } }] }] } },
  });
  await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/publish`, cookies, payload: {} });
  return project.id as string;
}
async function shopSite(workspaceId: string) {
  const [s] = await db.db
    .insert(sites)
    .values({ workspaceId, url: `https://shop-${crypto.randomUUID().slice(0, 6)}.test`, platform: "wordpress", connectionStatus: "connected", secretEncrypted: encryptString("s".repeat(64), deriveKey("test-secret-test-secret", "site-secrets")), capabilitiesJson: ["publish", "woocommerce"] })
    .returning();
  return s!;
}
const now = () => Math.floor(Date.now() / 1000);
const order = (id: string, projectId: string, status: RemoteOrder["status"], lines: Array<Partial<RemoteOrder["lines"][number]>>, at = now() - 3600): RemoteOrder => ({
  id,
  status,
  currency: "usd",
  paidAt: at,
  modifiedAt: at + 10,
  lines: lines.map((l, i) => ({ id: `${id}-${i}`, projectId, sessionId: "sess-abcdef12", productId: "41", quantity: 1, total: 24.75, ...l })),
});

describe("orderRows", () => {
  it("keeps only lines of the site's own projects, normalises numbers and ids", () => {
    const mine = crypto.randomUUID();
    const rows = orderRows(
      "site-1",
      [
        order("100", mine, "paid", [{ quantity: 2, total: 49.499 }, { projectId: crypto.randomUUID() }, { projectId: "not-a-uuid" }, { sessionId: "bad id!" }]),
        { ...order("101", mine, "paid", [{}]), status: "weird" as RemoteOrder["status"] },
        { ...order("102", mine, "paid", [{}]), paidAt: 0 },
      ],
      new Set([mine]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ orderId: "100", lineId: "100-0", projectId: mine, quantity: 2, revenue: 49.5, currency: "USD", status: "paid", sessionId: "sess-abcdef12" });
    expect(rows[1]!.sessionId).toBeNull();
  });
});

describe("revenue attribution", () => {
  it("pulls credited orders when the Analytics page opens (at most once a minute), counts paid ones, follows refunds", async () => {
    const owner = await register();
    const projectId = await publishedProject(owner.cookies, owner.workspaceId);
    const site = await shopSite(owner.workspaceId);
    shop = {
      enabled: true,
      orders: [order("5001", projectId, "paid", [{ quantity: 2, total: 49.5 }]), order("5002", projectId, "paid", [{ total: 24.75 }]), order("5003", projectId, "cancelled", [{}])],
    };
    orders.mockClear();
    const a = (await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics?days=30`, cookies: owner.cookies })).json();
    expect(orders).toHaveBeenCalledTimes(1);
    expect(orders.mock.calls[0]![1]).toBe(0); // first pull starts at the beginning
    expect(a.totals.orders).toBe(2);
    expect(a.totals.revenue).toEqual([{ currency: "USD", orders: 2, items: 3, revenue: 74.25 }]);
    expect(a.products.find((p: { productId: string }) => p.productId === "41")).toMatchObject({ title: "Desk lamp", orders: 2, units: 3, revenue: 74.25 });
    expect(a.daily.reduce((n: number, d: { orders?: number }) => n + (d.orders ?? 0), 0)).toBe(2);

    // Within the window: no second request to the shop.
    await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics?days=30`, cookies: owner.cookies });
    expect(orders).toHaveBeenCalledTimes(1);

    // Later the shop refunds one order: the next pull (from the stored cursor) updates the row.
    await db.db.update(sites).set({ ordersSyncedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(sites.id, site.id));
    shop = { enabled: true, orders: [{ ...order("5002", projectId, "refunded", [{ total: 0 }]), modifiedAt: now() }] };
    const b = (await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics?days=30`, cookies: owner.cookies })).json();
    expect(orders).toHaveBeenCalledTimes(2);
    expect(orders.mock.calls[1]![1]).toBeGreaterThan(0);
    expect(b.totals.orders).toBe(1);
    expect(b.totals.revenue[0].revenue).toBe(49.5);

    // Analytics off on the site: nothing is pulled, nothing breaks.
    await db.db.update(sites).set({ ordersSyncedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(sites.id, site.id));
    shop = { enabled: false, orders: [] };
    const c = (await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics?days=30`, cookies: owner.cookies })).json();
    expect(c.totals.orders).toBe(1);
    const stored = await db.db.select().from(shopOrders).where(eq(shopOrders.projectId, projectId));
    expect(stored.map((r) => r.status).sort()).toEqual(["cancelled", "paid", "refunded"]);
  });

  it("CSV: daily rows with orders and revenue, raw events, members only, formula-safe", async () => {
    const owner = await register();
    const projectId = await publishedProject(owner.cookies, owner.workspaceId, "=HYPERLINK(evil)");
    await shopSite(owner.workspaceId);
    shop = { enabled: true, orders: [order("7001", projectId, "paid", [{ total: 10 }])] };
    const ev = (type: string, extra: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), type, at: Date.now(), ...extra });
    await app.inject({ method: "POST", url: "/api/v1/analytics/events", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ projectId, sessionId: "sess-csv00001", path: "=cmd", events: [ev("player_loaded"), ev("video_play", { t: 0 }), ev("add_to_cart", { productId: "41" })] }) });
    await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics?days=7`, cookies: owner.cookies }); // pulls the order

    const daily = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics.csv?days=7`, cookies: owner.cookies });
    expect(daily.statusCode).toBe(200);
    expect(daily.headers["content-type"]).toMatch(/text\/csv/);
    expect(daily.headers["content-disposition"]).toMatch(/attachment; filename="HYPERLINKevil-daily-7d-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = daily.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("date,player_loads,viewers,plays,completions,clicks,add_to_cart,checkouts,orders,revenue,currency");
    const today = new Date().toISOString().slice(0, 10);
    expect(lines.find((l) => l.startsWith(`"${today}"`))).toBe(`"${today}","1","1","1","0","0","1","0","1","10","USD"`);

    const events = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics.csv?days=7&view=events`, cookies: owner.cookies });
    const ev2 = events.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(ev2[0]).toBe("time,event,session,version,video_time,scene,element,product,device,host,path,details");
    expect(ev2).toHaveLength(4);
    expect(ev2.every((l, i) => i === 0 || l.includes(`"'=cmd"`))).toBe(true);

    const outsider = await register();
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics.csv`, cookies: outsider.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/analytics.csv` })).statusCode).toBe(401);
  });
});

describe("analytics retention", () => {
  it("deletes raw events older than the limit, keeps newer ones; 0 keeps everything", async () => {
    const owner = await register();
    const projectId = await publishedProject(owner.cookies, owner.workspaceId, "Retention");
    const oldId = `old-${crypto.randomUUID()}`;
    const newId = `new-${crypto.randomUUID()}`;
    await db.db.insert(analyticsEvents).values([
      { id: oldId, projectId, sessionId: "sess-retain01", type: "player_loaded", occurredAt: new Date(Date.now() - 500 * 86_400_000) },
      { id: newId, projectId, sessionId: "sess-retain01", type: "player_loaded", occurredAt: new Date(Date.now() - 30 * 86_400_000) },
    ]);
    const ctx = { db: db.db } as unknown as Ctx;
    expect(await pruneAnalytics(ctx, 0)).toBe(0);
    expect(await pruneAnalytics(ctx, 395)).toBeGreaterThanOrEqual(1);
    const left = await db.db.select({ id: analyticsEvents.id }).from(analyticsEvents).where(eq(analyticsEvents.projectId, projectId));
    expect(left.map((r) => r.id)).toEqual([newId]);
  });
});
