import { describe, expect, it } from "vitest";
import { applyOffsets, nextSeek, parseDistance, pinAnchor, pinState, pinTypeFor, smoothStep, triggerPoint, triggerProgress, type AncestorStyle } from "./scroll.js";

const plain: AncestorStyle = { overflow: "visible", overflowX: "visible", overflowY: "visible", transform: "none", perspective: "none", filter: "none", willChange: "auto", contain: "none" };

describe("scroll math", () => {
  it("parses distances", () => {
    expect(parseDistance("400vh", 800)).toBe(3200);
    expect(parseDistance("1500px", 800)).toBe(1500);
    expect(parseDistance("nonsense", 800)).toBe(2400);
  });

  it("anchors the pinned player at the top, centre or bottom of the viewport, with an offset", () => {
    const base = { viewport: 1000, playerLength: 400 };
    expect(pinAnchor({ ...base, pinPosition: "top", pinOffset: 0 })).toBe(0);
    expect(pinAnchor({ ...base, pinPosition: "top", pinOffset: 80 })).toBe(80);
    expect(pinAnchor({ ...base, pinPosition: "center", pinOffset: 0 })).toBe(300);
    expect(pinAnchor({ ...base, pinPosition: "center", pinOffset: 40 })).toBe(340);
    expect(pinAnchor({ ...base, pinPosition: "bottom", pinOffset: 0 })).toBe(600);
    expect(pinAnchor({ ...base, pinPosition: "bottom", pinOffset: 50 })).toBe(550);
  });

  it("pins through the travel and maps it to 0..1 forwards and backwards (ScrollTrigger semantics)", () => {
    // Container = 400 px player + 3000 px travel; pin at the top of a 1000 px viewport.
    const base = { travel: 3000, playerLength: 400, viewport: 1000, pinPosition: "top" as const, pinOffset: 0 };
    expect(pinState({ ...base, containerStart: 600 })).toEqual({ phase: "before", progress: 0, shift: 0, anchor: 0 });
    expect(pinState({ ...base, containerStart: 0 })).toEqual({ phase: "pinned", progress: 0, shift: 0, anchor: 0 });
    expect(pinState({ ...base, containerStart: -1500 })).toEqual({ phase: "pinned", progress: 0.5, shift: 1500, anchor: 0 });
    expect(pinState({ ...base, containerStart: -3000 })).toEqual({ phase: "after", progress: 1, shift: 3000, anchor: 0 });
    expect(pinState({ ...base, containerStart: -9000 }).progress).toBe(1);
    // scrolling back up reverses
    expect(pinState({ ...base, containerStart: -750 }).progress).toBe(0.25);
    // a centred pin starts later: the player's top must reach 300 px first
    expect(pinState({ ...base, pinPosition: "center", containerStart: 300 })).toMatchObject({ phase: "pinned", progress: 0 });
    expect(pinState({ ...base, pinPosition: "center", containerStart: -1200 }).progress).toBe(0.5);
  });

  it("maps unpinned scroll between GSAP-style trigger points", () => {
    // Default "top bottom" → "bottom top": the whole pass through the viewport.
    const base = { playerLength: 500, viewport: 1000, start: "top bottom", end: "bottom top" };
    expect(triggerPoint("top bottom", 500, 1000)).toBe(1000);
    expect(triggerPoint("bottom top", 500, 1000)).toBe(-500);
    expect(triggerPoint("center center", 500, 1000)).toBe(250);
    expect(triggerProgress({ ...base, containerStart: 1000 })).toBe(0); // top edge just below the viewport
    expect(triggerProgress({ ...base, containerStart: -500 })).toBe(1); // bottom edge just above it
    expect(triggerProgress({ ...base, containerStart: 250 })).toBe(0.5);
    // "top center" → "bottom center": scrubs while the player crosses the middle of the screen.
    const mid = { ...base, start: "top center", end: "bottom center" };
    expect(triggerProgress({ ...mid, containerStart: 500 })).toBe(0);
    expect(triggerProgress({ ...mid, containerStart: 0 })).toBe(1);
    expect(triggerProgress({ ...mid, containerStart: 250 })).toBe(0.5);
  });

  it("applies dead zones", () => {
    expect(applyOffsets(0.1, 0.1, 0.1)).toBe(0);
    expect(applyOffsets(0.5, 0.1, 0.1)).toBe(0.5);
    expect(applyOffsets(0.95, 0.1, 0.1)).toBe(1);
  });

  it("picks the pin technique the page allows: sticky, fixed through overflow clipping, transform inside smooth-scroll wrappers", () => {
    expect(pinTypeFor([])).toBe("sticky");
    expect(pinTypeFor([plain, plain])).toBe("sticky");
    expect(pinTypeFor([plain, { ...plain, overflowX: "hidden", overflowY: "auto", overflow: "hidden auto" }])).toBe("fixed");
    expect(pinTypeFor([{ ...plain, overflow: "hidden" }, { ...plain, transform: "matrix(1, 0, 0, 1, 0, -120)" }])).toBe("transform");
    expect(pinTypeFor([{ ...plain, willChange: "transform" }])).toBe("transform");
    expect(pinTypeFor([{ ...plain, contain: "paint" }])).toBe("transform");
    expect(pinTypeFor([{ ...plain, overflow: "clip" }])).toBe("sticky"); // clip is not a scroll container
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

  it("smoothing converges, is frame-rate independent and snaps when disabled", () => {
    expect(smoothStep(0, 10, 0, 16)).toBe(10);
    let v = 0;
    for (let i = 0; i < 240; i++) v = smoothStep(v, 10, 0.5, 16.67);
    expect(v).toBe(10);
    const one = smoothStep(0, 10, 0.5, 16.67);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(10);
    // smoothness 1 still moves (≈400 ms time constant), and two 8 ms steps equal one 16 ms step
    expect(smoothStep(0, 10, 1, 16.67)).toBeGreaterThan(0.3);
    expect(smoothStep(smoothStep(0, 10, 0.5, 8), 10, 0.5, 8)).toBeCloseTo(smoothStep(0, 10, 0.5, 16), 6);
  });
});
