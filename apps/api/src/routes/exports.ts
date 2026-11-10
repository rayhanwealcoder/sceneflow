import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { EXPORT_MIME, exportDuration, exportFileName, exportLimitError, exportOptionsFor, exportRequestSchema, LocalStorageProvider, MAX_EXPORT_SECONDS, projectDuration, projectVersions, QUEUES, videoExports, type ExportRenderJob } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser } from "../lib/auth.js";
import { resolvePublishedMedia } from "../lib/media.js";
import { loadProjectWithRole } from "../lib/review.js";
import { assertUuid, parseBody } from "../lib/validate.js";

/*
 * MP4 export (doc §31). The API freezes *what* to render (the draft or published config with the best renditions
 * attached, plus size / fps / layout) into a `video_exports` row and queues it; the worker renders it in headless
 * Chrome + FFmpeg and stores the file. The download goes through this API so the browser gets a real file name
 * and an `attachment` disposition (local disk is streamed, remote storage is a redirect to the public URL).
 */

type ExportRow = typeof videoExports.$inferSelect;

export function toExportDto(row: ExportRow, publicUrl: string) {
  const { configJson: _config, storageKey: _key, ...rest } = row;
  return { ...rest, options: row.optionsJson, progress: row.progressJson, fileUrl: row.status === "ready" ? `${publicUrl}/api/v1/exports/${row.id}/file` : null };
}

export async function exportRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const local = ctx.storage instanceof LocalStorageProvider ? ctx.storage : null;

  async function loadExport(userId: string, id: string, min: "viewer" | "editor" = "viewer") {
    assertUuid(id, "export id");
    const row = await ctx.db.query.videoExports.findFirst({ where: eq(videoExports.id, id) });
    if (!row) throw new HttpError(404, "EXPORT_NOT_FOUND", "Export not found");
    await requireMember(ctx, userId, row.workspaceId, min);
    return row;
  }

  /** Editors ask for a render of the current draft (default) or the published version. */
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/exports", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { project } = await loadProjectWithRole(ctx, user.id, req.params.id, "editor");
    const body = parseBody(exportRequestSchema, req.body ?? {});
    const version =
      body.source === "published"
        ? project.publishedVersion
          ? await ctx.db.query.projectVersions.findFirst({ where: and(eq(projectVersions.projectId, project.id), eq(projectVersions.version, project.publishedVersion)) })
          : null
        : await ctx.db.query.projectVersions.findFirst({ where: eq(projectVersions.projectId, project.id), orderBy: desc(projectVersions.version) });
    if (!version) throw new HttpError(404, "VERSION_NOT_FOUND", body.source === "published" ? "This project is not published yet." : "Nothing to export yet. Save the project first.");
    // Drafts only know the editor proxy; attach the renditions the worker has produced so the file is rendered from the best one.
    const config = await resolvePublishedMedia(ctx.db, version.configJson);
    const duration = projectDuration(config);
    if (!(duration > 0) || !config.scenes.length) throw new HttpError(422, "EXPORT_EMPTY", "This project has no scenes yet. Add a video or a template in the editor first.");
    if (duration > MAX_EXPORT_SECONDS) throw new HttpError(422, "EXPORT_TOO_LONG", `Exports are limited to ${MAX_EXPORT_SECONDS / 60} minutes; this project is ${Math.round(duration)} seconds long${exportDuration(config) !== duration ? ` (${Math.round(exportDuration(config))} s at its playback speed)` : ""}.`);
    const limit = exportLimitError(body, exportDuration(config));
    if (limit) throw new HttpError(422, "EXPORT_LIMIT", limit);
    const options = exportOptionsFor(config, body);
    const [row] = await ctx.db
      .insert(videoExports)
      .values({ workspaceId: project.workspaceId, projectId: project.id, requestedBy: user.id, requestedByName: user.name, source: body.source, version: version.version, checksum: version.checksum, configJson: config, optionsJson: options, fileName: exportFileName(project.name, options.quality, options.format) })
      .returning();
    const job: ExportRenderJob = { exportId: row!.id };
    await ctx.queue.send(QUEUES.exportRender, job, { retryLimit: 0, expireInSeconds: 60 * 60 });
    return reply.code(201).send({ export: toExportDto(row!, ctx.cfg.publicUrl) });
  });

  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/exports", async (req) => {
    const user = await requireUser(ctx, req);
    const { project } = await loadProjectWithRole(ctx, user.id, req.params.id);
    const rows = await ctx.db.select().from(videoExports).where(eq(videoExports.projectId, project.id)).orderBy(desc(videoExports.createdAt)).limit(20);
    return { exports: rows.map((r) => toExportDto(r, ctx.cfg.publicUrl)) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/exports/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const row = await loadExport(user.id, req.params.id);
    return { export: toExportDto(row, ctx.cfg.publicUrl) };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/exports/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const row = await loadExport(user.id, req.params.id, "editor");
    if (row.status === "rendering") throw new HttpError(409, "EXPORT_IN_PROGRESS", "This export is being rendered right now; delete it when it is done.");
    if (row.storageKey) await ctx.storage.deleteObject(row.storageKey).catch(() => {});
    await ctx.db.delete(videoExports).where(eq(videoExports.id, row.id));
    return { ok: true };
  });

  /** The download. Any member may fetch it (a viewer sends the file to the client). */
  app.get<{ Params: { id: string } }>("/api/v1/exports/:id/file", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const row = await loadExport(user.id, req.params.id);
    if (row.status !== "ready" || !row.storageKey) throw new HttpError(409, "EXPORT_NOT_READY", row.status === "failed" ? "This export failed; render it again." : "This export is still rendering.");
    const format = row.optionsJson.format ?? "mp4";
    const fileName = row.fileName ?? exportFileName("video", row.optionsJson.quality, format);
    if (!local) return reply.redirect(ctx.storage.publicUrl(row.storageKey), 302);
    const path = local.publicPathForUrl(local.publicUrl(row.storageKey));
    const st = path ? await stat(path).catch(() => null) : null;
    if (!path || !st?.isFile()) throw new HttpError(410, "EXPORT_FILE_MISSING", "The file is no longer in storage; render it again.");
    reply.header("content-type", EXPORT_MIME[format]);
    reply.header("content-length", String(st.size));
    reply.header("content-disposition", `attachment; filename="${fileName}"`);
    reply.header("accept-ranges", "none");
    return reply.send(createReadStream(path));
  });
}
