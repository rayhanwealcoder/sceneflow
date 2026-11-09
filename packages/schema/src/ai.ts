import { z } from "zod";
import { safeUrl } from "./url.js";

/*
 * Phase 9 — AI assistance (doc §10.2): script, storyboard, copy, voiceover, captions.
 * Everything the model produces is validated here before it touches a project, and everything that lands
 * in a project is ordinary project data (scenes, layers, captions) — nothing in the published config
 * depends on an AI provider being available later.
 */

export const CAPTION_POSITIONS = ["bottom", "top"] as const;
export const CAPTION_SIZES = ["s", "m", "l"] as const;

/** One subtitle line. Times are project seconds (same clock as scenes). */
export const captionCueSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    text: z.string().min(1).max(200),
  })
  .refine((c) => c.end > c.start, { message: "Cue end must be after start", path: ["end"] });
export type CaptionCue = z.infer<typeof captionCueSchema>;

export const captionsSchema = z.object({
  /** BCP-47-ish language tag ("en", "bn", "pt-BR"). */
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).default("en"),
  cues: z.array(captionCueSchema).max(2000).default([]),
  style: z.object({ position: z.enum(CAPTION_POSITIONS).default("bottom"), size: z.enum(CAPTION_SIZES).default("m") }).default({}),
  /** Where the cues came from — estimated from the script, transcribed from audio, or typed. */
  source: z.enum(["script", "transcript", "manual"]).optional(),
});
export type Captions = z.infer<typeof captionsSchema>;

/** Per-scene storyboard notes written by the script step. Editor-only: stripped from published configs. */
export const sceneScriptSchema = z.object({
  voiceover: z.string().max(1200).optional(),
  /** What the footage should show — doubles as a prompt for an AI video tool (docs/ai-video-prompts.md). */
  shot: z.string().max(600).optional(),
});
export type SceneScript = z.infer<typeof sceneScriptSchema>;

/** The script + storyboard the AI returns, after validation. Durations are seconds per scene. */
export const aiScriptSceneSchema = z.object({
  name: z.string().trim().min(1).max(60),
  duration: z.number().min(1).max(60),
  headline: z.string().trim().min(1).max(90),
  subline: z.string().trim().max(160).optional(),
  voiceover: z.string().trim().max(600).default(""),
  /** Button label when this scene should carry the call to action. */
  cta: z.string().trim().max(30).optional(),
  shot: z.string().trim().max(400).default(""),
});
export const aiScriptSchema = z.object({
  title: z.string().trim().min(1).max(80),
  scenes: z.array(aiScriptSceneSchema).min(1).max(12),
  cta: z.object({ label: z.string().trim().min(1).max(30), url: safeUrl.optional() }).optional(),
});
export type AiScript = z.infer<typeof aiScriptSchema>;
export type AiScriptScene = z.infer<typeof aiScriptSceneSchema>;

export const AI_TONES = ["friendly", "confident", "playful", "premium", "urgent", "calm"] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_COPY_KINDS = ["headline", "subline", "button", "badge", "tooltip", "product", "voiceover"] as const;
export type AiCopyKind = (typeof AI_COPY_KINDS)[number];

/** Request bodies shared by the API and the editor. */
export const aiScriptRequestSchema = z.object({
  projectId: z.string().uuid(),
  brief: z.string().trim().min(3).max(1500),
  durationSeconds: z.number().min(5).max(180).default(20),
  sceneCount: z.number().int().min(1).max(12).optional(),
  tone: z.enum(AI_TONES).default("friendly"),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).default("en"),
});
export type AiScriptRequest = z.infer<typeof aiScriptRequestSchema>;

export const aiCopyRequestSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(AI_COPY_KINDS),
  text: z.string().trim().max(1200).default(""),
  instruction: z.string().trim().max(300).optional(),
  tone: z.enum(AI_TONES).default("friendly"),
  count: z.number().int().min(1).max(8).default(4),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).default("en"),
  context: z.object({ product: z.object({ title: z.string().max(200), price: z.string().max(40).optional() }).optional(), brief: z.string().max(600).optional() }).optional(),
});
export type AiCopyRequest = z.infer<typeof aiCopyRequestSchema>;

/** Voice ids are provider identifiers (ElevenLabs ids, installed voice names): letters, digits, space and a few punctuation marks only. */
export const voiceIdSchema = z.string().trim().regex(/^[A-Za-z0-9 _.()-]{1,120}$/, "Invalid voice id");

export const aiVoiceoverRequestSchema = z.object({
  projectId: z.string().uuid(),
  sceneId: z.string().min(1).max(64).optional(),
  text: z.string().trim().min(1).max(1200),
  voiceId: voiceIdSchema.optional(),
});
export type AiVoiceoverRequest = z.infer<typeof aiVoiceoverRequestSchema>;

export const aiCaptionsRequestSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).optional(),
});
export type AiCaptionsRequest = z.infer<typeof aiCaptionsRequestSchema>;

/** Binary search for the cue showing at `t` (cues are sorted by start and do not overlap). */
export function cueAt(cues: readonly CaptionCue[], t: number): CaptionCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid]!;
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c;
  }
  return null;
}

/** Sorts, clamps and drops overlaps so `cueAt` can binary-search. */
export function normalizeCues(cues: readonly CaptionCue[]): CaptionCue[] {
  const sorted = cues
    .filter((c) => c.text.trim() && c.end > c.start)
    .map((c) => ({ start: Math.max(0, round3(c.start)), end: round3(c.end), text: c.text.trim().slice(0, 200) }))
    .sort((a, b) => a.start - b.start);
  const out: CaptionCue[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.start < prev.end) {
      if (c.end <= prev.end) continue;
      c.start = prev.end;
    }
    out.push(c);
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
