import type { Frame, Layer, Scene } from "./scene.js";

export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type Device = (typeof DEVICES)[number];

/** Breakpoints used by the runtime when device is "auto" (stage width in CSS px). */
export function deviceFromWidth(width: number): Device {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export type StyleMap = Record<string, string | number>;

export interface ResolvedLayer {
  frame: Frame;
  hidden: boolean;
  style: StyleMap;
  /** Which fields the current device overrides, so editors can show a badge / reset button. */
  overridden: { frame: boolean; hidden: boolean; style: boolean };
}

/**
 * Effective layer for a device. Overrides cascade desktop -> tablet -> mobile,
 * so a mobile layout inherits tablet changes unless mobile sets its own.
 */
export function resolveLayer(layer: Layer, device: Device): ResolvedLayer {
  let frame: Frame = { ...layer.frame };
  let hidden = layer.hidden;
  let style: StyleMap = { ...layer.style };
  const overridden = { frame: false, hidden: false, style: false };

  const chain: Array<"tablet" | "mobile"> = device === "desktop" ? [] : device === "tablet" ? ["tablet"] : ["tablet", "mobile"];
  for (const d of chain) {
    const ov = layer.responsive?.[d];
    if (!ov) continue;
    const own = d === device;
    if (ov.frame) {
      frame = { ...frame, ...ov.frame };
      if (own) overridden.frame = true;
    }
    if (ov.hidden !== undefined) {
      hidden = ov.hidden;
      if (own) overridden.hidden = true;
    }
    if (ov.style) {
      style = { ...style, ...ov.style };
      if (own) overridden.style = true;
    }
  }
  return { frame, hidden, style, overridden };
}

/** Layer timing is relative to its scene. `time === null` means "ignore timing" (editor view). */
export function isLayerVisibleAt(layer: Layer, scene: Scene, time: number | null): boolean {
  if (time === null) return true;
  const rel = time - scene.start;
  const start = layer.start ?? 0;
  const end = layer.end ?? scene.end - scene.start;
  return rel >= start && rel < end;
}

export function sceneAt(scenes: Scene[], time: number): Scene | undefined {
  return scenes.find((s) => time >= s.start && time < s.end) ?? (scenes.length && time >= scenes[scenes.length - 1]!.end ? scenes[scenes.length - 1] : undefined);
}
