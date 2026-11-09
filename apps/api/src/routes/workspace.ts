import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { analyticsEvents, brandKits, clients, comments, projectActivity, projects, sites, users, WORKSPACE_ROLES, workspaceInvites, workspaceMembers, workspaces, type WorkspaceRole } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser, roleAtLeast } from "../lib/auth.js";
import { hashToken, newToken, toProjectDto } from "../lib/review.js";
import { assertUuid, parseBody } from "../lib/validate.js";

/*
 * Agency workflow (doc §23 / Phase 10): team members + roles, invitation links, clients, the portfolio
 * dashboard with alerts and the activity feed. Clients never need an account — they get a review link
 * (see routes/review.ts); this file is about the agency's own people and bookkeeping.
 */

const INVITE_DAYS = 7;
const nameSchema = z.string().trim().min(1).max(120);
const clientSchema = z.object({
  name: nameSchema,
  contactName: z.string().trim().max(120).nullable().optional(),
  contactEmail: z.string().trim().email().max(254).nullable().optional().or(z.literal("").transform(() => null)),
  notes: z.string().trim().max(2000).nullable().optional(),
  brandKitId: z.string().uuid().nullable().optional(),
});
const inviteSchema = z.object({ role: z.enum(["viewer", "editor", "admin"]).default("editor"), email: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)) });
const memberPatchSchema = z.object({ role: z.enum(["viewer", "editor", "admin"]) });
const publicLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

export interface DashboardAlert {
  kind: "site_error" | "waiting_client" | "approved_unpublished" | "changes_requested" | "player_errors" | "stale_draft";
  severity: "warn" | "fail" | "info";
  projectId?: string;
  title: string;
  detail?: string;
  href: string;
}

export async function workspaceRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  /* ---------- workspace + members ---------- */

  app.get<{ Params: { id: string } }>("/api/v1/workspaces/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    const role = await requireMember(ctx, user.id, id);
    const ws = await ctx.db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
    if (!ws) throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
    const members = await ctx.db
      .select({ userId: users.id, name: users.name, email: users.email, role: workspaceMembers.role, joinedAt: workspaceMembers.createdAt })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, id))
      .orderBy(workspaceMembers.createdAt);
    return { workspace: { id: ws.id, name: ws.name, type: ws.type, planId: ws.planId, ownerId: ws.ownerId }, role, members };
  });

  app.patch<{ Params: { id: string } }>("/api/v1/workspaces/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    await requireMember(ctx, user.id, id, "admin");
    const body = parseBody(z.object({ name: nameSchema }), req.body);
    const [ws] = await ctx.db.update(workspaces).set({ name: body.name }).where(eq(workspaces.id, id)).returning();
    return { workspace: ws };
  });

  /** Roles: owner is fixed; admins manage viewer / editor / admin; nobody edits their own role here. */
  app.patch<{ Params: { id: string; userId: string } }>("/api/v1/workspaces/:id/members/:userId", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    const target = assertUuid(req.params.userId, "user id");
    await requireMember(ctx, user.id, id, "admin");
    const body = parseBody(memberPatchSchema, req.body);
    if (target === user.id) throw new HttpError(400, "OWN_ROLE", "Ask another admin to change your role");
    const [m] = await ctx.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, target)));
    if (!m) throw new HttpError(404, "MEMBER_NOT_FOUND", "That person is not in this workspace");
    if (m.role === "owner") throw new HttpError(400, "OWNER_FIXED", "The owner's role cannot be changed");
    await ctx.db.update(workspaceMembers).set({ role: body.role }).where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, target)));
    return { ok: true, role: body.role };
  });

  /** Remove a member (admin), or leave yourself (anyone but the owner). */
  app.delete<{ Params: { id: string; userId: string } }>("/api/v1/workspaces/:id/members/:userId", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    const target = assertUuid(req.params.userId, "user id");
    const role = await requireMember(ctx, user.id, id);
    if (target !== user.id && !roleAtLeast(role, "admin")) throw new HttpError(403, "FORBIDDEN", "Only admins can remove members");
    const [m] = await ctx.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, target)));
    if (!m) throw new HttpError(404, "MEMBER_NOT_FOUND", "That person is not in this workspace");
    if (m.role === "owner") throw new HttpError(400, "OWNER_FIXED", "The owner cannot be removed");
    await ctx.db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, target)));
    return { ok: true };
  });

  /* ---------- invitation links ---------- */

  app.get<{ Params: { id: string } }>("/api/v1/workspaces/:id/invites", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    await requireMember(ctx, user.id, id, "admin");
    const rows = await ctx.db
      .select({ id: workspaceInvites.id, role: workspaceInvites.role, email: workspaceInvites.email, expiresAt: workspaceInvites.expiresAt, createdAt: workspaceInvites.createdAt })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.workspaceId, id), isNull(workspaceInvites.acceptedAt), gt(workspaceInvites.expiresAt, new Date())))
      .orderBy(desc(workspaceInvites.createdAt));
    return { invites: rows };
  });

  /** Creates a link the admin copies to a colleague. The token is shown once; only its hash is stored. */
  app.post<{ Params: { id: string } }>("/api/v1/workspaces/:id/invites", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    await requireMember(ctx, user.id, id, "admin");
    const body = parseBody(inviteSchema, req.body ?? {});
    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000);
    const [invite] = await ctx.db
      .insert(workspaceInvites)
      .values({ workspaceId: id, tokenHash: hashToken(token), role: body.role, email: body.email?.toLowerCase() ?? null, invitedBy: user.id, expiresAt })
      .returning({ id: workspaceInvites.id, role: workspaceInvites.role, email: workspaceInvites.email, expiresAt: workspaceInvites.expiresAt, createdAt: workspaceInvites.createdAt });
    // A workspace with invites is a team.
    await ctx.db.update(workspaces).set({ type: "team" }).where(and(eq(workspaces.id, id), eq(workspaces.type, "personal")));
    return reply.code(201).send({ invite, url: `${ctx.cfg.webOrigin}/join/${token}` });
  });

  app.delete<{ Params: { id: string; inviteId: string } }>("/api/v1/workspaces/:id/invites/:inviteId", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    const inviteId = assertUuid(req.params.inviteId, "invite id");
    await requireMember(ctx, user.id, id, "admin");
    await ctx.db.delete(workspaceInvites).where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, id)));
    return { ok: true };
  });

  /** Public: what the link is for, so the join page can say "Mia invited you to Studio as editor". */
  app.get<{ Params: { token: string } }>("/api/v1/invites/:token", publicLimit, async (req) => {
    const invite = await loadInvite(ctx, req.params.token);
    const ws = await ctx.db.query.workspaces.findFirst({ where: eq(workspaces.id, invite.workspaceId) });
    const inviter = invite.invitedBy ? await ctx.db.query.users.findFirst({ where: eq(users.id, invite.invitedBy) }) : null;
    return { workspaceName: ws?.name ?? "a workspace", role: invite.role, email: invite.email, invitedBy: inviter?.name ?? null, expiresAt: invite.expiresAt };
  });

  app.post<{ Params: { token: string } }>("/api/v1/invites/:token/accept", publicLimit, async (req) => {
    const user = await requireUser(ctx, req);
    const invite = await loadInvite(ctx, req.params.token);
    if (invite.email && invite.email !== user.email.toLowerCase()) throw new HttpError(403, "INVITE_EMAIL_MISMATCH", `This invitation is for ${invite.email}. Sign in with that account.`);
    const existing = await ctx.db.query.workspaceMembers.findFirst({ where: and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, user.id)) });
    await ctx.db.transaction(async (tx) => {
      if (!existing) await tx.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role });
      else if (roleAtLeast(invite.role, existing.role) && existing.role !== "owner") await tx.update(workspaceMembers).set({ role: invite.role }).where(and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, user.id)));
      await tx.update(workspaceInvites).set({ acceptedAt: new Date(), acceptedBy: user.id }).where(eq(workspaceInvites.id, invite.id));
    });
    return { workspaceId: invite.workspaceId, role: existing && !roleAtLeast(invite.role, existing.role) ? existing.role : invite.role };
  });

  /* ---------- clients ---------- */

  app.get<{ Querystring: { workspaceId?: string } }>("/api/v1/clients", async (req) => {
    const user = await requireUser(ctx, req);
    const workspaceId = assertUuid(req.query.workspaceId ?? "", "workspaceId");
    await requireMember(ctx, user.id, workspaceId);
    const rows = await ctx.db
      .select({
        id: clients.id,
        workspaceId: clients.workspaceId,
        name: clients.name,
        contactName: clients.contactName,
        contactEmail: clients.contactEmail,
        notes: clients.notes,
        brandKitId: clients.brandKitId,
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
        projectCount: sql<number>`count(${projects.id})`.mapWith(Number),
      })
      .from(clients)
      .leftJoin(projects, eq(projects.clientId, clients.id))
      .where(eq(clients.workspaceId, workspaceId))
      .groupBy(clients.id)
      .orderBy(clients.name);
    return { clients: rows };
  });

  app.post("/api/v1/clients", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(clientSchema.extend({ workspaceId: z.string().uuid() }), req.body);
    await requireMember(ctx, user.id, body.workspaceId, "editor");
    if (body.brandKitId) await assertKitInWorkspace(ctx, body.brandKitId, body.workspaceId);
    const [client] = await ctx.db.insert(clients).values({ ...body, contactEmail: body.contactEmail ?? null }).returning();
    return reply.code(201).send({ client: { ...client, projectCount: 0 } });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/clients/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "client id");
    const client = await ctx.db.query.clients.findFirst({ where: eq(clients.id, id) });
    if (!client) throw new HttpError(404, "CLIENT_NOT_FOUND", "Client not found");
    await requireMember(ctx, user.id, client.workspaceId, "editor");
    const body = parseBody(clientSchema.partial(), req.body);
    if (body.brandKitId) await assertKitInWorkspace(ctx, body.brandKitId, client.workspaceId);
    const [updated] = await ctx.db.update(clients).set({ ...body, updatedAt: new Date() }).where(eq(clients.id, id)).returning();
    return { client: updated };
  });

  /** Deleting a client keeps its projects (they become unassigned). */
  app.delete<{ Params: { id: string } }>("/api/v1/clients/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "client id");
    const client = await ctx.db.query.clients.findFirst({ where: eq(clients.id, id) });
    if (!client) throw new HttpError(404, "CLIENT_NOT_FOUND", "Client not found");
    await requireMember(ctx, user.id, client.workspaceId, "admin");
    await ctx.db.delete(clients).where(eq(clients.id, id));
    return { ok: true };
  });

  /* ---------- dashboard + activity ---------- */

  app.get<{ Params: { id: string } }>("/api/v1/workspaces/:id/activity", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    await requireMember(ctx, user.id, id);
    return { activity: await recentActivity(ctx, id, 50) };
  });

  /** Portfolio view (doc §23): every project with client, site health, review state, 7-day numbers; alerts; feed; your mentions. */
  app.get<{ Params: { id: string } }>("/api/v1/workspaces/:id/dashboard", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    await requireMember(ctx, user.id, id);
    const now = Date.now();
    const since = new Date(now - 7 * 86400_000);

    const [clientRows, projectRows, siteRows] = await Promise.all([
      ctx.db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.workspaceId, id)).orderBy(clients.name),
      ctx.db.select().from(projects).where(eq(projects.workspaceId, id)).orderBy(desc(projects.updatedAt)),
      ctx.db.select({ id: sites.id, name: sites.name, url: sites.url, connectionStatus: sites.connectionStatus, lastError: sites.lastError, lastSeenAt: sites.lastSeenAt }).from(sites).where(eq(sites.workspaceId, id)),
    ]);
    const projectIds = projectRows.map((p) => p.id);
    const [openComments, stats, mentions] = projectIds.length
      ? await Promise.all([
          ctx.db
            .select({ projectId: comments.projectId, open: sql<number>`count(*) filter (where ${comments.resolvedAt} is null)`.mapWith(Number), total: sql<number>`count(*)`.mapWith(Number) })
            .from(comments)
            .where(inArray(comments.projectId, projectIds))
            .groupBy(comments.projectId),
          ctx.db
            .select({
              projectId: analyticsEvents.projectId,
              loads: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'player_loaded')`.mapWith(Number),
              plays: sql<number>`count(distinct ${analyticsEvents.sessionId}) filter (where ${analyticsEvents.type} = 'video_play')`.mapWith(Number),
              clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} in ('element_click','hotspot_click'))`.mapWith(Number),
              addToCarts: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'add_to_cart')`.mapWith(Number),
              errors: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'player_error')`.mapWith(Number),
            })
            .from(analyticsEvents)
            .where(and(inArray(analyticsEvents.projectId, projectIds), gt(analyticsEvents.occurredAt, since)))
            .groupBy(analyticsEvents.projectId),
          ctx.db
            .select({ id: comments.id, projectId: comments.projectId, authorName: comments.authorName, body: comments.body, createdAt: comments.createdAt, t: comments.t, sceneId: comments.sceneId })
            .from(comments)
            .where(and(inArray(comments.projectId, projectIds), isNull(comments.resolvedAt), sql`${comments.mentionsJson} ? ${user.id}`))
            .orderBy(desc(comments.createdAt))
            .limit(20),
        ])
      : [[], [], []];

    const commentsBy = new Map(openComments.map((c) => [c.projectId, c]));
    const statsBy = new Map(stats.map((s) => [s.projectId, s]));
    const siteBy = new Map(siteRows.map((s) => [s.id, s]));
    const clientBy = new Map(clientRows.map((c) => [c.id, c.name]));

    const alerts: DashboardAlert[] = [];
    for (const s of siteRows) {
      if (s.connectionStatus === "error") alerts.push({ kind: "site_error", severity: "fail", title: `${s.name ?? s.url} cannot be reached`, detail: s.lastError ?? "The last publish to this site failed.", href: "/projects#sites" });
    }
    const list = projectRows.map((p) => {
      const site = p.siteId ? (siteBy.get(p.siteId) ?? null) : null;
      const c = commentsBy.get(p.id);
      const st = statsBy.get(p.id);
      const draftNewer = p.publishedVersion !== null && p.currentDraftVersion > p.publishedVersion;
      const waitingDays = p.reviewUpdatedAt ? Math.floor((now - p.reviewUpdatedAt.getTime()) / 86400_000) : 0;
      const page = `/projects/${p.id}`;
      if (p.reviewStatus === "client" && waitingDays >= 3) alerts.push({ kind: "waiting_client", severity: "warn", projectId: p.id, title: `${p.name}: waiting for the client for ${waitingDays} days`, detail: "Send a reminder, or publish if you have the go-ahead another way.", href: page });
      if (p.reviewStatus === "approved" && p.approvedVersion !== null && (p.publishedVersion === null || p.publishedVersion < p.approvedVersion)) alerts.push({ kind: "approved_unpublished", severity: "info", projectId: p.id, title: `${p.name}: approved but not published`, detail: `${p.approvedBy ?? "The reviewer"} approved v${p.approvedVersion}. Publish it when you are ready.`, href: page });
      if (p.reviewStatus === "changes") alerts.push({ kind: "changes_requested", severity: "warn", projectId: p.id, title: `${p.name}: changes requested`, detail: "Open the comments in the editor to see what to change.", href: `${page}/editor?comments=1` });
      if (st && st.errors > 0) alerts.push({ kind: "player_errors", severity: "warn", projectId: p.id, title: `${p.name}: ${st.errors} player error${st.errors === 1 ? "" : "s"} in the last 7 days`, detail: "Usually a media file the site cannot load. Run “Something not working?”.", href: page });
      if (draftNewer && now - p.updatedAt.getTime() > 7 * 86400_000) alerts.push({ kind: "stale_draft", severity: "info", projectId: p.id, title: `${p.name}: unpublished changes for over a week`, detail: `Draft v${p.currentDraftVersion} is newer than the live v${p.publishedVersion}.`, href: page });
      return {
        ...toProjectDto(p),
        clientName: p.clientId ? (clientBy.get(p.clientId) ?? null) : null,
        site: site ? { id: site.id, name: site.name, url: site.url, connectionStatus: site.connectionStatus, lastError: site.lastError } : null,
        draftNewer,
        openComments: c?.open ?? 0,
        totalComments: c?.total ?? 0,
        stats7d: { loads: st?.loads ?? 0, plays: st?.plays ?? 0, clicks: st?.clicks ?? 0, addToCarts: st?.addToCarts ?? 0, errors: st?.errors ?? 0 },
      };
    });
    const order: Record<DashboardAlert["severity"], number> = { fail: 0, warn: 1, info: 2 };
    alerts.sort((a, b) => order[a.severity] - order[b.severity]);
    const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
    return {
      clients: clientRows.map((c) => ({ ...c, projectCount: projectRows.filter((p) => p.clientId === c.id).length })),
      projects: list,
      alerts,
      mentions: mentions.map((m) => ({ ...m, projectName: projectName.get(m.projectId) ?? "" })),
      activity: await recentActivity(ctx, id, 30),
      totals: {
        projects: list.length,
        published: list.filter((p) => p.status === "published").length,
        inReview: list.filter((p) => p.reviewStatus === "internal" || p.reviewStatus === "client").length,
        openComments: list.reduce((n, p) => n + p.openComments, 0),
        loads7d: list.reduce((n, p) => n + p.stats7d.loads, 0),
        plays7d: list.reduce((n, p) => n + p.stats7d.plays, 0),
        clicks7d: list.reduce((n, p) => n + p.stats7d.clicks, 0),
      },
    };
  });
}

async function loadInvite(ctx: Ctx, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(404, "INVITE_INVALID", "This invitation link is not valid");
  const invite = await ctx.db.query.workspaceInvites.findFirst({ where: eq(workspaceInvites.tokenHash, hashToken(token)) });
  if (!invite) throw new HttpError(404, "INVITE_INVALID", "This invitation link is not valid any more");
  if (invite.acceptedAt) throw new HttpError(410, "INVITE_USED", "This invitation has already been used");
  if (invite.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "INVITE_EXPIRED", "This invitation has expired. Ask for a new link.");
  return invite;
}

async function assertKitInWorkspace(ctx: Ctx, kitId: string, workspaceId: string) {
  const kit = await ctx.db.query.brandKits.findFirst({ where: eq(brandKits.id, kitId) });
  if (!kit || kit.workspaceId !== workspaceId) throw new HttpError(400, "BRAND_KIT_MISMATCH", "That brand kit belongs to another workspace");
}

async function recentActivity(ctx: Ctx, workspaceId: string, limit: number) {
  return ctx.db
    .select({ id: projectActivity.id, projectId: projectActivity.projectId, projectName: projects.name, type: projectActivity.type, actorName: projectActivity.actorName, detail: projectActivity.detail, createdAt: projectActivity.createdAt })
    .from(projectActivity)
    .innerJoin(projects, eq(projects.id, projectActivity.projectId))
    .where(eq(projectActivity.workspaceId, workspaceId))
    .orderBy(desc(projectActivity.createdAt))
    .limit(limit);
}

export type { WorkspaceRole };
export const ASSIGNABLE_ROLES = WORKSPACE_ROLES.filter((r) => r !== "owner");
