import { extname } from "node:path";
import type { Readable } from "node:stream";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { LocalStorageProvider, mediaAssets, QUEUES, UploadTooLargeError, type MediaProcessJob, type MediaType } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser } from "../lib/auth.js";
import { assertUuid, parseBody } from "../lib/validate.js";

const ALLOWED_MIME: Record<string, MediaType> = {
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "image/gif": "video", // GIFs are normalized to video for scrub playback (doc 11.2)
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
};

const createUploadSchema = z.object({
  workspaceId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().refine((m) => m in ALLOWED_MIME, "Unsupported file type"),
  sizeBytes: z.number().int().positive(),
});

const safeExt = (filename: string) => {
  const ext = extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext && ext.length <= 6 ? ext : ".bin";
};

export async function mediaRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const local = ctx.storage instanceof LocalStorageProvider ? ctx.storage : null;

  async function markUploadedAndQueue(assetId: string, bytes: number): Promise<void> {
    await ctx.db.update(mediaAssets).set({ status: "uploaded", sizeBytes: bytes, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    const job: MediaProcessJob = { assetId };
    await ctx.queue.send(QUEUES.mediaProcess, job, { retryLimit: 2, retryDelay: 10, expireInSeconds: 60 * 60 });
  }

  /** Step 1: the browser asks for a signed upload target (local PUT handler or a presigned S3/R2 URL). */
  app.post("/api/v1/media/uploads", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(createUploadSchema, req.body);
    await requireMember(ctx, user.id, body.workspaceId, "editor");
    if (body.sizeBytes > ctx.cfg.maxUploadBytes) throw new HttpError(413, "FILE_TOO_LARGE", `Maximum upload size is ${ctx.cfg.maxUploadBytes} bytes`);
    const type = ALLOWED_MIME[body.mimeType]!;
    const [asset] = await ctx.db
      .insert(mediaAssets)
      .values({ workspaceId: body.workspaceId, provider: ctx.storage.id, providerAssetId: "", type, originalName: body.filename, mimeType: body.mimeType, sizeBytes: body.sizeBytes })
      .returning();
    if (!asset) throw new Error("insert asset failed");
    const key = `${body.workspaceId}/${asset.id}/original${safeExt(body.filename)}`;
    await ctx.db.update(mediaAssets).set({ providerAssetId: key }).where(eq(mediaAssets.id, asset.id));
    const upload = await ctx.storage.createUploadUrl({ key, mimeType: body.mimeType, sizeBytes: body.sizeBytes });
    // Remote providers need the browser to tell us when the PUT finished; local uploads complete in the PUT handler.
    return reply.code(201).send({ assetId: asset.id, upload, complete: local ? null : `/api/v1/media/uploads/${asset.id}/complete` });
  });

  /** Step 2 (local provider only): the browser PUTs the bytes to the signed URL. */
  if (local) {
    app.put<{ Params: { "*": string }; Querystring: { size?: string; exp?: string; sig?: string } }>(
      "/uploads/*",
      { bodyLimit: ctx.cfg.maxUploadBytes },
      async (req, reply) => {
        const key = req.params["*"];
        const size = Number(req.query.size);
        const exp = Number(req.query.exp);
        if (!local.verifyUpload(key, size, exp, req.query.sig ?? "")) throw new HttpError(403, "INVALID_UPLOAD_SIGNATURE", "Upload link is invalid or expired");
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > size) throw new HttpError(413, "FILE_TOO_LARGE", "Upload is larger than the declared size");
        const asset = await ctx.db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.providerAssetId, key), eq(mediaAssets.status, "pending")) });
        if (!asset) throw new HttpError(404, "UPLOAD_NOT_FOUND", "No pending upload for this link");
        let bytes: number;
        try {
          bytes = await local.writeOriginal(key, req.body as Readable, size);
        } catch (err) {
          if (err instanceof UploadTooLargeError) throw new HttpError(413, "FILE_TOO_LARGE", err.message);
          throw err;
        }
        await markUploadedAndQueue(asset.id, bytes);
        return reply.code(200).send({ assetId: asset.id, status: "uploaded" });
      },
    );

    // Derived files only (proxies, posters, thumbnails). Originals are never served from here.
    await app.register(fastifyStatic, {
      root: local.publicDir,
      prefix: "/files/",
      decorateReply: false,
      index: false,
      list: false,
      cacheControl: true,
      maxAge: "7d",
      immutable: true,
    });
  }

  /** Step 2b (remote providers): the browser reports the presigned PUT finished; we verify with a HEAD and queue processing. */
  app.post<{ Params: { id: string } }>("/api/v1/media/uploads/:id/complete", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "asset id");
    const asset = await ctx.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, id) });
    if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Media not found");
    await requireMember(ctx, user.id, asset.workspaceId, "editor");
    if (asset.status !== "pending") return { assetId: asset.id, status: asset.status };
    const size = await ctx.storage.statOriginal(asset.providerAssetId);
    if (size === null) throw new HttpError(409, "UPLOAD_INCOMPLETE", "The file has not arrived in storage yet");
    if (size > asset.sizeBytes) throw new HttpError(413, "FILE_TOO_LARGE", "Upload is larger than the declared size");
    await markUploadedAndQueue(asset.id, size);
    return { assetId: asset.id, status: "uploaded" };
  });

  app.get<{ Params: { id: string } }>("/api/v1/media/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "asset id");
    const asset = await ctx.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, id) });
    if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Media not found");
    await requireMember(ctx, user.id, asset.workspaceId);
    return { asset: toPublicAsset(asset) };
  });

  app.get<{ Querystring: { workspaceId?: string } }>("/api/v1/media", async (req) => {
    const user = await requireUser(ctx, req);
    const workspaceId = assertUuid(req.query.workspaceId ?? "", "workspaceId");
    await requireMember(ctx, user.id, workspaceId);
    const rows = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId)).orderBy(desc(mediaAssets.createdAt)).limit(200);
    return { assets: rows.map(toPublicAsset) };
  });
}

function toPublicAsset(a: typeof mediaAssets.$inferSelect) {
  const { providerAssetId: _key, ...rest } = a;
  return rest;
}
