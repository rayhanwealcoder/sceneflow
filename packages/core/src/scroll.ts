/**
 * Pure math for Scroll Scrub so it can be unit-tested without a browser.
 *
 * Everything is measured from the scroll container's *viewport-relative* rectangle (`getBoundingClientRect`),
 * never from `window.scrollY`: that is what the visitor sees, and it stays correct inside smooth-scroll themes
 * that move the page with a transform (GSAP ScrollSmoother, Lenis, Locomotive) where scrollY and the picture
 * disagree for a few hundred milliseconds after every wheel tick.
 */

import type { ScrollEdge } from "@sceneflow/schema";

/** "400vh" / "2400px" -> pixels for the current viewport length. */
export function parseDistance(value: string, viewport: number): number {
  const m = /^(\d{1,4})(vh|px)$/.exec(value.trim());
  if (!m) return viewport * 3;
  const n = Number(m[1]);
  return m[2] === "px" ? n : (n / 100) * viewport;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Re-maps raw progress so that [startOffset, 1 - endOffset] becomes [0, 1]. */
export function applyOffsets(p: number, startOffset: number, endOffset: number): number {
  const span = 1 - startOffset - endOffset;
  if (span <= 0) return clamp01(p);
  return clamp01((p - startOffset) / span);
}

// ---------- pinned ----------

export interface PinInput {
  /** Container start edge relative to the viewport (rect.top, or rect.left when horizontal). */
  containerStart: number;
  /** Scrub travel in px: how far the page scrolls while the player stays pinned. */
  travel: number;
  /** Player length along the scroll axis (its height, or width when horizontal). */
  playerLength: number;
  /** Viewport length along the axis. */
  viewport: number;
  pinPosition: ScrollEdge;
  pinOffset: number;
}

/** Viewport position (px from the start edge) of the player's start edge while it is pinned. */
export function pinAnchor(i: Pick<PinInput, "viewport" | "playerLength" | "pinPosition" | "pinOffset">): number {
  const free = i.viewport - i.playerLength;
  const base = i.pinPosition === "center" ? free / 2 : i.pinPosition === "bottom" ? free : 0;
  return base + (i.pinPosition === "bottom" ? -i.pinOffset : i.pinOffset);
}

export type PinPhase = "before" | "pinned" | "after";

export interface PinState {
  phase: PinPhase;
  /** Raw 0..1 progress through the travel (before dead zones). */
  progress: number;
  /** Offset of the player from the container start along the axis (0 = top of the container, `travel` = its end). */
  shift: number;
  /** Where the player's start edge sits in the viewport while pinned. */
  anchor: number;
}

/**
 * ScrollTrigger-style pin: the container is `playerLength + travel` long. The player rides along until its start edge
 * reaches `anchor`, stays there while the page scrolls `travel` px (progress 0 -> 1), then leaves with the container.
 */
export function pinState(i: PinInput): PinState {
  const anchor = pinAnchor(i);
  const travel = Math.max(1, i.travel);
  const shift = anchor - i.containerStart; // how far the player must move down inside its container to stay at the anchor
  if (shift < 0) return { phase: "before", progress: 0, shift: 0, anchor };
  if (shift >= travel) return { phase: "after", progress: 1, shift: travel, anchor };
  return { phase: "pinned", progress: shift / travel, shift, anchor };
}

// ---------- unpinned (trigger points) ----------

export interface TriggerInput {
  containerStart: number;
  /** Player (= container) length along the axis. */
  playerLength: number;
  viewport: number;
  /** "<player edge> <viewport edge>" (GSAP syntax). */
  start: string;
  end: string;
}

/** Position of an edge on an element of the given length: top 0, center 1/2, bottom 1. */
const edgePos = (edge: string, length: number) => (edge === "center" ? length / 2 : edge === "bottom" ? length : 0);

/** Container start position (viewport-relative) at which "<player edge> <viewport edge>" is met. */
export function triggerPoint(spec: string, playerLength: number, viewport: number): number {
  const [playerEdge = "top", viewportEdge = "bottom"] = spec.split(" ");
  return edgePos(viewportEdge, viewport) - edgePos(playerEdge, playerLength);
}

/** Raw 0..1 progress between the start and end trigger points (forwards and backwards). */
export function triggerProgress(i: TriggerInput): number {
  const t0 = triggerPoint(i.start, i.playerLength, i.viewport);
  const t1 = triggerPoint(i.end, i.playerLength, i.viewport);
  const span = t0 - t1;
  if (span <= 0) return i.containerStart <= t0 ? 1 : 0;
  return clamp01((t0 - i.containerStart) / span);
}

// ---------- which pin technique a page allows ----------

export type PinType = "sticky" | "fixed" | "transform";

export interface AncestorStyle {
  overflow: string;
  overflowX: string;
  overflowY: string;
  transform: string;
  perspective: string;
  filter: string;
  willChange: string;
  contain: string;
}

const SCROLLS = /hidden|auto|scroll|overlay/;
const CONTAINING = /paint|layout|strict|content/;

/**
 * Picks how to pin the player inside *this* page, like ScrollTrigger's `pinType`:
 *  - sticky: CSS does everything on the compositor; needs ancestors without overflow clipping or transforms;
 *  - fixed: works through overflow clipping (most themes), not through a transformed ancestor;
 *  - transform: moves the player with the page every frame; the only option inside smooth-scroll wrappers.
 */
export function pinTypeFor(ancestors: readonly AncestorStyle[]): PinType {
  let scrolls = false;
  for (const a of ancestors) {
    if (a.transform !== "none" || a.perspective !== "none" || a.filter !== "none" || /transform|perspective|filter/.test(a.willChange) || CONTAINING.test(a.contain)) return "transform";
    if (SCROLLS.test(a.overflow) || SCROLLS.test(a.overflowX) || SCROLLS.test(a.overflowY)) scrolls = true;
  }
  return scrolls ? "fixed" : "sticky";
}

// ---------- seeking + smoothing ----------

/** Half a frame at 60 fps: closer than this is "already there". */
export const SEEK_EPS = 1 / 60;

/**
 * Seek coalescing. Browsers cancel an in-flight seek when `currentTime` is set again, and a cancelled seek
 * never paints a frame — setting it on every scroll event therefore shows *fewer* frames, not more. Rule:
 * at most one seek in flight; while one is pending remember only the latest wanted time and apply it on
 * `seeked`. Returns the time to assign now, or null to wait.
 */
export function nextSeek(video: { currentTime: number; seeking: boolean; readyState: number }, wanted: number, eps = SEEK_EPS): number | null {
  if (!Number.isFinite(wanted) || video.readyState < 1 || video.seeking) return null;
  return Math.abs(video.currentTime - wanted) > eps ? wanted : null;
}

/** Longest catch-up time constant (smoothness 1), in ms. ScrollTrigger `scrub: 1` feels about the same. */
export const SMOOTH_MAX_MS = 400;

/**
 * One smoothing step: exponential approach toward `target`, frame-rate independent. `smoothness` 0 snaps;
 * 1 is a ~400 ms time constant. Wheel ticks arrive as steps of ~100 px — this is what turns them into motion.
 */
export function smoothStep(current: number, target: number, smoothness: number, dtMs: number): number {
  if (smoothness <= 0 || !(dtMs > 0)) return target;
  const tau = smoothness * SMOOTH_MAX_MS;
  const k = 1 - Math.exp(-dtMs / tau);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.0005 ? target : next;
}
