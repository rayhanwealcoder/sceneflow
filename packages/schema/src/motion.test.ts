import { describe, expect, it } from "vitest";
import { layerMotion, motionAt, type Layer, type Scene } from "./index.js";

const scene: Scene = { id: "s", name: "S", start: 10, end: 20, background: { type: "color", color: "#000" }, layers: [], transition: { type: "none", duration: 0 } };
const base: Layer = { id: "l", type: "text", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, locked: false, hidden: false, content: {}, style: {}, start: 2, end: 8 };

describe("motion", () => {
  it("has no motion without animation", () => {
    expect(layerMotion(base, scene, 12)).toBeNull();
  });
  it("animates in from the layer start and rests afterwards", () => {
    const l: Layer = { ...base, animation: { in: { type: "slide-up", duration: 1, delay: 0 } } };
    const atStart = layerMotion(l, scene, 12)!; // rel 0
    expect(atStart.opacity).toBe(0);
    expect(atStart.translateY).toBe(48);
    const mid = layerMotion(l, scene, 12.5)!;
    expect(mid.opacity).toBeGreaterThan(0.5);
    expect(mid.translateY).toBeLessThan(48);
    expect(layerMotion(l, scene, 13.5)).toBeNull();
  });
  it("respects delay and animates out at the end (reverse-safe)", () => {
    const l: Layer = { ...base, animation: { in: { type: "fade", duration: 0.5, delay: 1 }, out: { type: "zoom", duration: 1, delay: 0 } } };
    expect(layerMotion(l, scene, 12.2)!.opacity).toBe(0); // during delay
    expect(layerMotion(l, scene, 14)).toBeNull();
    const nearEnd = layerMotion(l, scene, 17.5)!; // 0.5s remaining of a 1s out
    expect(nearEnd.scale).toBeLessThan(1);
    expect(nearEnd.opacity).toBeGreaterThan(0);
    const atEnd = layerMotion(l, scene, 18)!;
    expect(atEnd.opacity).toBe(0);
    // same time twice gives the same state: scrubbing is deterministic
    expect(layerMotion(l, scene, 17.5)).toEqual(nearEnd);
  });
  it("motionAt clamps progress", () => {
    expect(motionAt("fade", -1).opacity).toBe(0);
    expect(motionAt("fade", 2).opacity).toBe(1);
    expect(motionAt("slide-left", 1).translateX).toBe(0);
  });
});
