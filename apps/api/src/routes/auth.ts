import { and, eq, gt, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { adminAudit, passwordChangedMail, passwordResets, sessions, users, workspaceMembers, workspaces } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { cookieOptions, endSession, getUser, hashPassword, hashToken, IMPERSONATOR_COOKIE, requireUser, SESSION_COOKIE, startSession, verifyPassword, type AuthUser } from "../lib/auth.js";
import { LoginGuard, minutesLeft } from "../lib/loginGuard.js";
import { issuePasswordReset } from "../lib/reset.js";
import { parseBody } from "../lib/validate.js";

const email = z.string().email().max(254).transform((v) => v.trim().toLowerCase());
const password = z.string().min(8).max(128);
const name = z.string().trim().min(1).max(80);
const registerSchema = z.object({ email, password, name });
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const forgotSchema = z.object({ email });
const TOKEN_RE = /^[0-9a-f]{64}$/;
const resetSchema = z.object({ token: z.string().regex(TOKEN_RE), password });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
const profileSchema = z.object({ name });
const authLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
/** Requests are limited harder than sign-in: each one may send a mail. */
const forgotLimit = { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } };

/** `r\u2022\u2022\u2022@example.com`: enough to recognise your own account on the reset page, not enough to learn the address. */
export function maskEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}\u2022\u2022\u2022@${domain}`;
}

/** "Sign in as" sessions may look around and help, but never change the account's credentials or profile. */
function refuseWhileImpersonating(user: AuthUser): void {
  if (user.impersonatedBy) throw new HttpError(403, "IMPERSONATING", "Not available while signed in as another user. Return to your admin account first.");
}

type ResetRow = { id: string; userId: string; expiresAt: Date; usedAt: Date | null; email: string; name: string };

/** The reset row behind a link, or the 404 / 410 the page should show. */
async function loadReset(ctx: Ctx, token: string): Promise<ResetRow> {
  const invalid = () => new HttpError(404, "RESET_INVALID", "This link is not valid. Request a new one.");
  if (!TOKEN_RE.test(token)) throw invalid();
  const [row] = await ctx.db
    .select({ id: passwordResets.id, userId: passwordResets.userId, expiresAt: passwordResets.expiresAt, usedAt: passwordResets.usedAt, email: users.email, name: users.name, status: users.status })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(eq(passwordResets.id, hashToken(token)))
    .limit(1);
  if (!row || row.status !== "active") throw invalid();
  if (row.usedAt) throw new HttpError(410, "RESET_USED", "This link was already used. Request a new one if you still need it.");
  if (row.expiresAt.getTime() < Date.now()) throw new HttpError(410, "RESET_EXPIRED", "This link has expired. Request a new one.");
  return row;
}

export async function authRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  // Brute-force protection (see lib/loginGuard.ts): 5 failures per account, 30 per client address.
  const accountGuard = new LoginGuard({ max: 5 });
  const addressGuard = new LoginGuard({ max: 30 });
  // Unknown emails cost the same scrypt work as wrong passwords, so timing does not reveal who has an account.
  const dummyHash = await hashPassword("not-a-real-password");
  const brand = { webOrigin: ctx.cfg.webOrigin };

  app.post("/api/v1/auth/register", authLimit, async (req, reply) => {
    const body = parseBody(registerSchema, req.body);
    const existing = await ctx.db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (existing) throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists");
    const passwordHash = await hashPassword(body.password);
    const user = await ctx.db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email: body.email, name: body.name, passwordHash }).returning();
      if (!u) throw new Error("insert user failed");
      const [ws] = await tx.insert(workspaces).values({ ownerId: u.id, name: `${body.name}'s workspace`, type: "personal" }).returning();
      if (!ws) throw new Error("insert workspace failed");
      await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role: "owner" });
      return { id: u.id, email: u.email, name: u.name, workspaceId: ws.id };
    });
    await startSession(ctx, reply, user.id);
    return reply.code(201).send({ user: { id: user.id, email: user.email, name: user.name }, workspaceId: user.workspaceId });
  });

  app.post("/api/v1/auth/login", authLimit, async (req, reply) => {
    const body = parseBody(loginSchema, req.body);
    const accountKey = `acct:${body.email}`;
    const addressKey = `ip:${req.ip}`;
    const wait = Math.max(accountGuard.retryAfter(accountKey), addressGuard.retryAfter(addressKey));
    if (wait > 0) {
      reply.header("retry-after", String(Math.ceil(wait / 1000)));
      throw new HttpError(429, "TOO_MANY_ATTEMPTS", `Too many sign-in attempts. Try again in ${minutesLeft(wait)} minute${minutesLeft(wait) === 1 ? "" : "s"}.`);
    }
    const user = await ctx.db.query.users.findFirst({ where: eq(users.email, body.email) });
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : (await verifyPassword(body.password, dummyHash), false);
    if (!user || !ok || user.status !== "active") {
      accountGuard.fail(accountKey);
      addressGuard.fail(addressKey);
      throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    accountGuard.succeed(accountKey);
    await startSession(ctx, reply, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    await endSession(ctx, req, reply);
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (req) => {
    const user = await getUser(ctx, req);
    return { user };
  });

  /** Rename yourself. */
  app.patch("/api/v1/auth/me", authLimit, async (req) => {
    const user = await requireUser(ctx, req);
    refuseWhileImpersonating(user);
    const body = parseBody(profileSchema, req.body);
    await ctx.db.update(users).set({ name: body.name }).where(eq(users.id, user.id));
    return { user: { ...user, name: body.name } };
  });

  /**
   * Forgot password: always answers the same way, whether or not the address has an account (no enumeration),
   * and never waits for the mail server (the mail goes out after the response). A new request replaces any
   * earlier unused link. `delivery` tells the page whether a mail actually left or the link only went to the
   * server's log / outbox folder (self-hosted without MAIL_* settings).
   */
  app.post("/api/v1/auth/forgot", forgotLimit, async (req) => {
    const body = parseBody(forgotSchema, req.body);
    const user = await ctx.db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (user && user.status === "active") await issuePasswordReset(ctx, user);
    return { ok: true, delivery: ctx.mailer.delivers ? "email" : "log" };
  });

  /** What the reset page shows before the form: whose account this is (masked), or why the link is dead. */
  app.get<{ Params: { token: string } }>("/api/v1/auth/reset/:token", authLimit, async (req) => {
    const row = await loadReset(ctx, req.params.token);
    return { email: maskEmail(row.email) };
  });

  /** Sets the new password, signs the user out everywhere else and in here, and tells them by mail. */
  app.post("/api/v1/auth/reset", authLimit, async (req, reply) => {
    const body = parseBody(resetSchema, req.body);
    const row = await loadReset(ctx, body.token);
    const passwordHash = await hashPassword(body.password);
    await ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id));
      await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    });
    // Whoever holds the mailbox owns the account: lift a brute-force lock their attacker may have caused.
    accountGuard.succeed(`acct:${row.email}`);
    await startSession(ctx, reply, row.userId);
    ctx.mailer.sendLater({ to: row.email, ...passwordChangedMail(brand, { name: row.name, resetLink: `${ctx.cfg.webOrigin}/forgot` }) });
    return { user: { id: row.userId, email: row.email, name: row.name } };
  });

  /** Change the password while signed in; every other device is signed out, this one stays. */
  app.post("/api/v1/auth/password", authLimit, async (req) => {
    const user = await requireUser(ctx, req);
    refuseWhileImpersonating(user);
    const body = parseBody(changePasswordSchema, req.body);
    const row = await ctx.db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!row || !(await verifyPassword(body.currentPassword, row.passwordHash))) throw new HttpError(400, "WRONG_PASSWORD", "Your current password is not correct");
    const passwordHash = await hashPassword(body.newPassword);
    const current = hashToken(req.cookies[SESSION_COOKIE] ?? "");
    await ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, current)));
    });
    ctx.mailer.sendLater({ to: user.email, ...passwordChangedMail(brand, { name: user.name, resetLink: `${ctx.cfg.webOrigin}/forgot` }) });
    return { ok: true };
  });

  /**
   * Ends a super admin's "Sign in as": the borrowed session is deleted and the admin's own session (kept in
   * the IMPERSONATOR_COOKIE) is put back when it is still valid and still theirs.
   */
  app.post("/api/v1/auth/impersonation/stop", authLimit, async (req, reply) => {
    const user = await requireUser(ctx, req);
    if (!user.impersonatedBy) throw new HttpError(400, "NOT_IMPERSONATING", "You are not signed in as another user");
    await ctx.db.delete(sessions).where(eq(sessions.id, hashToken(req.cookies[SESSION_COOKIE] ?? "")));
    const back = req.cookies[IMPERSONATOR_COOKIE] ?? "";
    const [own] = back
      ? await ctx.db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(and(eq(sessions.id, hashToken(back)), eq(sessions.userId, user.impersonatedBy.id), gt(sessions.expiresAt, new Date()))).limit(1)
      : [];
    reply.clearCookie(IMPERSONATOR_COOKIE, { path: "/" });
    if (own) reply.setCookie(SESSION_COOKIE, back, cookieOptions(ctx, own.expiresAt.getTime() - Date.now()));
    else reply.clearCookie(SESSION_COOKIE, { path: "/" });
    await ctx.db.insert(adminAudit).values({ actorId: user.impersonatedBy.id, actorEmail: user.impersonatedBy.email, action: "user.impersonate_stop", targetType: "user", targetId: user.id, targetLabel: user.email, ip: req.ip ?? null });
    return { restored: Boolean(own) };
  });

  app.get("/api/v1/workspaces", async (req) => {
    const user = await requireUser(ctx, req);
    const rows = await ctx.db
      .select({ id: workspaces.id, name: workspaces.name, type: workspaces.type, planId: workspaces.planId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id));
    return { workspaces: rows };
  });
}
