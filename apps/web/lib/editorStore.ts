"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AiScript, Captions, Device, Layer, Preset, Project, Scene } from "@sceneflow/schema";
import * as ed from "@sceneflow/editor";
import type { BrandKitRow, LibraryPreset } from "./types";

export type SaveState = "saved" | "saving" | "unsaved" | "error";
export type EditorMode = "simple" | "advanced";
export type AiTab = "script" | "copy" | "voiceover" | "captions";

interface EditorState {
  loaded: boolean;
  history: ed.History<Project>;
  project: Project;
  sceneId: string;
  selection: string[];
  device: Device;
  mode: EditorMode;
  clipboard: Layer[];
  gesture: { active: boolean; started: boolean };
  saveState: SaveState;
  savedVersion: number | null;
  showSafeArea: boolean;
  /** Default brand kit of the workspace (new elements and official presets follow it). */
  brandKit: BrandKitRow | null;
  /** Presets saved by the user / workspace (official ones are code in @sceneflow/editor). */
  library: LibraryPreset[];
  /** AI assistant panel (script / copy / voiceover / captions). */
  ai: { open: boolean; tab: AiTab };
}

export type ApplyResult = { ok: true } | { ok: false; message: string };

interface EditorActions {
  setBrandKit(kit: BrandKitRow | null): void;
  setLibrary(presets: LibraryPreset[]): void;
  upsertLibrary(preset: LibraryPreset): void;
  removeFromLibrary(id: string): void;
  /** Applies an element / scene / motion preset to the current scene or selection (doc 22.3: always a copy). */
  applyPreset(preset: Preset): ApplyResult;
  /** Re-applies the workspace brand kit to every element of the project. */
  applyBrand(): ApplyResult;
  /** Pulls the newer look of a library preset into one element. */
  refreshPreset(layerId: string, preset: Preset): void;
  openAi(tab?: AiTab): void;
  closeAi(): void;
  /** Turns an AI script into scenes (replace or append). Returns the new scene ids. */
  applyScript(script: AiScript, mode: "replace" | "append"): string[];
  setSceneScript(sceneId: string, patch: { voiceover?: string; shot?: string }): void;
  setCaptions(captions: Captions | null): void;
  /** Re-times captions from every scene's voiceover text (over its audio when it has one). */
  regenerateCaptions(): void;
  setPlaybackCaptions(on: boolean): void;
  /** Puts a generated voiceover asset on a scene (replacing an older one; the scene grows to fit). */
  addVoiceover(sceneId: string, audio: { assetId: string; src: string; duration: number }): void;
  load(project: Project, savedVersion: number | null): void;
  /** Applies a pure Project -> Project operation with undo history (coalesced while a gesture is active). */
  apply(fn: (p: Project) => Project): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  selectScene(id: string): void;
  select(ids: string[], additive?: boolean): void;
  setDevice(d: Device): void;
  setMode(m: EditorMode): void;
  toggleSafeArea(): void;
  setSaveState(s: SaveState, version?: number): void;

  addScene(): void;
  duplicateScene(id: string): void;
  removeScene(id: string): void;
  moveScene(id: string, dir: -1 | 1): void;
  updateScene(id: string, patch: Partial<Pick<Scene, "name" | "background" | "transition">>): void;
  setSceneDuration(id: string, d: number): void;
  setProjectMeta(patch: Partial<Pick<Project, "canvas" | "playback" | "video" | "poster">>): void;

  addLayer(type: ed.ElementType, init?: Partial<Layer>): void;
  removeSelected(): void;
  duplicateSelected(): void;
  copy(): void;
  paste(): void;
  updateLayer(id: string, patch: Parameters<typeof ed.updateLayer>[3]): void;
  updateLayerForDevice(id: string, patch: ed.DevicePatch): void;
  clearOverride(id: string, key?: "frame" | "style" | "hidden"): void;
  reorder(id: string, dir: "up" | "down" | "top" | "bottom"): void;
  align(mode: ed.AlignMode): void;
  distribute(axis: "h" | "v"): void;
}

export type EditorStore = EditorState & EditorActions;

const empty = ed.createEmptyProject("unsaved");

/** Keeps sceneId/selection pointing at things that still exist after an operation. */
function reconcile(project: Project, sceneId: string, selection: string[]) {
  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
  const ids = new Set(scene?.layers.map((l) => l.id) ?? []);
  return { sceneId: scene?.id ?? sceneId, selection: selection.filter((id) => ids.has(id)) };
}

export const useEditor = create<EditorStore>()((set, get) => ({
  loaded: false,
  history: ed.createHistory(empty),
  project: empty,
  sceneId: empty.scenes[0]!.id,
  selection: [],
  device: "desktop",
  mode: "simple",
  clipboard: [],
  gesture: { active: false, started: false },
  saveState: "saved",
  savedVersion: null,
  showSafeArea: false,
  brandKit: null,
  library: [],
  ai: { open: false, tab: "script" },

  setBrandKit: (brandKit) => set({ brandKit }),
  openAi: (tab) => set((s) => ({ ai: { open: true, tab: tab ?? s.ai.tab } })),
  closeAi: () => set((s) => ({ ai: { ...s.ai, open: false } })),
  applyScript: (script, mode) => {
    const { project, brandKit, apply } = get();
    const r = ed.applyScript(project, script, { brand: brandKit?.config ?? null, mode });
    apply(() => r.project);
    set({ sceneId: r.sceneIds[0] ?? get().sceneId, selection: [] });
    return r.sceneIds;
  },
  setSceneScript: (sceneId, patch) => get().apply((p) => ed.setSceneScript(p, sceneId, patch)),
  setCaptions: (captions) => get().apply((p) => ed.setCaptions(p, captions)),
  regenerateCaptions: () => get().apply((p) => ed.setCaptions(p, ed.captionsFromScript(p))),
  setPlaybackCaptions: (on) => get().apply((p) => ({ ...p, playback: { ...p.playback, captions: on } })),
  addVoiceover: (sceneId, audio) => get().apply((p) => ed.addVoiceoverLayer(p, sceneId, audio).project),
  setLibrary: (library) => set({ library }),
  upsertLibrary: (preset) => set((s) => ({ library: [preset, ...s.library.filter((p) => p.id !== preset.id)] })),
  removeFromLibrary: (id) => set((s) => ({ library: s.library.filter((p) => p.id !== id) })),

  applyPreset: (preset) => {
    const { project, sceneId, selection, brandKit, apply } = get();
    // Official presets are deliberately generic, so they take the brand; saved presets already look the way the user wants.
    const brand = preset.scope === "official" ? (brandKit?.config ?? null) : null;
    switch (preset.config.type) {
      case "element": {
        const r = ed.applyElementPreset(project, sceneId, preset, { brand });
        apply(() => r.project);
        set({ selection: r.layerIds });
        return { ok: true };
      }
      case "scene": {
        const r = ed.applyScenePreset(project, sceneId, preset, { brand });
        apply(() => r.project);
        set({ sceneId: r.sceneId, selection: [] });
        return { ok: true };
      }
      case "animation": {
        if (!selection.length) return { ok: false, message: "Select an element on the canvas first, then pick a motion." };
        apply((p) => ed.applyAnimationPreset(p, sceneId, selection, preset));
        return { ok: true };
      }
      default:
        return { ok: false, message: "Templates start a new video from the Projects page." };
    }
  },
  applyBrand: () => {
    const { brandKit, apply } = get();
    if (!brandKit) return { ok: false, message: "No brand kit yet. Set one up on the Projects page (colours, fonts, logo) and it applies here." };
    apply((p) => ed.applyBrandKit(p, brandKit.config, { kitId: brandKit.id, version: brandKit.version }));
    return { ok: true };
  },
  refreshPreset: (layerId, preset) => get().apply((p) => ed.refreshFromPreset(p, get().sceneId, layerId, preset)),

  load: (project, savedVersion) =>
    set({ loaded: true, history: ed.createHistory(project), project, sceneId: project.scenes[0]!.id, selection: [], saveState: "saved", savedVersion, gesture: { active: false, started: false } }),

  apply: (fn) =>
    set((s) => {
      const next = fn(s.project);
      if (next === s.project) return {};
      let history: ed.History<Project>;
      let gesture = s.gesture;
      if (s.gesture.active) {
        if (!s.gesture.started) {
          history = ed.push(s.history, next);
          gesture = { active: true, started: true };
        } else history = ed.replace(s.history, next);
      } else history = ed.push(s.history, next);
      return { history, project: history.present, gesture, saveState: "unsaved", ...reconcile(history.present, s.sceneId, s.selection) };
    }),

  beginGesture: () => set({ gesture: { active: true, started: false } }),
  endGesture: () => set({ gesture: { active: false, started: false } }),

  undo: () =>
    set((s) => {
      const history = ed.undo(s.history);
      if (history === s.history) return {};
      return { history, project: history.present, saveState: "unsaved", ...reconcile(history.present, s.sceneId, s.selection) };
    }),
  redo: () =>
    set((s) => {
      const history = ed.redo(s.history);
      if (history === s.history) return {};
      return { history, project: history.present, saveState: "unsaved", ...reconcile(history.present, s.sceneId, s.selection) };
    }),

  selectScene: (id) => set({ sceneId: id, selection: [] }),
  select: (ids, additive) =>
    set((s) => {
      if (!additive) return { selection: ids };
      const next = new Set(s.selection);
      for (const id of ids) next.has(id) ? next.delete(id) : next.add(id);
      return { selection: [...next] };
    }),
  setDevice: (device) => set({ device }),
  setMode: (mode) => set({ mode }),
  toggleSafeArea: () => set((s) => ({ showSafeArea: !s.showSafeArea })),
  setSaveState: (saveState, version) => set((s) => ({ saveState, savedVersion: version ?? s.savedVersion })),

  addScene: () => {
    const { project, sceneId, apply } = get();
    const r = ed.addScene(project, sceneId);
    apply(() => r.project);
    set({ sceneId: r.sceneId, selection: [] });
  },
  duplicateScene: (id) => {
    const r = ed.duplicateScene(get().project, id);
    get().apply(() => r.project);
    set({ sceneId: r.sceneId, selection: [] });
  },
  removeScene: (id) => get().apply((p) => ed.removeScene(p, id)),
  moveScene: (id, dir) => get().apply((p) => ed.moveScene(p, id, dir)),
  updateScene: (id, patch) => get().apply((p) => ed.updateScene(p, id, patch)),
  setSceneDuration: (id, d) => get().apply((p) => ed.setSceneDuration(p, id, d)),
  // `poster: undefined` removes the custom thumbnail (JSON drops undefined keys; a spread would keep the old one).
  setProjectMeta: (patch) =>
    get().apply((p) => {
      const next = { ...p, ...patch };
      if ("poster" in patch && patch.poster === undefined) delete next.poster;
      return next;
    }),

  addLayer: (type, init) => {
    const { project, sceneId, apply, brandKit } = get();
    const r = ed.addLayer(project, sceneId, type, init, brandKit?.config);
    apply(() => r.project);
    set({ selection: [r.layerId] });
  },
  removeSelected: () => {
    const { sceneId, selection, apply } = get();
    if (selection.length) apply((p) => ed.removeLayers(p, sceneId, selection));
  },
  duplicateSelected: () => {
    const { project, sceneId, selection, apply } = get();
    if (!selection.length) return;
    const r = ed.duplicateLayers(project, sceneId, selection);
    apply(() => r.project);
    set({ selection: r.layerIds });
  },
  copy: () => {
    const { project, sceneId, selection } = get();
    const scene = ed.getScene(project, sceneId);
    set({ clipboard: scene?.layers.filter((l) => selection.includes(l.id)) ?? [] });
  },
  paste: () => {
    const { project, sceneId, clipboard, apply } = get();
    if (!clipboard.length) return;
    const r = ed.pasteLayers(project, sceneId, clipboard);
    apply(() => r.project);
    set({ selection: r.layerIds });
  },
  updateLayer: (id, patch) => get().apply((p) => ed.updateLayer(p, get().sceneId, id, patch)),
  updateLayerForDevice: (id, patch) => get().apply((p) => ed.updateLayerForDevice(p, get().sceneId, id, get().device, patch)),
  clearOverride: (id, key) => {
    const { device, sceneId } = get();
    if (device === "desktop") return;
    get().apply((p) => ed.clearOverride(p, sceneId, id, device, key));
  },
  reorder: (id, dir) => get().apply((p) => ed.reorderLayer(p, get().sceneId, id, dir)),
  align: (mode) => {
    const { sceneId, selection, device } = get();
    get().apply((p) => ed.alignLayers(p, sceneId, selection, mode, device));
  },
  distribute: (axis) => {
    const { sceneId, selection, device } = get();
    get().apply((p) => ed.distributeLayers(p, sceneId, selection, axis, device));
  },
}));

/** Convenience selectors. */
export const useScene = () => useEditor((s) => s.project.scenes.find((sc) => sc.id === s.sceneId) ?? s.project.scenes[0]!);
/**
 * Selected layers of the current scene. The selector builds a new array, so it must be shallow-compared:
 * zustand 5 re-renders until the snapshot is referentially stable, and under a React transition (e.g.
 * arriving via router.push from the goal picker) an always-new array loops until "Maximum update depth".
 */
export const useSelectedLayers = () =>
  useEditor(
    useShallow((s) => {
      const scene = s.project.scenes.find((sc) => sc.id === s.sceneId);
      return scene ? scene.layers.filter((l) => s.selection.includes(l.id)) : [];
    }),
  );
