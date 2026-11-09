import type { Frame } from "@sceneflow/schema";

/** All geometry is in percent of the stage (0-100). Values are rounded to 2 decimals. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const MIN_SIZE = 1;

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function moveFrame(f: Frame, dx: number, dy: number): Frame {
  return { ...f, x: round2(f.x + dx), y: round2(f.y + dy) };
}

export interface ResizeOptions {
  keepAspect?: boolean;
  minSize?: number;
  /** Stage aspect ratio (w/h); needed to keep the *visual* aspect when units are percentages. */
  stageRatio?: number;
}

/** Resize by dragging `handle` by (dx, dy). The opposite edge/corner stays anchored. */
export function resizeFrame(f: Frame, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Frame {
  const min = opts.minSize ?? MIN_SIZE;
  const right = f.x + f.w;
  const bottom = f.y + f.h;
  let w = f.w;
  let h = f.h;
  if (handle.includes("e")) w = f.w + dx;
  if (handle.includes("w")) w = f.w - dx;
  if (handle.includes("s")) h = f.h + dy;
  if (handle.includes("n")) h = f.h - dy;
  w = Math.max(min, w);
  h = Math.max(min, h);

  if (opts.keepAspect && f.w > 0 && f.h > 0) {
    // visual ratio = (w% * stageW) / (h% * stageH); keep it constant
    const ratio = f.w / f.h;
    const corner = handle.length === 2;
    const horizontal = handle === "e" || handle === "w";
    if (corner ? Math.abs(w - f.w) >= Math.abs(h - f.h) : horizontal) h = Math.max(min, w / ratio);
    else w = Math.max(min, h * ratio);
  }

  const x = handle.includes("w") ? right - w : f.x;
  const y = handle.includes("n") ? bottom - h : f.y;
  return { ...f, x: round2(x), y: round2(y), w: round2(w), h: round2(h) };
}

export function rotateFrame(f: Frame, degrees: number): Frame {
  let r = degrees % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  return { ...f, rotation: round2(r) };
}

/** Angle (degrees) from frame center to a pointer position, both in stage percent. */
export function angleFromCenter(f: Frame, px: number, py: number, stageRatio = 16 / 9): number {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  // convert to a square coordinate system so angles are visually correct
  const dx = (px - cx) * stageRatio;
  const dy = py - cy;
  return (Math.atan2(dy, dx) * 180) / Math.PI + 90;
}

export interface Guide {
  axis: "x" | "y";
  pos: number;
}

export interface SnapOptions {
  threshold?: number;
  /** Also snap to stage edges and center. Default true. */
  stage?: boolean;
  /** Safe-area inset in percent (edges at inset and 100 - inset). 0 disables. */
  safeArea?: number;
}

function candidates(targets: Frame[], axis: "x" | "y", opts: SnapOptions): number[] {
  const out: number[] = [];
  if (opts.stage !== false) out.push(0, 50, 100);
  if (opts.safeArea) out.push(opts.safeArea, 100 - opts.safeArea);
  for (const t of targets) {
    const a = axis === "x" ? t.x : t.y;
    const size = axis === "x" ? t.w : t.h;
    out.push(a, a + size / 2, a + size);
  }
  return out;
}

/**
 * Snaps a moving frame's edges/center to other frames, stage edges/center and the safe area.
 * Returns the adjusted frame plus the guide lines that were matched (for drawing).
 */
export function snapFrame(frame: Frame, targets: Frame[], opts: SnapOptions = {}): { frame: Frame; guides: Guide[] } {
  const threshold = opts.threshold ?? 1;
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;
  for (const axis of ["x", "y"] as const) {
    const pos = axis === "x" ? frame.x : frame.y;
    const size = axis === "x" ? frame.w : frame.h;
    const edges = [pos, pos + size / 2, pos + size];
    let best: { delta: number; at: number } | null = null;
    for (const c of candidates(targets, axis, opts)) {
      for (const e of edges) {
        const delta = c - e;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: c };
      }
    }
    if (best) {
      if (axis === "x") dx = best.delta;
      else dy = best.delta;
      guides.push({ axis, pos: round2(best.at) });
    }
  }
  return { frame: moveFrame(frame, dx, dy), guides };
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Aligns frames inside `bounds` (default: the stage). With one frame this aligns it to the stage. */
export function alignFrames(frames: Frame[], mode: AlignMode, bounds: Frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 }): Frame[] {
  return frames.map((f) => {
    switch (mode) {
      case "left":
        return { ...f, x: round2(bounds.x) };
      case "hcenter":
        return { ...f, x: round2(bounds.x + (bounds.w - f.w) / 2) };
      case "right":
        return { ...f, x: round2(bounds.x + bounds.w - f.w) };
      case "top":
        return { ...f, y: round2(bounds.y) };
      case "vcenter":
        return { ...f, y: round2(bounds.y + (bounds.h - f.h) / 2) };
      case "bottom":
        return { ...f, y: round2(bounds.y + bounds.h - f.h) };
    }
  });
}

/** Bounding box of several frames (rotation ignored). */
export function boundsOf(frames: Frame[]): Frame {
  const x1 = Math.min(...frames.map((f) => f.x));
  const y1 = Math.min(...frames.map((f) => f.y));
  const x2 = Math.max(...frames.map((f) => f.x + f.w));
  const y2 = Math.max(...frames.map((f) => f.y + f.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, rotation: 0 };
}

/** Evenly spaces 3+ frames between the first and last along an axis (by center). Returns frames in input order. */
export function distributeFrames(frames: Frame[], axis: "h" | "v"): Frame[] {
  if (frames.length < 3) return frames;
  const key = axis === "h" ? "x" : "y";
  const size = axis === "h" ? "w" : "h";
  const order = frames.map((f, i) => ({ f, i })).sort((a, b) => a.f[key] + a.f[size] / 2 - (b.f[key] + b.f[size] / 2));
  const first = order[0]!.f;
  const last = order[order.length - 1]!.f;
  const c0 = first[key] + first[size] / 2;
  const c1 = last[key] + last[size] / 2;
  const step = (c1 - c0) / (order.length - 1);
  const out = frames.slice();
  order.forEach(({ f, i }, n) => {
    out[i] = { ...f, [key]: round2(c0 + step * n - f[size] / 2) };
  });
  return out;
}

/** Converts a pixel delta on screen to stage percent. */
export const pxToPct = (px: number, stagePx: number): number => (stagePx > 0 ? (px / stagePx) * 100 : 0);
