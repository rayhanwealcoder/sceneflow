import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { MAX_FRAMES, mediaAssets, QUEUES, type Db, type JobSender, type MediaFrame, type MediaMetadata, type MediaRendition, type MediaRenditionsJob, type StorageProvider } from "@sceneflow/server";
import { audioArgs, ffmpeg, ffmpegBuffer, ffprobe, imageArgs, pcmArgs, peaksFromPcm16, posterArgs, proxyArgs, renditionArgs, renditionPlan, scrubArgs, thumbnailArgs } from "./ffmpeg.js";

export interface ProcessDeps {
  db: Db;
  storage: StorageProvider;
  /** When present, videos get a follow-up renditions job (worker offloading). */
  queue?: JobSender;
}

async function setProgress(db: Db, assetId: string, meta: MediaMetadata, stage: string, percent: number): Promise<void> {
  meta.progress = { stage, percent };
  await db.update(mediaAssets).set({ metadataJson: meta, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
}

/**
 * Fast path — turns an uploaded original into editor-ready derivatives within seconds:
 *   video -> metadata, poster.jpg, proxy-540.mp4, 10 thumbnails, waveform.json (if it has audio)
 *   image -> metadata, editor.webp (also used as poster)
 *   audio -> metadata, audio.m4a, waveform.json
 * The asset becomes "ready" here; device renditions (720p/1080p/scrub) follow in `processRenditions`.
 * The original is never published; only files under the public prefix are.
 */
export async function processMedia({ db, storage, queue }: ProcessDeps, assetId: string): Promise<MediaMetadata> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, assetId) });
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  if (!asset.providerAssetId) throw new Error(`Asset ${assetId} has no storage key`);

  await db.update(mediaAssets).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
  const workDir = await mkdtemp(join(tmpdir(), "sceneflow-"));
  const keyBase = dirname(asset.providerAssetId); // <workspaceId>/<assetId>

  try {
    const input = await storage.readOriginal(asset.providerAssetId);
    const probe = await ffprobe(input);
    const meta: MediaMetadata = { duration: probe.duration, width: probe.width, height: probe.height, codec: probe.codec, hasAudio: probe.hasAudio };

    if (asset.type === "video") {
      await setProgress(db, assetId, meta, "Creating poster", 10);
      const poster = join(workDir, "poster.jpg");
      await ffmpeg(posterArgs(input, Math.min(1, probe.duration * 0.1), poster));
      meta.posterUrl = await storage.putPublic(`${keyBase}/poster.jpg`, poster, "image/jpeg");

      await setProgress(db, assetId, meta, "Encoding editor preview", 30);
      const proxy = join(workDir, "proxy-540.mp4");
      await ffmpeg(proxyArgs(input, proxy));
      meta.proxyUrl = await storage.putPublic(`${keyBase}/proxy-540.mp4`, proxy, "video/mp4");

      await setProgress(db, assetId, meta, "Making thumbnails", 75);
      const every = Math.max(0.5, probe.duration / 10);
      await ffmpeg(thumbnailArgs(input, every, join(workDir, "thumb-%02d.jpg")));
      const thumbs = (await readdir(workDir)).filter((f) => f.startsWith("thumb-")).sort();
      meta.thumbnails = [];
      for (const t of thumbs) meta.thumbnails.push(await storage.putPublic(`${keyBase}/${t}`, join(workDir, t), "image/jpeg"));
    } else if (asset.type === "image") {
      await setProgress(db, assetId, meta, "Optimizing image", 40);
      const editor = join(workDir, "editor.webp");
      await ffmpeg(imageArgs(input, editor));
      meta.editorUrl = await storage.putPublic(`${keyBase}/editor.webp`, editor, "image/webp");
      meta.posterUrl = meta.editorUrl;
    } else if (asset.type === "audio") {
      await setProgress(db, assetId, meta, "Converting audio", 40);
      const audio = join(workDir, "audio.m4a");
      await ffmpeg(audioArgs(input, audio));
      meta.audioUrl = await storage.putPublic(`${keyBase}/audio.m4a`, audio, "audio/mp4");
    }

    if (probe.hasAudio) {
      await setProgress(db, assetId, meta, "Analyzing audio", 90);
      const peaks = peaksFromPcm16(await ffmpegBuffer(pcmArgs(input)));
      const wf = join(workDir, "waveform.json");
      await writeFile(wf, JSON.stringify({ version: 1, duration: probe.duration, peaks }));
      meta.waveformUrl = await storage.putPublic(`${keyBase}/waveform.json`, wf, "application/json");
    }

    delete meta.progress;
    if (asset.type === "video") {
      const plan = renditionPlan(probe.height, probe.duration);
      meta.renditions = plan.length && queue ? { status: "pending", items: [] } : { status: "skipped", items: [] };
    }
    await db.update(mediaAssets).set({ status: "ready", metadataJson: meta, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    if (meta.renditions?.status === "pending" && queue) {
      const job: MediaRenditionsJob = { assetId };
      await queue.send(QUEUES.mediaRenditions, job, { retryLimit: 1, retryDelay: 30, expireInSeconds: 2 * 60 * 60 });
    }
    return meta;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 1000) : String(err);
    await db.update(mediaAssets).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * One full-size still at `time` for a custom thumbnail. Idempotent per time (same key), recorded on the asset so
 * the API can hand the URL to the editor as soon as it exists. The list keeps the newest `MAX_FRAMES` entries.
 */
export async function extractFrame({ db, storage }: ProcessDeps, assetId: string, time: number): Promise<MediaFrame> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, assetId) });
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  if (asset.type !== "video" || asset.status !== "ready") throw new Error(`Asset ${assetId} is not a ready video`);
  const duration = asset.metadataJson.duration ?? 0;
  const at = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, Math.max(0, duration - 0.05)));
  const ms = Math.round(at * 1000);
  const existing = asset.metadataJson.frames?.find((f) => Math.round(f.time * 1000) === ms);
  if (existing) return existing;
  const workDir = await mkdtemp(join(tmpdir(), "sceneflow-f-"));
  try {
    const input = await storage.readOriginal(asset.providerAssetId);
    const out = join(workDir, `frame-${ms}.jpg`);
    await ffmpeg(posterArgs(input, at, out));
    const url = await storage.putPublic(`${dirname(asset.providerAssetId)}/frame-${ms}.jpg`, out, "image/jpeg");
    const frame: MediaFrame = { time: ms / 1000, url };
    // Re-read: the renditions job may have written the metadata meanwhile.
    const fresh = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, assetId) });
    const meta: MediaMetadata = { ...(fresh ?? asset).metadataJson };
    meta.frames = [...(meta.frames ?? []).filter((f) => Math.round(f.time * 1000) !== ms), frame].slice(-MAX_FRAMES);
    await db.update(mediaAssets).set({ metadataJson: meta, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    return frame;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Slow path — device renditions for a ready video: 720p / 1080p playback files (never upscaled) and a
 * scroll-optimized MP4 for short clips. Runs after the editor is already usable; failures never touch
 * the "ready" status, they are recorded under `renditions.error`.
 */
export async function processRenditions({ db, storage }: ProcessDeps, assetId: string): Promise<MediaRendition[]> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, assetId) });
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  if (asset.type !== "video" || asset.status !== "ready") return [];
  const meta: MediaMetadata = { ...asset.metadataJson };
  const plan = renditionPlan(meta.height, meta.duration ?? 0);
  if (!plan.length) {
    meta.renditions = { status: "skipped", items: [] };
    await db.update(mediaAssets).set({ metadataJson: meta, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    return [];
  }
  const workDir = await mkdtemp(join(tmpdir(), "sceneflow-r-"));
  const keyBase = dirname(asset.providerAssetId);
  const items: MediaRendition[] = [];
  try {
    const input = await storage.readOriginal(asset.providerAssetId);
    for (const [i, step] of plan.entries()) {
      const label = step.kind === "scrub" ? "Encoding scroll version" : `Encoding ${step.height}p`;
      await setProgress(db, assetId, { ...meta, renditions: { status: "pending", items } }, label, Math.round((i / plan.length) * 100));
      const name = step.kind === "scrub" ? `scrub-${step.height}.mp4` : `video-${step.height}.mp4`;
      const out = join(workDir, name);
      await ffmpeg(step.kind === "scrub" ? scrubArgs(input, out, step.height) : renditionArgs(input, out, step.height, Boolean(meta.hasAudio)));
      const probe = await ffprobe(out);
      const src = await storage.putPublic(`${keyBase}/${name}`, out, "video/mp4");
      items.push({ src, width: probe.width ?? 0, height: probe.height ?? step.height, kind: step.kind, sizeBytes: (await stat(out)).size });
    }
    delete meta.progress;
    meta.renditions = { status: "ready", items };
    await db.update(mediaAssets).set({ metadataJson: meta, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    return items;
  } catch (err) {
    delete meta.progress;
    meta.renditions = { status: "failed", items, error: err instanceof Error ? err.message.slice(0, 500) : String(err) };
    await db.update(mediaAssets).set({ metadataJson: meta, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
