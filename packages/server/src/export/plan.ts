import { aspectRatioValue, type CanvasRatio, type Device, type Project, type VideoSource } from "@sceneflow/schema";
import { z } from "zod";
import type { ExportOptions } from "../db/schema.js";

/*
 * MP4 export planning (doc §31 "MP4 export"; doc §11.2 "final export uses the high-quality source where possible").
 * Pure functions shared by the API (validates a request, freezes the options) and the worker (renders them), so
 * both agree on frame size, duration and what is heard. Nothing here touches a browser or FFmpeg.
 */

export const EXPORT_QUALITIES = ["1080p", "720p"] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
export const EXPORT_FPS = [24, 25, 30, 60] as const;
/** Longest video the render worker accepts (10 minutes ≈ 18 000 frames at 30 fps). */
export const MAX_EXPORT_SECONDS = 600;

export const exportRequestSchema = z.object({
  /** Current draft (default) or the live published version. */
  source: z.enum(["draft", "published"]).default("draft"),
  quality: z.enum(EXPORT_QUALITIES).default("1080p"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
  /** Responsive layout to render; "auto" = mobile for portrait canvases, desktop otherwise. */
  device: z.enum(["auto", "desktop", "tablet", "mobile"]).default("auto"),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

const even = (n: number) => Math.round(n / 2) * 2;

/** Frame size for a canvas ratio: the short side is 1080 (or 720), the long side follows the ratio, both even. */
export function exportDimensions(ratio: CanvasRatio, quality: ExportQuality): { width: number; height: number } {
  const r = aspectRatioValue(ratio);
  const short = quality === "1080p" ? 1080 : 720;
  return r >= 1 ? { width: even(short * r), height: short } : { width: short, height: even(short / r) };
}

/** Portrait canvases are for phones, so they render with the mobile layout unless told otherwise. */
export function resolveExportDevice(ratio: CanvasRatio, device: ExportRequest["device"]): Device {
  if (device !== "auto") return device;
  return aspectRatioValue(ratio) < 1 ? "mobile" : "desktop";
}

export function exportOptionsFor(project: Project, req: Pick<ExportRequest, "quality" | "fps" | "device">): ExportOptions {
  const ratio = project.canvas.aspectRatio;
  return { quality: req.quality, ...exportDimensions(ratio, req.quality), fps: req.fps, device: resolveExportDevice(ratio, req.device) };
}

/** Length of the export: the base video, or the end of the last scene. */
export function projectDuration(p: Project): number {
  return p.video?.duration ?? p.scenes[p.scenes.length - 1]?.end ?? 0;
}

/** Highest progressive rendition (1080p before 720p before the proxy); `fallback` when there are none. */
export function bestSource(sources: VideoSource[] | undefined, fallback: string | undefined): string | undefined {
  const progressive = (sources ?? []).filter((s) => s.kind !== "scrub" && s.src);
  if (!progressive.length) return fallback;
  return [...progressive].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]!.src;
}

/**
 * The config the render page loads: plain playback (a scroll-scrub project exports as a straight play-through),
 * no controls or progress bar, the best rendition of every video, no analytics. Captions stay as authored.
 */
export function exportConfig(project: Project): Project {
  const { analytics: _analytics, ...rest } = project;
  const video = project.video ? { ...project.video, src: bestSource(project.video.sources, project.video.src) ?? project.video.src, sources: undefined } : undefined;
  const scenes = project.scenes.map((s) => (s.background.type === "video" ? { ...s, background: { ...s.background, src: bestSource(s.background.sources, s.background.src), sources: undefined } } : s));
  return { ...rest, video, scenes, playback: { ...project.playback, mode: "normal", controls: false, showProgress: false } };
}

/** One piece of audio on the export timeline. */
export interface AudioCue {
  /** Media asset the URL came from, when known — the worker then mixes from the original instead of the proxy. */
  assetId?: string;
  src: string;
  /** Seconds into the source file where the cue begins. */
  sourceStart: number;
  /** Length in seconds. */
  duration: number;
  /** Position on the export timeline in seconds. */
  at: number;
  /** 0..1 */
  volume: number;
  label: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * What the player would play: the base video's own sound, or each scene's background video while that scene is
 * on, plus every audio layer (voiceover, music) from its start inside the scene. A muted project exports silent,
 * exactly like the runtime (which also keeps audio layers quiet when `playback.muted` is on).
 */
export function audioPlan(project: Project, total: number): AudioCue[] {
  if (project.playback.muted || total <= 0) return [];
  const cues: AudioCue[] = [];
  if (project.video) cues.push({ assetId: project.video.assetId, src: project.video.src, sourceStart: 0, duration: project.video.duration, at: 0, volume: 1, label: "video" });
  for (const scene of project.scenes) {
    const len = scene.end - scene.start;
    const bg = scene.background;
    if (!project.video && bg.type === "video" && bg.src) cues.push({ assetId: bg.assetId, src: bg.src, sourceStart: bg.sourceStart, duration: len, at: scene.start, volume: 1, label: scene.name || "scene" });
    for (const layer of scene.layers) {
      if (layer.type !== "audio" || !layer.src || layer.hidden) continue;
      const start = layer.start ?? 0;
      const end = Math.min(layer.end ?? len, len);
      if (end <= start) continue;
      const vol = Number(layer.content.volume);
      cues.push({ assetId: layer.assetId, src: layer.src, sourceStart: 0, duration: end - start, at: scene.start + start, volume: Number.isFinite(vol) ? clamp01(vol) : 1, label: layer.name ?? "audio" });
    }
  }
  return cues.filter((c) => c.at < total && c.duration > 0).map((c) => ({ ...c, duration: Math.min(c.duration, total - c.at) }));
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

/**
 * FFmpeg `-filter_complex` for the cues: input 0 is the rendered video, cue i is input i + 1. Every cue is
 * trimmed, moved to its place, padded to the full length (so `amix` never re-normalises mid-way) and the
 * 1/N scaling of `amix` is undone, with a limiter against clipping. Works with FFmpeg ≥ 4.1 (no `normalize`).
 */
export function audioFilterGraph(cues: AudioCue[], total: number): { filter: string; out: string } {
  const parts: string[] = [];
  cues.forEach((c, i) => {
    const delay = Math.max(0, Math.round(c.at * 1000));
    parts.push(
      `[${i + 1}:a]atrim=start=${num(c.sourceStart)}:end=${num(c.sourceStart + c.duration)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${num(c.volume)},adelay=${delay}|${delay},apad,atrim=0:${num(total)},asetpts=PTS-STARTPTS[a${i}]`,
    );
  });
  if (cues.length === 1) return { filter: parts.join(";"), out: "[a0]" };
  parts.push(`${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:duration=first:dropout_transition=0,volume=${cues.length},alimiter=limit=0.95:level=0[aout]`);
  return { filter: parts.join(";"), out: "[aout]" };
}

/** `spring-launch-1080p.mp4` — ASCII only so the Content-Disposition header stays simple. */
export function exportFileName(projectName: string, quality: ExportQuality): string {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "video"}-${quality}.mp4`;
}
