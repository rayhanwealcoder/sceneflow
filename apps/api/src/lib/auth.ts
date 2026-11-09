import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sessions, users, workspaceMembers, WORKSPACE_ROLES, type WorkspaceRole } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";

const scrypt = promisify(scryptCb);
export const SESSION_COOKIE = "sf_session";
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

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(ctx: Ctx, reply: FastifyReply, userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await ctx.db.insert(sessions).values({ id: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.cfg.secureCookies,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await ctx.db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export type AuthUser = { id: string; email: string; name: string };

export async function getUser(ctx: Ctx, req: FastifyRequest): Promise<AuthUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const rows = await ctx.db
    .select({ id: users.id, email: users.email, name: users.name, status: users.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0];
  return u && u.status === "active" ? { id: u.id, email: u.email, name: u.name } : null;
}

export async function requireUser(ctx: Ctx, req: FastifyRequest): Promise<AuthUser> {
  const user = await getUser(ctx, req);
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");
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
