import { z } from "zod";
import { captionsSchema } from "./ai.js";
import { sceneSchema, videoSourceSchema } from "./scene.js";
import { safeUrl } from "./url.js";

export const SUPPORTED_MAJOR = 1;
/** Hard limit for stored project JSON. The soft target is under 100 KB. */
export const MAX_PROJECT_BYTES = 512 * 1024;

/** GSAP-style trigger: "<player edge> <viewport edge>", e.g. "top bottom" = when the player's top reaches the viewport bottom. */
export const SCROLL_TRIGGER_RE = /^(top|center|bottom) (top|center|bottom)$/;
export type ScrollEdge = "top" | "center" | "bottom";

export const playbackSchema = z.object({
  mode: z.enum(["normal", "autoplay", "click", "hover", "loop", "scroll"]).default("normal"),
  controls: z.boolean().default(true),
  muted: z.boolean().default(false),
  /** Playback rate for every mode except scroll (0.25×–3×); the timeline stays in video seconds. */
  speed: z.number().min(0.25).max(3).default(1),
  // ---- Scroll Scrub (doc 9.1) ----
  /** Keep the player fixed in view while the page scrolls through `scrollDistance`. */
  pin: z.boolean().default(true),
  /** How far the page scrolls while the player is pinned (the scrub travel), like ScrollTrigger's `end: "+=300%"`. */
  scrollDistance: z.string().regex(/^\d{1,4}(vh|px)$/).default("300vh"),
  /** Where the pinned player sits in the viewport. */
  pinPosition: z.enum(["top", "center", "bottom"]).default("top"),
  /** Extra pixels from that edge, e.g. the height of a fixed site header. */
  pinOffset: z.number().int().min(-600).max(600).default(0),
  /** Unpinned only: when scrubbing starts / ends (GSAP ScrollTrigger `start` / `end` syntax). */
  triggerStart: z.string().regex(SCROLL_TRIGGER_RE).default("top bottom"),
  triggerEnd: z.string().regex(SCROLL_TRIGGER_RE).default("bottom top"),
  scrollAxis: z.enum(["vertical", "horizontal"]).default("vertical"),
  /** 0 = follow the scroll position exactly, 1 = very smooth (≈0.4 s catch-up), like ScrollTrigger's `scrub` seconds. */
  smoothness: z.number().min(0).max(1).default(0.3),
  /** Fractions of the scroll range to ignore at the start/end (dead zones). */
  startOffset: z.number().min(0).max(0.45).default(0),
  endOffset: z.number().min(0).max(0.45).default(0),
  showProgress: z.boolean().default(false),
  /** Draw start / end / pin lines on the page while testing (ScrollTrigger `markers`). */
  markers: z.boolean().default(false),
  mobileFallback: z.enum(["normal", "autoplay", "poster", "scroll"]).default("normal"),
  reducedMotion: z.enum(["normal", "poster"]).default("normal"),
  /** Show the project's captions (when it has any). Visitors can still toggle them with the CC button. */
  captions: z.boolean().default(true),
});
export type Playback = z.infer<typeof playbackSchema>;

export const CANVAS_RATIOS = ["16:9", "9:16", "1:1", "4:5", "4:3"] as const;
export type CanvasRatio = (typeof CANVAS_RATIOS)[number];

/** Numeric width/height ratio of the frame all layer percentages refer to. */
export function aspectRatioValue(ratio: CanvasRatio): number {
  const [w, h] = ratio.split(":").map(Number) as [number, number];
  return w / h;
}

/** A plain CSS colour (hex, rgb()/hsl(), a colour name or "transparent") — nothing that could carry a URL or another declaration. */
export const cssColor = z.string().max(40).regex(/^(transparent|#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24}|(rgb|rgba|hsl|hsla)\([\d\s.,%/]+\))$/);

export const canvasSchema = z.object({
  aspectRatio: z.enum(CANVAS_RATIOS).default("16:9"),
  /** Behind the video (letterboxing, before the first frame). "transparent" blends the player into the page. */
  background: cssColor.default("#000"),
});

export const projectSchema = z
  .object({
    schemaVersion: z.string().regex(/^\d+\.\d+$/),
    projectId: z.string().min(1).max(64),
    version: z.number().int().min(1),
    canvas: canvasSchema.default({}),
    video: z
      .object({
        provider: z.string().max(32),
        assetId: z.string().max(64),
        src: safeUrl,
        poster: safeUrl.optional(),
        /** Device/network renditions (doc 11.4); `src` is the fallback every runtime understands. */
        sources: z.array(videoSourceSchema).max(12).optional(),
        duration: z.number().min(0),
      })
      .optional(),
    playback: playbackSchema.default({}),
    /** Custom thumbnail shown before the first play (a chosen video frame or an uploaded image); falls back to the video's own poster. */
    poster: safeUrl.optional(),
    scenes: z.array(sceneSchema).max(100),
    /** Brand kit last applied to this project (doc 22.4); lets the editor offer a re-apply when the kit changes. */
    brand: z.object({ kitId: z.string().min(1).max(64), version: z.number().int().min(1) }).optional(),
    /** Web fonts the runtime should load for this project (opt-in from the brand kit). Family names only. */
    fonts: z.object({ google: z.array(z.string().regex(/^[A-Za-z0-9 ]{2,60}$/)).max(6).default([]) }).optional(),
    /** Where the runtime reports anonymous playback events (set at publish time); `enabled: false` turns them off. */
    analytics: z.object({ endpoint: safeUrl, enabled: z.boolean().default(true) }).optional(),
    /** Subtitles on the project clock (doc §10.2 captions). Rendered by the runtime, editable in the editor. */
    captions: captionsSchema.optional(),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    p.scenes.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: "custom", message: `Duplicate scene id ${s.id}`, path: ["scenes", i, "id"] });
      ids.add(s.id);
    });
  });

export type Project = z.infer<typeof projectSchema>;

export type ParseResult =
  | { ok: true; project: Project }
  | { ok: false; code: "TOO_LARGE" | "INVALID_JSON" | "UNSUPPORTED_VERSION" | "INVALID_SCHEMA"; message: string; issues?: z.ZodIssue[] };

/** Validate untrusted input (raw JSON string or object). Unknown fields are stripped. */
export function parseProject(input: unknown): ParseResult {
  let data = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_PROJECT_BYTES) {
      return { ok: false, code: "TOO_LARGE", message: "Project exceeds size limit" };
    }
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, code: "INVALID_JSON", message: "Not valid JSON" };
    }
  }
  const sv = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof sv === "string" && /^\d+\.\d+$/.test(sv)) {
    const major = Number(sv.split(".")[0]);
    if (major !== SUPPORTED_MAJOR) {
      return { ok: false, code: "UNSUPPORTED_VERSION", message: `Unsupported schema major version ${major}` };
    }
  }
  const r = projectSchema.safeParse(data);
  return r.success
    ? { ok: true, project: r.data }
    : { ok: false, code: "INVALID_SCHEMA", message: "Project failed validation", issues: r.error.issues };
}
