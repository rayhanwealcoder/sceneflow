import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiScriptSchema, type AiScript } from "@sceneflow/schema";
// The SDK's structured-output helper speaks Zod 4; the rest of the repo stays on the classic API (zod ≥ 3.25 ships both).
import { z } from "zod/v4";
import type { CopyBrief, ScriptBrief, TextProvider } from "./types.js";

/*
 * Claude-backed text provider (script / storyboard / copy). Structured outputs guarantee the shape; the
 * result is still run through the project schema (lengths, counts) before it reaches the editor.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";

/** Plain shapes for the model (no refinements); `aiScriptSchema` tightens them afterwards. */
const scriptOutput = z.object({
  title: z.string(),
  scenes: z.array(
    z.object({
      name: z.string(),
      duration_seconds: z.number(),
      headline: z.string(),
      subline: z.string().describe("Supporting line under the headline, or an empty string"),
      voiceover: z.string().describe("Spoken narration for this scene, 1–2 short sentences"),
      cta: z.string().describe("Button label if this scene shows the call to action, else an empty string"),
      shot: z.string().describe("What the footage shows: subject, setting, light, one slow camera move"),
    }),
  ),
  cta_label: z.string(),
});
const copyOutput = z.object({ variants: z.array(z.string()) });

const SYSTEM = `You write scripts and on-screen copy for short interactive marketing videos that play on a website (SceneFlow).
Rules: concrete and specific, no hype words like "revolutionary", no emojis, no hashtags, no exclamation marks in headlines.
Headlines fit in one or two lines (max ~60 characters). Sublines max 120 characters. Voiceover is natural spoken language, 1–2 short sentences per scene, roughly 2.5 words per second of scene length.
Shot descriptions are for an AI video generator: subject on the left of frame, one slow continuous camera move, no text or logos in the footage.
Write in the language the brief is written in unless a language code says otherwise.`;

export class AnthropicTextProvider implements TextProvider {
  readonly id = "anthropic";
  readonly label: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; model?: string }) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.label = `Claude (${this.model})`;
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: 90_000, maxRetries: 1 });
  }
  private readonly model: string;

  async script(brief: ScriptBrief): Promise<AiScript> {
    const n = brief.sceneCount ? `${brief.sceneCount} scenes` : `${brief.durationSeconds <= 12 ? "2" : brief.durationSeconds <= 25 ? "3" : brief.durationSeconds <= 45 ? "4" : "5–6"} scenes`;
    const footage = brief.hasVideo
      ? `The user already has one continuous video of ${Math.round(brief.videoDuration ?? brief.durationSeconds)} seconds; the scenes split that footage, so scene durations must add up to ${Math.round(brief.videoDuration ?? brief.durationSeconds)} seconds and shot descriptions describe what probably happens in such footage.`
      : `No footage yet: the user will generate or film each scene from your shot description.`;
    const product = brief.product ? `Product: ${brief.product.title}${brief.product.price ? ` (${brief.product.price})` : ""}.` : "";
    const user = `Brief: ${brief.brief}
${product}
Target length: ${brief.durationSeconds} seconds in ${n}. Tone: ${brief.tone}. Language: ${brief.language}.
${footage}
Exactly one scene (normally the last) carries the call to action button label; give the others an empty cta. Also give a short overall title.`;
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(scriptOutput) },
    });
    const out = res.parsed_output;
    if (!out) throw new Error("The model returned no script");
    const scenes = out.scenes.slice(0, 12).map((s) => ({
      name: clip(s.name, 60) || "Scene",
      duration: Math.max(1, Math.min(60, Math.round(s.duration_seconds * 10) / 10 || 5)),
      headline: clip(s.headline, 90) || clip(out.title, 90) || "Headline",
      subline: clip(s.subline, 160) || undefined,
      voiceover: clip(s.voiceover, 600),
      cta: clip(s.cta, 30) || undefined,
      shot: clip(s.shot, 400),
    }));
    return aiScriptSchema.parse({ title: clip(out.title, 80) || "Video", scenes, cta: { label: clip(out.cta_label, 30) || "Shop now" } });
  }

  async copy(brief: CopyBrief): Promise<string[]> {
    const what: Record<CopyBrief["kind"], string> = {
      headline: "headlines (max 60 characters)",
      subline: "supporting lines under a headline (max 110 characters)",
      button: "button labels (1–3 words)",
      badge: "badge texts (1–2 words, uppercase)",
      tooltip: "hotspot tooltips (max 40 characters)",
      product: "product card blurbs (max 90 characters)",
      voiceover: "spoken voiceover lines (1–2 sentences)",
    };
    const ctx = [brief.context?.product ? `Product: ${brief.context.product.title}${brief.context.product.price ? ` (${brief.context.product.price})` : ""}.` : "", brief.context?.brief ? `Video brief: ${brief.context.brief}` : ""].filter(Boolean).join("\n");
    const user = `Write ${brief.count} alternative ${what[brief.kind]} in a ${brief.tone} tone, language ${brief.language}.
Current text: "${brief.text || "(none yet)"}"
${brief.instruction ? `Instruction: ${brief.instruction}` : ""}
${ctx}
Each variant must be different in angle, not just wording. Return only the variants.`;
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: zodOutputFormat(copyOutput) },
    });
    const variants = (res.parsed_output?.variants ?? []).map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean);
    return [...new Set(variants)].slice(0, brief.count);
  }
}

const clip = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
