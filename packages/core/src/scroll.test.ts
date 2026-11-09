import { describe, expect, it } from "vitest";
import { applyOffsets, nextSeek, parseDistance, scrollProgress, smoothStep } from "./scroll.js";

describe("scroll math", () => {
  it("parses distances", () => {
    expect(parseDistance("400vh", 800)).toBe(3200);
    expect(parseDistance("1500px", 800)).toBe(1500);
    expect(parseDistance("nonsense", 800)).toBe(2400);
  });

  it("maps pinned scroll to 0..1 forwards and backwards", () => {
    const base = { containerStart: 1000, containerLength: 4000, viewport: 1000, pin: true, startOffset: 0, endOffset: 0 };
    expect(scrollProgress({ ...base, scrollPos: 0 })).toBe(0);
    expect(scrollProgress({ ...base, scrollPos: 1000 })).toBe(0);
    expect(scrollProgress({ ...base, scrollPos: 2500 })).toBe(0.5);
    expect(scrollProgress({ ...base, scrollPos: 4000 })).toBe(1);
    expect(scrollProgress({ ...base, scrollPos: 9000 })).toBe(1);
    // scrolling back up reverses
    expect(scrollProgress({ ...base, scrollPos: 1750 })).toBe(0.25);
  });

  it("maps unpinned scroll across the viewport", () => {
    const base = { containerStart: 2000, containerLength: 500, viewport: 1000, pin: false, startOffset: 0, endOffset: 0 };
    expect(scrollProgress({ ...base, scrollPos: 1000 })).toBe(0); // top edge just below viewport
    expect(scrollProgress({ ...base, scrollPos: 2500 })).toBe(1); // bottom edge just above viewport
    expect(scrollProgress({ ...base, scrollPos: 1750 })).toBe(0.5);
  });

  it("applies dead zones", () => {
    expect(applyOffsets(0.1, 0.1, 0.1)).toBe(0);
    expect(applyOffsets(0.5, 0.1, 0.1)).toBe(0.5);
    expect(applyOffsets(0.95, 0.1, 0.1)).toBe(1);
  });

  it("coalesces seeks: never while one is in flight, never before metadata, never for sub-frame moves", () => {
    expect(nextSeek({ currentTime: 1, seeking: false, readyState: 4 }, 2)).toBe(2);
    expect(nextSeek({ currentTime: 1, seeking: true, readyState: 4 }, 2)).toBeNull();
    expect(nextSeek({ currentTime: 1, seeking: false, readyState: 0 }, 2)).toBeNull();
    expect(nextSeek({ currentTime: 1, seeking: false, readyState: 4 }, 1.01)).toBeNull();
    expect(nextSeek({ currentTime: 1, seeking: false, readyState: 4 }, NaN)).toBeNull();
    // Reverse scrubbing is just another target.
    expect(nextSeek({ currentTime: 5, seeking: false, readyState: 4 }, 0.5)).toBe(0.5);
  });

  it("smoothing converges and snaps when disabled", () => {
    expect(smoothStep(0, 10, 0, 16)).toBe(10);
    let v = 0;
    for (let i = 0; i < 120; i++) v = smoothStep(v, 10, 0.5, 16.67);
    expect(v).toBe(10);
    const one = smoothStep(0, 10, 0.5, 16.67);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(10);
  });
});
