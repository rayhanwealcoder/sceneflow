"use client";

import { create } from "zustand";
import { projectDuration } from "@sceneflow/editor";
import { sceneAt } from "@sceneflow/schema";
import { useEditor } from "./editorStore";

/**
 * Editor playback clock. Lives outside the document store so that a moving playhead
 * only re-renders the few components that subscribe to `time` (never the whole editor).
 */
interface PlayheadState {
  time: number;
  playing: boolean;
  /** Timeline zoom in px per second. */
  zoom: number;
}
interface PlayheadActions {
  setTime(t: number, opts?: { follow?: boolean }): void;
  setZoom(z: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
}

let raf = 0;
let last = 0;

/** Keeps the canvas on the scene under the playhead. */
function followScene(t: number): void {
  const s = useEditor.getState();
  const scene = sceneAt(s.project.scenes, t);
  if (scene && scene.id !== s.sceneId) useEditor.setState({ sceneId: scene.id, selection: [] });
}

const total = () => projectDuration(useEditor.getState().project);

export const usePlayhead = create<PlayheadState & PlayheadActions>()((set, get) => ({
  time: 0,
  playing: false,
  zoom: 60,

  setTime: (t, opts) => {
    const time = Math.max(0, Math.min(t, total()));
    set({ time });
    if (opts?.follow !== false) followScene(time);
  },
  setZoom: (zoom) => set({ zoom: Math.max(8, Math.min(320, Math.round(zoom))) }),

  play: () => {
    if (get().playing) return;
    if (get().time >= total() - 0.01) set({ time: 0 });
    set({ playing: true });
    last = performance.now();
    const step = (now: number) => {
      if (!get().playing) return;
      const end = total();
      const t = get().time + (now - last) / 1000;
      last = now;
      if (t >= end) {
        set({ time: end, playing: false });
        followScene(end);
        return;
      }
      set({ time: t });
      followScene(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  },
  pause: () => {
    cancelAnimationFrame(raf);
    set({ playing: false });
  },
  toggle: () => (get().playing ? get().pause() : get().play()),
}));
