import { describe, expect, it } from "vitest";
import { deviceFromWidth, isLayerVisibleAt, resolveLayer, sceneAt, type Layer, type Scene } from "./index.js";

const layer: Layer = {
  id: "l1",
  type: "text",
  frame: { x: 10, y: 10, w: 50, h: 10, rotation: 0 },
  locked: false,
  hidden: false,
  content: { text: "Hi" },
  style: { color: "#fff", fontSize: 40 },
  responsive: {
    tablet: { frame: { w: 70 }, style: { fontSize: 32 } },
    mobile: { frame: { x: 5 }, hidden: true },
  },
};

describe("resolveLayer", () => {
  it("returns desktop values untouched", () => {
    const r = resolveLayer(layer, "desktop");
    expect(r.frame).toEqual(layer.frame);
    expect(r.style.fontSize).toBe(40);
    expect(r.overridden).toEqual({ frame: false, hidden: false, style: false });
  });
  it("applies tablet overrides", () => {
    const r = resolveLayer(layer, "tablet");
    expect(r.frame).toEqual({ x: 10, y: 10, w: 70, h: 10, rotation: 0 });
    expect(r.style.fontSize).toBe(32);
    expect(r.overridden.frame).toBe(true);
    expect(r.hidden).toBe(false);
  });
  it("mobile inherits tablet then applies its own", () => {
    const r = resolveLayer(layer, "mobile");
    expect(r.frame).toEqual({ x: 5, y: 10, w: 70, h: 10, rotation: 0 });
    expect(r.style.fontSize).toBe(32);
    expect(r.hidden).toBe(true);
    expect(r.overridden).toEqual({ frame: true, hidden: true, style: false });
  });
});

describe("timing helpers", () => {
  const scene: Scene = { id: "s", name: "S", start: 10, end: 20, background: { type: "color", color: "#000" }, layers: [], transition: { type: "none", duration: 0 } };
  it("layer visibility is relative to the scene", () => {
    const timed = { ...layer, start: 2, end: 5 };
    expect(isLayerVisibleAt(timed, scene, 11)).toBe(false);
    expect(isLayerVisibleAt(timed, scene, 12)).toBe(true);
    expect(isLayerVisibleAt(timed, scene, 15)).toBe(false);
    expect(isLayerVisibleAt(layer, scene, 19.9)).toBe(true);
    expect(isLayerVisibleAt(layer, scene, null)).toBe(true);
  });
  it("sceneAt finds the active scene and clamps to the last one", () => {
    const s2: Scene = { ...scene, id: "s2", start: 20, end: 30 };
    expect(sceneAt([scene, s2], 15)?.id).toBe("s");
    expect(sceneAt([scene, s2], 20)?.id).toBe("s2");
    expect(sceneAt([scene, s2], 31)?.id).toBe("s2");
    expect(sceneAt([scene, s2], 5)).toBeUndefined();
  });
  it("maps widths to devices", () => {
    expect(deviceFromWidth(400)).toBe("mobile");
    expect(deviceFromWidth(800)).toBe("tablet");
    expect(deviceFromWidth(1400)).toBe("desktop");
  });
});
