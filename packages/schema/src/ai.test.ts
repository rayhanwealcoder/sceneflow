import { describe, expect, it } from "vitest";
import { aiScriptSchema, captionsSchema, cueAt, normalizeCues, parseProject, sceneSchema } from "./index.js";

const scene = (extra: Record<string, unknown> = {}) => ({ id: "s", name: "S", start: 0, end: 4, background: { type: "color", color: "#000" }, ...extra });

describe("captions", () => {
  it("fills defaults, validates cues and limits size", () => {
    const c = captionsSchema.parse({ cues: [{ start: 0, end: 1.5, text: "Hello" }] });
    expect(c).toMatchObject({ language: "en", style: { position: "bottom", size: "m" } });
    expect(captionsSchema.safeParse({ cues: [{ start: 2, end: 1, text: "backwards" }] }).success).toBe(false);
    expect(captionsSchema.safeParse({ cues: [{ start: 0, end: 1, text: "" }] }).success).toBe(false);
    expect(captionsSchema.safeParse({ language: "English", cues: [] }).success).toBe(false);
    expect(captionsSchema.safeParse({ language: "pt-BR", cues: [] }).success).toBe(true);
    expect(captionsSchema.safeParse({ cues: Array.from({ length: 2001 }, (_, i) => ({ start: i, end: i + 1, text: "x" })) }).success).toBe(false);
  });

  it("cueAt finds the cue at a time; normalizeCues sorts and removes overlaps", () => {
    const cues = normalizeCues([
      { start: 4, end: 6, text: "c" },
      { start: 0, end: 2, text: "a" },
      { start: 1.5, end: 3, text: "b" }, // overlaps a → starts when a ends
      { start: 4.5, end: 5, text: "inside c" }, // fully inside c → dropped
    ]);
    expect(cues.map((c) => c.text)).toEqual(["a", "b", "c"]);
    expect(cues[1]).toMatchObject({ start: 2, end: 3 });
    expect(cueAt(cues, 0.5)?.text).toBe("a");
    expect(cueAt(cues, 2)?.text).toBe("b");
    expect(cueAt(cues, 3.5)).toBeNull();
    expect(cueAt(cues, 5.9)?.text).toBe("c");
    expect(cueAt(cues, 6)).toBeNull();
    expect(cueAt([], 1)).toBeNull();
  });

  it("projects carry captions and a captions playback switch; scenes carry script notes", () => {
    const r = parseProject({ schemaVersion: "1.0", projectId: "p", version: 1, captions: { cues: [{ start: 0, end: 1, text: "Hi" }] }, scenes: [scene({ script: { voiceover: "Hi there", shot: "Slow push-in" } })] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.playback.captions).toBe(true);
    expect(r.project.captions?.cues).toHaveLength(1);
    expect(r.project.scenes[0]!.script).toEqual({ voiceover: "Hi there", shot: "Slow push-in" });
    expect(sceneSchema.safeParse(scene({ script: { voiceover: "x".repeat(1201) } })).success).toBe(false);
  });
});

describe("AI script shape", () => {
  const sc = (n: number) => ({ name: `S${n}`, duration: 5, headline: `Headline ${n}`, voiceover: "Line", shot: "Shot" });
  it("accepts a sane script and rejects too many scenes, empty headlines and unsafe CTA links", () => {
    const ok = aiScriptSchema.parse({ title: "T", scenes: [sc(1), { ...sc(2), cta: "Shop now", subline: "Sub" }], cta: { label: "Shop now", url: "https://shop.test/x" } });
    expect(ok.scenes[1]!.cta).toBe("Shop now");
    expect(aiScriptSchema.safeParse({ title: "T", scenes: Array.from({ length: 13 }, (_, i) => sc(i)) }).success).toBe(false);
    expect(aiScriptSchema.safeParse({ title: "T", scenes: [{ ...sc(1), headline: "  " }] }).success).toBe(false);
    expect(aiScriptSchema.safeParse({ title: "T", scenes: [sc(1)], cta: { label: "Go", url: "javascript:alert(1)" } }).success).toBe(false);
    expect(aiScriptSchema.safeParse({ title: "T", scenes: [{ ...sc(1), duration: 0.5 }] }).success).toBe(false);
  });
});
