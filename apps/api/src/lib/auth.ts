import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sessions, users, workspaceMembers, WORKSPACE_ROLES, type WorkspaceRole } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";

const scrypt = promisify(scryptCb);
export const SESSION_COOKIE = "sf_session";
/** While a super admin is signed in as someone else: their own session token, to return to. */
export const IMPERSONATOR_COOKIE = "sf_impersonator";
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** sha256 hex of a secret token (session cookie, reset link) — what the tables store. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const cookieOptions = (ctx: Ctx, maxAgeMs: number) => ({ path: "/", httpOnly: true, sameSite: "lax" as const, secure: ctx.cfg.secureCookies, maxAge: Math.round(maxAgeMs / 1000) });

/**
 * New session + cookie. `impersonatorId`: a super admin's "Sign in as" session (short-lived, does not count
 * as the user's own sign-in).
 */
export async function startSession(ctx: Ctx, reply: FastifyReply, userId: string, opts: { impersonatorId?: string } = {}): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const ttl = opts.impersonatorId ? IMPERSONATION_TTL_MS : SESSION_TTL_MS;
  await ctx.db.insert(sessions).values({ id: hashToken(token), userId, expiresAt: new Date(Date.now() + ttl), impersonatorId: opts.impersonatorId ?? null });
  if (!opts.impersonatorId) await ctx.db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, userId));
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(ctx, ttl));
}

export async function endSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await ctx.db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  reply.clearCookie(IMPERSONATOR_COOKIE, { path: "/" });
}

/**
 * `superAdmin`: platform role, read from the database on every request (never from the cookie).
 * `impersonatedBy`: set when a super admin is signed in as this user (the app shows a banner).
 */
export type AuthUser = { id: string; email: string; name: string; superAdmin: boolean; impersonatedBy?: { id: string; email: string; name: string } | null };

const impersonator = alias(users, "impersonator");

export async function getUser(ctx: Ctx, req: FastifyRequest): Promise<AuthUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const rows = await ctx.db
    .select({ id: users.id, email: users.email, name: users.name, status: users.status, platformRole: users.platformRole, impId: impersonator.id, impEmail: impersonator.email, impName: impersonator.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(impersonator, eq(impersonator.id, sessions.impersonatorId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0];
  if (!u || u.status !== "active") return null;
  const impersonatedBy = u.impId && u.impEmail && u.impName ? { id: u.impId, email: u.impEmail, name: u.impName } : null;
  // Inside a "Sign in as" session nobody is a super admin (the target never is; see admin.ts).
  return { id: u.id, email: u.email, name: u.name, superAdmin: !impersonatedBy && u.platformRole === "super_admin", impersonatedBy };
}

export async function requireUser(ctx: Ctx, req: FastifyRequest): Promise<AuthUser> {
  const user = await getUser(ctx, req);
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
  return user;
}

/** Admin routes answer 404 to everyone else, so the console is not advertised. */
export async function requireSuperAdmin(ctx: Ctx, req: FastifyRequest): Promise<AuthUser> {
  const user = await getUser(ctx, req);
  if (!user?.superAdmin) throw new HttpError(404, "NOT_FOUND", "Not found");
  return user;
}

export function roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return WORKSPACE_ROLES.indexOf(role) >= WORKSPACE_ROLES.indexOf(min);
}

/** Throws 403 unless the user is a member of the workspace with at least `min` role. */
export async function requireMember(ctx: Ctx, userId: string, workspaceId: string, min: WorkspaceRole = "viewer"): Promise<WorkspaceRole> {
  const [m] = await ctx.db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!m || !roleAtLeast(m.role, min)) throw new HttpError(403, "FORBIDDEN", "You do not have access to this workspace");
  return m.role;
}
