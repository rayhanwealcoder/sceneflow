/*
 * Phase 16: temporary passwords and sign-in links from a super admin, e-mail address change, comment and
 * approval mails. Mail goes to a recording provider (behaves like Resend / SMTP).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMailer, createDb, loginLinks, users, type Mail } from "@sceneflow/server";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";
import { temporaryPassword } from "../src/lib/admin.js";

let app: FastifyInstance;
let storageDir: string;
let db: ReturnType<typeof createDb>;
const sent: Mail[] = [];
const mailer = buildMailer({ id: "resend", label: "Recorder", send: async (m) => { sent.push(m); return { id: `m${sent.length}` }; } }, "SceneFlow <test@localhost>", () => {});

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-support-"));
  app = await buildApp(testConfig(storageDir), { queue: { send: vi.fn(async () => "job") }, mailer });
  db = createDb(testConfig(storageDir).databaseUrl);
});
afterAll(async () => {
  await app.close();
  await db.close();
  await rm(storageDir, { recursive: true, force: true });
});

type Cookies = Record<string, string>;
const PASS = "support-pass-123";
const settle = () => new Promise((r) => setTimeout(r, 30));
const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }): Cookies => ({ sf_session: res.cookies.find((c) => c.name === "sf_session")!.value });
async function register(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${crypto.randomUUID().slice(0, 8)}@test.dev`;
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: PASS, name } });
  expect(res.statusCode).toBe(201);
  return { email, name, id: res.json().user.id as string, workspaceId: res.json().workspaceId as string, cookies: cookieOf(res) };
}
const login = (email: string, password = PASS) => app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
const get = (url: string, cookies?: Cookies) => app.inject({ method: "GET", url, cookies });
const send = (method: "PATCH" | "POST" | "PUT", url: string, cookies: Cookies | undefined, payload: object = {}) => app.inject({ method, url, cookies, payload });
const me = async (cookies: Cookies) => (await get("/api/v1/auth/me", cookies)).json().user;
const grant = (id: string) => db.db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, id));

describe("temporary password generator", () => {
  it("makes three groups of four readable characters, different every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = temporaryPassword();
      expect(p).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe("super admin: temporary password", () => {
  it("replaces the password, signs out everywhere, and the next sign-in must choose its own password first", async () => {
    const boss = await register("Boss Temp");
    await grant(boss.id);
    const user = await register("Locked Out");
    const otherAdmin = await register("Admin Two");
    await grant(otherAdmin.id);

    // Guard rails and access.
    expect((await send("POST", `/api/v1/admin/users/${boss.id}/temp-password`, boss.cookies)).json().error).toBe("NOT_ON_YOURSELF");
    expect((await send("POST", `/api/v1/admin/users/${otherAdmin.id}/temp-password`, boss.cookies)).json().error).toBe("TARGET_IS_ADMIN");
    expect((await send("POST", `/api/v1/admin/users/${boss.id}/temp-password`, user.cookies)).statusCode).toBe(404);

    sent.length = 0;
    const r = await send("POST", `/api/v1/admin/users/${user.id}/temp-password`, boss.cookies);
    expect(r.statusCode, r.body).toBe(200);
    const temp: string = r.json().password;
    expect(temp).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    expect(r.json().endedSessions).toBe(1);
    expect(await me(user.cookies)).toBeNull();
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[user.email, "Your SceneFlow password was changed"]]);
    expect(JSON.stringify(sent)).not.toContain(temp);

    // Old password is dead; the temporary one opens a restricted session.
    expect((await login(user.email)).statusCode).toBe(401);
    const tl = await login(user.email, temp);
    expect(tl.statusCode).toBe(200);
    expect(tl.json().passwordSetup).toBe(true);
    const setup = cookieOf(tl);
    expect(await me(setup)).toMatchObject({ id: user.id, passwordSetup: true, superAdmin: false });
    expect((await get("/api/v1/workspaces", setup)).statusCode).toBe(200);
    const blocked = await get(`/api/v1/projects?workspaceId=${user.workspaceId}`, setup);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe("PASSWORD_SETUP");
    expect((await send("PATCH", "/api/v1/auth/me", setup, { name: "x" })).json().error).toBe("PASSWORD_SETUP");

    // Must be a new password, set without the current one.
    expect((await send("POST", "/api/v1/auth/password", setup, { newPassword: temp })).json().error).toBe("SAME_PASSWORD");
    const set = await send("POST", "/api/v1/auth/password", setup, { newPassword: "my-own-pass-777" });
    expect(set.statusCode, set.body).toBe(200);
    expect(await me(setup)).toMatchObject({ passwordSetup: false });
    expect((await get(`/api/v1/projects?workspaceId=${user.workspaceId}`, setup)).statusCode).toBe(200);
    expect((await login(user.email, temp)).statusCode).toBe(401);
    const normal = await login(user.email, "my-own-pass-777");
    expect(normal.json().passwordSetup).toBe(false);
    // A normal session still needs the current password.
    expect((await send("POST", "/api/v1/auth/password", cookieOf(normal), { newPassword: "another-pass-888" })).json().error).toBe("WRONG_PASSWORD");

    const audit = (await get(`/api/v1/admin/users/${user.id}`, boss.cookies)).json().audit;
    expect(audit[0]).toMatchObject({ action: "user.set_temp_password", actorEmail: boss.email, detail: { endedSessions: 1 } });
    expect(JSON.stringify(audit)).not.toContain(temp);
  });
});

describe("super admin: sign-in link", () => {
  it("one-time link, peek without spending, password setup by default, older links retired, expiry", async () => {
    const boss = await register("Boss Link");
    await grant(boss.id);
    const user = await register("No Mailbox");
    expect((await send("POST", `/api/v1/admin/users/${user.id}/login-link`, boss.cookies, { hours: 5 })).statusCode).toBe(400);
    expect((await send("POST", `/api/v1/admin/users/${user.id}/login-link`, user.cookies, {})).statusCode).toBe(404);

    const first = (await send("POST", `/api/v1/admin/users/${user.id}/login-link`, boss.cookies, {})).json();
    expect(first.link).toMatch(/^http:\/\/localhost:3000\/sign-in-link\/[0-9a-f]{64}$/);
    expect(first.passwordSetup).toBe(true);
    expect(new Date(first.expiresAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    const second = (await send("POST", `/api/v1/admin/users/${user.id}/login-link`, boss.cookies, { hours: 1 })).json();
    const t1 = first.link.split("/").pop();
    const t2 = second.link.split("/").pop();
    // The first one was retired by the second.
    expect((await get(`/api/v1/auth/login-link/${t1}`)).json().error).toBe("LINK_INVALID");

    // Looking at the page spends nothing.
    const peek = await get(`/api/v1/auth/login-link/${t2}`);
    expect(peek.json()).toMatchObject({ email: "n•••@test.dev", name: "No Mailbox", passwordSetup: true });
    expect((await get(`/api/v1/auth/login-link/${t2}`)).statusCode).toBe(200);

    const use = await send("POST", "/api/v1/auth/login-link", undefined, { token: t2 });
    expect(use.statusCode, use.body).toBe(200);
    expect(use.json().passwordSetup).toBe(true);
    const s = cookieOf(use);
    expect(await me(s)).toMatchObject({ id: user.id, passwordSetup: true });
    expect((await send("POST", "/api/v1/auth/login-link", undefined, { token: t2 })).json().error).toBe("LINK_USED");
    expect((await send("POST", "/api/v1/auth/password", s, { newPassword: "fresh-pass-999" })).statusCode).toBe(200);
    expect((await login(user.email, "fresh-pass-999")).statusCode).toBe(200);

    // Plain sign-in link (no new password), and an expired one.
    const plain = (await send("POST", `/api/v1/admin/users/${user.id}/login-link`, boss.cookies, { hours: 168, passwordSetup: false })).json();
    const ps = cookieOf(await send("POST", "/api/v1/auth/login-link", undefined, { token: plain.link.split("/").pop() }));
    expect(await me(ps)).toMatchObject({ id: user.id, passwordSetup: false });
    expect((await get(`/api/v1/projects?workspaceId=${user.workspaceId}`, ps)).statusCode).toBe(200);
    const old = (await send("POST", `/api/v1/admin/users/${user.id}/login-link`, boss.cookies, { hours: 1 })).json();
    await db.db.update(loginLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginLinks.userId, user.id));
    expect((await send("POST", "/api/v1/auth/login-link", undefined, { token: old.link.split("/").pop() })).json().error).toBe("LINK_EXPIRED");
    expect((await send("POST", "/api/v1/auth/login-link", undefined, { token: "nope" })).statusCode).toBe(400);

    const actions = (await get(`/api/v1/admin/users/${user.id}`, boss.cookies)).json().audit.map((a: { action: string }) => a.action);
    expect(actions.filter((a: string) => a === "user.create_login_link")).toHaveLength(4);
    expect(actions.filter((a: string) => a === "user.login_link_used")).toHaveLength(2);
  });
});

describe("change e-mail address", () => {
  it("needs the password, confirms on the new address, tells the old one, then signs in with the new address", async () => {
    const u = await register("Mover");
    const taken = await register("Taken");
    const newEmail = `moved-${crypto.randomUUID().slice(0, 8)}@test.dev`;
    expect((await send("POST", "/api/v1/auth/email", u.cookies, { newEmail, currentPassword: "wrong" })).json().error).toBe("WRONG_PASSWORD");
    expect((await send("POST", "/api/v1/auth/email", u.cookies, { newEmail: taken.email, currentPassword: PASS })).json().error).toBe("EMAIL_TAKEN");
    expect((await send("POST", "/api/v1/auth/email", u.cookies, { newEmail: u.email, currentPassword: PASS })).json().error).toBe("SAME_EMAIL");

    sent.length = 0;
    const r = await send("POST", "/api/v1/auth/email", u.cookies, { newEmail: newEmail.toUpperCase(), currentPassword: PASS });
    expect(r.json()).toEqual({ ok: true, delivery: "email" });
    await settle();
    expect(sent.map((m) => m.to).sort()).toEqual([newEmail, u.email].sort());
    const confirm = sent.find((m) => m.to === newEmail)!;
    expect(confirm.subject).toBe("Confirm your new SceneFlow e-mail address");
    expect(sent.find((m) => m.to === u.email)!.subject).toBe("Your SceneFlow e-mail address is about to change");
    const token = confirm.text.match(/\/confirm-email\/([0-9a-f]{64})/)![1];
    // Nothing changed yet.
    expect((await me(u.cookies)).email).toBe(u.email);
    expect((await get(`/api/v1/auth/email/${token}`)).json()).toEqual({ newEmail });

    sent.length = 0;
    const done = await send("POST", "/api/v1/auth/email/confirm", undefined, { token });
    expect(done.json()).toEqual({ ok: true, email: newEmail });
    expect((await me(u.cookies)).email).toBe(newEmail);
    expect((await login(newEmail)).statusCode).toBe(200);
    expect((await login(u.email)).statusCode).toBe(401);
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[u.email, "Your SceneFlow e-mail address was changed"]]);
    expect((await send("POST", "/api/v1/auth/email/confirm", undefined, { token })).json().error).toBe("LINK_USED");
  });
});

describe("comment and approval mails", () => {
  it("mentions and replies mail the people concerned (not the author), approvals mail approvers and the requester, the switch stops them", async () => {
    const owner = await register("Olivia Owner");
    const editor = await register("Ed Editor");
    const inv = (await send("POST", `/api/v1/workspaces/${owner.workspaceId}/invites`, owner.cookies, { role: "editor" })).json();
    await send("POST", `/api/v1/invites/${inv.url.split("/").pop()}/accept`, editor.cookies);
    const { project } = (await send("POST", "/api/v1/projects", owner.cookies, { workspaceId: owner.workspaceId, name: "Launch film" })).json();
    await send("PUT", `/api/v1/projects/${project.id}/draft`, owner.cookies, { config: { scenes: [{ id: "s1", name: "Intro", start: 0, end: 4, background: { type: "color", color: "#000" }, layers: [] }] } });

    sent.length = 0;
    const c1 = await send("POST", `/api/v1/projects/${project.id}/comments`, editor.cookies, { body: "@Olivia the logo is too small" });
    expect(c1.statusCode, c1.body).toBe(201);
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[owner.email, 'Ed Editor mentioned you in "Launch film"']]);
    expect(sent[0]!.text).toContain("the logo is too small");
    expect(sent[0]!.text).toContain(`http://localhost:3000/projects/${project.id}`);

    sent.length = 0;
    await send("POST", `/api/v1/projects/${project.id}/comments`, owner.cookies, { body: "Fixed, have a look", parentId: c1.json().comment.id });
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[editor.email, 'Olivia Owner replied to your comment on "Launch film"']]);

    sent.length = 0;
    const review = await send("POST", `/api/v1/projects/${project.id}/review`, editor.cookies, { action: "request_internal", note: "Ready" });
    expect(review.statusCode, review.body).toBe(200);
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[owner.email, 'Ed Editor asks you to approve "Launch film"']]);

    sent.length = 0;
    await send("POST", `/api/v1/projects/${project.id}/review`, owner.cookies, { action: "approve" });
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([[editor.email, 'Olivia Owner approved "Launch film"']]);

    // The editor turns the mails off: nothing more for them, password mails would still come.
    expect((await send("PATCH", "/api/v1/auth/me", editor.cookies, { emailNotifications: false })).statusCode).toBe(200);
    expect(await me(editor.cookies)).toMatchObject({ emailNotifications: false });
    sent.length = 0;
    await send("POST", `/api/v1/projects/${project.id}/review`, owner.cookies, { action: "request_changes", note: "@Ed bigger logo please" });
    await settle();
    expect(sent).toEqual([]);
  });
});
