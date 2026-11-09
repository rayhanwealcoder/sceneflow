import { z } from "zod";
import { actionSchema } from "./actions.js";
import { productRefSchema } from "./commerce.js";
import { safeUrl } from "./url.js";

const id = z.string().min(1).max(64);
/** Normalized percentage relative to the frame (0-100 = inside the frame). */
const pct = z.number().min(-100).max(200);
const styleMap = z.record(z.string().max(64), z.union([z.string().max(256), z.number()]));

export const frameSchema = z.object({ x: pct, y: pct, w: pct, h: pct, rotation: z.number().default(0) });
export type Frame = z.infer<typeof frameSchema>;

/** Responsive overrides: only fields that differ from desktop. */
export const layerOverrideSchema = z.object({
  frame: frameSchema.partial().optional(),
  hidden: z.boolean().optional(),
  style: styleMap.optional(),
});

export const ANIMATION_TYPES = ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom"] as const;
export type AnimationType = (typeof ANIMATION_TYPES)[number];

/** Enter/exit motion is a pure function of time so it scrubs correctly forwards and backwards. */
export const animationSpecSchema = z.object({
  type: z.enum(ANIMATION_TYPES),
  duration: z.number().min(0.05).max(5).default(0.5),
  delay: z.number().min(0).max(10).default(0),
});
export type AnimationSpec = z.infer<typeof animationSpecSchema>;
export const layerAnimationSchema = z.object({ in: animationSpecSchema.optional(), out: animationSpecSchema.optional() });

export const layerSchema = z.object({
  id,
  type: z.enum(["text", "image", "video", "shape", "icon", "badge", "button", "audio", "product", "commerce-button", "hotspot", "form"]),
  name: z.string().max(120).optional(),
  frame: frameSchema,
  /** Timing in seconds relative to the scene start. Omitted = whole scene. */
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  content: z.record(z.string().max(64), z.union([z.string().max(5000), z.number(), z.boolean()])).default({}),
  /** Media asset this layer was created from (image/audio), for pickers and waveforms. */
  assetId: z.string().max(64).optional(),
  src: safeUrl.optional(),
  style: styleMap.default({}),
  action: actionSchema.optional(),
  /** Product shown by a `product` layer (card with image, title, price, variant/quantity and a button). */
  product: productRefSchema.optional(),
  animation: layerAnimationSchema.optional(),
  responsive: z.object({ tablet: layerOverrideSchema.optional(), mobile: layerOverrideSchema.optional() }).optional(),
});

/**
 * One encoded rendition of a video. The runtime picks the best fit for the player width, pixel density,
 * network profile and playback mode ("scrub" renditions have dense keyframes and no audio).
 */
export const videoSourceSchema = z.object({
  src: safeUrl,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  kind: z.enum(["progressive", "scrub"]).default("progressive"),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type VideoSource = z.infer<typeof videoSourceSchema>;

/** Backgrounds carry the resolved media URL so a published config is self-contained (the runtime never calls the API). */
export const backgroundSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("video"),
    assetId: id,
    src: safeUrl.optional(),
    poster: safeUrl.optional(),
    /** Alternative renditions (filled at publish time); `src` stays the universal fallback. */
    sources: z.array(videoSourceSchema).max(12).optional(),
    sourceStart: z.number().min(0).default(0),
    sourceEnd: z.number().min(0).optional(),
  }),
  z.object({ type: z.literal("image"), assetId: id, src: safeUrl.optional() }),
  z.object({ type: z.literal("color"), color: z.string().max(32) }),
  z.object({ type: z.literal("gradient"), css: z.string().max(512).regex(/^(linear|radial|conic)-gradient\([^;{}]*\)$/i, "Invalid gradient") }),
]);

export const sceneSchema = z
  .object({
    id,
    name: z.string().max(120),
    start: z.number().min(0),
    end: z.number().min(0),
    background: backgroundSchema,
    layers: z.array(layerSchema).max(200).default([]),
    transition: z.object({ type: z.enum(["none", "fade", "slide", "zoom"]), duration: z.number().min(0).max(5) }).default({ type: "none", duration: 0 }),
  })
  .refine((s) => s.end > s.start, { message: "Scene end must be after start", path: ["end"] });

export type Scene = z.infer<typeof sceneSchema>;
export type Layer = z.infer<typeof layerSchema>;
