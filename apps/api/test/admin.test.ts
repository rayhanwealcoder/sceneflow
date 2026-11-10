import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, users } from "@sceneflow/server";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";

let app: FastifyInstance;
let storageDir: string;
let db: ReturnType<typeof createDb>;
const queue = { send: vi.fn(async () => "job-1"), retry: vi.fn(async () => undefined) };

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-admin-"));
  app = await buildApp(testConfig(storageDir), { queue });
  db = createDb(testConfig(storageDir).databaseUrl);
});
afterAll(async () => {
  await app.close();
  await db.close();
  await rm(storageDir, { recursive: true, force: true });
});

type Cookies = Record<string, string>;
const PASS = "admin-test-pass-1";
async function register(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${crypto.randomUUID().slice(0, 8)}@test.dev`;
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: PASS, name } });
  expect(res.statusCode).toBe(201);
  return { email, id: res.json().user.id as string, workspaceId: res.json().workspaceId as string, cookies: { sf_session: res.cookies.find((c) => c.name === "sf_session")!.value } as Cookies };
}
const login = (email: string) => app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASS } });
const get = (url: string, cookies?: Cookies) => app.inject({ method: "GET", url, cookies });
const send = (method: "PATCH" | "POST", url: string, cookies: Cookies, payload: object = {}) => app.inject({ method, url, cookies, payload });
const grant = (id: string) => db.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, id));

describe("super admin console: access", () => {
  it("is invisible (404) to visitors and to ordinary users, open to super admins", async () => {
    const plain = await register("Plain User");
    const boss = await register("Boss Admin");
    await grant(boss.id);
    for (const url of ["/api/v1/admin/overview", "/api/v1/admin/users", "/api/v1/admin/workspaces", "/api/v1/admin/system", "/api/v1/admin/audit", `/api/v1/admin/users/${plain.id}`]) {
      expect((await get(url)).statusCode, url).toBe(404);
      expect((await get(url, plain.cookies)).statusCode, url).toBe(404);
      expect((await get(url, boss.cookies)).statusCode, url).toBe(200);
    }
    expect((await send("PATCH", `/api/v1/admin/users/${boss.id}`, plain.cookies, { platformRole: "user" })).statusCode).toBe(404);
    expect((await get("/api/v1/auth/me", boss.cookies)).json().user.superAdmin).toBe(true);
    expect((await get("/api/v1/auth/me", plain.cookies)).json().user.superAdmin).toBe(false);
  });
});

describe("super admin console: data", () => {
  it("overview counts, user search with filters, user detail with workspaces", async () => {
    const boss = await register("Boss Two");
    await grant(boss.id);
    const target = await register("Searchable Person");
    const o = (await get("/api/v1/admin/overview", boss.cookies)).json();
    expect(o.users.total).toBeGreaterThanOrEqual(2);
    expect(o.users.superAdmins).toBeGreaterThanOrEqual(1);
    expect(o.users.signups7d).toBeGreaterThanOrEqual(2);
    expect(o.workspaces.total).toBeGreaterThanOrEqual(2);
    expect(o.workspaces.byPlan.find((p: { planId: string }) => p.planId === "free").count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(o.topStorage)).toBe(true);

    const found = (await get(`/api/v1/admin/users?q=${encodeURIComponent(target.email)}`, boss.cookies)).json();
    expect(found.total).toBe(1);
    expect(found.users[0]).toMatchObject({ id: target.id, status: "active", platformRole: "user", workspaces: 1, sessions: 1 });
    expect(found.users[0].lastSignInAt).toBeTruthy();
    // LIKE wildcards are literal: "%" alone matches only e-mails that contain a percent sign (none).
    expect((await get(`/api/v1/admin/users?q=${encodeURIComponent("%")}`, boss.cookies)).json().total).toBe(0);
    expect((await get(`/api/v1/admin/users?role=super_admin&q=${encodeURIComponent(boss.email)}`, boss.cookies)).json().total).toBe(1);

    const detail = (await get(`/api/v1/admin/users/${target.id}`, boss.cookies)).json();
    expect(detail.user.passwordHash).toBeUndefined();
    expect(detail.workspaces).toEqual([expect.objectContaining({ id: target.workspaceId, role: "owner", owner: true, planId: "free" })]);
    expect(detail.sessions.active).toBe(1);
    expect((await get(`/api/v1/admin/users/${crypto.randomUUID()}`, boss.cookies)).statusCode).toBe(404);
    expect((await get(`/api/v1/admin/users/not-a-uuid`, boss.cookies)).statusCode).toBe(400);
  });

  it("disable signs the account out everywhere and blocks sign-in; enable restores it; all audited", async () => {
    const boss = await register("Boss Three");
    await grant(boss.id);
    const target = await register("Spammer");
    await login(target.email); // second session
    const off = await send("PATCH", `/api/v1/admin/users/${target.id}`, boss.cookies, { status: "disabled" });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ changed: true, endedSessions: 2, user: { status: "disabled" } });
    expect((await get("/api/v1/auth/me", target.cookies)).json().user).toBeNull();
    expect((await login(target.email)).statusCode).toBe(401);
    // Same request again changes nothing and writes no audit row.
    expect((await send("PATCH", `/api/v1/admin/users/${target.id}`, boss.cookies, { status: "disabled" })).json().changed).toBe(false);
    // A disabled account cannot be made a super admin.
    expect((await send("PATCH", `/api/v1/admin/users/${target.id}`, boss.cookies, { platformRole: "super_admin" })).json().error).toBe("USER_DISABLED");

    expect((await send("PATCH", `/api/v1/admin/users/${target.id}`, boss.cookies, { status: "active" })).statusCode).toBe(200);
    expect((await login(target.email)).statusCode).toBe(200);
    expect((await send("PATCH", `/api/v1/admin/users/${target.id}`, boss.cookies, {})).statusCode).toBe(400);

    const log = (await get(`/api/v1/admin/users/${target.id}`, boss.cookies)).json().audit;
    expect(log.map((a: { action: string }) => a.action)).toEqual(["user.enable", "user.disable"]);
    expect(log[1]).toMatchObject({ actorEmail: boss.email, detail: { from: "active", to: "disabled", endedSessions: 2 } });
  });

  it("guard rails: not on yourself; super admin can be granted and revoked by another", async () => {
    const a = await register("Admin A");
    const b = await register("Admin B");
    await grant(a.id);
    expect((await send("PATCH", `/api/v1/admin/users/${a.id}`, a.cookies, { status: "disabled" })).json().error).toBe("NOT_ON_YOURSELF");
    expect((await send("PATCH", `/api/v1/admin/users/${a.id}`, a.cookies, { platformRole: "user" })).json().error).toBe("NOT_ON_YOURSELF");
    expect((await send("PATCH", `/api/v1/admin/users/${b.id}`, a.cookies, { platformRole: "super_admin" })).statusCode).toBe(200);
    expect((await get("/api/v1/admin/overview", b.cookies)).statusCode).toBe(200);
    // B removes A, and A loses the console on the very next request.
    expect((await send("PATCH", `/api/v1/admin/users/${a.id}`, b.cookies, { platformRole: "user" })).statusCode).toBe(200);
    expect((await get("/api/v1/admin/overview", a.cookies)).statusCode).toBe(404);
  });

  it("sign out everywhere ends the sessions but keeps your own current one", async () => {
    const boss = await register("Boss Four");
    await grant(boss.id);
    const target = await register("Lost Laptop");
    await login(target.email);
    expect((await send("POST", `/api/v1/admin/users/${target.id}/sign-out`, boss.cookies)).json().endedSessions).toBe(2);
    expect((await get("/api/v1/auth/me", target.cookies)).json().user).toBeNull();
    expect((await login(target.email)).statusCode).toBe(200); // password unchanged
    await login(boss.email); // boss: a second session elsewhere
    expect((await send("POST", `/api/v1/admin/users/${boss.id}/sign-out`, boss.cookies)).json().endedSessions).toBe(1);
    expect((await get("/api/v1/auth/me", boss.cookies)).json().user?.email).toBe(boss.email);
  });

  it("workspaces: search by owner, detail, plan change (validated, audited)", async () => {
    const boss = await register("Boss Five");
    await grant(boss.id);
    const owner = await register("Shop Owner");
    const list = (await get(`/api/v1/admin/workspaces?q=${encodeURIComponent(owner.email)}`, boss.cookies)).json();
    expect(list.total).toBe(1);
    expect(list.plans).toEqual(["free", "pro", "agency", "enterprise"]);
    expect(list.workspaces[0]).toMatchObject({ id: owner.workspaceId, planId: "free", members: 1, projects: 0, storageBytes: 0, owner: { email: owner.email } });
    await app.inject({ method: "POST", url: "/api/v1/projects", cookies: owner.cookies, payload: { workspaceId: owner.workspaceId, name: "Launch" } });
    const d = (await get(`/api/v1/admin/workspaces/${owner.workspaceId}`, boss.cookies)).json();
    expect(d.members).toEqual([expect.objectContaining({ email: owner.email, role: "owner" })]);
    expect(d.projects).toEqual([expect.objectContaining({ name: "Launch", status: "draft" })]);
    expect(d.usage).toEqual({ files: 0, bytes: 0, exports: 0, events7d: 0 });

    expect((await send("PATCH", `/api/v1/admin/workspaces/${owner.workspaceId}`, boss.cookies, { planId: "platinum" })).statusCode).toBe(400);
    const changed = await send("PATCH", `/api/v1/admin/workspaces/${owner.workspaceId}`, boss.cookies, { planId: "pro" });
    expect(changed.json()).toMatchObject({ changed: true, workspace: { planId: "pro" } });
    expect((await get("/api/v1/workspaces", owner.cookies)).json().workspaces[0].planId).toBe("pro");
    expect((await get(`/api/v1/admin/workspaces?plan=pro&q=${encodeURIComponent(owner.email)}`, boss.cookies)).json().total).toBe(1);
    const audit = (await get("/api/v1/admin/audit?targetType=workspace", boss.cookies)).json();
    expect(audit.entries.find((e: { targetId: string }) => e.targetId === owner.workspaceId)).toMatchObject({ action: "workspace.change_plan", actorEmail: boss.email, detail: { from: "free", to: "pro" } });
  });

  it("system: providers, queues and workers; retry needs the job queue", async () => {
    const boss = await register("Boss Six");
    await grant(boss.id);
    const s = (await get("/api/v1/admin/system", boss.cookies)).json();
    expect(s.mail).toMatchObject({ provider: "log", delivers: false });
    expect(s.storage.provider).toBe("local");
    expect(s.queues.map((q: { name: string }) => q.name)).toEqual(["media.process", "media.renditions", "media.frame", "export.render"]);
    expect(s.stuck).toEqual(expect.objectContaining({ exportsRendering: expect.any(Number), media: expect.any(Number) }));
    expect(s.server.dbBytes).toBeGreaterThan(0);
    expect(Array.isArray(s.workers)).toBe(true);
    if (!s.queueAvailable) {
      const r = await send("POST", `/api/v1/admin/jobs/${crypto.randomUUID()}/retry`, boss.cookies, { queue: "export.render" });
      expect(r.statusCode).toBe(503);
    }
    expect((await send("POST", `/api/v1/admin/jobs/${crypto.randomUUID()}/retry`, boss.cookies, { queue: "evil" })).statusCode).toBe(400);
  });
});

describe("super admin console: support tools", () => {
  it("sign in as: borrowed 1-hour session with a banner flag, no credential changes, audited, back to the admin", async () => {
    const boss = await register("Boss Seven");
    await grant(boss.id);
    const customer = await register("Help Me");
    const other = await register("Other Admin");
    await grant(other.id);
    expect((await send("POST", `/api/v1/admin/users/${other.id}/impersonate`, boss.cookies)).json().error).toBe("TARGET_IS_ADMIN");
    expect((await send("POST", `/api/v1/admin/users/${boss.id}/impersonate`, boss.cookies)).json().error).toBe("NOT_ON_YOURSELF");

    const start = await send("POST", `/api/v1/admin/users/${customer.id}/impersonate`, boss.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const as = { sf_session: start.cookies.find((c) => c.name === "sf_session")!.value, sf_impersonator: start.cookies.find((c) => c.name === "sf_impersonator")!.value };
    expect(as.sf_impersonator).toBe(boss.cookies.sf_session);
    expect(start.cookies.find((c) => c.name === "sf_session")!.maxAge).toBe(3600);
    const me = (await get("/api/v1/auth/me", as)).json().user;
    expect(me).toMatchObject({ id: customer.id, superAdmin: false, impersonatedBy: { id: boss.id, email: boss.email } });
    // Sees the customer's workspace, cannot touch credentials or the console.
    expect((await get("/api/v1/workspaces", as)).json().workspaces[0].id).toBe(customer.workspaceId);
    expect((await send("POST", "/api/v1/auth/password", as, { currentPassword: PASS, newPassword: "hijack-pass-1" })).json().error).toBe("IMPERSONATING");
    expect((await send("PATCH", "/api/v1/auth/me", as, { name: "Hacked" })).json().error).toBe("IMPERSONATING");
    expect((await get("/api/v1/admin/overview", as)).statusCode).toBe(404);
    // The customer's own last sign-in is not touched by the admin's visit.
    const before = (await get(`/api/v1/admin/users/${customer.id}`, boss.cookies)).json().user.lastSignInAt;

    const stop = await send("POST", "/api/v1/auth/impersonation/stop", as);
    expect(stop.json()).toEqual({ restored: true });
    expect(stop.cookies.find((c) => c.name === "sf_session")!.value).toBe(boss.cookies.sf_session);
    expect((await get("/api/v1/auth/me", as)).json().user).toBeNull(); // the borrowed session is gone
    expect((await get("/api/v1/auth/me", boss.cookies)).json().user.superAdmin).toBe(true);
    expect((await send("POST", "/api/v1/auth/impersonation/stop", boss.cookies)).json().error).toBe("NOT_IMPERSONATING");
    const d = (await get(`/api/v1/admin/users/${customer.id}`, boss.cookies)).json();
    expect(d.user.lastSignInAt).toBe(before);
    expect(d.audit.map((a: { action: string }) => a.action)).toEqual(["user.impersonate_stop", "user.impersonate_start"]);
  });

  it("send a reset link (never shown to the admin), CSV export without formula injection, sites list", async () => {
    const boss = await register("Boss Eight");
    await grant(boss.id);
    const target = await register("=cmd|' /C calc'!A0");
    const r = await send("POST", `/api/v1/admin/users/${target.id}/send-reset`, boss.cookies);
    expect(r.json()).toEqual({ ok: true, delivery: "log" });
    expect(r.body).not.toMatch(/reset\//);
    const csv = await get(`/api/v1/admin/users.csv?q=${encodeURIComponent(target.email)}`, boss.cookies);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers["content-disposition"]).toMatch(/attachment; filename="sceneflow-users-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = csv.body.replace(/^\ufeff/, "").trim().split("\r\n");
    expect(lines[0]).toBe("id,email,name,status,role,created_at,last_sign_in_at,workspaces");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=cmd|' /C calc'!A0"`);
    expect((await get("/api/v1/admin/users.csv", target.cookies)).statusCode).toBe(404);
    const audit = (await get("/api/v1/admin/audit?targetType=system", boss.cookies)).json().entries;
    expect(audit[0]).toMatchObject({ action: "users.export_csv", actorEmail: boss.email, detail: { rows: 1 } });

    const sites = (await get("/api/v1/admin/sites", boss.cookies)).json();
    expect(sites).toMatchObject({ page: 1, pageSize: 25 });
    expect(Array.isArray(sites.sites)).toBe(true);
    expect((await get("/api/v1/admin/sites", target.cookies)).statusCode).toBe(404);
    const sys = (await get("/api/v1/admin/system", boss.cookies)).json();
    expect(Array.isArray(sys.failedExports)).toBe(true);
  });
});
