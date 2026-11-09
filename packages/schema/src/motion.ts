import type { AnimationSpec, Layer, Scene } from "./scene.js";

/** Visual state of a layer at a point in time. Translations are in reference px (scaled by the stage). */
export interface MotionState {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
}

const DISTANCE = 48;
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** State for progress p (0 = fully "out", 1 = fully "in"). */
export function motionAt(type: AnimationSpec["type"], p: number): MotionState {
  const e = easeOutCubic(clamp01(p));
  const d = (1 - e) * DISTANCE;
  switch (type) {
    case "fade":
      return { opacity: e, translateX: 0, translateY: 0, scale: 1 };
    case "slide-up":
      return { opacity: e, translateX: 0, translateY: d, scale: 1 };
    case "slide-down":
      return { opacity: e, translateX: 0, translateY: -d, scale: 1 };
    case "slide-left":
      return { opacity: e, translateX: d, translateY: 0, scale: 1 };
    case "slide-right":
      return { opacity: e, translateX: -d, translateY: 0, scale: 1 };
    case "zoom":
      return { opacity: e, translateX: 0, translateY: 0, scale: 0.8 + 0.2 * e };
  }
}

/**
 * Enter/exit motion of a layer at absolute project `time`.
 * Returns null when the layer is in its resting state (no transform/opacity override needed).
 */
export function layerMotion(layer: Layer, scene: Scene, time: number): MotionState | null {
  const anim = layer.animation;
  if (!anim || (!anim.in && !anim.out)) return null;
  const start = layer.start ?? 0;
  const end = layer.end ?? scene.end - scene.start;
  const rel = time - scene.start - start;
  const duration = end - start;

  if (anim.in) {
    const t = rel - anim.in.delay;
    if (t < anim.in.duration) return motionAt(anim.in.type, t / anim.in.duration);
  }
  if (anim.out) {
    const remaining = duration - rel;
    if (remaining < anim.out.duration) return motionAt(anim.out.type, remaining / anim.out.duration);
  }
  return null;
}
