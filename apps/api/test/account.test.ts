import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMailer, createDb, passwordResets, type Mail } from "@sceneflow/server";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";
import { hashToken } from "../src/lib/auth.js";

let app: FastifyInstance;
let storageDir: string;
const sent: Mail[] = [];
// A "real" provider that records instead of delivering: the API behaves as with Resend / SMTP.
const mailer = buildMailer({ id: "resend", label: "Recorder", send: async (m) => { sent.push(m); return { id: `m${sent.length}` }; } }, "SceneFlow <test@localhost>", () => {});
const queue = { send: vi.fn(async () => "job-1") };

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-acct-"));
  app = await buildApp(testConfig(storageDir), { queue, mailer });
});
afterAll(async () => {
  await app.close();
  await rm(storageDir, { recursive: true, force: true });
});

const email = () => `u-${crypto.randomUUID()}@test.dev`;
const settle = () => new Promise((r) => setTimeout(r, 20));
const linkOf = (m: Mail) => m.text.match(/http:\/\/localhost:3000\/reset\/([0-9a-f]{64})/);

async function register(name = "Mia") {
  const addr = email();
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: addr, password: "first-pass-123", name } });
  expect(res.statusCode).toBe(201);
  const cookie = res.cookies.find((c) => c.name === "sf_session")!.value;
  return { email: addr, cookies: { sf_session: cookie }, workspaceId: res.json().workspaceId as string };
}
async function login(addr: string, password: string) {
  return app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: addr, password } });
}
async function me(cookies: Record<string, string>) {
  return (await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies })).json().user;
}

describe("forgot password -> reset link -> new password", () => {
  it("mails a one-time link, resets the password, signs out every other session and signs this one in", async () => {
    const u = await register("Mia Reset");
    const other = await login(u.email, "first-pass-123"); // a second device
    const otherCookies = { sf_session: other.cookies.find((c) => c.name === "sf_session")!.value };

    sent.length = 0;
    const forgot = await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: u.email.toUpperCase() } });
    expect(forgot.statusCode).toBe(200);
    expect(forgot.json()).toEqual({ ok: true, delivery: "email" });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(u.email);
    expect(sent[0]!.subject).toBe("Reset your SceneFlow password");
    expect(sent[0]!.text).toContain("Mia Reset");
    const token = linkOf(sent[0]!)?.[1];
    expect(token).toBeDefined();

    // The page asks whose account the link belongs to.
    const peek = await app.inject({ method: "GET", url: `/api/v1/auth/reset/${token}` });
    expect(peek.statusCode).toBe(200);
    expect(peek.json().email).toBe("u\u2022\u2022\u2022@test.dev");

    // Too short -> validation, nothing changes.
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "short" } })).statusCode).toBe(400);

    const reset = await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "second-pass-456" } });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.json().user.email).toBe(u.email);
    const fresh = { sf_session: reset.cookies.find((c) => c.name === "sf_session")!.value };
    expect((await me(fresh))?.name).toBe("Mia Reset");
    // Both earlier sessions are gone.
    expect(await me(u.cookies)).toBeNull();
    expect(await me(otherCookies)).toBeNull();
    // Old password dead, new one works.
    expect((await login(u.email, "first-pass-123")).statusCode).toBe(401);
    expect((await login(u.email, "second-pass-456")).statusCode).toBe(200);
    // The link is spent.
    expect((await app.inject({ method: "GET", url: `/api/v1/auth/reset/${token}` })).statusCode).toBe(410);
    const again = await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "third-pass-789" } });
    expect(again.statusCode).toBe(410);
    expect(again.json().error).toBe("RESET_USED");
    // ...and the owner was told.
    await settle();
    expect(sent.map((m) => m.subject)).toEqual(["Reset your SceneFlow password", "Your SceneFlow password was changed"]);
  });

  it("answers unknown addresses exactly like known ones and sends nothing", async () => {
    sent.length = 0;
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: email() } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, delivery: "email" });
    await settle();
    expect(sent).toHaveLength(0);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: "not-an-address" } })).statusCode).toBe(400);
  });

  it("a newer request replaces the earlier link; expired and malformed links are refused", async () => {
    const u = await register();
    sent.length = 0;
    await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: u.email } });
    await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: u.email } });
    await settle();
    expect(sent).toHaveLength(2);
    const [first, second] = sent.map((m) => linkOf(m)![1]!);
    expect((await app.inject({ method: "GET", url: `/api/v1/auth/reset/${first}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/auth/reset/${second}` })).statusCode).toBe(200);

    // Age the second link past its hour.
    const { db, close } = createDb(testConfig(storageDir).databaseUrl);
    await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResets.id, hashToken(second!)));
    await close();
    const expired = await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token: second, password: "whatever-123" } });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error).toBe("RESET_EXPIRED");

    expect((await app.inject({ method: "GET", url: `/api/v1/auth/reset/${"f".repeat(64)}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/auth/reset/nope` })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token: "nope", password: "whatever-123" } })).statusCode).toBe(400);
  });

  it("a reset lifts the brute-force lock an attacker caused on the account", async () => {
    const u = await register();
    for (let i = 0; i < 5; i++) await login(u.email, `wrong-${i}`);
    expect((await login(u.email, "first-pass-123")).statusCode).toBe(429);
    sent.length = 0;
    await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: u.email } });
    await settle();
    const token = linkOf(sent[0]!)![1];
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "unlocked-pass-1" } })).statusCode).toBe(200);
    expect((await login(u.email, "unlocked-pass-1")).statusCode).toBe(200);
  });
});

describe("account: change password and name while signed in", () => {
  it("needs the current password, keeps this session, drops the others, mails a notice", async () => {
    const u = await register("Noor");
    const other = await login(u.email, "first-pass-123");
    const otherCookies = { sf_session: other.cookies.find((c) => c.name === "sf_session")!.value };

    expect((await app.inject({ method: "POST", url: "/api/v1/auth/password", payload: { currentPassword: "first-pass-123", newPassword: "x" } })).statusCode).toBe(401);
    const wrong = await app.inject({ method: "POST", url: "/api/v1/auth/password", cookies: u.cookies, payload: { currentPassword: "nope-nope-1", newPassword: "another-pass-9" } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe("WRONG_PASSWORD");
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/password", cookies: u.cookies, payload: { currentPassword: "first-pass-123", newPassword: "short" } })).statusCode).toBe(400);

    sent.length = 0;
    const ok = await app.inject({ method: "POST", url: "/api/v1/auth/password", cookies: u.cookies, payload: { currentPassword: "first-pass-123", newPassword: "another-pass-9" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await me(u.cookies))?.email).toBe(u.email); // still signed in here
    expect(await me(otherCookies)).toBeNull(); // the other device is out
    expect((await login(u.email, "first-pass-123")).statusCode).toBe(401);
    expect((await login(u.email, "another-pass-9")).statusCode).toBe(200);
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[u.email, "Your SceneFlow password was changed"]]);

    const renamed = await app.inject({ method: "PATCH", url: "/api/v1/auth/me", cookies: u.cookies, payload: { name: "  Noor Khan " } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().user.name).toBe("Noor Khan");
    expect((await me(u.cookies))?.name).toBe("Noor Khan");
    expect((await app.inject({ method: "PATCH", url: "/api/v1/auth/me", cookies: u.cookies, payload: { name: "" } })).statusCode).toBe(400);
  });
});

describe("invitations by e-mail", () => {
  it("mails the join link when an address is given, says so, and stays a plain link otherwise", async () => {
    const owner = await register("Olivia");
    sent.length = 0;
    const plain = await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "editor" } });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().sent).toBe(false);
    const mailed = await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "viewer", email: "Guest@Example.com" } });
    expect(mailed.statusCode).toBe(201);
    expect(mailed.json().sent).toBe(true);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("guest@example.com");
    expect(sent[0]!.subject).toBe("Olivia invited you to Olivia's workspace on SceneFlow");
    expect(sent[0]!.text).toContain(mailed.json().url);
    expect(sent[0]!.text).toContain("as viewer");
  });
});

describe("without a mail server (default config)", () => {
  it("still issues working links: delivery is reported as 'log' and the mail lands in the outbox folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-outbox-"));
    const plain = await buildApp(testConfig(dir), { queue });
    try {
      const addr = email();
      await plain.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: addr, password: "first-pass-123", name: "Log" } });
      const r = await plain.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: addr } });
      expect(r.json()).toEqual({ ok: true, delivery: "log" });
      let files: string[] = [];
      for (let i = 0; i < 50 && files.length === 0; i++) {
        await settle();
        files = await readdir(join(dir, "outbox")).catch(() => []);
      }
      expect(files).toHaveLength(1);
      const saved = JSON.parse(await readFile(join(dir, "outbox", files[0]!), "utf8"));
      expect(saved.to).toBe(addr);
      const token = (saved.text as string).match(/\/reset\/([0-9a-f]{64})/)![1];
      expect((await plain.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "from-outbox-123" } })).statusCode).toBe(200);
    } finally {
      await plain.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
