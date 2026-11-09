import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { aiCaptionsRequestSchema, aiCopyRequestSchema, aiScriptRequestSchema, aiVoiceoverRequestSchema, type Project } from "@sceneflow/schema";
import { mediaAssets, projects, projectVersions, QUEUES, type MediaProcessJob, type ScriptBrief } from "@sceneflow/server";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser } from "../lib/auth.js";
import { assertUuid, parseBody } from "../lib/validate.js";

/*
 * AI assistance (doc §10.2 / Phase 9). All routes need a signed-in editor of the project's workspace.
 * Text (script, copy) is validated against the project schema before it is returned; voiceovers become
 * ordinary media assets that go through the normal processing pipeline (m4a + waveform), so the editor
 * and runtime treat them like any uploaded audio.
 */

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });

export async function aiRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  /** The project (editor role) and its current draft config, for context the model can use. */
  async function projectContext(userId: string, projectId: string) {
    assertUuid(projectId, "projectId");
    const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    await requireMember(ctx, userId, project.workspaceId, "editor");
    const draft = await ctx.db.query.projectVersions.findFirst({ where: and(eq(projectVersions.projectId, project.id), eq(projectVersions.version, project.currentDraftVersion)) });
    return { project, config: (draft?.configJson ?? null) as Project | null };
  }

  const firstProduct = (config: Project | null) => {
    for (const s of config?.scenes ?? []) for (const l of s.layers) if (l.product) return { title: l.product.title, price: l.product.price ?? undefined };
    return undefined;
  };

  app.get("/api/v1/ai/status", async (req) => {
    await requireUser(ctx, req);
    return ctx.ai.status();
  });

  app.post("/api/v1/ai/script", limit(20), async (req) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(aiScriptRequestSchema, req.body);
    const { project, config } = await projectContext(user.id, body.projectId);
    const brief: ScriptBrief = {
      ...body,
      projectName: project.name,
      hasVideo: !!config?.video,
      videoDuration: config?.video?.duration,
      product: firstProduct(config),
    };
    try {
      const script = await ctx.ai.text.script(brief);
      return { script, provider: ctx.ai.text.id };
    } catch (err) {
      req.log.warn({ err }, "ai script failed");
      throw new HttpError(502, "AI_FAILED", friendly(err, "The script could not be written right now. Try again in a moment."));
    }
  });

  app.post("/api/v1/ai/copy", limit(60), async (req) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(aiCopyRequestSchema, req.body);
    const { config } = await projectContext(user.id, body.projectId);
    const context = { ...body.context, product: body.context?.product ?? firstProduct(config) };
    try {
      const variants = await ctx.ai.text.copy({ ...body, context });
      return { variants, provider: ctx.ai.text.id };
    } catch (err) {
      req.log.warn({ err }, "ai copy failed");
      throw new HttpError(502, "AI_FAILED", friendly(err, "No suggestions right now. Try again in a moment."));
    }
  });

  /** Text → audio asset. The asset is queued like an upload and becomes "ready" with an m4a + waveform. */
  app.post("/api/v1/ai/voiceover", limit(30), async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(aiVoiceoverRequestSchema, req.body);
    const { project, config } = await projectContext(user.id, body.projectId);
    const speech = ctx.ai.speech;
    if (!speech) throw new HttpError(501, "AI_NOT_CONFIGURED", "No voice available on this server. Add ELEVENLABS_API_KEY to the API .env (or install espeak-ng on Linux).");
    let synthesized;
    try {
      synthesized = await speech.synthesize(body.text, body.voiceId);
    } catch (err) {
      req.log.warn({ err }, "voiceover failed");
      throw new HttpError(502, "AI_FAILED", friendly(err, "The voice could not be generated. Try again in a moment."));
    }
    const sceneName = config?.scenes.find((s) => s.id === body.sceneId)?.name;
    const label = (sceneName ? `Voiceover – ${sceneName}` : `Voiceover – ${body.text.slice(0, 40).trim()}`).slice(0, 120);
    const [asset] = await ctx.db
      .insert(mediaAssets)
      .values({ workspaceId: project.workspaceId, provider: ctx.storage.id, providerAssetId: "", type: "audio", originalName: `${label}.${synthesized.ext}`, mimeType: synthesized.mimeType, sizeBytes: synthesized.audio.length, metadataJson: synthesized.durationSeconds ? { duration: synthesized.durationSeconds, hasAudio: true } : {} })
      .returning();
    if (!asset) throw new Error("insert asset failed");
    const key = `${project.workspaceId}/${asset.id}/original.${synthesized.ext}`;
    await ctx.storage.putOriginal(key, synthesized.audio, synthesized.mimeType);
    await ctx.db.update(mediaAssets).set({ providerAssetId: key, status: "uploaded", updatedAt: new Date() }).where(eq(mediaAssets.id, asset.id));
    const job: MediaProcessJob = { assetId: asset.id };
    await ctx.queue.send(QUEUES.mediaProcess, job, { retryLimit: 2, retryDelay: 10, expireInSeconds: 60 * 60 });
    const { providerAssetId: _key, ...pub } = { ...asset, providerAssetId: key, status: "uploaded" as const };
    return reply.code(201).send({ asset: pub, durationSeconds: synthesized.durationSeconds ?? null, provider: speech.id, voiceId: body.voiceId ?? null });
  });

  /** Audio asset → caption cues (relative to the start of that audio). */
  app.post("/api/v1/ai/captions", limit(20), async (req) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(aiCaptionsRequestSchema, req.body);
    const { project } = await projectContext(user.id, body.projectId);
    const stt = ctx.ai.transcription;
    if (!stt) throw new HttpError(501, "AI_NOT_CONFIGURED", "Transcription needs ELEVENLABS_API_KEY in the API .env. Captions from the script work without it.");
    const asset = await ctx.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, body.assetId) });
    if (!asset || asset.workspaceId !== project.workspaceId) throw new HttpError(404, "ASSET_NOT_FOUND", "Media not found");
    if (asset.type === "image") throw new HttpError(400, "NOT_AUDIO", "Pick a video or audio file");
    if (asset.sizeBytes > 200 * 1024 * 1024) throw new HttpError(413, "FILE_TOO_LARGE", "Files over 200 MB cannot be transcribed here");
    try {
      const path = await ctx.storage.readOriginal(asset.providerAssetId);
      const cues = await stt.transcribe(await readFile(path), asset.mimeType, body.language);
      return { cues, provider: stt.id, duration: asset.metadataJson.duration ?? null };
    } catch (err) {
      req.log.warn({ err }, "transcription failed");
      throw new HttpError(502, "AI_FAILED", friendly(err, "The audio could not be transcribed. Try again in a moment."));
    }
  });
}

/** Surfaces provider messages that help the admin (quota, invalid key) and hides the rest. */
function friendly(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message : "";
  if (/401|403|invalid.*key|authentication/i.test(m)) return "The AI key was rejected. Check the API .env.";
  if (/429|quota|rate limit|credit/i.test(m)) return "The AI provider is rate-limiting or out of credit. Try again later.";
  return fallback;
}
