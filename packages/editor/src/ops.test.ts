import { describe, expect, it } from "vitest";
import { parseProject, resolveLayer } from "@sceneflow/schema";
import { canRedo, canUndo, createHistory, push, redo, replace, undo } from "./history.js";
import {
  addLayer,
  addScene,
  alignLayers,
  clearOverride,
  createEmptyProject,
  duplicateLayers,
  duplicateScene,
  getLayer,
  moveScene,
  removeLayers,
  removeScene,
  reorderLayer,
  setSceneDuration,
  updateLayer,
  updateLayerForDevice,
} from "./ops.js";

const valid = (p: unknown) => parseProject(p).ok;

describe("scene operations keep the document valid and contiguous", () => {
  it("adds, reorders, resizes and removes scenes", () => {
    let p = createEmptyProject("p1");
    const first = p.scenes[0]!.id;
    const a = addScene(p, first, 3);
    p = a.project;
    expect(p.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 5],
      [5, 8],
    ]);
    p = setSceneDuration(p, first, 2);
    expect(p.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [2, 5],
    ]);
    p = moveScene(p, a.sceneId, -1);
    expect(p.scenes[0]!.id).toBe(a.sceneId);
    expect(p.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [3, 5],
    ]);
    const d = duplicateScene(p, first);
    expect(d.project.scenes).toHaveLength(3);
    expect(d.project.scenes[2]!.id).toBe(d.sceneId);
    expect(valid(d.project)).toBe(true);
    p = removeScene(removeScene(d.project, d.sceneId), a.sceneId);
    expect(p.scenes).toHaveLength(1);
    expect(removeScene(p, first).scenes).toHaveLength(1); // never below one scene
    expect(valid(p)).toBe(true);
  });
});

describe("layer operations", () => {
  const base = createEmptyProject("p1");
  const sid = base.scenes[0]!.id;

  it("adds every element type with valid defaults", () => {
    let p = base;
    for (const t of ["text", "image", "button", "shape", "badge", "hotspot", "audio"] as const) p = addLayer(p, sid, t).project;
    expect(p.scenes[0]!.layers).toHaveLength(7);
    expect(valid(p)).toBe(true);
  });

  it("duplicates with an offset and removes", () => {
    const a = addLayer(base, sid, "text");
    const d = duplicateLayers(a.project, sid, [a.layerId]);
    const copy = getLayer(d.project, sid, d.layerIds[0]!)!;
    expect(copy.frame.x).toBe(10);
    expect(copy.id).not.toBe(a.layerId);
    expect(removeLayers(d.project, sid, [a.layerId, copy.id]).scenes[0]!.layers).toHaveLength(0);
  });

  it("reorders z-index", () => {
    let p = base;
    const ids: string[] = [];
    for (const t of ["text", "shape", "badge"] as const) {
      const r = addLayer(p, t === "text" ? sid : sid, t);
      p = r.project;
      ids.push(r.layerId);
    }
    const order = (q: typeof p) => q.scenes[0]!.layers.map((l) => l.id);
    expect(order(reorderLayer(p, sid, ids[0]!, "top"))).toEqual([ids[1], ids[2], ids[0]]);
    expect(order(reorderLayer(p, sid, ids[2]!, "bottom"))).toEqual([ids[2], ids[0], ids[1]]);
    expect(order(reorderLayer(p, sid, ids[0]!, "up"))).toEqual([ids[1], ids[0], ids[2]]);
    expect(order(reorderLayer(p, sid, ids[0]!, "down"))).toEqual(ids);
  });

  it("writes desktop edits to the base and tablet/mobile edits to overrides", () => {
    const a = addLayer(base, sid, "text");
    let p = updateLayerForDevice(a.project, sid, a.layerId, "desktop", { frame: { x: 20 }, style: { fontSize: 50 } });
    let l = getLayer(p, sid, a.layerId)!;
    expect(l.frame.x).toBe(20);
    expect(l.style.fontSize).toBe(50);
    expect(l.responsive).toBeUndefined();

    p = updateLayerForDevice(p, sid, a.layerId, "mobile", { frame: { w: 90 }, hidden: false });
    p = updateLayerForDevice(p, sid, a.layerId, "mobile", { style: { fontSize: 28 } });
    l = getLayer(p, sid, a.layerId)!;
    expect(l.frame.w).toBe(56); // desktop untouched
    expect(l.responsive?.mobile).toEqual({ frame: { w: 90 }, hidden: false, style: { fontSize: 28 } });
    const m = resolveLayer(l, "mobile");
    expect(m.frame.w).toBe(90);
    expect(m.style.fontSize).toBe(28);
    expect(resolveLayer(l, "tablet").frame.w).toBe(56);
    expect(valid(p)).toBe(true);

    p = clearOverride(p, sid, a.layerId, "mobile", "style");
    expect(getLayer(p, sid, a.layerId)!.responsive?.mobile?.style).toBeUndefined();
    p = clearOverride(p, sid, a.layerId, "mobile");
    expect(getLayer(p, sid, a.layerId)!.responsive?.mobile).toBeUndefined();
  });

  it("updates content/action without touching geometry", () => {
    const a = addLayer(base, sid, "button");
    const p = updateLayer(a.project, sid, a.layerId, { content: { label: "Buy" }, action: { type: "OPEN_URL", url: "https://x.com", newTab: true } });
    const l = getLayer(p, sid, a.layerId)!;
    expect(l.content.label).toBe("Buy");
    expect(l.action?.type).toBe("OPEN_URL");
    expect(l.frame).toEqual(getLayer(a.project, sid, a.layerId)!.frame);
    expect(valid(p)).toBe(true);
  });

  it("aligns a single layer to the stage per device", () => {
    const a = addLayer(base, sid, "shape");
    const p = alignLayers(a.project, sid, [a.layerId], "hcenter", "tablet");
    const l = getLayer(p, sid, a.layerId)!;
    expect(l.frame.x).toBe(35); // desktop untouched
    expect(resolveLayer(l, "tablet").frame.x).toBe(35);
    expect(l.responsive?.tablet?.frame?.x).toBe(35);
  });
});

describe("history", () => {
  it("push/undo/redo and replace during gestures", () => {
    let h = createHistory(1);
    h = push(h, 2);
    h = replace(h, 3); // still the same undo step
    expect(h.present).toBe(3);
    expect(h.past).toEqual([1]);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canUndo(h)).toBe(true);
    h = push(undo(h), 9);
    expect(h.future).toEqual([]);
  });
});
