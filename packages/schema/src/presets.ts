import { z } from "zod";
import { projectSchema } from "./project.js";
import { layerAnimationSchema, layerSchema, sceneSchema } from "./scene.js";
import { safeUrl } from "./url.js";

/*
 * Presets and brand kits (doc §22). A preset is a reusable piece of a project: one or more elements,
 * a whole scene, an enter/exit motion, or a full project ("template"). Applying a preset always
 * creates an independent copy; the copy only remembers where it came from (`preset: { id, version }`)
 * so the editor can offer a newer version later. Nothing auto-updates.
 */

export const PRESET_TYPES = ["element", "scene", "animation", "template"] as const;
export type PresetType = (typeof PRESET_TYPES)[number];

/** "official" ships with the product (code); "personal" and "workspace" live in the cloud library. */
export const PRESET_SCOPES = ["official", "personal", "workspace"] as const;
export type PresetScope = (typeof PRESET_SCOPES)[number];

/** Smart presets declare what the user still has to supply after applying them (doc 22.3). */
export const PRESET_INPUTS = ["video", "image", "product", "logo", "cta"] as const;
export type PresetInput = (typeof PRESET_INPUTS)[number];

export const presetConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("element"), layers: z.array(layerSchema).min(1).max(20) }),
  z.object({ type: z.literal("scene"), scene: sceneSchema }),
  z.object({ type: z.literal("animation"), animation: layerAnimationSchema }),
  z.object({ type: z.literal("template"), project: projectSchema }),
]);
export type PresetConfig = z.infer<typeof presetConfigSchema>;

/** Hard limit for one stored preset. */
export const MAX_PRESET_BYTES = 256 * 1024;

/** What the editor shows and applies, whether the preset comes from code or from the library. */
export interface Preset {
  id: string;
  type: PresetType;
  scope: PresetScope;
  name: string;
  description?: string;
  inputs: PresetInput[];
  version: number;
  config: PresetConfig;
}

/* ---------------- brand kit (doc 22.4) ---------------- */

const cssColor = z.string().trim().min(1).max(64);
/** A CSS font-family value ("" = inherit the site's font). */
const fontFamily = z.string().trim().max(200);

export const brandKitSchema = z.object({
  colors: z
    .object({
      /** Buttons, product-card accent, hotspots. */
      primary: cssColor.default("#4f46e5"),
      /** Badges and highlights. */
      secondary: cssColor.default("#ef4444"),
      /** Cards (product card background) and the text on them. */
      surface: cssColor.default("#ffffff"),
      surfaceText: cssColor.default("#111111"),
    })
    .default({}),
  fonts: z
    .object({
      heading: fontFamily.default(""),
      body: fontFamily.default(""),
      /** Also load the named Google Fonts on the published page (opt-in; the editor always previews them). */
      loadGoogleFonts: z.boolean().default(false),
    })
    .default({}),
  logo: z.object({ assetId: z.string().max(64).optional(), src: safeUrl }).optional(),
  button: z
    .object({
      borderRadius: z.number().min(0).max(999).default(10),
      fontWeight: z.number().int().min(400).max(900).default(700),
      textTransform: z.enum(["none", "uppercase"]).default("none"),
    })
    .default({}),
  /** Corner radius of cards and images. */
  radius: z.number().min(0).max(999).default(14),
  shadow: z.enum(["none", "soft", "strong"]).default("soft"),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

export const DEFAULT_BRAND_KIT: BrandKit = brandKitSchema.parse({});

/** Google Fonts family names are letters, digits and spaces only (used to build the stylesheet URL). */
export const googleFontName = z.string().regex(/^[A-Za-z0-9 ]{2,60}$/);
