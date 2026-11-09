import { describe, expect, it } from "vitest";
import { brandKitSchema, parseProject, presetConfigSchema, type Preset } from "@sceneflow/schema";
import { applyBrandKit, contrastText, googleFamilies } from "./brand.js";
import { createLayer } from "./defaults.js";
import { addLayer, createEmptyProject } from "./ops.js";
import { applyAnimationPreset, applyElementPreset, applyScenePreset, detectInputs, OFFICIAL_PRESETS, outdatedPresets, presetFromLayers, presetFromProject, presetFromScene, projectFromTemplateConfig, refreshFromPreset } from "./presets.js";
import { createProjectFromTemplate } from "./templates.js";

const byId = (id: string) => OFFICIAL_PRESETS.find((p) => p.id === `official:${id}`)!;

describe("official presets", () => {
  it("are valid preset configs with the declared inputs", () => {
    expect(OFFICIAL_PRESETS.length).toBeGreaterThan(15);
    for (const p of OFFICIAL_PRESETS) {
      const r = presetConfigSchema.safeParse(p.config);
      expect(r.success, `${p.id}: ${JSON.stringify(!r.success && r.error.issues)}`).toBe(true);
      expect(p.scope).toBe("official");
    }
    expect(detectInputs(byId("product-spot").config)).toEqual(["product"]);
    expect(detectInputs(byId("logo-corner").config)).toEqual(["logo"]);
    expect(detectInputs(byId("cta-pill").config)).toEqual(["cta"]);
    expect(detectInputs(byId("headline-sub").config)).toEqual([]);
  });
});

describe("applying presets (AC-008)", () => {
  it("adds element copies with fresh ids and a preset reference; a second copy is nudged", () => {
    const p = createEmptyProject("p");
    const sceneId = p.scenes[0]!.id;
    const a = applyElementPreset(p, sceneId, byId("lower-third"));
    expect(a.layerIds).toHaveLength(3);
    const layers = a.project.scenes[0]!.layers;
    expect(layers.map((l) => l.preset)).toEqual([
      { id: "official:lower-third", version: 1, part: 0 },
      { id: "official:lower-third", version: 1, part: 1 },
      { id: "official:lower-third", version: 1, part: 2 },
    ]);
    // Ids are new, the preset itself untouched.
    const src = byId("lower-third").config;
    const srcIds = new Set(src.type === "element" ? src.layers.map((x) => x.id) : []);
    expect(layers.some((l) => srcIds.has(l.id))).toBe(false);
    const b = applyElementPreset(a.project, sceneId, byId("lower-third"));
    expect(b.project.scenes[0]!.layers[3]!.frame.x).toBe(layers[0]!.frame.x + 3);
    expect(parseProject(b.project).ok).toBe(true);
  });

  it("remaps TOGGLE_LAYER inside a group and keeps GO_TO_SCENE targets valid", () => {
    const p = createEmptyProject("p");
    const s = p.scenes[0]!.id;
    const btn = createLayer("button", { id: "b", action: { type: "TOGGLE_LAYER", layerId: "t" } });
    const txt = createLayer("text", { id: "t" });
    const jump = createLayer("button", { id: "j", action: { type: "GO_TO_SCENE", sceneId: "missing" } });
    const preset: Preset = { id: "grp", type: "element", scope: "workspace", name: "Group", inputs: [], version: 1, config: presetFromLayers([btn, txt, jump]) };
    const r = applyElementPreset(p, s, preset);
    const [nb, nt, nj] = r.project.scenes[0]!.layers;
    expect(nb!.action).toEqual({ type: "TOGGLE_LAYER", layerId: nt!.id });
    expect(nj!.action).toEqual({ type: "GO_TO_SCENE", sceneId: s });
  });

  it("inserts a scene preset after the current scene with contiguous timing", () => {
    const p = createProjectFromTemplate("explainer", "p");
    const first = p.scenes[0]!.id;
    const r = applyScenePreset(p, first, byId("title-card"));
    expect(r.project.scenes).toHaveLength(3);
    expect(r.project.scenes[1]!.id).toBe(r.sceneId);
    expect(r.project.scenes[1]!.preset).toEqual({ id: "official:title-card", version: 1 });
    let t = 0;
    for (const s of r.project.scenes) {
      expect(s.start).toBe(t);
      t = s.end;
    }
    expect(r.project.scenes[1]!.end - r.project.scenes[1]!.start).toBe(4);
    expect(parseProject(r.project).ok).toBe(true);
  });

  it("sets or clears motion on the selected layers", () => {
    const p = createEmptyProject("p");
    const s = p.scenes[0]!.id;
    const a = addLayer(p, s, "text");
    const b = addLayer(a.project, s, "badge");
    const withMotion = applyAnimationPreset(b.project, s, [a.layerId], byId("rise-up"));
    expect(withMotion.scenes[0]!.layers[0]!.animation).toEqual({ in: { type: "slide-up", duration: 0.6, delay: 0 } });
    expect(withMotion.scenes[0]!.layers[1]!.animation).toBeUndefined();
    const cleared = applyAnimationPreset(withMotion, s, [a.layerId], byId("none"));
    expect(cleared.scenes[0]!.layers[0]!.animation).toBeUndefined();
  });

  it("round-trips a saved scene and template through the library shape", () => {
    const p = createProjectFromTemplate("scroll-story", "p");
    const sc = presetFromScene(p.scenes[1]!);
    expect(sc.type === "scene" && sc.scene.start).toBe(0);
    expect(presetConfigSchema.safeParse(sc).success).toBe(true);
    const tpl = presetFromProject(p);
    expect(presetConfigSchema.safeParse(tpl).success).toBe(true);
    const fresh = projectFromTemplateConfig(tpl, "new-project");
    expect(fresh.projectId).toBe("new-project");
    expect(fresh.version).toBe(1);
    expect(fresh.playback.mode).toBe("scroll");
    const oldIds = new Set(p.scenes.flatMap((s) => [s.id, ...s.layers.map((l) => l.id)]));
    for (const s of fresh.scenes) {
      expect(oldIds.has(s.id)).toBe(false);
      for (const l of s.layers) expect(oldIds.has(l.id)).toBe(false);
    }
    expect(parseProject(fresh).ok).toBe(true);
  });

  it("reports newer library versions and refreshes the look of one element on request", () => {
    const p = createEmptyProject("p");
    const s = p.scenes[0]!.id;
    const v1: Preset = { id: "lib-1", type: "element", scope: "workspace", name: "CTA", inputs: [], version: 1, config: presetFromLayers([createLayer("button", { style: { background: "#000", color: "#fff", borderRadius: 4 } })]) };
    const applied = applyElementPreset(p, s, v1);
    const v2: Preset = { ...v1, version: 2, config: presetFromLayers([createLayer("button", { style: { background: "#0ea5e9", color: "#fff", borderRadius: 999 }, animation: { in: { type: "zoom", duration: 0.4, delay: 0 } } })]) };
    expect(outdatedPresets(applied.project, [v1])).toEqual([]);
    const out = outdatedPresets(applied.project, [v2]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sceneId: s, layerId: applied.layerIds[0], from: 1 });
    const moved = { ...applied.project, scenes: [{ ...applied.project.scenes[0]!, layers: applied.project.scenes[0]!.layers.map((l) => ({ ...l, frame: { ...l.frame, x: 50 }, content: { label: "Mine" } })) }] };
    const refreshed = refreshFromPreset(moved, s, applied.layerIds[0]!, v2);
    const l = refreshed.scenes[0]!.layers[0]!;
    expect(l.style.background).toBe("#0ea5e9");
    expect(l.frame.x).toBe(50);
    expect(l.content.label).toBe("Mine");
    expect(l.animation?.in?.type).toBe("zoom");
    expect(l.preset?.version).toBe(2);
    expect(outdatedPresets(refreshed, [v2])).toEqual([]);
  });
});

describe("brand kit", () => {
  const kit = brandKitSchema.parse({ colors: { primary: "#facc15", secondary: "#0f172a", surface: "#0f172a", surfaceText: "#f8fafc" }, fonts: { heading: '"Poppins", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif', loadGoogleFonts: true }, button: { borderRadius: 999, fontWeight: 800, textTransform: "uppercase" }, radius: 6, logo: { src: "https://cdn.test/logo.png", assetId: "logo-1" } });

  it("picks readable text colours", () => {
    expect(contrastText("#facc15")).toBe("#111111");
    expect(contrastText("#0f172a")).toBe("#ffffff");
    expect(contrastText("#fff")).toBe("#111111");
    expect(contrastText("rgba(0,0,0,.5)")).toBe("#ffffff");
  });

  it("brands buttons, product cards, badges, fonts and the logo placeholder; records the kit on the project", () => {
    const shoppable = createProjectFromTemplate("shoppable", "p");
    const base = applyElementPreset(shoppable, shoppable.scenes[0]!.id, byId("logo-corner"));
    const branded = applyBrandKit(base.project, kit, { kitId: "k1", version: 3 });
    const layers = branded.scenes[0]!.layers;
    const badge = layers.find((l) => l.type === "badge")!;
    const product = layers.find((l) => l.type === "product")!;
    const headline = layers.find((l) => l.type === "text")!;
    const logo = layers.find((l) => l.type === "image")!;
    expect(badge.style.background).toBe("#0f172a");
    expect(badge.style.color).toBe("#ffffff");
    expect(product.style).toMatchObject({ accent: "#facc15", background: "#0f172a", color: "#f8fafc", borderRadius: 6, fontFamily: '"Inter", system-ui, sans-serif' });
    expect(headline.style.fontFamily).toBe('"Poppins", system-ui, sans-serif');
    expect(logo.src).toBe("https://cdn.test/logo.png");
    expect(logo.assetId).toBe("logo-1");
    expect(branded.brand).toEqual({ kitId: "k1", version: 3 });
    expect(branded.fonts).toEqual({ google: ["Poppins", "Inter"] });
    expect(parseProject(branded).ok).toBe(true);

    // Buttons added later follow the kit too.
    const withButton = addLayer(branded, branded.scenes[0]!.id, "button", {}, kit);
    const btn = withButton.project.scenes[0]!.layers.at(-1)!;
    expect(btn.style).toMatchObject({ background: "#facc15", color: "#111111", borderRadius: 999, fontWeight: 800, textTransform: "uppercase" });

    // Without the Google opt-in no fonts are requested from the published page.
    const quiet = applyBrandKit(branded, { ...kit, fonts: { ...kit.fonts, loadGoogleFonts: false } });
    expect(quiet.fonts).toBeUndefined();
    expect(quiet.brand).toBeUndefined();
    expect(googleFamilies(kit)).toEqual(["Poppins", "Inter"]);
  });
});
