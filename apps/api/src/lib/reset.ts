import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { passwordResetMail, passwordResets } from "@sceneflow/server";
import type { Ctx } from "../context.js";
import { hashToken } from "./auth.js";

/** Reset links live 60 minutes and work once. */
export const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Creates a one-time reset link for the account (replacing any earlier unused one) and mails it after the
 * response. Used by "Forgot your password?" and by a super admin's "Send password reset link"; the link
 * itself is never returned to the caller.
 */
export async function issuePasswordReset(ctx: Ctx, user: { id: string; email: string; name: string }): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await ctx.db.transaction(async (tx) => {
    await tx.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
    await tx.insert(passwordResets).values({ id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  });
  ctx.mailer.sendLater({ to: user.email, ...passwordResetMail({ webOrigin: ctx.cfg.webOrigin }, { name: user.name, link: `${ctx.cfg.webOrigin}/reset/${token}`, minutes: RESET_TTL_MS / 60000 }) });
}
