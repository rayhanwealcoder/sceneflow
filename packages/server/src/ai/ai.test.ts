import { describe, expect, it } from "vitest";
import { aiScriptSchema } from "@sceneflow/schema";
import { buildServices, createAi, psString, splitDurations, StarterTextProvider, subjectOf, wavDuration, wordsToCues } from "./index.js";

const starter = new StarterTextProvider();

describe("starter text provider (no key)", () => {
  it("writes a valid script whose scenes add up to the requested length", async () => {
    for (const [brief, duration, tone] of [
      ["Promote our new ceramic pour-over coffee set for home baristas", 20, "premium"],
      ["Black Friday sale on running shoes", 10, "urgent"],
      ["Explain how the app's dark mode works", 60, "calm"],
    ] as const) {
      const s = await starter.script({ brief, durationSeconds: duration, tone, language: "en", hasVideo: false });
      expect(aiScriptSchema.safeParse(s).success).toBe(true);
      expect(s.scenes.reduce((n, x) => n + x.duration, 0)).toBe(duration);
      expect(s.scenes.filter((x) => x.cta).length).toBe(1);
      expect(s.scenes.every((x) => x.voiceover && x.shot)).toBe(true);
    }
    const product = await starter.script({ brief: "sell it", durationSeconds: 15, tone: "friendly", language: "en", hasVideo: true, videoDuration: 15, product: { title: "Aero Kettle", price: "$89" }, sceneCount: 2 });
    expect(product.scenes).toHaveLength(2);
    expect(product.scenes[0]!.headline).toContain("Aero Kettle");
  });

  it("derives a subject and splits durations sensibly", () => {
    expect(subjectOf("Promote our new ceramic pour-over coffee set for home baristas")).toBe("Ceramic pour-over coffee set");
    expect(subjectOf("")).toBe("Your product");
    expect(splitDurations(20, 3).reduce((a, b) => a + b, 0)).toBe(20);
    expect(splitDurations(10, 4).every((d) => d >= 1)).toBe(true);
  });

  it("returns distinct copy variants per kind and honours the count", async () => {
    const buttons = await starter.copy({ kind: "button", text: "Shop now", tone: "urgent", count: 3, language: "en" });
    expect(buttons).toHaveLength(3);
    expect(new Set(buttons).size).toBe(3);
    expect(buttons).not.toContain("Shop now");
    const heads = await starter.copy({ kind: "headline", text: "Meet the pour-over set, finally here", tone: "friendly", count: 5, language: "en", instruction: "Shorter" });
    expect(heads.length).toBeGreaterThan(0);
    expect(heads.every((h) => h.length <= 28)).toBe(true);
    const badges = await starter.copy({ kind: "badge", text: "", tone: "friendly", count: 8, language: "en" });
    expect(badges).toContain("NEW");
  });
});

describe("caption helpers", () => {
  it("reads the duration of a PCM WAV from its header", () => {
    const sampleRate = 22050;
    const seconds = 2.5;
    const dataSize = Math.round(sampleRate * 2 * seconds);
    const buf = Buffer.alloc(44 + dataSize);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(dataSize, 40);
    expect(wavDuration(buf)).toBe(2.5);
    expect(wavDuration(Buffer.from("not a wav file at all, just bytes........................"))).toBeNull();
  });

  it("groups word timings into cues on sentence ends, pauses and length", () => {
    const words = [
      { text: "Meet", start: 0, end: 0.3 },
      { text: "the", start: 0.3, end: 0.4 },
      { text: "set.", start: 0.4, end: 0.9 },
      { text: "Slow", start: 1.0, end: 1.3 },
      { text: "mornings", start: 1.3, end: 1.8 },
      { text: "ahead", start: 3.2, end: 3.6 }, // pause > 0.7 s → new cue
    ];
    const cues = wordsToCues(words);
    expect(cues.map((c) => c.text)).toEqual(["Meet the set.", "Slow mornings", "ahead"]);
    expect(cues[0]).toMatchObject({ start: 0, end: 0.9 });
    expect(cues[2]!.end - cues[2]!.start).toBeGreaterThanOrEqual(0.3);
  });
});

describe("PowerShell literal escaping (system voice)", () => {
  it("neutralises ASCII and Unicode single quotes so a value can never leave the string", () => {
    expect(psString("Microsoft Zira Desktop")).toBe("'Microsoft Zira Desktop'");
    expect(psString("it's")).toBe("'it''s'");
    // U+2019 is a string delimiter for PowerShell too — the classic bypass of apostrophe-only escaping.
    expect(psString("x’; Start-Process calc; ‘")).toBe("'x''; Start-Process calc; '''");
    expect(psString("a‚b‛c")).toBe("'a''b''c'");
    expect(psString("line\nbreak\u0000")).toBe("'linebreak'");
    expect(psString("$env:SECRET `n")).toBe("'$env:SECRET `n'"); // inert inside single quotes
  });
});

describe("service wiring", () => {
  it("falls back to starter text and reports hints; explicit off disables speech", async () => {
    const ai = await createAi({ AI_TEXT_PROVIDER: "starter", AI_SPEECH_PROVIDER: "off" });
    expect(ai.text.id).toBe("starter");
    expect(ai.speech).toBeNull();
    const status = await ai.status();
    expect(status.text.real).toBe(false);
    expect(status.hints.some((h) => h.includes("ANTHROPIC_API_KEY"))).toBe(true);
    expect(status.hints.some((h) => h.includes("ELEVENLABS_API_KEY"))).toBe(true);
  });

  it("uses Claude when a key is present and ElevenLabs for both speech and transcription", async () => {
    const ai = await createAi({ ANTHROPIC_API_KEY: "sk-test", ELEVENLABS_API_KEY: "el-test" });
    expect(ai.text.id).toBe("anthropic");
    expect(ai.text.label).toContain("claude-opus-5-5");
    expect(ai.speech?.id).toBe("elevenlabs");
    expect(ai.transcription?.id).toBe("elevenlabs");
  });

  it("status tolerates a voice list that fails", async () => {
    const ai = buildServices({
      text: starter,
      speech: { id: "x", label: "X", voices: async () => { throw new Error("down"); }, synthesize: async () => ({ audio: Buffer.alloc(0), mimeType: "audio/wav", ext: "wav" }) },
      transcription: null,
    });
    const s = await ai.status();
    expect(s.speech).toEqual({ provider: "x", label: "X", voices: [] });
  });
});
