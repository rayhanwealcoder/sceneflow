import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { users, workspaceMembers, workspaces } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { endSession, getUser, hashPassword, requireUser, startSession, verifyPassword } from "../lib/auth.js";
import { LoginGuard, minutesLeft } from "../lib/loginGuard.js";
import { parseBody } from "../lib/validate.js";

const email = z.string().email().max(254).transform((v) => v.trim().toLowerCase());
const registerSchema = z.object({ email, password: z.string().min(8).max(128), name: z.string().trim().min(1).max(80) });
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const authLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  // Brute-force protection (see lib/loginGuard.ts): 5 failures per account, 30 per client address.
  const accountGuard = new LoginGuard({ max: 5 });
  const addressGuard = new LoginGuard({ max: 30 });
  // Unknown emails cost the same scrypt work as wrong passwords, so timing does not reveal who has an account.
  const dummyHash = await hashPassword("not-a-real-password");

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
