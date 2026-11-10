import { aspectRatioValue, type CanvasRatio, type Device, type Project, type VideoSource } from "@sceneflow/schema";
import { z } from "zod";
import type { ExportOptions } from "../db/schema.js";

/*
 * MP4 export planning (doc §31 "MP4 export"; doc §11.2 "final export uses the high-quality source where possible").
 * Pure functions shared by the API (validates a request, freezes the options) and the worker (renders them), so
 * both agree on frame size, duration and what is heard. Nothing here touches a browser or FFmpeg.
 */

export const EXPORT_QUALITIES = ["2160p", "1080p", "720p", "480p"] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
/** MP4 (H.264 + AAC, plays everywhere), WebM (VP9 + Opus, smaller for the web; keeps a transparent background), GIF (short silent loop). */
export const EXPORT_FORMATS = ["mp4", "webm", "gif"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_MIME: Record<ExportFormat, string> = { mp4: "video/mp4", webm: "video/webm", gif: "image/gif" };
export const EXPORT_FPS = [24, 25, 30, 60] as const;
/** Longest video the render worker accepts (10 minutes ≈ 18 000 frames at 30 fps). */
export const MAX_EXPORT_SECONDS = 600;
/** 4K frames are four times the work: up to 3 minutes. */
export const MAX_4K_SECONDS = 180;
/** GIFs are for short loops (e-mail, chat, product pages): 30 seconds, up to 720p, 15 frames a second. */
export const MAX_GIF_SECONDS = 30;
export const GIF_FPS = 15;
const SHORT_SIDE: Record<ExportQuality, number> = { "2160p": 2160, "1080p": 1080, "720p": 720, "480p": 480 };
/** Video codecs Google Chrome decodes from an uploaded file (MP4 / MOV / WebM container). */
export const BROWSER_DECODABLE_CODECS = ["h264", "vp8", "vp9", "av1"] as const;

export const exportRequestSchema = z.object({
  /** Current draft (default) or the live published version. */
  source: z.enum(["draft", "published"]).default("draft"),
  quality: z.enum(EXPORT_QUALITIES).default("1080p"),
  format: z.enum(EXPORT_FORMATS).default("mp4"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
  /** Responsive layout to render; "auto" = mobile for portrait canvases, desktop otherwise. */
  device: z.enum(["auto", "desktop", "tablet", "mobile"]).default("auto"),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

const even = (n: number) => Math.round(n / 2) * 2;

/** Frame size for a canvas ratio: the short side is 2160 / 1080 / 720 / 480, the long side follows the ratio, both even. */
export function exportDimensions(ratio: CanvasRatio, quality: ExportQuality): { width: number; height: number } {
  const r = aspectRatioValue(ratio);
  const short = SHORT_SIDE[quality];
  return r >= 1 ? { width: even(short * r), height: short } : { width: short, height: even(short / r) };
}

/** Portrait canvases are for phones, so they render with the mobile layout unless told otherwise. */
export function resolveExportDevice(ratio: CanvasRatio, device: ExportRequest["device"]): Device {
  if (device !== "auto") return device;
  return aspectRatioValue(ratio) < 1 ? "mobile" : "desktop";
}

export function exportOptionsFor(project: Project, req: Pick<ExportRequest, "quality" | "fps" | "device"> & { format?: ExportFormat }): ExportOptions {
  const ratio = project.canvas.aspectRatio;
  const format = req.format ?? "mp4";
  return {
    quality: req.quality,
    ...exportDimensions(ratio, req.quality),
    fps: format === "gif" ? GIF_FPS : req.fps,
    device: resolveExportDevice(ratio, req.device),
    format,
    // Only WebM keeps an alpha channel; a transparent canvas then stays see-through (overlay video).
    transparent: format === "webm" && project.canvas.background === "transparent",
  };
}

/** Why a request cannot be rendered as asked (null = fine). `duration` = wall-clock seconds of the file. */
export function exportLimitError(req: { quality: ExportQuality; format?: ExportFormat }, duration: number): string | null {
  const format = req.format ?? "mp4";
  if (format === "gif" && (req.quality === "2160p" || req.quality === "1080p")) return "GIFs go up to 720p (bigger GIFs get huge); pick 720p or 480p, or export a WebM / MP4.";
  if (format === "gif" && duration > MAX_GIF_SECONDS) return `GIFs are limited to ${MAX_GIF_SECONDS} seconds; this video is ${Math.round(duration)} seconds. Export a WebM or MP4 instead.`;
  if (req.quality === "2160p" && duration > MAX_4K_SECONDS) return `4K exports are limited to ${MAX_4K_SECONDS / 60} minutes; this video is ${Math.round(duration)} seconds. Use 1080p for longer videos.`;
  return null;
}

/**
 * Whether the render page should play the original upload instead of a rendition (doc 11.2: "final export uses
 * the high-quality source where possible"): Chrome must decode its codec, and it must not be more than twice the
 * frame size (decoding a 4K file for a 720p export costs a lot and adds nothing). Renditions are re-encodes, so the
 * original is always the sharper picture when it qualifies.
 */
export function useOriginalSource(meta: { codec?: string; width?: number; height?: number }, frame: { width: number; height: number }): boolean {
  if (!meta.codec || !(BROWSER_DECODABLE_CODECS as readonly string[]).includes(meta.codec)) return false;
  if (!meta.width || !meta.height) return false;
  const sourceShort = Math.min(meta.width, meta.height);
  const frameShort = Math.min(frame.width, frame.height);
  return sourceShort <= frameShort * 2;
}

/** Media assets the timeline plays as video (base video + scene backgrounds). */
export function videoAssetIds(project: Project): string[] {
  const ids = new Set<string>();
  if (project.video?.assetId) ids.add(project.video.assetId);
  for (const s of project.scenes) if (s.background.type === "video" && s.background.assetId) ids.add(s.background.assetId);
  return [...ids];
}

/** Length of the project timeline in video seconds: the base video, or the end of the last scene. */
export function projectDuration(p: Project): number {
  return p.video?.duration ?? p.scenes[p.scenes.length - 1]?.end ?? 0;
}

/** Playback speed the file plays at (scroll projects export as a 1× play-through, like the runtime treats them). */
export function exportSpeed(p: Project): number {
  return p.playback.mode === "scroll" ? 1 : p.playback.speed;
}

/** Wall-clock length of the exported file: the timeline divided by the playback speed. */
export function exportDuration(p: Project): number {
  return projectDuration(p) / exportSpeed(p);
}

/** Highest progressive rendition (1080p before 720p before the proxy); `fallback` when there are none. */
export function bestSource(sources: VideoSource[] | undefined, fallback: string | undefined): string | undefined {
  const progressive = (sources ?? []).filter((s) => s.kind !== "scrub" && s.src);
  if (!progressive.length) return fallback;
  return [...progressive].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]!.src;
}

/**
 * The config the render page loads: plain playback (a scroll-scrub project exports as a straight play-through),
 * no controls or progress bar, no analytics; every video plays its original upload when `originals` has a URL for
 * its asset (see useOriginalSource), otherwise its best rendition. Captions stay as authored.
 */
export function exportConfig(project: Project, originals: Record<string, string> = {}): Project {
  const { analytics: _analytics, ...rest } = project;
  const pick = (assetId: string | undefined, sources: VideoSource[] | undefined, src: string | undefined) => (assetId && originals[assetId]) || bestSource(sources, src);
  const video = project.video ? { ...project.video, src: pick(project.video.assetId, project.video.sources, project.video.src) ?? project.video.src, sources: undefined } : undefined;
  const scenes = project.scenes.map((s) => (s.background.type === "video" ? { ...s, background: { ...s.background, src: pick(s.background.assetId, s.background.sources, s.background.src), sources: undefined } } : s));
  return { ...rest, video, scenes, playback: { ...project.playback, speed: exportSpeed(project), mode: "normal", controls: false, showProgress: false, markers: false } };
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
  /** Position on the export timeline in seconds (timeline seconds; the speed is applied when mixing). */
  at: number;
  /** 0..1 */
  volume: number;
  label: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * What the player would play: the base video's own sound, or each scene's background video while that scene is
 * on, plus every audio layer (voiceover, music) from its start inside the scene. A muted project exports silent,
 * exactly like the runtime (which also keeps audio layers quiet when `playback.muted` is on). `total` is in
 * timeline (video) seconds.
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

/** `atempo` accepts 0.5–2 per stage (FFmpeg 4.x); other speeds are chained: 0.25 = 0.5·0.5, 3 = 2·1.5. */
export function tempoFilters(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  if (!(s > 0) || Math.abs(s - 1) < 1e-6) return out;
  while (s > 2) {
    out.push("atempo=2");
    s /= 2;
  }
  while (s < 0.5) {
    out.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${num(s)}`);
  return out;
}

/**
 * FFmpeg `-filter_complex` for the cues: input 0 is the rendered video, cue i is input i + 1. Every cue is
 * trimmed, sped up or slowed to the playback speed, moved to its place, padded to the full length (so `amix`
 * never re-normalises mid-way) and the 1/N scaling of `amix` is undone, with a limiter against clipping.
 * `total` is the file's length in wall-clock seconds. Works with FFmpeg ≥ 4.1 (no `normalize`).
 */
export function audioFilterGraph(cues: AudioCue[], total: number, speed = 1): { filter: string; out: string } {
  const parts: string[] = [];
  const tempo = tempoFilters(speed).join(",");
  cues.forEach((c, i) => {
    const delay = Math.max(0, Math.round((c.at / speed) * 1000));
    parts.push(
      `[${i + 1}:a]atrim=start=${num(c.sourceStart)}:end=${num(c.sourceStart + c.duration)},asetpts=PTS-STARTPTS,${tempo ? tempo + "," : ""}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${num(c.volume)},adelay=${delay}|${delay},apad,atrim=0:${num(total)},asetpts=PTS-STARTPTS[a${i}]`,
    );
  });
  if (cues.length === 1) return { filter: parts.join(";"), out: "[a0]" };
  parts.push(`${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:duration=first:dropout_transition=0,volume=${cues.length},alimiter=limit=0.95:level=0[aout]`);
  return { filter: parts.join(";"), out: "[aout]" };
}

/** `spring-launch-1080p.mp4` — ASCII only so the Content-Disposition header stays simple. */
export function exportFileName(projectName: string, quality: ExportQuality, format: ExportFormat = "mp4"): string {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "video"}-${quality}.${format}`;
}
