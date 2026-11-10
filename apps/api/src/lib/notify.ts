/*
 * Comment and approval mails (Phase 16). Every mail goes out after the response (mailer.sendLater) and only to
 * active members who kept "Email me about comments and approvals" on; nobody is mailed about their own action.
 */
import { and, eq, inArray } from "drizzle-orm";
import { approvalMail, commentMail, users, workspaceMembers } from "@sceneflow/server";
import type { Ctx } from "../context.js";
import { roleAtLeast } from "./auth.js";

type Recipient = { id: string; email: string; name: string };
type ProjectRef = { id: string; name: string; workspaceId: string };

const projectLink = (ctx: Ctx, projectId: string) => `${ctx.cfg.webOrigin}/projects/${projectId}`;

/** Workspace members among `ids` (or all of them) who want mail; never `exclude`. */
async function recipients(ctx: Ctx, workspaceId: string, opts: { ids?: string[]; minRole?: "admin"; exclude?: string | null }): Promise<Recipient[]> {
  if (opts.ids && opts.ids.length === 0) return [];
  const rows = await ctx.db
    .select({ id: users.id, email: users.email, name: users.name, role: workspaceMembers.role, status: users.status, wants: users.emailNotifications })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), ...(opts.ids ? [inArray(users.id, opts.ids)] : [])));
  return rows
    .filter((r) => r.status === "active" && r.wants && r.id !== opts.exclude && (!opts.minRole || roleAtLeast(r.role, opts.minRole)))
    .map(({ id, email, name }) => ({ id, email, name }));
}

/**
 * New comment: everyone it @mentions, plus the author of the comment it replies to. A person who is both
 * gets one mail (the mention). Guests (client review link) have no account and get nothing.
 */
export async function notifyComment(
  ctx: Ctx,
  project: ProjectRef,
  comment: { body: string; mentions: string[]; parentAuthorId: string | null },
  author: { id: string | null; name: string },
): Promise<number> {
  const ids = [...new Set([...comment.mentions, ...(comment.parentAuthorId ? [comment.parentAuthorId] : [])])];
  const people = await recipients(ctx, project.workspaceId, { ids, exclude: author.id });
  const brand = { webOrigin: ctx.cfg.webOrigin };
  for (const p of people) {
    const reason = comment.mentions.includes(p.id) ? "mention" : "reply";
    ctx.mailer.sendLater({ to: p.email, ...commentMail(brand, { name: p.name, author: author.name, projectName: project.name, body: comment.body, link: projectLink(ctx, project.id), reason }) });
  }
  return people.length;
}

/**
 * Approval workflow mails. `requested`: the workspace's admins and owner (the people who can approve).
 * `approved` / `changes_requested`: whoever sent the draft for review; when nobody did (a client decided on
 * an old link), the admins and owner, so the decision is not lost.
 */
export async function notifyApproval(
  ctx: Ctx,
  project: ProjectRef & { reviewRequestedBy: string | null },
  kind: "requested" | "approved" | "changes_requested",
  actor: { id: string | null; name: string },
  note?: string | null,
): Promise<number> {
  const people =
    kind === "requested" || !project.reviewRequestedBy
      ? await recipients(ctx, project.workspaceId, { minRole: "admin", exclude: actor.id })
      : await recipients(ctx, project.workspaceId, { ids: [project.reviewRequestedBy], exclude: actor.id });
  const brand = { webOrigin: ctx.cfg.webOrigin };
  for (const p of people) ctx.mailer.sendLater({ to: p.email, ...approvalMail(brand, { name: p.name, actor: actor.name, projectName: project.name, link: projectLink(ctx, project.id), kind, note }) });
  return people.length;
}
