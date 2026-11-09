import { inArray } from "drizzle-orm";
import type { Project, VideoSource } from "@sceneflow/schema";
import { mediaAssets, type Db, type MediaMetadata } from "@sceneflow/server";
import { uuidRe } from "./validate.js";

/*
 * Publish-time media resolution (doc 11.2 "final export uses the high-quality source"):
 * the editor works on the 540p proxy; when a version is published we attach every rendition the worker
 * produced (720p / 1080p / scroll-optimized) so the runtime can pick per device, and point `src` at the
 * best general-purpose file. Versions stay self-contained: nothing is resolved at play time.
 */

function sourcesFor(meta: MediaMetadata): VideoSource[] {
  const out: VideoSource[] = [];
  if (meta.proxyUrl) {
    const h = 540;
    const w = meta.width && meta.height ? Math.round((meta.width * h) / meta.height / 2) * 2 : undefined;
    out.push({ src: meta.proxyUrl, width: w, height: h, kind: "progressive" });
  }
  for (const r of meta.renditions?.items ?? []) out.push({ src: r.src, width: r.width || undefined, height: r.height, kind: r.kind, sizeBytes: r.sizeBytes });
  return out;
}

/** 720p when it exists (good default for any embed), otherwise what the editor used. */
function bestSrc(meta: MediaMetadata, fallback: string | undefined): string | undefined {
  const items = meta.renditions?.items ?? [];
  return items.find((r) => r.kind === "progressive" && r.height === 720)?.src ?? items.find((r) => r.kind === "progressive")?.src ?? fallback;
}

export async function resolvePublishedMedia(db: Db, config: Project): Promise<Project> {
  const ids = new Set<string>();
  if (config.video && uuidRe.test(config.video.assetId)) ids.add(config.video.assetId);
  for (const s of config.scenes) if (s.background.type === "video" && uuidRe.test(s.background.assetId)) ids.add(s.background.assetId);
  if (!ids.size) return config;
  const rows = await db.select({ id: mediaAssets.id, metadataJson: mediaAssets.metadataJson }).from(mediaAssets).where(inArray(mediaAssets.id, [...ids]));
  const metas = new Map(rows.map((r) => [r.id, r.metadataJson]));

  const video = config.video && metas.get(config.video.assetId) ? (() => {
    const meta = metas.get(config.video!.assetId)!;
    return { ...config.video!, src: bestSrc(meta, config.video!.src) ?? config.video!.src, sources: sourcesFor(meta) };
  })() : config.video;

  const scenes = config.scenes.map((s) => {
    if (s.background.type !== "video") return s;
    const meta = metas.get(s.background.assetId);
    if (!meta) return s;
    return { ...s, background: { ...s.background, src: bestSrc(meta, s.background.src), sources: sourcesFor(meta) } };
  });
  return { ...config, video, scenes };
}

/** Readiness summary of the media a config references, for diagnostics and the publish UI. */
export async function mediaReadiness(db: Db, config: Project): Promise<{ ready: number; processing: number; failed: number; hdPending: number; missing: number }> {
  const ids = new Set<string>();
  if (config.video && uuidRe.test(config.video.assetId)) ids.add(config.video.assetId);
  for (const s of config.scenes) {
    if ((s.background.type === "video" || s.background.type === "image") && uuidRe.test(s.background.assetId)) ids.add(s.background.assetId);
    for (const l of s.layers) if (l.assetId && uuidRe.test(l.assetId)) ids.add(l.assetId);
  }
  const out = { ready: 0, processing: 0, failed: 0, hdPending: 0, missing: 0 };
  if (!ids.size) return out;
  const rows = await db.select({ id: mediaAssets.id, status: mediaAssets.status, type: mediaAssets.type, metadataJson: mediaAssets.metadataJson }).from(mediaAssets).where(inArray(mediaAssets.id, [...ids]));
  const seen = new Set(rows.map((r) => r.id));
  out.missing = [...ids].filter((id) => !seen.has(id)).length;
  for (const r of rows) {
    if (r.status === "ready") out.ready++;
    else if (r.status === "failed") out.failed++;
    else out.processing++;
    if (r.type === "video" && r.metadataJson.renditions?.status === "pending") out.hdPending++;
  }
  return out;
}
