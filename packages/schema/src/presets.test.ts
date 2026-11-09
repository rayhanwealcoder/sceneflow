import { describe, expect, it } from "vitest";
import { brandKitSchema, DEFAULT_BRAND_KIT, parseProject, presetConfigSchema } from "./index.js";

const layer = { id: "l1", type: "button", frame: { x: 10, y: 80, w: 30, h: 10 }, content: { label: "Shop" }, style: { background: "#4f46e5" } };
const scene = { id: "s1", name: "A", start: 0, end: 5, background: { type: "color", color: "#000" }, layers: [layer] };

describe("preset configs", () => {
  it("accepts element, scene, animation and template presets and rejects the rest", () => {
    expect(presetConfigSchema.safeParse({ type: "element", layers: [layer] }).success).toBe(true);
    expect(presetConfigSchema.safeParse({ type: "scene", scene }).success).toBe(true);
    expect(presetConfigSchema.safeParse({ type: "animation", animation: { in: { type: "fade", duration: 0.5, delay: 0 } } }).success).toBe(true);
    expect(presetConfigSchema.safeParse({ type: "template", project: { schemaVersion: "1.0", projectId: "t", version: 1, scenes: [scene] } }).success).toBe(true);
    expect(presetConfigSchema.safeParse({ type: "element", layers: [] }).success).toBe(false);
    expect(presetConfigSchema.safeParse({ type: "scene", scene: { ...scene, end: 0 } }).success).toBe(false);
    expect(presetConfigSchema.safeParse({ type: "sticker", layers: [layer] }).success).toBe(false);
    // Preset content goes through the same URL allowlist as projects.
    expect(presetConfigSchema.safeParse({ type: "element", layers: [{ ...layer, action: { type: "OPEN_URL", url: "javascript:alert(1)", newTab: true } }] }).success).toBe(false);
  });

  it("keeps preset references on layers and scenes, and brand/fonts on the project", () => {
    const r = parseProject({
      schemaVersion: "1.0",
      projectId: "p",
      version: 1,
      brand: { kitId: "k1", version: 2 },
      fonts: { google: ["Poppins", "Playfair Display"] },
      scenes: [{ ...scene, preset: { id: "official:title-card", version: 1 }, layers: [{ ...layer, preset: { id: "abc", version: 3, part: 1 } }] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.scenes[0]!.preset).toEqual({ id: "official:title-card", version: 1 });
    expect(r.project.scenes[0]!.layers[0]!.preset).toEqual({ id: "abc", version: 3, part: 1 });
    expect(r.project.brand).toEqual({ kitId: "k1", version: 2 });
    expect(r.project.fonts?.google).toEqual(["Poppins", "Playfair Display"]);
    // Font names cannot smuggle URL syntax into the Google Fonts request.
    expect(parseProject({ schemaVersion: "1.0", projectId: "p", version: 1, fonts: { google: ["Poppins&x=1"] }, scenes: [scene] }).ok).toBe(false);
  });
});

describe("brand kit", () => {
  it("fills every field with a sensible default and validates the logo URL", () => {
    expect(DEFAULT_BRAND_KIT.colors.primary).toBe("#4f46e5");
    expect(DEFAULT_BRAND_KIT.button).toEqual({ borderRadius: 10, fontWeight: 700, textTransform: "none" });
    const kit = brandKitSchema.parse({ colors: { primary: "#0ea5e9" }, fonts: { heading: '"Poppins", sans-serif' }, logo: { src: "https://cdn.test/logo.png" } });
    expect(kit.colors.secondary).toBe("#ef4444");
    expect(kit.fonts.body).toBe("");
    expect(kit.fonts.loadGoogleFonts).toBe(false);
    expect(brandKitSchema.safeParse({ logo: { src: "javascript:alert(1)" } }).success).toBe(false);
    expect(brandKitSchema.safeParse({ button: { fontWeight: 350 } }).success).toBe(false);
  });
});
