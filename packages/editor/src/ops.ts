import { playbackSchema, resolveLayer, type BrandKit, type Device, type Frame, type Layer, type Project, type Scene, type StyleMap } from "@sceneflow/schema";
import { createLayer, createScene, type ElementType } from "./defaults.js";
import { alignFrames, boundsOf, distributeFrames, round2, type AlignMode } from "./geometry.js";
import { newId } from "./ids.js";

/*
 * Every operation is a pure function Project -> Project. The UI store wraps them with history.
 * Scenes are sequential on the project timeline; layers are ordered back-to-front (last = top).
 */

const mapScene = (p: Project, sceneId: string, fn: (s: Scene) => Scene): Project => ({ ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? fn(s) : s)) });
const mapLayer = (p: Project, sceneId: string, layerId: string, fn: (l: Layer) => Layer): Project =>
  mapScene(p, sceneId, (s) => ({ ...s, layers: s.layers.map((l) => (l.id === layerId ? fn(l) : l)) }));

export const getScene = (p: Project, sceneId: string): Scene | undefined => p.scenes.find((s) => s.id === sceneId);
export const getLayer = (p: Project, sceneId: string, layerId: string): Layer | undefined => getScene(p, sceneId)?.layers.find((l) => l.id === layerId);

/** Re-chains scene start/end so they stay contiguous from 0, preserving each scene's duration. */
export function normalizeTiming(p: Project): Project {
  let t = 0;
  const scenes = p.scenes.map((s) => {
    const d = Math.max(0.1, round2(s.end - s.start));
    const next = { ...s, start: round2(t), end: round2(t + d) };
    t += d;
    return next;
  });
  return { ...p, scenes };
}

// ---------- scenes ----------

export function addScene(p: Project, afterSceneId?: string, duration = 5): { project: Project; sceneId: string } {
  const idx = afterSceneId ? p.scenes.findIndex((s) => s.id === afterSceneId) : p.scenes.length - 1;
  const scene = createScene(p.scenes.length + 1, 0, duration);
  const scenes = p.scenes.slice();
  scenes.splice(idx + 1, 0, scene);
  return { project: normalizeTiming({ ...p, scenes }), sceneId: scene.id };
}

export function duplicateScene(p: Project, sceneId: string): { project: Project; sceneId: string } {
  const idx = p.scenes.findIndex((s) => s.id === sceneId);
  const src = p.scenes[idx];
  if (!src) return { project: p, sceneId };
  const copy: Scene = { ...src, id: newId("s"), name: `${src.name} copy`, layers: src.layers.map((l) => ({ ...l, id: newId("l") })) };
  const scenes = p.scenes.slice();
  scenes.splice(idx + 1, 0, copy);
  return { project: normalizeTiming({ ...p, scenes }), sceneId: copy.id };
}

export function removeScene(p: Project, sceneId: string): Project {
  if (p.scenes.length <= 1) return p;
  return normalizeTiming({ ...p, scenes: p.scenes.filter((s) => s.id !== sceneId) });
}

export function moveScene(p: Project, sceneId: string, dir: -1 | 1): Project {
  const idx = p.scenes.findIndex((s) => s.id === sceneId);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= p.scenes.length) return p;
  const scenes = p.scenes.slice();
  const [s] = scenes.splice(idx, 1);
  scenes.splice(to, 0, s!);
  return normalizeTiming({ ...p, scenes });
}

export function updateScene(p: Project, sceneId: string, patch: Partial<Pick<Scene, "name" | "background" | "transition">>): Project {
  return mapScene(p, sceneId, (s) => ({ ...s, ...patch }));
}

export function setSceneDuration(p: Project, sceneId: string, duration: number): Project {
  const d = Math.max(0.1, round2(duration));
  return normalizeTiming(mapScene(p, sceneId, (s) => ({ ...s, end: s.start + d })));
}

// ---------- layers ----------

export function addLayer(p: Project, sceneId: string, type: ElementType, init: Partial<Layer> = {}, kit?: BrandKit | null): { project: Project; layerId: string } {
  const layer = createLayer(type, init, kit);
  return { project: mapScene(p, sceneId, (s) => ({ ...s, layers: [...s.layers, layer] })), layerId: layer.id };
}

export function removeLayers(p: Project, sceneId: string, ids: string[]): Project {
  const set = new Set(ids);
  return mapScene(p, sceneId, (s) => ({ ...s, layers: s.layers.filter((l) => !set.has(l.id)) }));
}

/** Duplicates (or pastes) layers above the originals, nudged so the copies are visible. */
export function duplicateLayers(p: Project, sceneId: string, ids: string[], offset = 2): { project: Project; layerIds: string[] } {
  const scene = getScene(p, sceneId);
  if (!scene) return { project: p, layerIds: [] };
  const copies: Layer[] = scene.layers.filter((l) => ids.includes(l.id)).map((l) => ({ ...l, id: newId("l"), frame: { ...l.frame, x: round2(l.frame.x + offset), y: round2(l.frame.y + offset) } }));
  return { project: mapScene(p, sceneId, (s) => ({ ...s, layers: [...s.layers, ...copies] })), layerIds: copies.map((c) => c.id) };
}

export function pasteLayers(p: Project, sceneId: string, layers: Layer[], offset = 2): { project: Project; layerIds: string[] } {
  const copies: Layer[] = layers.map((l) => ({ ...l, id: newId("l"), frame: { ...l.frame, x: round2(l.frame.x + offset), y: round2(l.frame.y + offset) } }));
  return { project: mapScene(p, sceneId, (s) => ({ ...s, layers: [...s.layers, ...copies] })), layerIds: copies.map((c) => c.id) };
}

/** Device-independent fields (content, action, src, name, lock, timing). */
export function updateLayer(p: Project, sceneId: string, layerId: string, patch: Partial<Omit<Layer, "id" | "frame" | "style" | "hidden" | "responsive">>): Project {
  return mapLayer(p, sceneId, layerId, (l) => ({ ...l, ...patch }));
}

export interface DevicePatch {
  frame?: Partial<Frame>;
  style?: StyleMap;
  hidden?: boolean;
}

/** Frame / style / hidden are responsive: desktop edits the base, tablet/mobile write an override. */
export function updateLayerForDevice(p: Project, sceneId: string, layerId: string, device: Device, patch: DevicePatch): Project {
  return mapLayer(p, sceneId, layerId, (l) => {
    if (device === "desktop") {
      return {
        ...l,
        frame: patch.frame ? { ...l.frame, ...patch.frame } : l.frame,
        style: patch.style ? { ...l.style, ...patch.style } : l.style,
        hidden: patch.hidden ?? l.hidden,
      };
    }
    const prev = l.responsive?.[device] ?? {};
    const next = {
      ...prev,
      frame: patch.frame ? { ...(prev.frame ?? {}), ...patch.frame } : prev.frame,
      style: patch.style ? { ...(prev.style ?? {}), ...patch.style } : prev.style,
      hidden: patch.hidden ?? prev.hidden,
    };
    return { ...l, responsive: { ...(l.responsive ?? {}), [device]: next } };
  });
}

export function clearOverride(p: Project, sceneId: string, layerId: string, device: "tablet" | "mobile", key?: "frame" | "style" | "hidden"): Project {
  return mapLayer(p, sceneId, layerId, (l) => {
    if (!l.responsive?.[device]) return l;
    const responsive = { ...l.responsive };
    if (!key) delete responsive[device];
    else {
      const { [key]: _removed, ...rest } = responsive[device] ?? {};
      responsive[device] = rest;
    }
    return { ...l, responsive };
  });
}

export function reorderLayer(p: Project, sceneId: string, layerId: string, dir: "up" | "down" | "top" | "bottom"): Project {
  return mapScene(p, sceneId, (s) => {
    const idx = s.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return s;
    const layers = s.layers.slice();
    const [l] = layers.splice(idx, 1);
    const to = dir === "top" ? layers.length : dir === "bottom" ? 0 : dir === "up" ? Math.min(layers.length, idx + 1) : Math.max(0, idx - 1);
    layers.splice(to, 0, l!);
    return { ...s, layers };
  });
}

export function alignLayers(p: Project, sceneId: string, ids: string[], mode: AlignMode, device: Device): Project {
  const scene = getScene(p, sceneId);
  if (!scene) return p;
  const targets = scene.layers.filter((l) => ids.includes(l.id));
  const frames = targets.map((l) => resolveLayer(l, device).frame);
  const bounds = targets.length > 1 ? boundsOf(frames) : undefined;
  const aligned = alignFrames(frames, mode, bounds);
  return targets.reduce((acc, l, i) => updateLayerForDevice(acc, sceneId, l.id, device, { frame: { x: aligned[i]!.x, y: aligned[i]!.y } }), p);
}

export function distributeLayers(p: Project, sceneId: string, ids: string[], axis: "h" | "v", device: Device): Project {
  const scene = getScene(p, sceneId);
  if (!scene) return p;
  const targets = scene.layers.filter((l) => ids.includes(l.id));
  const frames = distributeFrames(
    targets.map((l) => resolveLayer(l, device).frame),
    axis,
  );
  return targets.reduce((acc, l, i) => updateLayerForDevice(acc, sceneId, l.id, device, { frame: { x: frames[i]!.x, y: frames[i]!.y } }), p);
}

/** Starter document for a brand-new project (one empty scene). */
export function createEmptyProject(projectId: string): Project {
  return {
    schemaVersion: "1.0",
    projectId,
    version: 1,
    canvas: { aspectRatio: "16:9" },
    playback: playbackSchema.parse({ mode: "click" }),
    scenes: [createScene(1, 0, 5)],
  };
}
