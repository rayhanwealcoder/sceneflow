import { z } from "zod";
import { sceneSchema, videoSourceSchema } from "./scene.js";
import { safeUrl } from "./url.js";

export const SUPPORTED_MAJOR = 1;
/** Hard limit for stored project JSON. The soft target is under 100 KB. */
export const MAX_PROJECT_BYTES = 512 * 1024;

export const playbackSchema = z.object({
  mode: z.enum(["normal", "autoplay", "click", "hover", "loop", "scroll"]).default("normal"),
  controls: z.boolean().default(true),
  muted: z.boolean().default(false),
  // ---- Scroll Scrub (doc 9.1) ----
  /** Keep the player fixed in view while the page scrolls through `scrollDistance`. */
  pin: z.boolean().default(true),
  scrollDistance: z.string().regex(/^\d{1,4}(vh|px)$/).default("300vh"),
  scrollAxis: z.enum(["vertical", "horizontal"]).default("vertical"),
  /** 0 = follow the scroll position exactly, 1 = very smooth / laggy. */
  smoothness: z.number().min(0).max(1).default(0.3),
  /** Fractions of the scroll range to ignore at the start/end (dead zones). */
  startOffset: z.number().min(0).max(0.45).default(0),
  endOffset: z.number().min(0).max(0.45).default(0),
  showProgress: z.boolean().default(false),
  mobileFallback: z.enum(["normal", "autoplay", "poster", "scroll"]).default("normal"),
  reducedMotion: z.enum(["normal", "poster"]).default("normal"),
});
export type Playback = z.infer<typeof playbackSchema>;

export const CANVAS_RATIOS = ["16:9", "9:16", "1:1", "4:5", "4:3"] as const;
export type CanvasRatio = (typeof CANVAS_RATIOS)[number];

/** Numeric width/height ratio of the frame all layer percentages refer to. */
export function aspectRatioValue(ratio: CanvasRatio): number {
  const [w, h] = ratio.split(":").map(Number) as [number, number];
  return w / h;
}

export const canvasSchema = z.object({ aspectRatio: z.enum(CANVAS_RATIOS).default("16:9") });

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
    scenes: z.array(sceneSchema).max(100),
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
