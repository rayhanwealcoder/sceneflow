import { describe, expect, it } from "vitest";
import { parseProject, type AiScript, type Project } from "@sceneflow/schema";
import { addVoiceoverLayer, applyScript, captionsFromScript, createEmptyProject, estimateCues, setSceneScript, splitForCaptions, suggestedVoiceover, videoPromptFor, voiceoverLayer } from "./index.js";

const script: AiScript = {
  title: "Coffee set",
  scenes: [
    { name: "Hook", duration: 4, headline: "Meet the pour-over set", subline: "Slow mornings, better coffee", voiceover: "Meet the pour-over set. Slow mornings, better coffee.", shot: "Ceramic dripper on oak, steam rising, slow push-in" },
    { name: "Show", duration: 8, headline: "Every detail considered", voiceover: "Every detail is considered, from the spout to the glaze.", shot: "Close-up of the spout pouring, slow orbit" },
    { name: "CTA", duration: 4, headline: "Launch offer: 10% off", voiceover: "Ten percent off this week. Tap to shop.", shot: "Hero shot, rim light", cta: "Shop now" },
  ],
  cta: { label: "Shop now", url: "https://shop.test/pour-over" },
};

describe("applyScript", () => {
  it("builds scenes with headline, subline, CTA and script notes, re-chained from 0", () => {
    const base = createEmptyProject("p");
    const { project, sceneIds } = applyScript(base, script);
    expect(sceneIds).toHaveLength(3);
    expect(project.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 4],
      [4, 12],
      [12, 16],
    ]);
    const first = project.scenes[0]!;
    expect(first.background.type).toBe("gradient");
    expect(first.layers.map((l) => l.name)).toEqual(["Headline", "Subline"]);
    expect(first.layers[0]!.content.text).toBe("Meet the pour-over set");
    expect(first.script).toEqual({ voiceover: script.scenes[0]!.voiceover, shot: script.scenes[0]!.shot });
    const last = project.scenes[2]!;
    const cta = last.layers.find((l) => l.type === "button")!;
    expect(cta.content.label).toBe("Shop now");
    expect(cta.action).toEqual({ type: "OPEN_URL", url: "https://shop.test/pour-over", newTab: true });
    expect(project.scenes[1]!.layers.some((l) => l.type === "button")).toBe(false);
    expect(parseProject(project).ok).toBe(true);
  });

  it("splits a main video proportionally and keeps existing footage in replace mode", () => {
    const withVideo: Project = { ...createEmptyProject("p"), video: { provider: "local", assetId: "11111111-1111-4111-8111-111111111111", src: "https://cdn.test/v.mp4", duration: 32 } };
    const { project } = applyScript(withVideo, script);
    expect(project.scenes.map((s) => s.end - s.start)).toEqual([8, 16, 8]);
    expect(project.scenes.every((s) => s.background.type === "video" && s.background.assetId === withVideo.video!.assetId)).toBe(true);
    expect(project.scenes.map((s) => (s.background.type === "video" ? s.background.sourceStart : -1))).toEqual([0, 8, 24]);

    const footage: Project = { ...createEmptyProject("p"), scenes: [{ ...createEmptyProject("p").scenes[0]!, background: { type: "image", assetId: "img", src: "https://cdn.test/i.jpg" } }] };
    const kept = applyScript(footage, script).project;
    expect(kept.scenes[0]!.background.type).toBe("image");
    expect(kept.scenes[1]!.background.type).toBe("gradient");
  });

  it("append mode adds after the current scenes; replace drops stale captions", () => {
    const base = { ...createEmptyProject("p"), captions: { language: "en", cues: [{ start: 0, end: 1, text: "old" }], style: { position: "bottom" as const, size: "m" as const } } };
    const appended = applyScript(base, script, { mode: "append" }).project;
    expect(appended.scenes).toHaveLength(4);
    expect(appended.scenes[1]!.start).toBe(base.scenes[0]!.end);
    expect(appended.captions).toBeDefined();
    expect(applyScript(base, script).project.captions).toBeUndefined();
  });

  it("uses the brand kit for new elements and a cart action when the script has no link", () => {
    const kit = { colors: { primary: "#ff0000", secondary: "#00ff00", surface: "#fff", surfaceText: "#111" }, fonts: { heading: "Poppins", body: "Inter", loadGoogleFonts: false }, button: { borderRadius: 4, fontWeight: 700, textTransform: "none" as const }, radius: 12, shadow: "soft" as const };
    const { project } = applyScript(createEmptyProject("p"), { ...script, cta: undefined }, { brand: kit });
    const btn = project.scenes[2]!.layers.find((l) => l.type === "button")!;
    expect(btn.style.background).toBe("#ff0000");
    expect(btn.action).toEqual({ type: "OPEN_CART" });
    expect(project.scenes[0]!.layers[0]!.style.fontFamily).toBe("Poppins");
  });
});

describe("captions", () => {
  it("splits long text into readable pieces", () => {
    const pieces = splitForCaptions("Meet the pour-over set. Slow mornings, better coffee, every single day of the week without exception. Yes.");
    expect(pieces[0]).toBe("Meet the pour-over set.");
    expect(pieces.every((p) => p.length <= 64)).toBe(true);
    expect(pieces[pieces.length - 1]!.endsWith("Yes.")).toBe(true); // tiny fragment glued to its neighbour
  });

  it("estimates contiguous cues proportional to text length with a minimum duration", () => {
    const cues = estimateCues("Short. This second sentence is considerably longer than the first one.", 10, 16);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.start).toBe(10);
    expect(cues[1]!.end).toBe(16);
    expect(cues[0]!.end).toBe(cues[1]!.start);
    expect(cues[1]!.end - cues[1]!.start).toBeGreaterThan(cues[0]!.end - cues[0]!.start);
    expect(cues[0]!.end - cues[0]!.start).toBeGreaterThanOrEqual(0.8);
    expect(estimateCues("", 0, 5)).toEqual([]);
    expect(estimateCues("x", 5, 5)).toEqual([]);
  });

  it("captionsFromScript times each scene's line over its voiceover audio when present", () => {
    const { project } = applyScript(createEmptyProject("p"), script);
    const plain = captionsFromScript(project);
    expect(plain.source).toBe("script");
    expect(plain.cues[0]!.start).toBe(0);
    expect(plain.cues[plain.cues.length - 1]!.end).toBe(16);
    // Scene 2 (4–12 s) gets a 3 s voiceover → its cues sit inside 4–7 s.
    const voiced = addVoiceoverLayer(project, project.scenes[1]!.id, { assetId: "a", src: "https://cdn.test/vo.m4a", duration: 3 }).project;
    const cues = captionsFromScript(voiced).cues.filter((c) => c.start >= 4 && c.end <= 12);
    expect(cues.length).toBeGreaterThan(0);
    expect(Math.max(...cues.map((c) => c.end))).toBeLessThanOrEqual(7.001);
  });

  it("addVoiceoverLayer replaces an older voiceover and grows a scene that is too short", () => {
    const { project } = applyScript(createEmptyProject("p"), script);
    const sid = project.scenes[0]!.id; // 4 s scene
    const once = addVoiceoverLayer(project, sid, { assetId: "a1", src: "https://cdn.test/1.m4a", duration: 6.2 }).project;
    expect(once.scenes[0]!.end - once.scenes[0]!.start).toBeCloseTo(6.5, 5);
    expect(once.scenes[1]!.start).toBeCloseTo(6.5, 5); // later scenes shifted
    const twice = addVoiceoverLayer(once, sid, { assetId: "a2", src: "https://cdn.test/2.m4a", duration: 2 }).project;
    const vos = twice.scenes[0]!.layers.filter((l) => l.type === "audio");
    expect(vos).toHaveLength(1);
    expect(vos[0]!.assetId).toBe("a2");
    expect(voiceoverLayer(twice.scenes[0]!)?.end).toBe(2);
    expect(parseProject(twice).ok).toBe(true);
  });

  it("setSceneScript merges and drops empty notes; suggestedVoiceover reads the texts", () => {
    const { project } = applyScript(createEmptyProject("p"), script);
    const sid = project.scenes[0]!.id;
    expect(setSceneScript(project, sid, { voiceover: "New line" }).scenes[0]!.script).toEqual({ voiceover: "New line", shot: script.scenes[0]!.shot });
    expect(setSceneScript(setSceneScript(project, sid, { voiceover: "" }), sid, { shot: "" }).scenes[0]!.script).toBeUndefined();
    expect(suggestedVoiceover(project.scenes[0]!)).toBe("Meet the pour-over set. Slow mornings, better coffee");
    expect(videoPromptFor("Ceramic dripper on oak", 8)).toContain("8 seconds, 16:9");
    expect(videoPromptFor("x", 30)).toContain("10 seconds");
  });
});
