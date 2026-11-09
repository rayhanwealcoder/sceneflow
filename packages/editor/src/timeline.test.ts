import { describe, expect, it } from "vitest";
import { parseProject } from "@sceneflow/schema";
import { addLayer, addScene, createEmptyProject, getLayer, getScene, updateLayer, updateScene } from "./ops.js";
import { formatTime, moveLayerClip, moveSceneBoundary, projectDuration, rulerStep, setLayerTiming, snapTime, splitLayer, splitScene } from "./timeline.js";

const valid = (p: unknown) => parseProject(p).ok;

describe("layer timing", () => {
  const base = createEmptyProject("p");
  const sid = base.scenes[0]!.id; // 0..5
  const added = addLayer(base, sid, "text");
  const lid = added.layerId;

  it("clamps timing to the scene and enforces a minimum length", () => {
    let p = setLayerTiming(added.project, sid, lid, { start: -1, end: 99 });
    expect(getLayer(p, sid, lid)).toMatchObject({ start: 0, end: 5 });
    p = setLayerTiming(p, sid, lid, { start: 4.95 });
    expect(getLayer(p, sid, lid)).toMatchObject({ start: 4.9, end: 5 });
    expect(valid(p)).toBe(true);
  });

  it("moves a clip keeping its length", () => {
    let p = setLayerTiming(added.project, sid, lid, { start: 1, end: 2 });
    p = moveLayerClip(p, sid, lid, 10);
    expect(getLayer(p, sid, lid)).toMatchObject({ start: 4, end: 5 });
    p = moveLayerClip(p, sid, lid, -10);
    expect(getLayer(p, sid, lid)).toMatchObject({ start: 0, end: 1 });
  });

  it("splits a clip and keeps in/out animations on the right halves", () => {
    let p = setLayerTiming(added.project, sid, lid, { start: 1, end: 4 });
    p = updateLayer(p, sid, lid, { animation: { in: { type: "fade", duration: 0.5, delay: 0 }, out: { type: "zoom", duration: 0.5, delay: 0 } } });
    const r = splitLayer(p, sid, lid, 2.5);
    expect(r.layerIds).toHaveLength(2);
    const [a, b] = r.layerIds.map((id) => getLayer(r.project, sid, id)!);
    expect(a).toMatchObject({ start: 1, end: 2.5 });
    expect(b).toMatchObject({ start: 2.5, end: 4 });
    expect(a!.animation).toEqual({ in: { type: "fade", duration: 0.5, delay: 0 } });
    expect(b!.animation).toEqual({ out: { type: "zoom", duration: 0.5, delay: 0 } });
    expect(valid(r.project)).toBe(true);
    // too close to an edge: no split
    expect(splitLayer(p, sid, lid, 1.05).layerIds).toEqual([lid]);
  });
});

describe("scene timing", () => {
  it("splits a scene, trimming spanning layers and offsetting a video background", () => {
    let p = createEmptyProject("p");
    const sid = p.scenes[0]!.id;
    p = updateScene(p, sid, { background: { type: "video", assetId: "v", sourceStart: 2 } });
    const a = addLayer(p, sid, "text"); // whole scene
    p = setLayerTiming(a.project, sid, a.layerId, { start: 1, end: 4 });
    const b = addLayer(p, sid, "badge");
    p = setLayerTiming(b.project, sid, b.layerId, { start: 3.5, end: 5 });
    const r = splitScene(p, sid, 3);
    expect(r.project.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [3, 5],
    ]);
    const first = getScene(r.project, sid)!;
    const second = getScene(r.project, r.sceneId)!;
    expect(first.layers).toHaveLength(1);
    expect(first.layers[0]).toMatchObject({ start: 1, end: 3 });
    expect(second.layers).toHaveLength(2);
    expect(second.layers[0]).toMatchObject({ start: 0, end: 1 });
    expect(second.layers[1]).toMatchObject({ start: 0.5, end: 2 });
    expect(second.background).toMatchObject({ type: "video", sourceStart: 5 });
    expect(valid(r.project)).toBe(true);
  });

  it("moves a scene boundary keeping total duration and minimums", () => {
    let p = createEmptyProject("p");
    p = addScene(p, undefined, 5).project; // [0,5],[5,10]
    p = moveSceneBoundary(p, 0, 7);
    expect(p.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 7],
      [7, 10],
    ]);
    p = moveSceneBoundary(p, 0, 0);
    expect(p.scenes[0]!.end).toBe(0.5);
    expect(projectDuration(p)).toBe(10);
  });
});

describe("helpers", () => {
  it("snaps to the nearest candidate within the threshold", () => {
    expect(snapTime(2.93, [0, 3, 5], 0.1)).toEqual({ time: 3, snapped: true });
    expect(snapTime(2.5, [0, 3, 5], 0.1)).toEqual({ time: 2.5, snapped: false });
  });
  it("picks ruler steps and formats time", () => {
    expect(rulerStep(200)).toBe(0.25);
    expect(rulerStep(60)).toBe(1);
    expect(rulerStep(5)).toBe(10);
    expect(formatTime(65.25)).toBe("1:05.3");
  });
});
