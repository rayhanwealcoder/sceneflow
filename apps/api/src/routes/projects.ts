import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { parseProject } from "@sceneflow/schema";
import { clients, PLACEMENT_MODES, placements, projects, projectVersions, sitePublications, sites } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { logActivity } from "../lib/activity.js";
import { requireMember, requireUser, roleAtLeast } from "../lib/auth.js";
import { mediaReadiness, resolvePublishedMedia } from "../lib/media.js";
import { approvalCurrent, loadProjectWithRole, toProjectDto } from "../lib/review.js";
import { connectorErrorMessage, connectorSite, loadSite } from "../lib/sites.js";
import { assertUuid, parseBody } from "../lib/validate.js";

const createSchema = z.object({ workspaceId: z.string().uuid(), name: z.string().trim().min(1).max(120), clientId: z.string().uuid().nullable().optional() });
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["draft", "archived"]).optional(),
  siteId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  /** Doc §23 role-based publish: editors need an approved draft; admins and owners never do. */
  approvalRequired: z.boolean().optional(),
});
const versionSchema = z.object({ config: z.record(z.unknown()) });
const publishSchema = z.object({ version: z.number().int().min(1).optional() });

export interface SitePublishResult {
  siteId: string;
  siteName: string | null;
  ok: boolean;
  error?: string;
  shortcode?: string;
}

/** One line of the "something not working?" panel. */
export interface Diagnostic {
  id: string;
  status: "ok" | "info" | "warn" | "fail";
  title: string;
  detail?: string;
  fix?: { label: string; href: string };
}

const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function loadProject(ctx: Ctx, userId: string, id: string, min: "viewer" | "editor" | "admin" = "viewer") {
  assertUuid(id, "project id");
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  await requireMember(ctx, userId, project.workspaceId, min);
  return project;
}

/** A client must belong to the project's workspace. */
async function assertClient(ctx: Ctx, clientId: string, workspaceId: string) {
  const client = await ctx.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client || client.workspaceId !== workspaceId) throw new HttpError(400, "CLIENT_WORKSPACE_MISMATCH", "That client belongs to another workspace");
  return client;
}

export async function projectRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.post("/api/v1/projects", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(createSchema, req.body);
    await requireMember(ctx, user.id, body.workspaceId, "editor");
    if (body.clientId) await assertClient(ctx, body.clientId, body.workspaceId);
    const [project] = await ctx.db.insert(projects).values({ workspaceId: body.workspaceId, name: body.name, clientId: body.clientId ?? null }).returning();
    return reply.code(201).send({ project: toProjectDto(project!) });
  });

  app.get<{ Querystring: { workspaceId?: string } }>("/api/v1/projects", async (req) => {
    const user = await requireUser(ctx, req);
    const workspaceId = assertUuid(req.query.workspaceId ?? "", "workspaceId");
    await requireMember(ctx, user.id, workspaceId);
    const rows = await ctx.db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).orderBy(desc(projects.updatedAt));
    return { projects: rows.map(toProjectDto) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/projects/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const { project, role } = await loadProjectWithRole(ctx, user.id, req.params.id);
    const [draft, client] = await Promise.all([
      ctx.db.query.projectVersions.findFirst({ where: eq(projectVersions.projectId, project.id), orderBy: desc(projectVersions.version) }),
      project.clientId ? ctx.db.query.clients.findFirst({ where: eq(clients.id, project.clientId) }) : Promise.resolve(null),
    ]);
    return {
      project: toProjectDto(project),
      role,
      client: client ? { id: client.id, name: client.name, brandKitId: client.brandKitId } : null,
      draft: draft ? { version: draft.version, state: draft.state, checksum: draft.checksum, config: draft.configJson } : null,
    };
  });

  app.patch<{ Params: { id: string } }>("/api/v1/projects/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id, "editor");
    const body = parseBody(patchSchema, req.body);
    if (body.siteId) {
      const site = await loadSite(ctx, body.siteId);
      if (site.workspaceId !== project.workspaceId) throw new HttpError(400, "SITE_WORKSPACE_MISMATCH", "That site belongs to another workspace");
    }
    if (body.clientId) await assertClient(ctx, body.clientId, project.workspaceId);
    const [updated] = await ctx.db
      .update(projects)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning();
    return { project: toProjectDto(updated!) };
  });

  /** Saves a new immutable version. The server assigns projectId + version so the client never has to. */
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/versions", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id, "editor");
    const body = parseBody(versionSchema, req.body);
    const nextVersion = project.currentDraftVersion + 1;
    const parsed = parseProject({ ...body.config, schemaVersion: body.config.schemaVersion ?? "1.0", projectId: project.id, version: nextVersion });
    if (!parsed.ok) throw new HttpError(422, parsed.code, parsed.message, parsed.issues);
    const config = parsed.project;
    const version = await ctx.db.transaction(async (tx) => {
      const [v] = await tx
        .insert(projectVersions)
        .values({ projectId: project.id, version: nextVersion, configJson: config, checksum: checksum(config) })
        .returning();
      await tx.update(projects).set({ currentDraftVersion: nextVersion, updatedAt: new Date() }).where(eq(projects.id, project.id));
      return v;
    });
    return reply.code(201).send({ version: version?.version, checksum: version?.checksum, config });
  });

  /**
   * Autosave. Updates the latest version in place while it is still a draft; once that version
   * has been published a new draft version is created. Published versions are never mutated.
   */
  app.put<{ Params: { id: string } }>("/api/v1/projects/:id/draft", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id, "editor");
    const body = parseBody(versionSchema, req.body);
    const latest = await ctx.db.query.projectVersions.findFirst({ where: eq(projectVersions.projectId, project.id), orderBy: desc(projectVersions.version) });
    const reuse = latest && latest.state === "draft";
    const version = reuse ? latest.version : (latest?.version ?? 0) + 1;
    const parsed = parseProject({ ...body.config, schemaVersion: body.config.schemaVersion ?? "1.0", projectId: project.id, version });
    if (!parsed.ok) throw new HttpError(422, parsed.code, parsed.message, parsed.issues);
    const config = parsed.project;
    const sum = checksum(config);
    await ctx.db.transaction(async (tx) => {
      if (reuse) await tx.update(projectVersions).set({ configJson: config, checksum: sum }).where(eq(projectVersions.id, latest.id));
      else await tx.insert(projectVersions).values({ projectId: project.id, version, configJson: config, checksum: sum });
      await tx.update(projects).set({ currentDraftVersion: version, updatedAt: new Date() }).where(eq(projects.id, project.id));
    });
    return { version, checksum: sum, savedAt: new Date().toISOString() };
  });

  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/versions", async (req) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id);
    const rows = await ctx.db
      .select({ version: projectVersions.version, state: projectVersions.state, checksum: projectVersions.checksum, createdAt: projectVersions.createdAt })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, project.id))
      .orderBy(desc(projectVersions.version));
    return { versions: rows, publishedVersion: project.publishedVersion };
  });

  /**
   * Marks a version as the live one and, when the project is assigned to a site, pushes the
   * signed config to that WordPress site. The project id stays stable, so the shortcode never changes.
   */
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/publish", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const user = await requireUser(ctx, req);
    const { project, role } = await loadProjectWithRole(ctx, user.id, req.params.id, "editor");
    const body = parseBody(publishSchema, req.body ?? {});
    const target = body.version ?? project.currentDraftVersion;
    const version = await ctx.db.query.projectVersions.findFirst({
      where: and(eq(projectVersions.projectId, project.id), eq(projectVersions.version, target)),
    });
    if (!version) throw new HttpError(404, "VERSION_NOT_FOUND", "Nothing to publish yet. Save the project first.");
    // Doc §23 role-based publish permission: with approval on, editors publish only the approved, unchanged draft.
    if (project.approvalRequired && !roleAtLeast(role, "admin") && !approvalCurrent(project, version.checksum)) {
      throw new HttpError(
        409,
        "APPROVAL_REQUIRED",
        project.reviewStatus === "approved" ? "The approved version was changed afterwards. Send it for approval again, or ask an admin to publish." : "This video needs approval before it can be published. Send it for review, or ask an admin to publish.",
      );
    }
    // Swap the editor proxies for the best renditions available right now (doc 11.2); the version becomes immutable after this.
    const resolved = await resolvePublishedMedia(ctx.db, version.configJson);
    // Published copies know where to report anonymous playback events (doc §24); the editor's own setting can turn it off.
    resolved.analytics = { endpoint: `${ctx.cfg.publicUrl}/api/v1/analytics/events`, enabled: version.configJson.analytics?.enabled ?? true };
    // Storyboard notes (voiceover text, shot descriptions) are editor-only: visitors never download them.
    resolved.scenes = resolved.scenes.map(({ script: _script, ...scene }) => scene);
    const media = await mediaReadiness(ctx.db, resolved);
    await ctx.db.transaction(async (tx) => {
      await tx.update(projectVersions).set({ configJson: resolved, checksum: checksum(resolved), state: "published" }).where(eq(projectVersions.id, version.id));
      await tx.update(projects).set({ publishedVersion: target, status: "published", updatedAt: new Date() }).where(eq(projects.id, project.id));
    });
    await logActivity(ctx.db, { workspaceId: project.workspaceId, projectId: project.id, type: "published", actorName: user.name, detail: `v${target}` });

    const results: SitePublishResult[] = [];
    if (project.siteId) {
      const site = await ctx.db.query.sites.findFirst({ where: eq(sites.id, project.siteId) });
      if (site) {
        // Serialize once; the checksum must match exactly what the plugin receives (jsonb reorders keys).
        const configJson = JSON.stringify(resolved);
        try {
          const r = await ctx.connector.publish(connectorSite(ctx, site), { projectId: project.id, name: project.name, version: target, configJson });
          await ctx.db.insert(sitePublications).values({ siteId: site.id, projectId: project.id, version: target, status: "ok" });
          await ctx.db.update(sites).set({ connectionStatus: "connected", lastSeenAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(sites.id, site.id));
          results.push({ siteId: site.id, siteName: site.name, ok: true, shortcode: r.shortcode });
        } catch (err) {
          const message = connectorErrorMessage(err);
          await ctx.db.insert(sitePublications).values({ siteId: site.id, projectId: project.id, version: target, status: "failed", error: message });
          await ctx.db.update(sites).set({ connectionStatus: "error", lastError: message, updatedAt: new Date() }).where(eq(sites.id, site.id));
          results.push({ siteId: site.id, siteName: site.name, ok: false, error: message });
        }
      }
    }
    return { publishedVersion: target, publicUrl: `${ctx.cfg.publicUrl}/p/${project.id}.json`, sites: results, media };
  });

  /* ---------- diagnostics: "something not working?" — checks the whole chain and says what to do ---------- */

  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/diagnostics", async (req) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id);
    const checks: Diagnostic[] = [];
    const editor = `/projects/${project.id}/editor`;
    const page = `/projects/${project.id}`;

    const latest = await ctx.db.query.projectVersions.findFirst({ where: eq(projectVersions.projectId, project.id), orderBy: desc(projectVersions.version) });
    if (!latest) {
      checks.push({ id: "draft", status: "fail", title: "Nothing saved yet", detail: "Open the editor, add a video or a template and it saves automatically.", fix: { label: "Open editor", href: editor } });
      return { checks };
    }
    checks.push({ id: "draft", status: "ok", title: `Draft v${latest.version} saved`, detail: `${latest.configJson.scenes.length} scene(s), ${latest.configJson.scenes.reduce((n, s) => n + s.layers.length, 0)} element(s).` });

    const media = await mediaReadiness(ctx.db, latest.configJson);
    if (media.failed) checks.push({ id: "media", status: "fail", title: "A media file failed to process", detail: "Upload it again (MP4 H.264 works everywhere). The editor shows the error next to the file.", fix: { label: "Open project", href: page } });
    else if (media.processing) checks.push({ id: "media", status: "warn", title: "Media still processing", detail: "The video becomes usable within a minute; HD versions follow a bit later.", fix: { label: "Refresh", href: page } });
    else if (media.missing) checks.push({ id: "media", status: "warn", title: "A referenced media file no longer exists", detail: "Pick the video/image again in the editor." , fix: { label: "Open editor", href: editor } });
    else checks.push({ id: "media", status: media.hdPending ? "info" : "ok", title: media.hdPending ? "HD versions are being prepared" : "Media ready", detail: media.hdPending ? "Publish now works with the preview quality; publish again later to ship HD." : `${media.ready} file(s) ready.` });

    if (project.approvalRequired && !approvalCurrent(project, latest.checksum)) {
      checks.push({ id: "approval", status: "info", title: project.reviewStatus === "client" ? "Waiting for the client's approval" : project.reviewStatus === "changes" ? "Changes were requested" : project.reviewStatus === "approved" ? "Edited since it was approved" : "Needs approval before editors can publish", detail: "Admins can always publish. Review status and the client link are on the project page.", fix: { label: "Review & approval", href: `${page}#review` } });
    }
    if (!project.publishedVersion) checks.push({ id: "published", status: "fail", title: "Not published yet", detail: "Visitors only see published versions.", fix: { label: "Publish", href: page } });
    else if (latest.version !== project.publishedVersion) checks.push({ id: "published", status: "warn", title: `Published v${project.publishedVersion}, but v${latest.version} has newer changes`, detail: "Publish again to make the latest edits live.", fix: { label: "Publish", href: page } });
    else checks.push({ id: "published", status: "ok", title: `Published v${project.publishedVersion}` });

    const hasProducts = latest.configJson.scenes.some((s) => s.layers.some((l) => l.product?.provider === "woocommerce" || (l.action && "product" in l.action && l.action.product.provider === "woocommerce")));

    if (!project.siteId) {
      checks.push({ id: "site", status: "info", title: "No WordPress site assigned", detail: "Assign a site to publish straight to WordPress, or use the embed snippet on any website.", fix: { label: "Choose site", href: page } });
      return { checks };
    }
    const site = await ctx.db.query.sites.findFirst({ where: eq(sites.id, project.siteId) });
    if (!site) {
      checks.push({ id: "site", status: "fail", title: "The assigned site was removed", detail: "Pick another site or connect it again.", fix: { label: "Choose site", href: page } });
      return { checks };
    }
    let health: Awaited<ReturnType<typeof ctx.connector.health>> | null = null;
    try {
      health = await ctx.connector.health(site.url);
    } catch (err) {
      checks.push({ id: "site", status: "fail", title: `${site.name ?? site.url} is not reachable`, detail: `${connectorErrorMessage(err)}. Is the site online and the SceneFlow plugin active?`, fix: { label: "Re-check site", href: "/projects" } });
      return { checks };
    }
    if (!health.health.connected) checks.push({ id: "site", status: "fail", title: "The plugin says the site is not connected", detail: "Connect it again from Settings → SceneFlow in WordPress (one click).", fix: { label: "Open WordPress", href: `${site.url}/wp-admin/options-general.php?page=sceneflow` } });
    else checks.push({ id: "site", status: "ok", title: `${site.name ?? site.url} connected`, detail: `Plugin ${health.health.version}, WordPress ${health.health.wp}.` });

    if (hasProducts && !health.health.capabilities.includes("woocommerce")) checks.push({ id: "commerce", status: "fail", title: "This video uses WooCommerce products but WooCommerce is not active on the site", detail: "Activate WooCommerce, or switch the products to “My products” links.", fix: { label: "Open editor", href: editor } });

    if (project.publishedVersion) {
      const pushed = await ctx.db.query.sitePublications.findFirst({ where: and(eq(sitePublications.projectId, project.id), eq(sitePublications.siteId, site.id)), orderBy: desc(sitePublications.createdAt) });
      if (!pushed || pushed.version !== project.publishedVersion || pushed.status !== "ok") {
        checks.push({ id: "pushed", status: "fail", title: "The published version did not reach the site", detail: pushed?.error ?? "Publish again while the site is reachable.", fix: { label: "Publish again", href: page } });
      } else {
        try {
          const live = await ctx.connector.publicProject({ url: site.url, restBase: site.restBase }, project.id);
          if (live.status !== 200) checks.push({ id: "onsite", status: "fail", title: "The site does not serve this video", detail: `The site answered ${live.status} for the project config. Publish again.`, fix: { label: "Publish again", href: page } });
          else if (live.version !== project.publishedVersion) checks.push({ id: "onsite", status: "warn", title: `The site serves v${live.version ?? "?"}, you published v${project.publishedVersion}`, detail: "A caching plugin may hold an old copy, or the last push failed. Publish again / clear the site cache.", fix: { label: "Publish again", href: page } });
          else checks.push({ id: "onsite", status: "ok", title: "The site serves the published version" });
        } catch (err) {
          checks.push({ id: "onsite", status: "warn", title: "Could not verify the config on the site", detail: connectorErrorMessage(err) });
        }
      }
      const placed = await ctx.db.select({ id: placements.id }).from(placements).where(eq(placements.projectId, project.id));
      if (!placed.length) checks.push({ id: "placement", status: "info", title: "Not placed on any page yet", detail: `Add the shortcode [sceneflow id="${project.id}"] to a page, use the SceneFlow Video block, or place it on an existing element from here.`, fix: { label: "Place on your site", href: `${page}#place` } });
      else checks.push({ id: "placement", status: "ok", title: `Placed on ${placed.length} page element(s)`, detail: "Shortcodes and blocks are not counted here." });
    }
    return { checks };
  });

  /* ---------- element placements (mount the player into an existing element of a page) ---------- */

  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/placements", async (req) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id);
    const rows = await ctx.db.select().from(placements).where(eq(placements.projectId, project.id)).orderBy(desc(placements.createdAt));
    return { placements: rows };
  });

  const placementSchema = z
    .object({
      postId: z.number().int().positive().nullable().optional(),
      path: z.string().max(255).nullable().optional(),
      pageUrl: z.string().url().max(500).optional(),
      pageTitle: z.string().max(200).optional(),
      selector: z.string().trim().min(1).max(500).refine((s) => !/[<{}\r\n]/.test(s), "Selector contains invalid characters"),
      mode: z.enum(PLACEMENT_MODES).default("replace"),
    })
    .refine((p) => p.postId || p.path, { message: "A page (postId) or a path is required" });

  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/placements", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id, "editor");
    if (!project.siteId) throw new HttpError(409, "NO_SITE", "Assign a WordPress site to this project first");
    const site = await loadSite(ctx, project.siteId);
    const body = parseBody(placementSchema, req.body);
    const [row] = await ctx.db
      .insert(placements)
      .values({ projectId: project.id, siteId: site.id, postId: body.postId ?? null, path: body.path ?? null, pageUrl: body.pageUrl, pageTitle: body.pageTitle, selector: body.selector, mode: body.mode })
      .returning();
    try {
      await ctx.connector.savePlacement(connectorSite(ctx, site), { id: row!.id, projectId: project.id, postId: body.postId ?? null, path: body.path ?? null, selector: body.selector, mode: body.mode });
    } catch (err) {
      await ctx.db.delete(placements).where(eq(placements.id, row!.id));
      throw new HttpError(502, "SITE_REQUEST_FAILED", connectorErrorMessage(err));
    }
    return reply.code(201).send({ placement: row, published: project.publishedVersion !== null });
  });

  app.delete<{ Params: { id: string; pid: string } }>("/api/v1/projects/:id/placements/:pid", async (req) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id, "editor");
    const pid = assertUuid(req.params.pid, "placement id");
    const row = await ctx.db.query.placements.findFirst({ where: and(eq(placements.id, pid), eq(placements.projectId, project.id)) });
    if (!row) throw new HttpError(404, "PLACEMENT_NOT_FOUND", "Placement not found");
    let remoteOk = true;
    let error: string | undefined;
    try {
      const site = await loadSite(ctx, row.siteId);
      await ctx.connector.deletePlacement(connectorSite(ctx, site), row.id);
    } catch (err) {
      remoteOk = false;
      error = connectorErrorMessage(err);
    }
    await ctx.db.delete(placements).where(eq(placements.id, row.id));
    return { ok: true, remoteOk, error };
  });

  /** Pushes the current draft to the connected site as a short-lived preview and returns the URL to open. */
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/preview-session", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const user = await requireUser(ctx, req);
    const project = await loadProject(ctx, user.id, req.params.id);
    if (!project.siteId) throw new HttpError(409, "NO_SITE", "Assign a WordPress site to this project first");
    const site = await loadSite(ctx, project.siteId);
    const draft = await ctx.db.query.projectVersions.findFirst({ where: eq(projectVersions.projectId, project.id), orderBy: desc(projectVersions.version) });
    if (!draft) throw new HttpError(404, "VERSION_NOT_FOUND", "Save the project first");
    try {
      const r = await ctx.connector.previewSession(connectorSite(ctx, site), { projectId: project.id, configJson: JSON.stringify(draft.configJson) });
      return { previewUrl: r.previewUrl, expiresIn: r.expiresIn, version: draft.version };
    } catch (err) {
      throw new HttpError(502, "SITE_REQUEST_FAILED", connectorErrorMessage(err));
    }
  });
}
