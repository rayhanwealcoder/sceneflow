/** Pure math for Scroll Scrub so it can be unit-tested without a browser. */

/** "400vh" / "2400px" -> pixels for the current viewport length. */
export function parseDistance(value: string, viewport: number): number {
  const m = /^(\d{1,4})(vh|px)$/.exec(value.trim());
  if (!m) return viewport * 3;
  const n = Number(m[1]);
  return m[2] === "px" ? n : (n / 100) * viewport;
}

export interface ProgressInput {
  /** window.scrollY (or scrollX for horizontal). */
  scrollPos: number;
  /** Document offset of the scroll container's start edge. */
  containerStart: number;
  /** Container length along the scroll axis. */
  containerLength: number;
  /** Viewport length along the scroll axis. */
  viewport: number;
  pin: boolean;
  startOffset: number;
  endOffset: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Re-maps raw progress so that [startOffset, 1 - endOffset] becomes [0, 1]. */
export function applyOffsets(p: number, startOffset: number, endOffset: number): number {
  const span = 1 - startOffset - endOffset;
  if (span <= 0) return clamp01(p);
  return clamp01((p - startOffset) / span);
}

/**
 * 0..1 progress of the player through its scroll range.
 * Pinned: the player sticks while the page scrolls `containerLength - viewport`.
 * Unpinned: progress runs from the moment the player enters the viewport until it has left it.
 */
export function scrollProgress(i: ProgressInput): number {
  let raw: number;
  if (i.pin) {
    const usable = Math.max(1, i.containerLength - i.viewport);
    raw = (i.scrollPos - i.containerStart) / usable;
  } else {
    const total = i.viewport + i.containerLength;
    raw = (i.scrollPos + i.viewport - i.containerStart) / total;
  }
  return applyOffsets(clamp01(raw), i.startOffset, i.endOffset);
}

/** One smoothing step: how far `current` moves toward `target` this frame. smoothness 0 = snap. */
export function smoothStep(current: number, target: number, smoothness: number, dtMs: number): number {
  if (smoothness <= 0) return target;
  // Frame-rate independent exponential approach; ~60fps reference.
  const k = 1 - Math.pow(Math.max(0.02, 1 - (1 - smoothness) * 0.9), dtMs / 16.67);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.0005 ? target : next;
}
