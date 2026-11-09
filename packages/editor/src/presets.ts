import { PRESET_INPUTS, type BrandKit, type Layer, type Preset, type PresetConfig, type PresetInput, type Project, type Scene } from "@sceneflow/schema";
import { applyBrandKit, brandLayer } from "./brand.js";
import { createLayer } from "./defaults.js";
import { round2 } from "./geometry.js";
import { newId } from "./ids.js";
import { getScene, normalizeTiming } from "./ops.js";

/*
 * Presets (doc §22). Official presets are plain data built here; personal/workspace presets come from the
 * cloud library through the same `Preset` shape. Applying any of them creates an independent copy with
 * fresh ids and a `preset: { id, version }` reference, so nothing in a project ever changes behind the
 * user's back (doc 22.3: no forced auto-update).
 */

export const INPUT_LABELS: Record<PresetInput, string> = {
  video: "your video",
  image: "an image",
  product: "your product",
  logo: "your logo",
  cta: "a link for the button",
};

const WHITE = "#ffffff";
const SOFT_SHADOW = "0 2px 12px rgba(0,0,0,.45)";
const text = (content: string, frame: Layer["frame"], style: Layer["style"], extra: Partial<Layer> = {}) => createLayer("text", { content: { text: content }, frame, style, ...extra });

function official(id: string, type: Preset["type"], name: string, description: string, config: PresetConfig, inputs: PresetInput[] = []): Preset {
  return { id: `official:${id}`, type, scope: "official", name, description, inputs, version: 1, config };
}

const scene = (name: string, duration: number, background: Scene["background"], layers: Layer[]): Scene => ({
  id: newId("s"),
  name,
  start: 0,
  end: duration,
  background,
  layers,
  transition: { type: "fade", duration: 0.3 },
});

/* ---------------- official element presets ---------------- */

const ELEMENT_PRESETS: Preset[] = [
  official("headline-sub", "element", "Headline + subtitle", "A bold title with a smaller line under it.", {
    type: "element",
    layers: [
      text("Your headline here", { x: 8, y: 14, w: 60, h: 18, rotation: 0 }, { color: WHITE, fontSize: 52, fontWeight: 800, textAlign: "left", textShadow: SOFT_SHADOW }, { name: "Headline" }),
      text("A short line that explains it", { x: 8, y: 34, w: 54, h: 10, rotation: 0 }, { color: "rgba(255,255,255,.85)", fontSize: 22, fontWeight: 500, textAlign: "left" }, { name: "Subtitle" }),
    ],
  }),
  official(
    "cta-pill",
    "element",
    "Call to action",
    "A rounded button that opens a link. Appears half a second after the scene starts.",
    {
      type: "element",
      layers: [
        createLayer("button", {
          name: "Call to action",
          content: { label: "Learn more" },
          frame: { x: 8, y: 78, w: 24, h: 11, rotation: 0 },
          style: { background: "#4f46e5", color: WHITE, fontSize: 18, fontWeight: 700, borderRadius: 999 },
          action: { type: "OPEN_URL", url: "https://example.com", newTab: true },
          animation: { in: { type: "fade", duration: 0.5, delay: 0.5 } },
        }),
      ],
    },
    ["cta"],
  ),
  official("sale-badge", "element", "Sale badge", "A small pill in the corner, e.g. “-20%” or “NEW”.", {
    type: "element",
    layers: [createLayer("badge", { name: "Sale badge", content: { text: "-20%" }, frame: { x: 80, y: 8, w: 13, h: 9, rotation: 0 }, style: { background: "#ef4444", color: WHITE, fontSize: 18, fontWeight: 800, borderRadius: 999, letterSpacing: 1 } })],
  }),
  official("lower-third", "element", "Lower third", "Name and role on a dark bar, like a TV caption. Slides in from the left.", {
    type: "element",
    layers: [
      createLayer("shape", { name: "Bar", frame: { x: 6, y: 72, w: 46, h: 15, rotation: 0 }, style: { background: "rgba(17,24,39,.85)", borderRadius: 10 }, animation: { in: { type: "slide-left", duration: 0.5, delay: 0 } } }),
      text("Jane Doe", { x: 8, y: 73, w: 42, h: 7, rotation: 0 }, { color: WHITE, fontSize: 24, fontWeight: 800, textAlign: "left" }, { name: "Name", animation: { in: { type: "slide-left", duration: 0.5, delay: 0.1 } } }),
      text("Founder, Example Co.", { x: 8, y: 80, w: 42, h: 6, rotation: 0 }, { color: "rgba(255,255,255,.8)", fontSize: 16, fontWeight: 500, textAlign: "left" }, { name: "Role", animation: { in: { type: "slide-left", duration: 0.5, delay: 0.2 } } }),
    ],
  }),
  official("price-tag", "element", "Price callout", "A white tag with a big price.", {
    type: "element",
    layers: [
      createLayer("shape", { name: "Tag", frame: { x: 70, y: 64, w: 24, h: 13, rotation: 0 }, style: { background: WHITE, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.3)" }, animation: { in: { type: "zoom", duration: 0.4, delay: 0 } } }),
      text("$49", { x: 70, y: 64, w: 24, h: 13, rotation: 0 }, { color: "#111111", fontSize: 34, fontWeight: 800, textAlign: "center" }, { name: "Price", animation: { in: { type: "zoom", duration: 0.4, delay: 0 } } }),
    ],
  }),
  official("hotspot-tip", "element", "Hotspot with tip", "A pulsing dot that shows a short text on hover.", {
    type: "element",
    layers: [createLayer("hotspot", { content: { tooltip: "Tap to learn more" }, frame: { x: 48, y: 46, w: 4, h: 7, rotation: 0 } })],
  }),
  official("product-spot", "element", "Product spotlight", "A product card with live price and Add to cart on the right.", { type: "element", layers: [createLayer("product", { frame: { x: 62, y: 8, w: 32, h: 84, rotation: 0 } })] }, ["product"]),
  official("logo-corner", "element", "Logo in the corner", "Your logo, top left. Fills itself from the brand kit.", {
    type: "element",
    layers: [createLayer("image", { name: "Logo", frame: { x: 4, y: 5, w: 14, h: 10, rotation: 0 }, style: { fit: "contain", borderRadius: 0 } })],
  }, ["logo"]),
  official("caption-bar", "element", "Caption bar", "A dark strip along the bottom with one line of text.", {
    type: "element",
    layers: [
      createLayer("shape", { name: "Strip", frame: { x: 0, y: 86, w: 100, h: 14, rotation: 0 }, style: { background: "rgba(0,0,0,.6)", borderRadius: 0 } }),
      text("Your caption goes here", { x: 4, y: 88, w: 92, h: 10, rotation: 0 }, { color: WHITE, fontSize: 22, fontWeight: 600, textAlign: "left" }, { name: "Caption" }),
    ],
  }),
];

/* ---------------- official scene presets ---------------- */

const SCENE_PRESETS: Preset[] = [
  official("title-card", "scene", "Title card", "Headline and subtitle on a gradient. Good opener.", {
    type: "scene",
    scene: scene("Title", 4, { type: "gradient", css: "linear-gradient(135deg, #0f172a, #4f46e5)" }, [
      text("Your title", { x: 10, y: 32, w: 80, h: 20, rotation: 0 }, { color: WHITE, fontSize: 60, fontWeight: 800, textAlign: "center", textShadow: SOFT_SHADOW }, { name: "Title", animation: { in: { type: "fade", duration: 0.8, delay: 0 } } }),
      text("A line about what comes next", { x: 15, y: 54, w: 70, h: 10, rotation: 0 }, { color: "rgba(255,255,255,.85)", fontSize: 24, fontWeight: 500, textAlign: "center" }, { name: "Subtitle", animation: { in: { type: "slide-up", duration: 0.7, delay: 0.3 } } }),
    ]),
  }),
  official("feature-callout", "scene", "Feature callout", "A small headline and three hotspots to move onto your footage.", {
    type: "scene",
    scene: scene("Features", 6, { type: "color", color: "#0f172a" }, [
      text("Three things worth knowing", { x: 6, y: 8, w: 60, h: 12, rotation: 0 }, { color: WHITE, fontSize: 36, fontWeight: 800, textAlign: "left", textShadow: SOFT_SHADOW }, { name: "Headline" }),
      createLayer("hotspot", { content: { tooltip: "First detail" }, frame: { x: 30, y: 50, w: 4, h: 7, rotation: 0 } }),
      createLayer("hotspot", { content: { tooltip: "Second detail" }, frame: { x: 58, y: 40, w: 4, h: 7, rotation: 0 } }),
      createLayer("hotspot", { content: { tooltip: "Third detail" }, frame: { x: 76, y: 66, w: 4, h: 7, rotation: 0 } }),
    ]),
  }, ["video"]),
  official("product-showcase", "scene", "Product showcase", "Headline on the left, product card with Add to cart on the right.", {
    type: "scene",
    scene: scene("Showcase", 8, { type: "gradient", css: "linear-gradient(135deg, #111827, #0e7490)" }, [
      text("Meet your new favourite", { x: 6, y: 20, w: 50, h: 28, rotation: 0 }, { color: WHITE, fontSize: 48, fontWeight: 800, textAlign: "left", textShadow: SOFT_SHADOW }, { name: "Headline" }),
      text("Live price and stock come from your shop.", { x: 6, y: 52, w: 48, h: 12, rotation: 0 }, { color: "rgba(255,255,255,.85)", fontSize: 20, fontWeight: 500, textAlign: "left" }, { name: "Subtitle" }),
      createLayer("product", { frame: { x: 62, y: 8, w: 32, h: 84, rotation: 0 } }),
    ]),
  }, ["product"]),
  official("quote", "scene", "Testimonial quote", "A big quote with the person's name under it.", {
    type: "scene",
    scene: scene("Quote", 5, { type: "gradient", css: "linear-gradient(180deg, #1e1b4b, #312e81)" }, [
      text("“This changed how we sell online.”", { x: 10, y: 28, w: 80, h: 28, rotation: 0 }, { color: WHITE, fontSize: 40, fontWeight: 700, textAlign: "center", fontStyle: "italic" }, { name: "Quote", animation: { in: { type: "fade", duration: 0.8, delay: 0 } } }),
      text("— Jane Doe, Example Co.", { x: 20, y: 60, w: 60, h: 8, rotation: 0 }, { color: "rgba(255,255,255,.8)", fontSize: 20, fontWeight: 500, textAlign: "center" }, { name: "Author", animation: { in: { type: "fade", duration: 0.6, delay: 0.5 } } }),
    ]),
  }),
  official("end-card", "scene", "End card", "Thanks for watching, with Watch again and a link button.", {
    type: "scene",
    scene: scene("End", 4, { type: "color", color: "#111827" }, [
      text("Thanks for watching", { x: 10, y: 26, w: 80, h: 18, rotation: 0 }, { color: WHITE, fontSize: 44, fontWeight: 800, textAlign: "center" }, { name: "Headline" }),
      createLayer("button", { name: "Watch again", content: { label: "Watch again" }, frame: { x: 22, y: 58, w: 26, h: 12, rotation: 0 }, style: { background: "rgba(255,255,255,.15)", color: WHITE, fontSize: 18, fontWeight: 700, borderRadius: 10 }, action: { type: "SEEK", time: 0 } }),
      createLayer("button", { name: "Learn more", content: { label: "Learn more" }, frame: { x: 52, y: 58, w: 26, h: 12, rotation: 0 }, style: { background: "#4f46e5", color: WHITE, fontSize: 18, fontWeight: 700, borderRadius: 10 }, action: { type: "OPEN_URL", url: "https://example.com", newTab: true } }),
    ]),
  }, ["cta"]),
];

/* ---------------- official motion presets ---------------- */

const ANIMATION_PRESETS: Preset[] = [
  official("soft-fade", "animation", "Soft fade", "Fades in over 0.6 s.", { type: "animation", animation: { in: { type: "fade", duration: 0.6, delay: 0 } } }),
  official("rise-up", "animation", "Rise up", "Slides up while fading in.", { type: "animation", animation: { in: { type: "slide-up", duration: 0.6, delay: 0 } } }),
  official("pop-in", "animation", "Pop in", "Zooms in quickly.", { type: "animation", animation: { in: { type: "zoom", duration: 0.45, delay: 0 } } }),
  official("from-left", "animation", "From the left", "Slides in from the left.", { type: "animation", animation: { in: { type: "slide-left", duration: 0.5, delay: 0 } } }),
  official("fade-in-out", "animation", "Fade in and out", "Fades in, then fades out at the end.", { type: "animation", animation: { in: { type: "fade", duration: 0.5, delay: 0 }, out: { type: "fade", duration: 0.5, delay: 0 } } }),
  official("none", "animation", "No motion", "Removes enter and exit motion.", { type: "animation", animation: {} }),
];

export const OFFICIAL_PRESETS: Preset[] = [...ELEMENT_PRESETS, ...SCENE_PRESETS, ...ANIMATION_PRESETS];

/* ---------------- saving ---------------- */

const stripRef = (l: Layer): Layer => {
  const { preset: _p, ...rest } = l;
  return rest as Layer;
};

/** Element preset from the selected layers (ids are kept; they are replaced when the preset is applied). */
export function presetFromLayers(layers: Layer[]): PresetConfig {
  return { type: "element", layers: layers.map(stripRef) };
}

/** Scene preset: the scene re-based to start at 0 (duration kept). */
export function presetFromScene(s: Scene): PresetConfig {
  const { preset: _p, ...rest } = s;
  return { type: "scene", scene: { ...rest, start: 0, end: round2(s.end - s.start), layers: s.layers.map(stripRef) } };
}

/** Full template from a project (brand reference dropped; a template can be used with any kit). */
export function presetFromProject(p: Project): PresetConfig {
  const { brand: _b, ...rest } = p;
  return { type: "template", project: { ...rest, projectId: "template", version: 1, scenes: p.scenes.map((s) => ({ ...s, layers: s.layers.map(stripRef) })) } };
}

const allLayers = (config: PresetConfig): Layer[] =>
  config.type === "element" ? config.layers : config.type === "scene" ? config.scene.layers : config.type === "template" ? config.project.scenes.flatMap((s) => s.layers) : [];

/** What the user still has to supply after applying this preset (doc 22.3 "smart presets"). */
export function detectInputs(config: PresetConfig): PresetInput[] {
  const found = new Set<PresetInput>();
  for (const l of allLayers(config)) {
    if (l.type === "product" && !l.product) found.add("product");
    if (l.type === "image" && !l.src) found.add((l.name ?? "").toLowerCase() === "logo" ? "logo" : "image");
    if ((l.type === "button" || l.type === "commerce-button") && l.action?.type === "OPEN_URL" && /^https?:\/\/(example\.com|$)/.test(l.action.url)) found.add("cta");
  }
  const scenes = config.type === "scene" ? [config.scene] : config.type === "template" ? config.project.scenes : [];
  const hasVideo = config.type === "template" && !!config.project.video;
  if (!hasVideo && scenes.some((s) => s.background.type === "video" && !s.background.src)) found.add("video");
  return PRESET_INPUTS.filter((i) => found.has(i));
}

/* ---------------- applying ---------------- */

interface ApplyOptions {
  /** Brand the copies on the way in (used for official presets, which are deliberately generic). */
  brand?: BrandKit | null;
}

/** Re-points TOGGLE_LAYER / GO_TO_SCENE actions at the copied ids; unknown scenes fall back to `fallbackSceneId`. */
function remapActions(layer: Layer, layerMap: Map<string, string>, sceneMap: Map<string, string>, fallbackSceneId: string): Layer {
  const a = layer.action;
  if (!a) return layer;
  if (a.type === "TOGGLE_LAYER") return { ...layer, action: { ...a, layerId: layerMap.get(a.layerId) ?? a.layerId } };
  if (a.type === "GO_TO_SCENE") return { ...layer, action: { ...a, sceneId: sceneMap.get(a.sceneId) ?? fallbackSceneId } };
  return layer;
}

const identityMap = (ids: string[]) => new Map(ids.map((id) => [id, id]));

function copyLayers(layers: Layer[], preset: Pick<Preset, "id" | "version">, sceneMap: Map<string, string>, fallbackSceneId: string, opts: ApplyOptions, nudge = 0): Layer[] {
  const layerMap = new Map(layers.map((l) => [l.id, newId("l")]));
  return layers.map((l, i) => {
    let c: Layer = { ...l, id: layerMap.get(l.id)!, frame: { ...l.frame, x: round2(l.frame.x + nudge), y: round2(l.frame.y + nudge) }, preset: { id: preset.id, version: preset.version, part: i } };
    c = remapActions(c, layerMap, sceneMap, fallbackSceneId);
    if (opts.brand) c = brandLayer(c, opts.brand);
    return c;
  });
}

/** Adds the preset's elements to a scene as fresh copies; a second copy of the same preset is nudged so both are visible. */
export function applyElementPreset(p: Project, sceneId: string, preset: Preset, opts: ApplyOptions = {}): { project: Project; layerIds: string[] } {
  const target = getScene(p, sceneId);
  if (preset.config.type !== "element" || !target) return { project: p, layerIds: [] };
  const nudge = target.layers.some((l) => l.preset?.id === preset.id) ? 3 : 0;
  const copies = copyLayers(preset.config.layers, preset, identityMap(p.scenes.map((s) => s.id)), sceneId, opts, nudge);
  return { project: { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? { ...s, layers: [...s.layers, ...copies] } : s)) }, layerIds: copies.map((c) => c.id) };
}

/** Inserts the preset scene after `afterSceneId` (or at the end) and re-chains the timeline. */
export function applyScenePreset(p: Project, afterSceneId: string | undefined, preset: Preset, opts: ApplyOptions = {}): { project: Project; sceneId: string } {
  if (preset.config.type !== "scene") return { project: p, sceneId: afterSceneId ?? p.scenes[0]!.id };
  const src = preset.config.scene;
  const id = newId("s");
  const sceneMap = identityMap(p.scenes.map((s) => s.id));
  sceneMap.set(src.id, id);
  let background = src.background;
  // In a main-video project every scene plays a slice of that video.
  if (p.video && background.type === "video" && background.assetId !== p.video.assetId) background = { type: "video", assetId: p.video.assetId, sourceStart: 0 };
  const copy: Scene = { ...src, id, background, layers: copyLayers(src.layers, preset, sceneMap, id, opts), preset: { id: preset.id, version: preset.version } };
  const idx = afterSceneId ? p.scenes.findIndex((s) => s.id === afterSceneId) : p.scenes.length - 1;
  const scenes = p.scenes.slice();
  scenes.splice(idx + 1, 0, copy);
  const project = normalizeTiming({ ...p, scenes });
  if (p.video) {
    const placed = project.scenes.find((s) => s.id === id);
    if (placed && placed.background.type === "video") placed.background = { ...placed.background, sourceStart: placed.start };
  }
  return { project, sceneId: id };
}

/** Sets the preset's enter/exit motion on the given layers (an empty animation removes motion). */
export function applyAnimationPreset(p: Project, sceneId: string, layerIds: string[], preset: Preset): Project {
  if (preset.config.type !== "animation") return p;
  const anim = preset.config.animation;
  const ids = new Set(layerIds);
  const next = anim.in || anim.out ? { ...(anim.in ? { in: { ...anim.in } } : {}), ...(anim.out ? { out: { ...anim.out } } : {}) } : undefined;
  return {
    ...p,
    scenes: p.scenes.map((s) =>
      s.id !== sceneId
        ? s
        : {
            ...s,
            layers: s.layers.map((l) => {
              if (!ids.has(l.id)) return l;
              const { animation: _a, ...rest } = l;
              return next ? { ...rest, animation: next } : (rest as Layer);
            }),
          },
    ),
  };
}

/** Builds a new project document from a template preset: fresh ids, version 1, optional brand kit. */
export function projectFromTemplateConfig(config: PresetConfig, projectId: string, opts: ApplyOptions & { ref?: { kitId: string; version: number } } = {}): Project {
  if (config.type !== "template") throw new Error("Not a template preset");
  const src = config.project;
  const sceneMap = new Map(src.scenes.map((s) => [s.id, newId("s")]));
  const layerMap = new Map(src.scenes.flatMap((s) => s.layers.map((l) => [l.id, newId("l")] as const)));
  const firstScene = sceneMap.get(src.scenes[0]?.id ?? "") ?? "";
  const scenes: Scene[] = src.scenes.map((s) => ({
    ...s,
    id: sceneMap.get(s.id)!,
    layers: s.layers.map((l) => remapActions({ ...l, id: layerMap.get(l.id)! }, layerMap, sceneMap, firstScene)),
  }));
  const { brand: _b, ...rest } = src;
  let project: Project = normalizeTiming({ ...rest, projectId, version: 1, scenes });
  if (opts.brand) project = applyBrandKit(project, opts.brand, opts.ref);
  return project;
}

/* ---------------- versions (doc 22.3: compare and apply manually) ---------------- */

export interface OutdatedRef {
  sceneId: string;
  /** Undefined for a scene-level reference. */
  layerId?: string;
  preset: Preset;
  from: number;
}

/** Elements and scenes copied from a library preset that has a newer version now. */
export function outdatedPresets(p: Project, library: Preset[]): OutdatedRef[] {
  const latest = new Map(library.map((x) => [x.id, x]));
  const out: OutdatedRef[] = [];
  for (const s of p.scenes) {
    const sp = s.preset && latest.get(s.preset.id);
    if (sp && s.preset && sp.version > s.preset.version) out.push({ sceneId: s.id, preset: sp, from: s.preset.version });
    for (const l of s.layers) {
      const lp = l.preset && latest.get(l.preset.id);
      if (lp && l.preset && lp.version > l.preset.version) out.push({ sceneId: s.id, layerId: l.id, preset: lp, from: l.preset.version });
    }
  }
  return out;
}

/** Pulls the look (style + motion) of the newer preset version into one element; position and text stay. */
export function refreshFromPreset(p: Project, sceneId: string, layerId: string, preset: Preset): Project {
  if (preset.config.type !== "element") return p;
  const layers = preset.config.layers;
  return {
    ...p,
    scenes: p.scenes.map((s) =>
      s.id !== sceneId
        ? s
        : {
            ...s,
            layers: s.layers.map((l) => {
              if (l.id !== layerId || !l.preset) return l;
              const part = l.preset.part ?? 0;
              const src = layers[part]?.type === l.type ? layers[part] : layers.find((x) => x.type === l.type);
              if (!src) return l;
              const { animation: _a, ...rest } = l;
              return { ...rest, style: { ...src.style }, ...(src.animation ? { animation: src.animation } : {}), preset: { ...l.preset, version: preset.version } };
            }),
          },
    ),
  };
}
