/*
 * Super admin console API (/admin in the web app). Every route requires a session whose user has
 * platform_role = super_admin (re-read from the database per request) and answers 404 to everyone else.
 * Reads are aggregate SQL; every write is audited in admin_audit. Nothing here deletes data: accounts are
 * disabled, never removed.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_TARGETS, adminAudit, PLAN_IDS, PLATFORM_ROLES, QUEUES, sessions, users, workspaces } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { audit, csvCell, likePattern, num, paging, rows } from "../lib/admin.js";
import { cookieOptions, hashToken, IMPERSONATION_TTL_MS, IMPERSONATOR_COOKIE, requireSuperAdmin, SESSION_COOKIE, startSession } from "../lib/auth.js";
import { issuePasswordReset } from "../lib/reset.js";
import { loadSite, refreshSiteHealth } from "../lib/sites.js";
import { assertUuid, parseBody } from "../lib/validate.js";

const lim = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
const userPatch = z.object({ status: z.enum(["active", "disabled"]).optional(), platformRole: z.enum(PLATFORM_ROLES).optional() }).refine((b) => b.status || b.platformRole, "Nothing to change");
const workspacePatch = z.object({ planId: z.enum(PLAN_IDS) });
const retryBody = z.object({ queue: z.enum(Object.values(QUEUES) as [string, ...string[]]) });
const strOrNull = (v: unknown, allowed: readonly string[]) => (typeof v === "string" && allowed.includes(v) ? v : null);

type Q = Record<string, string | undefined>;

export async function adminRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const pgbossReady = async () => (await rows<{ r: string | null }>(ctx, sql`select to_regclass('pgboss.job')::text as r`))[0]?.r != null;

  app.get("/api/v1/admin/overview", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const [t] = await rows<Record<string, string>>(ctx, sql`select
      (select count(*) from users) as users_total,
      (select count(*) from users where status = 'disabled') as users_disabled,
      (select count(*) from users where platform_role = 'super_admin') as super_admins,
      (select count(*) from users where created_at > now() - interval '7 days') as signups_7d,
      (select count(*) from users where created_at > now() - interval '30 days') as signups_30d,
      (select count(*) from users where last_sign_in_at > now() - interval '7 days') as active_7d,
      (select count(*) from workspaces) as workspaces_total,
      (select count(*) from workspaces where type = 'team') as workspaces_team,
      (select count(*) from projects) as projects_total,
      (select count(*) from projects where status = 'published') as projects_published,
      (select count(*) from sites) as sites_total,
      (select count(*) from sites where connection_status = 'connected') as sites_connected,
      (select count(*) from media_assets) as media_count,
      (select coalesce(sum(size_bytes), 0) from media_assets) as media_bytes,
      (select count(*) from video_exports where created_at > now() - interval '7 days') as exports_7d,
      (select count(*) from video_exports where status = 'failed' and created_at > now() - interval '7 days') as exports_failed_7d,
      (select count(*) from analytics_events where occurred_at > now() - interval '7 days') as events_7d`);
    const plans = await rows<{ plan_id: string; n: string }>(ctx, sql`select plan_id, count(*) as n from workspaces group by plan_id order by n desc`);
    const top = await rows<{ id: string; name: string; plan_id: string; bytes: string; files: string }>(
      ctx,
      sql`select w.id, w.name, w.plan_id, coalesce(sum(m.size_bytes), 0) as bytes, count(m.id) as files
          from workspaces w left join media_assets m on m.workspace_id = w.id
          group by w.id order by bytes desc, w.created_at limit 5`,
    );
    const n = (k: string) => num(t?.[k]);
    return {
      users: { total: n("users_total"), disabled: n("users_disabled"), superAdmins: n("super_admins"), signups7d: n("signups_7d"), signups30d: n("signups_30d"), active7d: n("active_7d") },
      workspaces: { total: n("workspaces_total"), team: n("workspaces_team"), byPlan: plans.map((p) => ({ planId: p.plan_id, count: num(p.n) })) },
      projects: { total: n("projects_total"), published: n("projects_published") },
      sites: { total: n("sites_total"), connected: n("sites_connected") },
      media: { files: n("media_count"), bytes: n("media_bytes") },
      exports: { last7d: n("exports_7d"), failed7d: n("exports_failed_7d") },
      analytics: { events7d: n("events_7d") },
      topStorage: top.map((w) => ({ id: w.id, name: w.name, planId: w.plan_id, bytes: num(w.bytes), files: num(w.files) })),
    };
  });

  app.get("/api/v1/admin/users", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const q = req.query as Q;
    const { page, size, offset } = paging(q);
    const like = likePattern(q.q);
    const status = strOrNull(q.status, ["active", "disabled"]);
    const role = strOrNull(q.role, PLATFORM_ROLES);
    const where = sql`(${like}::text is null or u.email ilike ${like} or u.name ilike ${like})
      and (${status}::text is null or u.status = ${status}) and (${role}::text is null or u.platform_role = ${role})`;
    const [count] = await rows<{ n: string }>(ctx, sql`select count(*) as n from users u where ${where}`);
    const list = await rows<Record<string, unknown>>(
      ctx,
      sql`select u.id, u.email, u.name, u.status, u.platform_role, u.created_at, u.last_sign_in_at,
            (select count(*) from workspace_members m where m.user_id = u.id) as workspaces,
            (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions
          from users u where ${where} order by u.created_at desc limit ${size} offset ${offset}`,
    );
    return {
      total: num(count?.n),
      page,
      pageSize: size,
      users: list.map((u) => ({ id: u.id, email: u.email, name: u.name, status: u.status, platformRole: u.platform_role, createdAt: u.created_at, lastSignInAt: u.last_sign_in_at, workspaces: num(u.workspaces), sessions: num(u.sessions) })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/admin/users/:id", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "user id");
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, id), columns: { passwordHash: false } });
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");
    const memberships = await rows<Record<string, unknown>>(
      ctx,
      sql`select w.id, w.name, w.type, w.plan_id, m.role, (w.owner_id = ${id}) as owner,
            (select count(*) from projects p where p.workspace_id = w.id) as projects
          from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = ${id} order by w.created_at`,
    );
    const [s] = await rows<{ n: string; newest: Date | null }>(ctx, sql`select count(*) as n, max(created_at) as newest from sessions where user_id = ${id} and expires_at > now()`);
    const history = await rows<Record<string, unknown>>(ctx, sql`select action, actor_email, detail_json, created_at from admin_audit where target_type = 'user' and target_id = ${id} order by created_at desc limit 20`);
    return {
      user: { ...user, platformRole: user.platformRole },
      sessions: { active: num(s?.n), newest: s?.newest ?? null },
      workspaces: memberships.map((w) => ({ id: w.id, name: w.name, type: w.type, planId: w.plan_id, role: w.role, owner: Boolean(w.owner), projects: num(w.projects) })),
      audit: history.map((a) => ({ action: a.action, actorEmail: a.actor_email, detail: a.detail_json, createdAt: a.created_at })),
    };
  });

  /**
   * Disable / enable an account, grant / remove super admin. Guard rails: never on yourself, never leaves the
   * platform without an active super admin, only active accounts become super admins. Disabling signs the
   * account out everywhere at once (sessions are deleted; getUser also refuses disabled users).
   */
  app.patch<{ Params: { id: string } }>("/api/v1/admin/users/:id", lim, async (req) => {
    const actor = await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "user id");
    const body = parseBody(userPatch, req.body);
    const target = await ctx.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!target) throw new HttpError(404, "NOT_FOUND", "User not found");
    const removesAdmin = target.platformRole === "super_admin" && (body.status === "disabled" || body.platformRole === "user");
    if (target.id === actor.id && (body.status === "disabled" || body.platformRole === "user")) throw new HttpError(400, "NOT_ON_YOURSELF", "You cannot disable yourself or remove your own super admin role. Ask another super admin.");
    if (removesAdmin) {
      const [other] = await rows<{ n: string }>(ctx, sql`select count(*) as n from users where platform_role = 'super_admin' and status = 'active' and id <> ${id}`);
      if (num(other?.n) === 0) throw new HttpError(400, "LAST_SUPER_ADMIN", "This is the last active super admin.");
    }
    if (body.platformRole === "super_admin" && (body.status ?? target.status) !== "active") throw new HttpError(400, "USER_DISABLED", "Enable the account before making it a super admin.");

    const changes: Record<string, { from: string; to: string }> = {};
    if (body.status && body.status !== target.status) changes.status = { from: target.status, to: body.status };
    if (body.platformRole && body.platformRole !== target.platformRole) changes.platformRole = { from: target.platformRole, to: body.platformRole };
    if (Object.keys(changes).length === 0) return { user: { id: target.id, status: target.status, platformRole: target.platformRole }, changed: false };

    let endedSessions = 0;
    await ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ ...(changes.status ? { status: body.status } : {}), ...(changes.platformRole ? { platformRole: body.platformRole } : {}) }).where(eq(users.id, id));
      if (changes.status?.to === "disabled") endedSessions = (await tx.delete(sessions).where(eq(sessions.userId, id)).returning({ id: sessions.id })).length;
    });
    for (const [field, c] of Object.entries(changes)) {
      const action = field === "status" ? (c.to === "disabled" ? "user.disable" : "user.enable") : c.to === "super_admin" ? "user.grant_super_admin" : "user.revoke_super_admin";
      await audit(ctx, req, actor, { action, targetType: "user", targetId: id, targetLabel: target.email, detail: { ...c, ...(action === "user.disable" ? { endedSessions } : {}) } });
    }
    const fresh = await ctx.db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, status: true, platformRole: true } });
    return { user: fresh, changed: true, endedSessions };
  });

  /** Ends every session of the account (lost laptop, shared password); the password stays. */
  app.post<{ Params: { id: string } }>("/api/v1/admin/users/:id/sign-out", lim, async (req) => {
    const actor = await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "user id");
    const target = await ctx.db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, email: true } });
    if (!target) throw new HttpError(404, "NOT_FOUND", "User not found");
    // Your own current session survives, so you do not lock yourself out of the console.
    const keep = target.id === actor.id ? sql`${sessions.id} <> ${currentSessionHash(req)}` : sql`true`;
    const ended = (await ctx.db.delete(sessions).where(and(eq(sessions.userId, id), keep)).returning({ id: sessions.id })).length;
    await audit(ctx, req, actor, { action: "user.sign_out_everywhere", targetType: "user", targetId: id, targetLabel: target.email, detail: { endedSessions: ended } });
    return { endedSessions: ended };
  });

  app.get("/api/v1/admin/workspaces", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const q = req.query as Q;
    const { page, size, offset } = paging(q);
    const like = likePattern(q.q);
    const plan = strOrNull(q.plan, PLAN_IDS);
    const where = sql`(${like}::text is null or w.name ilike ${like} or o.email ilike ${like}) and (${plan}::text is null or w.plan_id = ${plan})`;
    const [count] = await rows<{ n: string }>(ctx, sql`select count(*) as n from workspaces w join users o on o.id = w.owner_id where ${where}`);
    const list = await rows<Record<string, unknown>>(
      ctx,
      sql`select w.id, w.name, w.type, w.plan_id, w.created_at, o.id as owner_id, o.email as owner_email, o.name as owner_name,
            (select count(*) from workspace_members m where m.workspace_id = w.id) as members,
            (select count(*) from projects p where p.workspace_id = w.id) as projects,
            (select count(*) from projects p where p.workspace_id = w.id and p.status = 'published') as published,
            (select count(*) from sites s where s.workspace_id = w.id) as sites,
            (select coalesce(sum(a.size_bytes), 0) from media_assets a where a.workspace_id = w.id) as storage_bytes
          from workspaces w join users o on o.id = w.owner_id where ${where}
          order by w.created_at desc limit ${size} offset ${offset}`,
    );
    return {
      total: num(count?.n),
      page,
      pageSize: size,
      plans: PLAN_IDS,
      workspaces: list.map((w) => ({
        id: w.id, name: w.name, type: w.type, planId: w.plan_id, createdAt: w.created_at,
        owner: { id: w.owner_id, email: w.owner_email, name: w.owner_name },
        members: num(w.members), projects: num(w.projects), published: num(w.published), sites: num(w.sites), storageBytes: num(w.storage_bytes),
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/admin/workspaces/:id", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    const ws = await ctx.db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
    if (!ws) throw new HttpError(404, "NOT_FOUND", "Workspace not found");
    const members = await rows<Record<string, unknown>>(ctx, sql`select u.id, u.email, u.name, u.status, m.role from workspace_members m join users u on u.id = m.user_id where m.workspace_id = ${id} order by m.created_at`);
    const projectRows = await rows<Record<string, unknown>>(ctx, sql`select id, name, status, published_version, updated_at from projects where workspace_id = ${id} order by updated_at desc limit 50`);
    const siteRows = await rows<Record<string, unknown>>(ctx, sql`select id, url, name, platform, connection_status, connector_version, last_seen_at from sites where workspace_id = ${id} order by created_at`);
    const [u] = await rows<Record<string, string>>(
      ctx,
      sql`select (select count(*) from media_assets where workspace_id = ${id}) as files,
                 (select coalesce(sum(size_bytes), 0) from media_assets where workspace_id = ${id}) as bytes,
                 (select count(*) from video_exports where workspace_id = ${id}) as exports,
                 (select count(*) from analytics_events e join projects p on p.id = e.project_id where p.workspace_id = ${id} and e.occurred_at > now() - interval '7 days') as events_7d`,
    );
    const history = await rows<Record<string, unknown>>(ctx, sql`select action, actor_email, detail_json, created_at from admin_audit where target_type = 'workspace' and target_id = ${id} order by created_at desc limit 20`);
    return {
      workspace: ws,
      plans: PLAN_IDS,
      members: members.map((m) => ({ id: m.id, email: m.email, name: m.name, status: m.status, role: m.role })),
      projects: projectRows.map((p) => ({ id: p.id, name: p.name, status: p.status, publishedVersion: p.published_version, updatedAt: p.updated_at })),
      sites: siteRows.map((s) => ({ id: s.id, url: s.url, name: s.name, platform: s.platform, status: s.connection_status, connectorVersion: s.connector_version, lastSeenAt: s.last_seen_at })),
      usage: { files: num(u?.files), bytes: num(u?.bytes), exports: num(u?.exports), events7d: num(u?.events_7d) },
      audit: history.map((a) => ({ action: a.action, actorEmail: a.actor_email, detail: a.detail_json, createdAt: a.created_at })),
    };
  });

  /** Plan change. No prices or quotas hang on it yet (billing decides those); it is recorded for that day. */
  app.patch<{ Params: { id: string } }>("/api/v1/admin/workspaces/:id", lim, async (req) => {
    const actor = await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "workspace id");
    const body = parseBody(workspacePatch, req.body);
    const ws = await ctx.db.query.workspaces.findFirst({ where: eq(workspaces.id, id), columns: { id: true, name: true, planId: true } });
    if (!ws) throw new HttpError(404, "NOT_FOUND", "Workspace not found");
    if (ws.planId === body.planId) return { workspace: ws, changed: false };
    await ctx.db.update(workspaces).set({ planId: body.planId }).where(and(eq(workspaces.id, id), ne(workspaces.planId, body.planId)));
    await audit(ctx, req, actor, { action: "workspace.change_plan", targetType: "workspace", targetId: id, targetLabel: ws.name, detail: { from: ws.planId, to: body.planId } });
    return { workspace: { ...ws, planId: body.planId }, changed: true };
  });

  /** Is the machine room working: workers alive, queues moving, providers configured, nothing stuck. */
  app.get("/api/v1/admin/system", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const workerRows = await rows<Record<string, unknown>>(ctx, sql`select id, host, pid, started_at, last_seen_at, info_json, (last_seen_at > now() - interval '90 seconds') as online from worker_heartbeats order by last_seen_at desc limit 20`);
    const queueNames = Object.values(QUEUES);
    let queues: Array<{ name: string; counts: Record<string, number> }> = queueNames.map((name) => ({ name, counts: {} }));
    let failedJobs: Array<Record<string, unknown>> = [];
    const hasBoss = await pgbossReady();
    if (hasBoss) {
      const counts = await rows<{ name: string; state: string; n: string }>(ctx, sql`select name, state::text as state, count(*) as n from pgboss.job where name in ${queueNames} group by 1, 2`);
      queues = queueNames.map((name) => ({ name, counts: Object.fromEntries(counts.filter((c) => c.name === name).map((c) => [c.state, num(c.n)])) }));
      const failed = await rows<Record<string, unknown>>(ctx, sql`select id, name, data, output, retry_count, created_on, completed_on from pgboss.job where state = 'failed' and name in ${queueNames} order by completed_on desc nulls last limit 20`);
      failedJobs = failed.map((j) => ({ id: j.id, queue: j.name, data: j.data, error: (j.output as { message?: string } | null)?.message ?? null, retries: num(j.retry_count), createdAt: j.created_on, failedAt: j.completed_on }));
    }
    const [stuck] = await rows<Record<string, string>>(
      ctx,
      sql`select (select count(*) from video_exports where status = 'rendering' and updated_at < now() - interval '15 minutes') as exports,
                 (select count(*) from video_exports where status = 'queued' and created_at < now() - interval '15 minutes') as exports_waiting,
                 (select count(*) from media_assets where status in ('uploaded', 'processing') and updated_at < now() - interval '30 minutes') as media,
                 (select count(*) from media_assets where status = 'failed') as media_failed,
                 pg_database_size(current_database()) as db_bytes`,
    );
    const failedExports = await rows<Record<string, unknown>>(
      ctx,
      sql`select e.id, e.error, e.finished_at, e.requested_by_name, p.id as project_id, p.name as project_name, w.name as workspace_name
          from video_exports e join projects p on p.id = e.project_id join workspaces w on w.id = e.workspace_id
          where e.status = 'failed' order by e.finished_at desc nulls last limit 10`,
    );
    let ai: unknown = null;
    try {
      ai = await Promise.race([ctx.ai.status(), new Promise((r) => setTimeout(() => r(null), 3000))]);
    } catch {
      ai = null;
    }
    return {
      workers: workerRows.map((w) => ({ id: w.id, host: w.host, pid: w.pid, startedAt: w.started_at, lastSeenAt: w.last_seen_at, online: Boolean(w.online), info: w.info_json })),
      queues,
      queueAvailable: hasBoss,
      canRetry: hasBoss && typeof ctx.queue.retry === "function",
      failedJobs,
      failedExports: failedExports.map((e) => ({ id: e.id, error: e.error, failedAt: e.finished_at, requestedBy: e.requested_by_name, project: { id: e.project_id, name: e.project_name }, workspaceName: e.workspace_name })),
      stuck: { exportsRendering: num(stuck?.exports), exportsWaiting: num(stuck?.exports_waiting), media: num(stuck?.media), mediaFailed: num(stuck?.media_failed) },
      mail: ctx.mailer.status(),
      ai,
      storage: { provider: ctx.storage.id },
      server: { node: process.version, uptimeSec: Math.round(process.uptime()), dbBytes: num(stuck?.db_bytes), publicUrl: ctx.cfg.publicUrl, webOrigin: ctx.cfg.webOrigin },
    };
  });

  /** Puts a failed upload / thumbnail / export job back in line. */
  app.post<{ Params: { id: string } }>("/api/v1/admin/jobs/:id/retry", lim, async (req) => {
    const actor = await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "job id");
    const body = parseBody(retryBody, req.body);
    if (!(await pgbossReady()) || typeof ctx.queue.retry !== "function") throw new HttpError(503, "QUEUE_UNAVAILABLE", "The job queue is not available on this server");
    const [job] = await rows<{ state: string; data: unknown }>(ctx, sql`select state::text as state, data from pgboss.job where id = ${id} and name = ${body.queue}`);
    if (!job) throw new HttpError(404, "NOT_FOUND", "Job not found");
    if (job.state !== "failed") throw new HttpError(409, "NOT_FAILED", `Only failed jobs can be retried (this one is ${job.state})`);
    await ctx.queue.retry(body.queue, id);
    await audit(ctx, req, actor, { action: "job.retry", targetType: "job", targetId: id, targetLabel: body.queue, detail: { data: job.data } });
    return { ok: true };
  });


  /**
   * "Sign in as" for support: a 1-hour session as the user, flagged with the admin's id (banner in the app,
   * no password or profile changes, no admin console). The admin's own session token waits in a cookie and
   * comes back with POST /auth/impersonation/stop. Never for super admins or disabled accounts.
   */
  app.post<{ Params: { id: string } }>("/api/v1/admin/users/:id/impersonate", lim, async (req, reply) => {
    const actor = await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "user id");
    const target = await ctx.db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, email: true, name: true, status: true, platformRole: true } });
    if (!target) throw new HttpError(404, "NOT_FOUND", "User not found");
    if (target.id === actor.id) throw new HttpError(400, "NOT_ON_YOURSELF", "That is you.");
    if (target.platformRole === "super_admin") throw new HttpError(400, "TARGET_IS_ADMIN", "Super admins cannot be signed in as.");
    if (target.status !== "active") throw new HttpError(400, "USER_DISABLED", "Enable the account first.");
    const own = req.cookies[SESSION_COOKIE] ?? "";
    await audit(ctx, req, actor, { action: "user.impersonate_start", targetType: "user", targetId: id, targetLabel: target.email, detail: { minutes: IMPERSONATION_TTL_MS / 60000 } });
    await startSession(ctx, reply, target.id, { impersonatorId: actor.id });
    reply.setCookie(IMPERSONATOR_COOKIE, own, cookieOptions(ctx, IMPERSONATION_TTL_MS));
    return { ok: true, user: { id: target.id, email: target.email, name: target.name } };
  });

  /** Mails the user a one-time reset link (the admin never sees the link). */
  app.post<{ Params: { id: string } }>("/api/v1/admin/users/:id/send-reset", lim, async (req) => {
    const actor = await requireSuperAdmin(ctx, req);
    const id = assertUuid(req.params.id, "user id");
    const target = await ctx.db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, email: true, name: true, status: true } });
    if (!target) throw new HttpError(404, "NOT_FOUND", "User not found");
    if (target.status !== "active") throw new HttpError(400, "USER_DISABLED", "Enable the account first.");
    await issuePasswordReset(ctx, target);
    await audit(ctx, req, actor, { action: "user.send_password_reset", targetType: "user", targetId: id, targetLabel: target.email, detail: { delivery: ctx.mailer.delivers ? "email" : "log" } });
    return { ok: true, delivery: ctx.mailer.delivers ? "email" : "log" };
  });

  /** Accounts as CSV (same filters as the list, up to 10 000 rows). Exporting personal data is audited. */
  app.get("/api/v1/admin/users.csv", lim, async (req, reply) => {
    const actor = await requireSuperAdmin(ctx, req);
    const q = req.query as Q;
    const like = likePattern(q.q);
    const status = strOrNull(q.status, ["active", "disabled"]);
    const role = strOrNull(q.role, PLATFORM_ROLES);
    const list = await rows<Record<string, unknown>>(
      ctx,
      sql`select u.id, u.email, u.name, u.status, u.platform_role, u.created_at, u.last_sign_in_at,
            (select count(*) from workspace_members m where m.user_id = u.id) as workspaces
          from users u
          where (${like}::text is null or u.email ilike ${like} or u.name ilike ${like})
            and (${status}::text is null or u.status = ${status}) and (${role}::text is null or u.platform_role = ${role})
          order by u.created_at desc limit 10000`,
    );
    await audit(ctx, req, actor, { action: "users.export_csv", targetType: "system", targetId: "users", targetLabel: "Accounts CSV", detail: { rows: list.length, filters: { q: q.q ?? null, status, role } } });
    const header = ["id", "email", "name", "status", "role", "created_at", "last_sign_in_at", "workspaces"];
    const body = list.map((u) => [u.id, u.email, u.name, u.status, u.platform_role, u.created_at, u.last_sign_in_at, num(u.workspaces)].map(csvCell).join(","));
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="sceneflow-users-${new Date().toISOString().slice(0, 10)}.csv"`);
    return "\ufeff" + [header.join(","), ...body].join("\r\n") + "\r\n";
  });

  /** Every connected site: health, plugin version against the latest release, last contact, last error. */
  app.get("/api/v1/admin/sites", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const q = req.query as Q;
    const { page, size, offset } = paging(q);
    const like = likePattern(q.q);
    const status = strOrNull(q.status, ["pending", "connected", "error"]);
    const where = sql`(${like}::text is null or s.url ilike ${like} or s.name ilike ${like} or w.name ilike ${like}) and (${status}::text is null or s.connection_status = ${status})`;
    const [count] = await rows<{ n: string }>(ctx, sql`select count(*) as n from sites s join workspaces w on w.id = s.workspace_id where ${where}`);
    const list = await rows<Record<string, unknown>>(
      ctx,
      sql`select s.id, s.url, s.name, s.platform, s.connection_status, s.connector_version, s.platform_version, s.last_seen_at, s.last_error, s.created_at,
            w.id as workspace_id, w.name as workspace_name, o.email as owner_email,
            (select count(*) from projects p where p.site_id = s.id and p.status = 'published') as published
          from sites s join workspaces w on w.id = s.workspace_id join users o on o.id = w.owner_id
          where ${where} order by s.last_seen_at desc nulls last, s.created_at desc limit ${size} offset ${offset}`,
    );
    const latest = latestConnectorVersions(ctx);
    return {
      total: num(count?.n),
      page,
      pageSize: size,
      latest,
      sites: list.map((s) => {
        const newest = latest[String(s.platform)] ?? null;
        return {
          id: s.id, url: s.url, name: s.name, platform: s.platform, status: s.connection_status, connectorVersion: s.connector_version, platformVersion: s.platform_version,
          lastSeenAt: s.last_seen_at, lastError: s.last_error, createdAt: s.created_at, published: num(s.published),
          workspace: { id: s.workspace_id, name: s.workspace_name, ownerEmail: s.owner_email },
          outdated: Boolean(newest && s.connector_version && compareVersions(String(s.connector_version), newest) < 0),
        };
      }),
    };
  });

  /** Re-asks one site's plugin for its version and status (the stored version is otherwise from pairing time). */
  app.post<{ Params: { id: string } }>("/api/v1/admin/sites/:id/check", lim, async (req) => {
    const actor = await requireSuperAdmin(ctx, req);
    const site = await loadSite(ctx, assertUuid(req.params.id, "site id"));
    const before = { status: site.connectionStatus, version: site.connectorVersion };
    const updated = await refreshSiteHealth(ctx, site);
    await audit(ctx, req, actor, { action: "site.check", targetType: "site", targetId: site.id, targetLabel: site.url, detail: { from: `${before.status} ${before.version ?? "?"}`, to: `${updated.connectionStatus} ${updated.connectorVersion ?? "?"}` } });
    return { status: updated.connectionStatus, connectorVersion: updated.connectorVersion, platformVersion: updated.platformVersion, lastSeenAt: updated.lastSeenAt, lastError: updated.lastError };
  });

  app.get("/api/v1/admin/audit", lim, async (req) => {
    await requireSuperAdmin(ctx, req);
    const q = req.query as Q;
    const { page, size, offset } = paging(q, 50);
    const type = strOrNull(q.targetType, ADMIN_TARGETS);
    const where = type ? eq(adminAudit.targetType, type as (typeof ADMIN_TARGETS)[number]) : undefined;
    const [count] = await rows<{ n: string }>(ctx, sql`select count(*) as n from admin_audit where (${type}::text is null or target_type = ${type})`);
    const list = await ctx.db.select().from(adminAudit).where(where).orderBy(sql`${adminAudit.createdAt} desc`).limit(size).offset(offset);
    return { total: num(count?.n), page, pageSize: size, entries: list.map((a) => ({ id: a.id, actorEmail: a.actorEmail, action: a.action, targetType: a.targetType, targetId: a.targetId, targetLabel: a.targetLabel, detail: a.detailJson, ip: a.ip, createdAt: a.createdAt })) };
  });
}

/** "1.10.0" vs "1.9.2": numeric per part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Latest released connector versions from the release manifest (pnpm build:connectors), by platform. */
function latestConnectorVersions(ctx: Ctx): Record<string, string> {
  try {
    const file = ctx.cfg.wpPluginDistDir ? join(ctx.cfg.wpPluginDistDir, "manifest.json") : "";
    if (!file || !existsSync(file)) return {};
    const m = JSON.parse(readFileSync(file, "utf8")) as { connectors?: Record<string, { version?: string }> };
    return Object.fromEntries(Object.entries(m.connectors ?? {}).filter(([, c]) => c.version).map(([k, c]) => [k, String(c.version)]));
  } catch {
    return {};
  }
}

const currentSessionHash = (req: { cookies: Record<string, string | undefined> }) => hashToken(req.cookies[SESSION_COOKIE] ?? "");
