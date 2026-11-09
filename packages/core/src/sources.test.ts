import { describe, expect, it } from "vitest";
import type { VideoSource } from "@sceneflow/schema";
import { detectProfile, pickSource } from "./sources.js";

const ladder: VideoSource[] = [
  { src: "https://m/540.mp4", width: 960, height: 540, kind: "progressive" },
  { src: "https://m/720.mp4", width: 1280, height: 720, kind: "progressive" },
  { src: "https://m/1080.mp4", width: 1920, height: 1080, kind: "progressive" },
  { src: "https://m/scrub.mp4", width: 1280, height: 720, kind: "scrub" },
];

describe("device profiles", () => {
  it("detects low profile on data saver / slow networks and high on dense screens", () => {
    expect(detectProfile({ saveData: true }, 3)).toBe("low");
    expect(detectProfile({ effectiveType: "3g" }, 2)).toBe("low");
    expect(detectProfile({ effectiveType: "4g" }, 1)).toBe("standard");
    expect(detectProfile({ effectiveType: "4g" }, 2)).toBe("standard");
    expect(detectProfile(undefined, 2)).toBe("high");
    expect(detectProfile(undefined, 1)).toBe("standard");
  });

  it("picks the smallest rendition that covers the player, bounded by the profile", () => {
    const base = { dpr: 1, profile: "standard" as const, scrub: false, fallback: "https://m/proxy.mp4" };
    expect(pickSource(ladder, { ...base, width: 400 })).toBe("https://m/540.mp4");
    expect(pickSource(ladder, { ...base, width: 1000 })).toBe("https://m/720.mp4");
    expect(pickSource(ladder, { ...base, width: 1400 })).toBe("https://m/1080.mp4");
    expect(pickSource(ladder, { ...base, width: 3000 })).toBe("https://m/1080.mp4"); // largest available
    // Retina doubles the need up to 1.5x on standard.
    expect(pickSource(ladder, { ...base, width: 700, dpr: 2 })).toBe("https://m/720.mp4");
    // Low profile ignores density and never exceeds 540p.
    expect(pickSource(ladder, { ...base, width: 1400, dpr: 3, profile: "low" })).toBe("https://m/540.mp4");
  });

  it("prefers scrub renditions in scroll mode and falls back when there are none", () => {
    expect(pickSource(ladder, { width: 1000, dpr: 1, profile: "standard", scrub: true, fallback: "x" })).toBe("https://m/scrub.mp4");
    expect(pickSource(ladder.slice(0, 3), { width: 1000, dpr: 1, profile: "standard", scrub: true, fallback: "x" })).toBe("https://m/720.mp4");
    expect(pickSource([], { width: 1000, dpr: 1, profile: "standard", scrub: false, fallback: "https://m/proxy.mp4" })).toBe("https://m/proxy.mp4");
    expect(pickSource([ladder[3]!], { width: 1000, dpr: 1, profile: "standard", scrub: false, fallback: "fb" })).toBe("fb"); // only scrub sources, normal playback
  });
});
