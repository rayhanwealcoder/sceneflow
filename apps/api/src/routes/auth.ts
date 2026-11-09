import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { users, workspaceMembers, workspaces } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { endSession, getUser, hashPassword, requireUser, startSession, verifyPassword } from "../lib/auth.js";
import { parseBody } from "../lib/validate.js";

const email = z.string().email().max(254).transform((v) => v.trim().toLowerCase());
const registerSchema = z.object({ email, password: z.string().min(8).max(128), name: z.string().trim().min(1).max(80) });
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const authLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
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
    const user = await ctx.db.query.users.findFirst({ where: eq(users.email, body.email) });
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok || user.status !== "active") throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
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
