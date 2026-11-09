import type { BrandKit, Layer, Project } from "@sceneflow/schema";

/*
 * Brand kit (doc 22.4): one set of colours, fonts, logo and shapes that is applied to the elements of a
 * project. Applying is a pure Project -> Project transform, so it works for templates, presets and
 * existing projects alike, and the user can undo it like any other edit.
 */

export interface FontOption {
  label: string;
  /** CSS font-family value stored in layer styles ("" = inherit the site's font). */
  family: string;
  /** Google Fonts family name when the font can be loaded from there. */
  google?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "Site default", family: "" },
  { label: "Inter", family: '"Inter", system-ui, sans-serif', google: "Inter" },
  { label: "Poppins", family: '"Poppins", system-ui, sans-serif', google: "Poppins" },
  { label: "Montserrat", family: '"Montserrat", system-ui, sans-serif', google: "Montserrat" },
  { label: "DM Sans", family: '"DM Sans", system-ui, sans-serif', google: "DM Sans" },
  { label: "Roboto", family: '"Roboto", system-ui, sans-serif', google: "Roboto" },
  { label: "Open Sans", family: '"Open Sans", system-ui, sans-serif', google: "Open Sans" },
  { label: "Nunito", family: '"Nunito", system-ui, sans-serif', google: "Nunito" },
  { label: "Oswald", family: '"Oswald", system-ui, sans-serif', google: "Oswald" },
  { label: "Space Grotesk", family: '"Space Grotesk", system-ui, sans-serif', google: "Space Grotesk" },
  { label: "Playfair Display", family: '"Playfair Display", Georgia, serif', google: "Playfair Display" },
  { label: "Lora", family: '"Lora", Georgia, serif', google: "Lora" },
  { label: "Merriweather", family: '"Merriweather", Georgia, serif', google: "Merriweather" },
  { label: "Georgia (system serif)", family: 'Georgia, "Times New Roman", serif' },
  { label: "Helvetica / Arial", family: '"Helvetica Neue", Arial, sans-serif' },
];

/** Google Fonts family names a kit needs (heading + body, deduplicated). */
export function googleFamilies(kit: Pick<BrandKit, "fonts">): string[] {
  const names = [kit.fonts.heading, kit.fonts.body].map((family) => FONT_OPTIONS.find((f) => f.family === family)?.google).filter((n): n is string => !!n);
  return [...new Set(names)];
}

/** Black or white, whichever reads better on the given colour (hex only; anything else gets white). */
export function contrastText(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return "#ffffff";
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "#111111" : "#ffffff";
}

const SHADOW: Record<BrandKit["shadow"], string | undefined> = { none: "none", soft: "0 10px 30px rgba(0,0,0,.25)", strong: "0 18px 50px rgba(0,0,0,.45)" };

type StylePatch = Record<string, string | number | undefined>;

/** Merges a patch into a style map; `undefined` removes the key. */
function patchStyle(layer: Layer, patch: StylePatch): Layer {
  const style: Record<string, string | number> = { ...layer.style };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete style[k];
    else style[k] = v;
  }
  return { ...layer, style };
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Headlines get the heading font, everything else the body font. */
function isHeading(layer: Layer): boolean {
  return (num(layer.style.fontWeight) ?? 400) >= 700 || (num(layer.style.fontSize) ?? 0) >= 32;
}

/** Applies the kit to one element. Text colours over video are left alone (the kit cannot know the footage). */
export function brandLayer(layer: Layer, kit: BrandKit): Layer {
  const { primary, secondary, surface, surfaceText } = kit.colors;
  const body = kit.fonts.body || undefined;
  switch (layer.type) {
    case "button":
    case "commerce-button":
      return patchStyle(layer, {
        background: primary,
        color: contrastText(primary),
        borderRadius: kit.button.borderRadius,
        fontWeight: kit.button.fontWeight,
        textTransform: kit.button.textTransform === "uppercase" ? "uppercase" : undefined,
        fontFamily: body,
        boxShadow: SHADOW[kit.shadow],
      });
    case "product":
      return patchStyle(layer, { accent: primary, background: surface, color: surfaceText, borderRadius: kit.radius, fontFamily: body, boxShadow: SHADOW[kit.shadow] });
    case "badge":
      return patchStyle(layer, { background: secondary, color: contrastText(secondary), fontFamily: body });
    case "text":
      return patchStyle(layer, { fontFamily: (isHeading(layer) ? kit.fonts.heading : kit.fonts.body) || undefined });
    case "hotspot":
      return patchStyle(layer, { color: primary });
    case "image": {
      let next = (num(layer.style.borderRadius) ?? 0) > 0 ? patchStyle(layer, { borderRadius: kit.radius }) : layer;
      // A "Logo" placeholder without an image takes the kit's logo.
      if (!next.src && kit.logo && (next.name ?? "").toLowerCase() === "logo") next = { ...next, src: kit.logo.src, assetId: kit.logo.assetId };
      return next;
    }
    default:
      return layer;
  }
}

/** Applies the kit to every element and records which kit (and version) the project now follows. */
export function applyBrandKit(p: Project, kit: BrandKit, ref?: { kitId: string; version: number }): Project {
  const google = kit.fonts.loadGoogleFonts ? googleFamilies(kit) : [];
  const next: Project = { ...p, scenes: p.scenes.map((s) => ({ ...s, layers: s.layers.map((l) => brandLayer(l, kit)) })) };
  if (ref) next.brand = ref;
  else delete next.brand;
  if (google.length) next.fonts = { google };
  else delete next.fonts;
  return next;
}
