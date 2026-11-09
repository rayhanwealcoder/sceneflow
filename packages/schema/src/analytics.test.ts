import { describe, expect, it } from "vitest";
import { analyticsBatchSchema, parseProject } from "./index.js";

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ id: "11111111-1111-4111-8111-111111111111", type, at: Date.now(), ...extra });
const base = { projectId: "22222222-2222-4222-8222-222222222222", sessionId: "abcdefgh1234", device: "desktop", host: "shop.example", path: "/p/x" };

describe("analytics batch", () => {
  it("accepts a well-formed batch and rejects unknown events, oversize batches and junk payloads", () => {
    expect(analyticsBatchSchema.safeParse({ ...base, events: [ev("player_loaded"), ev("watch", { t: 0, payload: { from: 0, to: 4.5 } }), ev("add_to_cart", { productId: "182", payload: { quantity: 2 } })] }).success).toBe(true);
    expect(analyticsBatchSchema.safeParse({ ...base, events: [ev("purchase")] }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ ...base, events: [] }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ ...base, events: Array.from({ length: 51 }, () => ev("player_loaded")) }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ ...base, sessionId: "x", events: [ev("player_loaded")] }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ ...base, events: [ev("player_loaded", { payload: { nested: { a: 1 } } })] }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ ...base, events: [ev("player_loaded", { payload: { note: "x".repeat(301) } })] }).success).toBe(false);
  });

  it("projects carry an optional analytics endpoint that must be http(s)", () => {
    const scene = { id: "s", name: "S", start: 0, end: 1, background: { type: "color", color: "#000" } };
    const ok = parseProject({ schemaVersion: "1.0", projectId: "p", version: 1, analytics: { endpoint: "https://api.test/api/v1/analytics/events" }, scenes: [scene] });
    expect(ok.ok && ok.project.analytics).toEqual({ endpoint: "https://api.test/api/v1/analytics/events", enabled: true });
    expect(parseProject({ schemaVersion: "1.0", projectId: "p", version: 1, analytics: { endpoint: "javascript:alert(1)" }, scenes: [scene] }).ok).toBe(false);
  });
});
