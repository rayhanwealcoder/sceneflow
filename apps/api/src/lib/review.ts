import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Project } from "@sceneflow/schema";
import { decryptString, encryptString, projects, type WorkspaceRole } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";
import { requireMember } from "./auth.js";
import { assertUuid } from "./validate.js";

type ProjectRow = typeof projects.$inferSelect;

/** Review links live 30 days unless revoked or renewed. */
export const REVIEW_LINK_DAYS = 30;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");

/** What the web app may see of a project: everything except the review-link secret, plus whether a link exists. */
export function toProjectDto(p: ProjectRow) {
  const { reviewTokenHash: _hash, reviewTokenEncrypted: _enc, ...rest } = p;
  const live = !!p.reviewTokenHash && (!p.reviewTokenExpiresAt || p.reviewTokenExpiresAt.getTime() > Date.now());
  return { ...rest, hasReviewLink: live };
}
export type ProjectDto = ReturnType<typeof toProjectDto>;

/** The client review URL of a project, decrypted on demand (only for members who may see it). */
export function reviewUrl(ctx: Ctx, p: ProjectRow): string | null {
  if (!p.reviewTokenEncrypted || !p.reviewTokenHash) return null;
  if (p.reviewTokenExpiresAt && p.reviewTokenExpiresAt.getTime() <= Date.now()) return null;
  try {
    return `${ctx.cfg.webOrigin}/review/${decryptString(p.reviewTokenEncrypted, ctx.siteSecretKey)}`;
  } catch {
    return null;
  }
}

export function encryptToken(ctx: Ctx, token: string): string {
  return encryptString(token, ctx.siteSecretKey);
}

export async function loadProjectWithRole(ctx: Ctx, userId: string, id: string, min: WorkspaceRole = "viewer"): Promise<{ project: ProjectRow; role: WorkspaceRole }> {
  assertUuid(id, "project id");
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const role = await requireMember(ctx, userId, project.workspaceId, min);
  return { project, role };
}

/** Finds the project behind a client review link; 404 for unknown / revoked, 410 for expired. */
export async function loadProjectByReviewToken(ctx: Ctx, token: string): Promise<ProjectRow> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(404, "REVIEW_LINK_INVALID", "This review link is not valid");
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.reviewTokenHash, hashToken(token)) });
  if (!project) throw new HttpError(404, "REVIEW_LINK_INVALID", "This review link is not valid any more. Ask for a new one.");
  if (project.reviewTokenExpiresAt && project.reviewTokenExpiresAt.getTime() <= Date.now()) throw new HttpError(410, "REVIEW_LINK_EXPIRED", "This review link has expired. Ask for a new one.");
  return project;
}

/** What a reviewer gets: the draft without storyboard notes (voiceover lines, shot descriptions are internal). */
export function stripForReview(config: Project): Project {
  return { ...config, scenes: config.scenes.map(({ script: _script, ...scene }) => scene) };
}

/**
 * `@Name` mentions → user ids. Matches full names and first names of workspace members, longest first,
 * case-insensitively; unknown names are left as text.
 */
export function parseMentions(body: string, members: Array<{ userId: string; name: string }>): string[] {
  const found = new Set<string>();
  const lower = body.toLowerCase();
  // Longest name first, and a full name beats a first name of the same spelling; each "@" is claimed once.
  const candidates = members
    .flatMap((m) => {
      const full = m.name.trim().toLowerCase();
      const first = full.split(/\s+/)[0] ?? "";
      const out = [{ userId: m.userId, name: full, kind: 0 }];
      if (first && first !== full) out.push({ userId: m.userId, name: first, kind: 1 });
      return out.filter((c) => c.name.length > 0);
    })
    .sort((a, b) => b.name.length - a.name.length || a.kind - b.kind);
  const claimed = new Set<number>();
  for (const c of candidates) {
    let i = lower.indexOf(`@${c.name}`);
    while (i !== -1) {
      const after = lower[i + 1 + c.name.length];
      if (!claimed.has(i) && (after === undefined || !/[a-z0-9]/.test(after))) {
        claimed.add(i);
        found.add(c.userId);
        break;
      }
      i = lower.indexOf(`@${c.name}`, i + 1);
    }
  }
  return [...found];
}

/** True when the approved draft is still the one on disk (autosave edits the draft in place). */
export function approvalCurrent(p: ProjectRow, draftChecksum: string | null): boolean {
  return p.reviewStatus === "approved" && !!p.approvedChecksum && p.approvedChecksum === draftChecksum;
}
