import { aiScriptSchema, type AiScript, type AiTone } from "@sceneflow/schema";
import type { CopyBrief, ScriptBrief, TextProvider } from "./types.js";

/*
 * No-key text provider. It does not pretend to be a language model: it turns the brief into a sensible
 * starter script and copy variations with simple rules, so the whole flow (script → scenes → voiceover →
 * captions) works on a laptop without any account. The UI says so and tells the admin which key to add.
 */

const STOP = new Set(["a", "an", "the", "for", "to", "of", "and", "my", "our", "your", "with", "about", "video", "promo", "promote", "showing", "show", "new", "this", "that", "is", "are", "we", "i", "want", "make", "create", "sell", "selling", "launch", "launching", "introducing", "featuring"]);

/** The thing the video is about: the first noun-ish phrase of the brief, capitalized. */
export function subjectOf(brief: string): string {
  const firstClause = brief.split(/[.!?\n;:]/)[0] ?? brief;
  const words = firstClause
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  const pick = words.slice(0, 4).join(" ").trim() || "your product";
  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

const HOOKS: Record<AiTone, string[]> = {
  friendly: ["Meet {s}", "Say hello to {s}", "{s}, made simple"],
  confident: ["{s}. Built to perform.", "This is {s}", "{s} sets the standard"],
  playful: ["Oh hey, {s}!", "{s} just got fun", "Ready for {s}?"],
  premium: ["Introducing {s}", "{s}. Crafted with care.", "The art of {s}"],
  urgent: ["{s} — don't miss it", "Last chance: {s}", "{s}, today only"],
  calm: ["{s}, at your pace", "Discover {s}", "{s}. Simply better."],
};

const CTA: Record<AiTone, string> = { friendly: "Shop now", confident: "Get yours", playful: "Try it", premium: "Discover more", urgent: "Buy now", calm: "Learn more" };

function pickScenes(duration: number, requested?: number): number {
  if (requested) return Math.max(1, Math.min(12, requested));
  return duration <= 10 ? 2 : duration <= 20 ? 3 : duration <= 40 ? 4 : duration <= 75 ? 5 : 6;
}

/** Spreads a total over n scenes with a shorter hook and a longer middle. */
export function splitDurations(total: number, n: number): number[] {
  const weights = Array.from({ length: n }, (_, i) => (i === 0 ? 0.8 : i === n - 1 ? 0.9 : 1.15));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.max(1, Math.round((total * w) / sum)));
  const diff = Math.round(total) - out.reduce((a, b) => a + b, 0);
  out[Math.floor(n / 2)] = Math.max(1, out[Math.floor(n / 2)]! + diff);
  return out;
}

export class StarterTextProvider implements TextProvider {
  readonly id = "starter";
  readonly label = "Starter text (no AI key configured)";

  async script(brief: ScriptBrief): Promise<AiScript> {
    const subject = brief.product?.title ?? subjectOf(brief.brief);
    const n = pickScenes(brief.durationSeconds, brief.sceneCount);
    const durations = splitDurations(brief.durationSeconds, n);
    const hooks = HOOKS[brief.tone] ?? HOOKS.friendly;
    const cta = CTA[brief.tone] ?? "Shop now";
    const price = brief.product?.price ? ` ${brief.product.price}.` : "";
    const beats = [
      { name: "Hook", headline: hooks[0]!.replace("{s}", subject), subline: brief.brief.length <= 90 ? brief.brief : undefined, voiceover: `${hooks[0]!.replace("{s}", subject)}.`, shot: `Cinematic reveal of ${subject}, soft studio light, shallow depth of field, slow push-in.` },
      { name: "Show it", headline: `See ${subject} in action`, subline: "The details that make the difference", voiceover: `Here is ${subject} in action — every detail made to work for you.`, shot: `Close-up of ${subject} in use, hands interacting naturally, slow orbit around the subject.` },
      { name: "Why it matters", headline: "Made for the way you live", subline: "Simple. Reliable. Yours.", voiceover: `Simple, reliable, and made for the way you live.`, shot: `${subject} in a real everyday setting, warm natural light, slow sideways slide.` },
      { name: "Proof", headline: "Loved by people like you", subline: "Thousands already switched", voiceover: `Loved by people like you — thousands have already made the switch.`, shot: `Lifestyle moment with ${subject}, genuine smile, soft backlight, slow pull-back.` },
      { name: "Offer", headline: hooks[2]!.replace("{s}", subject), subline: price ? `Now${price}` : "Free shipping on every order", voiceover: `${hooks[2]!.replace("{s}", subject)}.${price}`, shot: `${subject} centred-left on a clean surface, gentle light sweep, static camera with slow zoom.` },
      { name: "Call to action", headline: `Get ${subject} today`, subline: undefined, voiceover: `Get ${subject} today. Tap the button to start.`, shot: `Hero shot of ${subject}, dramatic rim light, slow push-in to the logo area.`, cta },
    ];
    const chosen = n >= beats.length ? beats : n === 1 ? [beats[5]!] : [...beats.slice(0, n - 1), beats[5]!];
    const scenes = chosen.slice(0, n).map((b, i) => ({ ...b, duration: durations[i] ?? 5, cta: "cta" in b ? b.cta : undefined }));
    return aiScriptSchema.parse({ title: `${subject} — ${brief.durationSeconds}s ${brief.tone} video`, scenes, cta: { label: cta } });
  }

  async copy(brief: CopyBrief): Promise<string[]> {
    const base = brief.text.trim() || (brief.context?.product?.title ? `Meet ${brief.context.product.title}` : "Your headline here");
    const subject = brief.context?.product?.title ?? subjectOf(brief.context?.brief ?? base);
    const variants = new Set<string>();
    const add = (s: string) => {
      const v = s.replace(/\s+/g, " ").trim();
      if (v && v.toLowerCase() !== base.toLowerCase()) variants.add(v);
    };
    const short = base.split(/[,.—–:;]/)[0]!.trim();
    switch (brief.kind) {
      case "button":
        for (const s of [CTA[brief.tone], "Shop now", "Get yours", "Add to cart", "Buy now", "See details", "Try it free", "Learn more"]) add(s);
        break;
      case "badge":
        for (const s of ["NEW", "SALE", "BESTSELLER", "LIMITED", "-20%", "JUST IN", "TOP PICK", "HOT"]) add(s);
        break;
      case "tooltip":
        for (const s of [`Tap to see ${subject}`, `More about ${subject}`, "Tap for details", "See how it works", "What's this?", `Why ${subject}?`]) add(s);
        break;
      case "product":
        for (const s of [`${subject} — made to last`, `${subject}: everything you need, nothing you don't`, `Meet ${subject}. You'll wonder how you managed before.`, `${subject}, designed for every day`, `The ${subject.toLowerCase()} people keep recommending`]) add(s);
        break;
      case "voiceover":
        for (const s of [`${base}`, `Here it is: ${short.toLowerCase()}.`, `${short} — and that is just the start.`, `Imagine this: ${short.toLowerCase()}.`, `${short}. Simple as that.`]) add(s);
        break;
      default: {
        // headline / subline
        if (short && short !== base) add(short);
        add(`${short}?`.replace(/\?\?$/, "?"));
        add(`${short} — finally`);
        add(`Introducing ${subject}`);
        add(`Meet ${subject}`);
        add(`${subject}, made simple`);
        add(`Why everyone loves ${subject}`);
        add(`${short}. Today.`);
      }
    }
    if (brief.instruction) {
      const i = brief.instruction.toLowerCase();
      if (/short/.test(i)) for (const v of [...variants]) if (v.length > 28) variants.delete(v);
      if (/urgent|now|today/.test(i)) add(`${short} — today only`), add(`Don't miss ${subject}`);
      if (/question/.test(i)) add(`Ready for ${subject}?`), add(`What if ${short.toLowerCase()}?`);
      if (/benefit|why/.test(i)) add(`${subject} saves you time every day`), add(`Less hassle. More ${subject.toLowerCase()}.`);
    }
    return [...variants].slice(0, brief.count);
  }
}
