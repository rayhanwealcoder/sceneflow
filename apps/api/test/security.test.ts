import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { configFromEnv, testConfig } from "../src/config.js";
import { LoginGuard } from "../src/lib/loginGuard.js";

let app: FastifyInstance;
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-sec-"));
  app = await buildApp(testConfig(storageDir), { queue: { send: vi.fn(async () => "job") } });
});
afterAll(async () => {
  await app.close();
  await rm(storageDir, { recursive: true, force: true });
});

const email = () => `u-${crypto.randomUUID()}@test.dev`;

describe("sign-in brute-force guard", () => {
  it("locks an account after 5 wrong passwords, even for the right one, and leaves other accounts alone", async () => {
    const victim = email();
    const other = email();
    await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: victim, password: "correct-horse-1", name: "V" } });
    await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: other, password: "correct-horse-2", name: "O" } });
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: victim, password: `wrong-${i}` } });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: victim, password: "correct-horse-1" } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe("TOO_MANY_ATTEMPTS");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // Wrong passwords for an unknown account answer like any other wrong password (no enumeration).
    const ghost = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: email(), password: "whatever-1" } });
    expect(ghost.statusCode).toBe(401);
    expect(ghost.json().message).toBe("Email or password is incorrect");
    // Another account on the same address still signs in (address limit is 30).
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: other, password: "correct-horse-2" } })).statusCode).toBe(200);
  });

  it("blocks progressively longer and forgets after the quiet period", () => {
    let now = 0;
    const g = new LoginGuard({ max: 3, windowMs: 1000 }, () => now);
    g.fail("a");
    g.fail("a");
    expect(g.retryAfter("a")).toBe(0);
    g.fail("a"); // 3rd → blocked for one window
    expect(g.retryAfter("a")).toBe(1000);
    now = 1001;
    expect(g.retryAfter("a")).toBe(0);
    g.fail("a"); // still remembered → double
    expect(g.retryAfter("a")).toBe(2000);
    now = 1001 + 2000 + 1000 + 2000 + 1; // quiet for window + last block
    expect(g.retryAfter("a")).toBe(0);
    g.fail("a");
    expect(g.retryAfter("a")).toBe(0); // fresh count
    g.succeed("a");
    expect(g.retryAfter("a")).toBe(0);
  });
});

describe("response hardening", () => {
  it("sets baseline security headers; API answers are never cached; HTML cannot be framed", async () => {
    const api = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(api.headers["x-content-type-options"]).toBe("nosniff");
    expect(api.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(api.headers["cache-control"]).toBe("no-store");
    const demo = await app.inject({ method: "GET", url: `/demo/${crypto.randomUUID()}` });
    expect(demo.headers["x-frame-options"]).toBe("DENY");
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.headers["cache-control"]).toBeUndefined();
  });

  it("does not trust X-Forwarded-For unless TRUST_PROXY is on", () => {
    const env = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", SESSION_SECRET: "0123456789abcdef0123456789" };
    expect(configFromEnv(env).trustProxy).toBe(false);
    expect(configFromEnv({ ...env, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(testConfig(storageDir).trustProxy).toBe(false);
  });
});
