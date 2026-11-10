import { parseProject, type Project } from "@sceneflow/schema";
import { describe, expect, it } from "vitest";
import { audioFilterGraph, audioPlan, bestSource, exportConfig, exportDimensions, exportDuration, exportFileName, exportLimitError, exportOptionsFor, exportSpeed, projectDuration, resolveExportDevice, tempoFilters, useOriginalSource, videoAssetIds } from "./plan.js";

function project(extra: Record<string, unknown>): Project {
  const r = parseProject({ schemaVersion: "1.0", projectId: "p", version: 1, scenes: [], ...extra });
  if (!r.ok) throw new Error(r.message);
  return r.project;
}

describe("export plan", () => {
  it("picks even frame sizes that keep the canvas ratio", () => {
    expect(exportDimensions("16:9", "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(exportDimensions("16:9", "720p")).toEqual({ width: 1280, height: 720 });
    expect(exportDimensions("9:16", "1080p")).toEqual({ width: 1080, height: 1920 });
    expect(exportDimensions("1:1", "720p")).toEqual({ width: 720, height: 720 });
    expect(exportDimensions("4:5", "1080p")).toEqual({ width: 1080, height: 1350 });
    expect(exportDimensions("4:3", "1080p")).toEqual({ width: 1440, height: 1080 });
    for (const ratio of ["16:9", "9:16", "1:1", "4:5", "4:3"] as const) {
      const d = exportDimensions(ratio, "720p");
      expect(d.width % 2).toBe(0);
      expect(d.height % 2).toBe(0);
    }
  });

  it("renders portrait canvases with the mobile layout unless told otherwise", () => {
    expect(resolveExportDevice("9:16", "auto")).toBe("mobile");
    expect(resolveExportDevice("4:5", "auto")).toBe("mobile");
    expect(resolveExportDevice("16:9", "auto")).toBe("desktop");
    expect(resolveExportDevice("9:16", "desktop")).toBe("desktop");
    const p = project({ canvas: { aspectRatio: "9:16" } });
    expect(exportOptionsFor(p, { quality: "720p", fps: 25, device: "auto" })).toEqual({ quality: "720p", width: 720, height: 1280, fps: 25, device: "mobile", format: "mp4", transparent: false });
  });

  it("prefers the largest progressive rendition and never a scrub file", () => {
    const sources = [
      { src: "https://m/x/proxy-540.mp4", height: 540, kind: "progressive" as const },
      { src: "https://m/x/scrub-720.mp4", height: 720, kind: "scrub" as const },
      { src: "https://m/x/video-1080.mp4", height: 1080, kind: "progressive" as const },
      { src: "https://m/x/video-720.mp4", height: 720, kind: "progressive" as const },
    ];
    expect(bestSource(sources, "https://m/x/proxy-540.mp4")).toBe("https://m/x/video-1080.mp4");
    expect(bestSource([sources[1]!], "https://m/x/proxy-540.mp4")).toBe("https://m/x/proxy-540.mp4");
    expect(bestSource(undefined, undefined)).toBeUndefined();
  });

  it("freezes a plain play-through config with the best sources and no analytics", () => {
    const p = project({
      video: { provider: "local", assetId: "a1", src: "https://m/a1/proxy-540.mp4", duration: 12, sources: [{ src: "https://m/a1/video-1080.mp4", height: 1080 }, { src: "https://m/a1/scrub-720.mp4", height: 720, kind: "scrub" }] },
      playback: { mode: "scroll", controls: true, showProgress: true, pin: true },
      analytics: { endpoint: "https://api/x" },
      scenes: [{ id: "s", name: "S", start: 0, end: 12, background: { type: "video", assetId: "a1", sourceStart: 0 }, layers: [] }],
    });
    const c = exportConfig(p);
    expect(c.playback.mode).toBe("normal");
    expect(c.playback.controls).toBe(false);
    expect(c.playback.showProgress).toBe(false);
    expect(c.video?.src).toBe("https://m/a1/video-1080.mp4");
    expect(c.video?.sources).toBeUndefined();
    expect(c.analytics).toBeUndefined();
    expect(projectDuration(c)).toBe(12);
    // A scenes-mode project ends with its last scene.
    expect(projectDuration(project({ scenes: [{ id: "a", name: "A", start: 0, end: 3, background: { type: "color", color: "#000" } }, { id: "b", name: "B", start: 3, end: 7.5, background: { type: "color", color: "#fff" } }] }))).toBe(7.5);
  });

  it("plans the audio the player would play: base video + audio layers, trimmed to the export", () => {
    const p = project({
      video: { provider: "local", assetId: "a1", src: "https://m/a1/video-720.mp4", duration: 10 },
      scenes: [
        { id: "s1", name: "One", start: 0, end: 6, background: { type: "video", assetId: "a1", sourceStart: 0 }, layers: [{ id: "vo", type: "audio", name: "Voiceover", frame: { x: 0, y: 0, w: 10, h: 10 }, start: 1, end: 4, assetId: "vo1", src: "https://m/vo1/audio.m4a", content: { volume: 0.8 } }] },
        { id: "s2", name: "Two", start: 6, end: 10, background: { type: "video", assetId: "a1", sourceStart: 6 }, layers: [{ id: "music", type: "audio", frame: { x: 0, y: 0, w: 10, h: 10 }, src: "https://m/music.mp3", content: {} }] },
      ],
    });
    const cues = audioPlan(p, 10);
    expect(cues.map((c) => [c.label, c.at, c.sourceStart, c.duration, c.volume])).toEqual([
      ["video", 0, 0, 10, 1],
      ["Voiceover", 1, 0, 3, 0.8],
      ["audio", 6, 0, 4, 1],
    ]);
    expect(cues[1]?.assetId).toBe("vo1");
    expect(audioPlan({ ...p, playback: { ...p.playback, muted: true } }, 10)).toEqual([]);
  });

  it("plans scene-mode backgrounds from their own sourceStart and keeps hidden audio out", () => {
    const p = project({
      scenes: [
        { id: "s1", name: "Intro", start: 0, end: 4, background: { type: "gradient", css: "linear-gradient(#000,#fff)" }, layers: [{ id: "h", type: "audio", frame: { x: 0, y: 0, w: 10, h: 10 }, hidden: true, src: "https://m/h.mp3" }] },
        { id: "s2", name: "Clip", start: 4, end: 9, background: { type: "video", assetId: "b2", src: "https://m/b2/proxy-540.mp4", sourceStart: 2.5 }, layers: [] },
      ],
    });
    expect(audioPlan(p, 9)).toEqual([{ assetId: "b2", src: "https://m/b2/proxy-540.mp4", sourceStart: 2.5, duration: 5, at: 4, volume: 1, label: "Clip" }]);
    // A cue starting after the export ends is dropped; one running past the end is shortened.
    expect(audioPlan(p, 6)).toEqual([{ assetId: "b2", src: "https://m/b2/proxy-540.mp4", sourceStart: 2.5, duration: 2, at: 4, volume: 1, label: "Clip" }]);
    expect(audioPlan(p, 4)).toEqual([]);
  });

  it("builds a filter graph that trims, delays, pads and mixes without re-normalising", () => {
    const cues = audioPlan(
      project({
        video: { provider: "local", assetId: "a1", src: "https://m/a1/v.mp4", duration: 8 },
        scenes: [{ id: "s", name: "S", start: 0, end: 8, background: { type: "video", assetId: "a1", sourceStart: 0 }, layers: [{ id: "vo", type: "audio", frame: { x: 0, y: 0, w: 1, h: 1 }, start: 2.5, src: "https://m/vo.m4a", content: { volume: 0.5 } }] }],
      }),
      8,
    );
    const g = audioFilterGraph(cues, 8);
    expect(g.out).toBe("[aout]");
    const parts = g.filter.split(";");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("[1:a]atrim=start=0:end=8,asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1,adelay=0|0,apad,atrim=0:8,asetpts=PTS-STARTPTS[a0]");
    expect(parts[1]).toContain("[2:a]atrim=start=0:end=5.5");
    expect(parts[1]).toContain("volume=0.5,adelay=2500|2500");
    expect(parts[2]).toBe("[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,volume=2,alimiter=limit=0.95:level=0[aout]");
    // One cue needs no mixer.
    expect(audioFilterGraph([cues[0]!], 8)).toEqual({ filter: parts[0], out: "[a0]" });
  });

  it("exports at the playback speed: shorter file, audio tempo-shifted, scroll projects at 1×", () => {
    const fast = project({ playback: { mode: "normal", speed: 2 }, video: { provider: "local", assetId: "a1", src: "https://m/a1/v.mp4", duration: 8 }, scenes: [{ id: "s", name: "S", start: 0, end: 8, background: { type: "video", assetId: "a1", sourceStart: 0 }, layers: [{ id: "vo", type: "audio", frame: { x: 0, y: 0, w: 1, h: 1 }, start: 2, src: "https://m/vo.m4a", content: {} }] }] });
    expect(exportSpeed(fast)).toBe(2);
    expect(exportDuration(fast)).toBe(4);
    expect(exportConfig(fast).playback.speed).toBe(2);
    const g = audioFilterGraph(audioPlan(fast, 8), 4, 2);
    expect(g.filter.split(";")[0]).toContain("asetpts=PTS-STARTPTS,atempo=2,aformat=");
    expect(g.filter.split(";")[1]).toContain("adelay=1000|1000,apad,atrim=0:4");
    expect(tempoFilters(1)).toEqual([]);
    expect(tempoFilters(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(tempoFilters(3)).toEqual(["atempo=2", "atempo=1.5"]);
    expect(tempoFilters(0.75)).toEqual(["atempo=0.75"]);
    // A scroll project plays through at 1× whatever speed says.
    const scroll = project({ playback: { mode: "scroll", speed: 2 }, scenes: [{ id: "s", name: "S", start: 0, end: 6, background: { type: "color", color: "#000" } }] });
    expect(exportSpeed(scroll)).toBe(1);
    expect(exportConfig(scroll).playback.speed).toBe(1);
  });

  it("names the file after the project, ASCII only", () => {
    expect(exportFileName("Spring Launch — Été 2026!", "1080p")).toBe("spring-launch-ete-2026-1080p.mp4");
    expect(exportFileName("বসন্ত", "720p")).toBe("video-720p.mp4");
  });
});

describe("export formats, 4K and originals (Phase 16)", () => {
  it("sizes 4K and 480p frames, freezes the format, GIFs at 15 fps, alpha only for a transparent WebM", () => {
    expect(exportDimensions("16:9", "2160p")).toEqual({ width: 3840, height: 2160 });
    expect(exportDimensions("9:16", "480p")).toEqual({ width: 480, height: 854 });
    const clear = project({ canvas: { aspectRatio: "16:9", background: "transparent" } });
    expect(exportOptionsFor(clear, { quality: "720p", fps: 30, device: "auto", format: "webm" })).toMatchObject({ format: "webm", transparent: true, fps: 30 });
    expect(exportOptionsFor(clear, { quality: "720p", fps: 30, device: "auto", format: "mp4" })).toMatchObject({ format: "mp4", transparent: false });
    expect(exportOptionsFor(clear, { quality: "480p", fps: 60, device: "auto", format: "gif" })).toMatchObject({ format: "gif", fps: 15, width: 854, height: 480 });
    expect(exportFileName("Spring Launch", "720p", "gif")).toBe("spring-launch-720p.gif");
    expect(exportFileName("Spring Launch", "2160p")).toBe("spring-launch-2160p.mp4");
  });

  it("limits: GIFs up to 720p and 30 s, 4K up to 3 minutes", () => {
    expect(exportLimitError({ quality: "1080p", format: "gif" }, 10)).toMatch(/720p/);
    expect(exportLimitError({ quality: "720p", format: "gif" }, 31)).toMatch(/30 seconds/);
    expect(exportLimitError({ quality: "480p", format: "gif" }, 30)).toBeNull();
    expect(exportLimitError({ quality: "2160p", format: "mp4" }, 181)).toMatch(/4K/);
    expect(exportLimitError({ quality: "2160p", format: "webm" }, 120)).toBeNull();
    expect(exportLimitError({ quality: "1080p" }, 600)).toBeNull();
  });

  it("plays the original upload when Chrome decodes it and it is at most twice the frame", () => {
    const frame = { width: 1920, height: 1080 };
    expect(useOriginalSource({ codec: "h264", width: 3840, height: 2160 }, frame)).toBe(true);
    expect(useOriginalSource({ codec: "h264", width: 3840, height: 2160 }, { width: 1280, height: 720 })).toBe(false);
    expect(useOriginalSource({ codec: "hevc", width: 1920, height: 1080 }, frame)).toBe(false);
    expect(useOriginalSource({ codec: "prores", width: 1920, height: 1080 }, frame)).toBe(false);
    expect(useOriginalSource({ codec: "vp9" }, frame)).toBe(false);
    const p = project({
      video: { provider: "local", assetId: "base1", src: "https://cdn.test/proxy.mp4", duration: 4, sources: [{ src: "https://cdn.test/1080.mp4", type: "video/mp4", height: 1080 }] },
      scenes: [{ id: "a", name: "A", start: 0, end: 4, background: { type: "video", assetId: "bg1", src: "https://cdn.test/bg-proxy.mp4", sourceStart: 0 } }],
    });
    expect(videoAssetIds(p).sort()).toEqual(["base1", "bg1"]);
    const withOriginal = exportConfig(p, { base1: "https://render.local/original/base1" });
    expect(withOriginal.video!.src).toBe("https://render.local/original/base1");
    expect(withOriginal.scenes[0]!.background).toMatchObject({ src: "https://cdn.test/bg-proxy.mp4" });
    expect(exportConfig(p).video!.src).toBe("https://cdn.test/1080.mp4");
  });
});
