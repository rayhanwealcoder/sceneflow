import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { clients, comments, projects, projectVersions, users, workspaceMembers, workspaces } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { logActivity } from "../lib/activity.js";
import { requireUser, roleAtLeast } from "../lib/auth.js";
import { approvalCurrent, encryptToken, hashToken, loadProjectByReviewToken, loadProjectWithRole, newToken, parseMentions, REVIEW_LINK_DAYS, reviewUrl, stripForReview, toProjectDto } from "../lib/review.js";
import { assertUuid, parseBody } from "../lib/validate.js";

/*
 * Review workflow + comments (doc §23). Two doors to the same project:
 *   team   — signed-in members: comments in the editor, "send for review", internal approval
 *   client — a review link (no account): sees the draft, comments on the video, approves or asks for changes
 */

const anchorSchema = {
  t: z.number().min(0).max(36_000).nullable().optional(),
  sceneId: z.string().max(64).nullable().optional(),
  layerId: z.string().max(64).nullable().optional(),
  x: z.number().min(0).max(100).nullable().optional(),
  y: z.number().min(0).max(100).nullable().optional(),
};
const bodySchema = z.string().trim().min(1).max(2000);
const commentSchema = z.object({ body: bodySchema, parentId: z.string().uuid().nullable().optional(), ...anchorSchema });
const commentPatchSchema = z.object({ body: bodySchema.optional(), resolved: z.boolean().optional() });
const reviewActionSchema = z.object({ action: z.enum(["request_internal", "request_client", "approve", "request_changes", "reset"]), note: z.string().trim().max(2000).optional() });
const linkSchema = z.object({ action: z.enum(["create", "revoke"]) });
const guestName = z.string().trim().min(1).max(80);
const guestCommentSchema = commentSchema.extend({ name: guestName });
const guestSchema = z.object({ name: guestName, note: z.string().trim().max(2000).optional() });
const publicLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

export async function reviewRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  /* ---------- team: comments ---------- */

  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/comments", async (req) => {
    const user = await requireUser(ctx, req);
    const { project } = await loadProjectWithRole(ctx, user.id, req.params.id);
    return { comments: await listComments(ctx, project.id) };
  });

  /** Viewers may comment too — reviewing is what a viewer is for. */
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/comments", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { project } = await loadProjectWithRole(ctx, user.id, req.params.id);
    const body = parseBody(commentSchema, req.body);
    const comment = await insertComment(ctx, project.id, { ...body, authorId: user.id, authorName: user.name, source: "team" }, project.workspaceId);
    await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "comment", actorName: user.name, detail: snippet(body.body) });
    return reply.code(201).send({ comment });
  });

  app.patch<{ Params: { id: string; cid: string } }>("/api/v1/projects/:id/comments/:cid", async (req) => {
    const user = await requireUser(ctx, req);
    const { project, role } = await loadProjectWithRole(ctx, user.id, req.params.id);
    const cid = assertUuid(req.params.cid, "comment id");
    const body = parseBody(commentPatchSchema, req.body);
    const row = await ctx.db.query.comments.findFirst({ where: and(eq(comments.id, cid), eq(comments.projectId, project.id)) });
    if (!row) throw new HttpError(404, "COMMENT_NOT_FOUND", "Comment not found");
    if (body.body !== undefined && row.authorId !== user.id && !roleAtLeast(role, "admin")) throw new HttpError(403, "NOT_AUTHOR", "Only the author can edit a comment");
    const patch: Partial<typeof comments.$inferInsert> = { updatedAt: new Date() };
    if (body.body !== undefined) patch.body = body.body;
    if (body.resolved !== undefined) {
      patch.resolvedAt = body.resolved ? new Date() : null;
      patch.resolvedBy = body.resolved ? user.name : null;
    }
    const [updated] = await ctx.db.update(comments).set(patch).where(eq(comments.id, cid)).returning();
    return { comment: updated };
  });

  app.delete<{ Params: { id: string; cid: string } }>("/api/v1/projects/:id/comments/:cid", async (req) => {
    const user = await requireUser(ctx, req);
    const { project, role } = await loadProjectWithRole(ctx, user.id, req.params.id);
    const cid = assertUuid(req.params.cid, "comment id");
    const row = await ctx.db.query.comments.findFirst({ where: and(eq(comments.id, cid), eq(comments.projectId, project.id)) });
    if (!row) throw new HttpError(404, "COMMENT_NOT_FOUND", "Comment not found");
    if (row.authorId !== user.id && !roleAtLeast(role, "admin")) throw new HttpError(403, "NOT_AUTHOR", "Only the author or an admin can delete a comment");
    await ctx.db.delete(comments).where(eq(comments.id, cid));
    return { ok: true };
  });

  /* ---------- team: review state ---------- */

  /** Draft → internal review → client review → approved (doc §23). Approve / request changes need an admin. */
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/review", async (req) => {
    const user = await requireUser(ctx, req);
    const { project, role } = await loadProjectWithRole(ctx, user.id, req.params.id, "editor");
    const body = parseBody(reviewActionSchema, req.body);
    const draft = await latestDraft(ctx, project.id);
    if (!draft && body.action !== "reset") throw new HttpError(409, "NOTHING_TO_REVIEW", "Save something in the editor first");
    const now = new Date();
    let patch: Partial<typeof projects.$inferInsert> = { reviewUpdatedAt: now, updatedAt: now };
    let link: string | null = null;
    switch (body.action) {
      case "request_internal":
        patch = { ...patch, reviewStatus: "internal", reviewVersion: draft!.version };
        await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "review_requested", actorName: user.name, detail: body.note });
        break;
      case "request_client": {
        const ensured = await ensureReviewLink(ctx, project);
        link = ensured.url;
        patch = { ...patch, ...ensured.patch, reviewStatus: "client", reviewVersion: draft!.version };
        await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "client_review_requested", actorName: user.name, detail: body.note });
        break;
      }
      case "approve":
        if (!roleAtLeast(role, "admin")) throw new HttpError(403, "ADMIN_REQUIRED", "Only an admin or the owner can approve. Editors send it for review.");
        patch = { ...patch, reviewStatus: "approved", approvedVersion: draft!.version, approvedChecksum: draft!.checksum, approvedBy: user.name, approvedAt: now };
        await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "approved", actorName: user.name, detail: body.note ?? `v${draft!.version}` });
        break;
      case "request_changes":
        if (!roleAtLeast(role, "admin")) throw new HttpError(403, "ADMIN_REQUIRED", "Only an admin or the owner can request changes here. Leave a comment instead.");
        patch = { ...patch, reviewStatus: "changes" };
        if (body.note) await insertComment(ctx, project.id, { body: body.note, authorId: user.id, authorName: user.name, source: "team" }, project.workspaceId);
        await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "changes_requested", actorName: user.name, detail: body.note ? snippet(body.note) : null });
        break;
      case "reset":
        patch = { ...patch, reviewStatus: "none", reviewVersion: null };
        await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "review_reset", actorName: user.name });
        break;
    }
    const [updated] = await ctx.db.update(projects).set(patch).where(eq(projects.id, project.id)).returning();
    return { project: toProjectDto(updated!), reviewUrl: link ?? reviewUrl(ctx, updated!) };
  });

  /** The client review link: read it, make a new one (renews / replaces), or revoke it. */
  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/review-link", async (req) => {
    const user = await requireUser(ctx, req);
    const { project } = await loadProjectWithRole(ctx, user.id, req.params.id, "editor");
    return { url: reviewUrl(ctx, project), expiresAt: project.reviewTokenExpiresAt };
  });

  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/review-link", async (req) => {
    const user = await requireUser(ctx, req);
    const { project } = await loadProjectWithRole(ctx, user.id, req.params.id, "editor");
    const body = parseBody(linkSchema, req.body);
    if (body.action === "revoke") {
      await ctx.db.update(projects).set({ reviewTokenHash: null, reviewTokenEncrypted: null, reviewTokenExpiresAt: null, updatedAt: new Date() }).where(eq(projects.id, project.id));
      return { url: null, expiresAt: null };
    }
    const fresh = await ensureReviewLink(ctx, project, true);
    await ctx.db.update(projects).set({ ...fresh.patch, updatedAt: new Date() }).where(eq(projects.id, project.id));
    return { url: fresh.url, expiresAt: fresh.patch.reviewTokenExpiresAt };
  });

  /* ---------- client: review link (no account) ---------- */

  app.get<{ Params: { token: string } }>("/api/v1/review/:token", publicLimit, async (req) => {
    const project = await loadProjectByReviewToken(ctx, req.params.token);
    const draft = await latestDraft(ctx, project.id);
    const [ws, client] = await Promise.all([
      ctx.db.query.workspaces.findFirst({ where: eq(workspaces.id, project.workspaceId) }),
      project.clientId ? ctx.db.query.clients.findFirst({ where: eq(clients.id, project.clientId) }) : Promise.resolve(null),
    ]);
    return {
      project: { id: project.id, name: project.name, clientName: client?.name ?? null, from: ws?.name ?? "SceneFlow" },
      status: project.reviewStatus,
      approvedBy: project.approvedBy,
      approvedAt: project.approvedAt,
      /** False once this exact draft has been approved (nothing to approve again). */
      canApprove: !!draft && !approvalCurrent(project, draft.checksum),
      version: draft?.version ?? null,
      config: draft ? stripForReview(draft.configJson) : null,
      comments: await listComments(ctx, project.id),
      expiresAt: project.reviewTokenExpiresAt,
    };
  });

  app.post<{ Params: { token: string } }>("/api/v1/review/:token/comments", publicLimit, async (req, reply) => {
    const project = await loadProjectByReviewToken(ctx, req.params.token);
    const body = parseBody(guestCommentSchema, req.body);
    const comment = await insertComment(ctx, project.id, { ...body, authorId: null, authorName: body.name, source: "client" }, project.workspaceId);
    await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "client_comment", actorName: body.name, detail: snippet(body.body) });
    return reply.code(201).send({ comment });
  });

  /** Reviewers can tick off what has been dealt with. */
  app.patch<{ Params: { token: string; cid: string } }>("/api/v1/review/:token/comments/:cid", publicLimit, async (req) => {
    const project = await loadProjectByReviewToken(ctx, req.params.token);
    const cid = assertUuid(req.params.cid, "comment id");
    const body = parseBody(z.object({ resolved: z.boolean(), name: guestName }), req.body);
    const [updated] = await ctx.db
      .update(comments)
      .set({ resolvedAt: body.resolved ? new Date() : null, resolvedBy: body.resolved ? body.name : null, updatedAt: new Date() })
      .where(and(eq(comments.id, cid), eq(comments.projectId, project.id)))
      .returning();
    if (!updated) throw new HttpError(404, "COMMENT_NOT_FOUND", "Comment not found");
    return { comment: updated };
  });

  app.post<{ Params: { token: string } }>("/api/v1/review/:token/approve", publicLimit, async (req) => {
    const project = await loadProjectByReviewToken(ctx, req.params.token);
    const body = parseBody(guestSchema, req.body);
    const draft = await latestDraft(ctx, project.id);
    if (!draft) throw new HttpError(409, "NOTHING_TO_REVIEW", "There is nothing to approve yet");
    const now = new Date();
    const [updated] = await ctx.db
      .update(projects)
      .set({ reviewStatus: "approved", approvedVersion: draft.version, approvedChecksum: draft.checksum, approvedBy: body.name, approvedAt: now, reviewUpdatedAt: now, updatedAt: now })
      .where(eq(projects.id, project.id))
      .returning();
    if (body.note) await insertComment(ctx, project.id, { body: body.note, authorId: null, authorName: body.name, source: "client" }, project.workspaceId);
    await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "approved", actorName: body.name, detail: body.note ? snippet(body.note) : `v${draft.version}` });
    return { status: updated!.reviewStatus, approvedBy: updated!.approvedBy, approvedAt: updated!.approvedAt, version: draft.version };
  });

  app.post<{ Params: { token: string } }>("/api/v1/review/:token/request-changes", publicLimit, async (req) => {
    const project = await loadProjectByReviewToken(ctx, req.params.token);
    const body = parseBody(guestSchema.extend({ note: z.string().trim().min(1).max(2000) }), req.body);
    const now = new Date();
    await ctx.db.update(projects).set({ reviewStatus: "changes", reviewUpdatedAt: now, updatedAt: now }).where(eq(projects.id, project.id));
    const comment = await insertComment(ctx, project.id, { body: body.note, authorId: null, authorName: body.name, source: "client" }, project.workspaceId);
    await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "changes_requested", actorName: body.name, detail: snippet(body.note) });
    return { status: "changes", comment };
  });
}

/* ---------- helpers ---------- */

const snippet = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

async function latestDraft(ctx: Ctx, projectId: string) {
  return ctx.db.query.projectVersions.findFirst({ where: eq(projectVersions.projectId, projectId), orderBy: desc(projectVersions.version) });
}

async function listComments(ctx: Ctx, projectId: string) {
  return ctx.db.select().from(comments).where(eq(comments.projectId, projectId)).orderBy(comments.createdAt);
}

type NewComment = { body: string; parentId?: string | null; authorId: string | null; authorName: string; source: "team" | "client"; t?: number | null; sceneId?: string | null; layerId?: string | null; x?: number | null; y?: number | null };

async function insertComment(ctx: Ctx, projectId: string, c: NewComment, workspaceId: string) {
  if (c.parentId) {
    const parent = await ctx.db.query.comments.findFirst({ where: and(eq(comments.id, c.parentId), eq(comments.projectId, projectId)) });
    if (!parent) throw new HttpError(404, "COMMENT_NOT_FOUND", "The comment you reply to no longer exists");
  }
  const members = await ctx.db.select({ userId: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspaceId));
  const [row] = await ctx.db
    .insert(comments)
    .values({ projectId, parentId: c.parentId ?? null, authorId: c.authorId, authorName: c.authorName, source: c.source, body: c.body, t: c.t ?? null, sceneId: c.sceneId ?? null, layerId: c.layerId ?? null, x: c.x ?? null, y: c.y ?? null, mentionsJson: parseMentions(c.body, members) })
    .returning();
  return row!;
}

/** Keeps the existing link while it is valid; `replace` always mints a new token (old link stops working). */
async function ensureReviewLink(ctx: Ctx, project: typeof projects.$inferSelect, replace = false): Promise<{ url: string; patch: Partial<typeof projects.$inferInsert> }> {
  const current = replace ? null : reviewUrl(ctx, project);
  if (current) return { url: current, patch: {} };
  const token = newToken();
  const expiresAt = new Date(Date.now() + REVIEW_LINK_DAYS * 86400_000);
  return { url: `${ctx.cfg.webOrigin}/review/${token}`, patch: { reviewTokenHash: hashToken(token), reviewTokenEncrypted: encryptToken(ctx, token), reviewTokenExpiresAt: expiresAt } };
}
