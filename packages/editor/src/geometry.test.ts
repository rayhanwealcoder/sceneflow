import { describe, expect, it } from "vitest";
import { alignFrames, boundsOf, distributeFrames, moveFrame, resizeFrame, rotateFrame, snapFrame } from "./geometry.js";

const f = { x: 10, y: 20, w: 30, h: 40, rotation: 0 };

describe("move/resize/rotate", () => {
  it("moves and rounds", () => {
    expect(moveFrame(f, 1.234, -2.5)).toEqual({ ...f, x: 11.23, y: 17.5 });
  });
  it("resizes from the south-east keeping the top-left anchored", () => {
    expect(resizeFrame(f, "se", 5, 5)).toEqual({ ...f, w: 35, h: 45 });
  });
  it("resizes from the north-west keeping the bottom-right anchored", () => {
    const r = resizeFrame(f, "nw", 5, 10);
    expect(r).toEqual({ ...f, x: 15, y: 30, w: 25, h: 30 });
    expect(r.x + r.w).toBe(f.x + f.w);
    expect(r.y + r.h).toBe(f.y + f.h);
  });
  it("never collapses below the minimum size", () => {
    expect(resizeFrame(f, "e", -100, 0).w).toBe(1);
    const r = resizeFrame(f, "w", 100, 0);
    expect(r.w).toBe(1);
    expect(r.x).toBe(39);
  });
  it("keeps aspect ratio on corner drags", () => {
    const r = resizeFrame(f, "se", 15, 0, { keepAspect: true });
    expect(r.w).toBe(45);
    expect(r.h).toBe(60);
  });
  it("normalizes rotation to -180..180", () => {
    expect(rotateFrame(f, 370).rotation).toBe(10);
    expect(rotateFrame(f, -190).rotation).toBe(170);
  });
});

describe("snapping", () => {
  it("snaps to another frame's edge and reports a guide", () => {
    const other = { x: 40.6, y: 0, w: 20, h: 10, rotation: 0 };
    const { frame, guides } = snapFrame(f, [other], { threshold: 1, stage: false });
    expect(frame.x + frame.w).toBe(40.6);
    expect(guides).toEqual([{ axis: "x", pos: 40.6 }]);
  });
  it("snaps to the stage center and safe area", () => {
    const near = { x: 35.3, y: 5.5, w: 30, h: 10, rotation: 0 };
    const { frame, guides } = snapFrame(near, [], { threshold: 1, safeArea: 5 });
    expect(frame.x + frame.w / 2).toBe(50);
    expect(frame.y).toBe(5);
    expect(guides.map((g) => g.axis)).toEqual(["x", "y"]);
  });
  it("does nothing outside the threshold", () => {
    expect(snapFrame(f, [], { threshold: 0.5, stage: true }).guides).toEqual([]);
  });
});

describe("align/distribute", () => {
  it("aligns a single frame to the stage", () => {
    expect(alignFrames([f], "hcenter")[0]!.x).toBe(35);
    expect(alignFrames([f], "bottom")[0]!.y).toBe(60);
  });
  it("aligns a selection to its bounding box", () => {
    const g = { x: 50, y: 0, w: 10, h: 10, rotation: 0 };
    const b = boundsOf([f, g]);
    expect(b).toEqual({ x: 10, y: 0, w: 50, h: 60, rotation: 0 });
    const [a1, a2] = alignFrames([f, g], "right", b);
    expect(a1!.x + a1!.w).toBe(60);
    expect(a2!.x + a2!.w).toBe(60);
  });
  it("distributes centers evenly", () => {
    const a = { x: 0, y: 0, w: 10, h: 10, rotation: 0 };
    const b = { x: 12, y: 0, w: 10, h: 10, rotation: 0 };
    const c = { x: 80, y: 0, w: 10, h: 10, rotation: 0 };
    const out = distributeFrames([a, c, b], "h");
    expect(out[0]).toEqual(a);
    expect(out[1]).toEqual(c);
    expect(out[2]!.x + 5).toBe(45);
  });
});
