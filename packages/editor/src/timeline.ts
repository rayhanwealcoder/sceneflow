import type { Layer, Project, Scene } from "@sceneflow/schema";
import { getScene, normalizeTiming } from "./ops.js";
import { round2 } from "./geometry.js";
import { newId } from "./ids.js";

export const MIN_CLIP = 0.1;
export const MIN_SCENE = 0.5;

export const projectDuration = (p: Project): number => p.scenes[p.scenes.length - 1]?.end ?? 0;

export const layerStart = (l: Layer): number => l.start ?? 0;
export const layerEnd = (l: Layer, scene: Scene): number => l.end ?? scene.end - scene.start;

const mapScene = (p: Project, sceneId: string, fn: (s: Scene) => Scene): Project => ({ ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? fn(s) : s)) });

/** Sets a layer's start/end (scene-relative), clamped inside the scene and at least MIN_CLIP long. */
export function setLayerTiming(p: Project, sceneId: string, layerId: string, t: { start?: number; end?: number }): Project {
  return mapScene(p, sceneId, (s) => {
    const dur = s.end - s.start;
    return {
      ...s,
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l;
        let start = t.start ?? layerStart(l);
        let end = t.end ?? layerEnd(l, s);
        start = Math.max(0, Math.min(start, dur - MIN_CLIP));
        end = Math.max(start + MIN_CLIP, Math.min(end, dur));
        return { ...l, start: round2(start), end: round2(end) };
      }),
    };
  });
}

/** Shifts a clip keeping its length, clamped to the scene. */
export function moveLayerClip(p: Project, sceneId: string, layerId: string, delta: number): Project {
  const s = getScene(p, sceneId);
  const l = s?.layers.find((x) => x.id === layerId);
  if (!s || !l) return p;
  const dur = s.end - s.start;
  const len = layerEnd(l, s) - layerStart(l);
  const start = Math.max(0, Math.min(layerStart(l) + delta, dur - len));
  return setLayerTiming(p, sceneId, layerId, { start, end: start + len });
}

/** Splits a layer clip at scene-relative time `at` into two layers (the second gets a new id). */
export function splitLayer(p: Project, sceneId: string, layerId: string, at: number): { project: Project; layerIds: string[] } {
  const s = getScene(p, sceneId);
  const l = s?.layers.find((x) => x.id === layerId);
  if (!s || !l) return { project: p, layerIds: [] };
  const start = layerStart(l);
  const end = layerEnd(l, s);
  if (at <= start + MIN_CLIP || at >= end - MIN_CLIP) return { project: p, layerIds: [layerId] };
  const second: Layer = { ...l, id: newId("l"), start: round2(at), end: round2(end), animation: l.animation ? { out: l.animation.out } : undefined };
  const first: Layer = { ...l, start: round2(start), end: round2(at), animation: l.animation ? { in: l.animation.in } : undefined };
  const layers = s.layers.flatMap((x) => (x.id === layerId ? [first, second] : [x]));
  return { project: mapScene(p, sceneId, (sc) => ({ ...sc, layers })), layerIds: [first.id, second.id] };
}

/**
 * Splits a scene at absolute project time `at`. Layers that span the cut are trimmed into both halves;
 * a video background continues from the matching source offset.
 */
export function splitScene(p: Project, sceneId: string, at: number): { project: Project; sceneId: string } {
  const idx = p.scenes.findIndex((s) => s.id === sceneId);
  const s = p.scenes[idx];
  if (!s || at <= s.start + MIN_SCENE || at >= s.end - MIN_SCENE) return { project: p, sceneId };
  const cut = at - s.start; // scene-relative
  const dur = s.end - s.start;
  const firstLayers: Layer[] = [];
  const secondLayers: Layer[] = [];
  for (const l of s.layers) {
    const ls = layerStart(l);
    const le = layerEnd(l, s);
    if (le <= cut) firstLayers.push(l);
    else if (ls >= cut) secondLayers.push({ ...l, id: newId("l"), start: round2(ls - cut), end: round2(le - cut) });
    else {
      firstLayers.push({ ...l, start: round2(ls), end: round2(cut) });
      secondLayers.push({ ...l, id: newId("l"), start: 0, end: round2(le - cut) });
    }
  }
  const bg = s.background;
  const secondBg = bg.type === "video" ? { ...bg, sourceStart: round2(bg.sourceStart + cut) } : bg;
  const first: Scene = { ...s, end: round2(s.start + cut), layers: firstLayers };
  const second: Scene = { ...s, id: newId("s"), name: `${s.name} (2)`, start: round2(s.start + cut), end: round2(s.start + dur), background: secondBg, layers: secondLayers };
  const scenes = p.scenes.slice();
  scenes.splice(idx, 1, first, second);
  return { project: normalizeTiming({ ...p, scenes }), sceneId: second.id };
}

/** Drags the boundary between scene[index] and scene[index+1] to absolute time `at`, keeping the total length. */
export function moveSceneBoundary(p: Project, index: number, at: number): Project {
  const a = p.scenes[index];
  const b = p.scenes[index + 1];
  if (!a || !b) return p;
  const t = Math.max(a.start + MIN_SCENE, Math.min(at, b.end - MIN_SCENE));
  const scenes = p.scenes.map((s, i) => (i === index ? { ...s, end: round2(t) } : i === index + 1 ? { ...s, start: round2(t) } : s));
  return normalizeTiming({ ...p, scenes });
}

/** Magnetic snapping for the timeline: returns the nearest candidate within `threshold` seconds. */
export function snapTime(t: number, candidates: number[], threshold: number): { time: number; snapped: boolean } {
  let best: number | null = null;
  for (const c of candidates) if (Math.abs(c - t) <= threshold && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c;
  return best === null ? { time: round2(t), snapped: false } : { time: round2(best), snapped: true };
}

/** Ruler tick spacing (seconds) that keeps labels readable at a given zoom (px per second). */
export function rulerStep(pxPerSec: number): number {
  if (pxPerSec >= 160) return 0.25;
  if (pxPerSec >= 90) return 0.5;
  if (pxPerSec >= 40) return 1;
  if (pxPerSec >= 20) return 2;
  if (pxPerSec >= 8) return 5;
  return 10;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
