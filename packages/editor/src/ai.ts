import { normalizeCues, playbackSchema, type Action, type AiScript, type BrandKit, type CaptionCue, type Captions, type Layer, type Project, type Scene } from "@sceneflow/schema";
import { brandLayer } from "./brand.js";
import { createLayer } from "./defaults.js";
import { newId } from "./ids.js";
import { normalizeTiming } from "./ops.js";

/*
 * Pure editor operations for the AI features (doc §10.2). The model only ever produces a validated
 * `AiScript`; everything below turns it into ordinary scenes / layers / captions the user can edit like
 * anything else, so nothing in a project depends on AI being available later.
 */

const PALETTE = [
  "linear-gradient(135deg, #0f172a, #4f46e5)",
  "linear-gradient(135deg, #111827, #0e7490)",
  "linear-gradient(135deg, #1e1b4b, #9d174d)",
  "linear-gradient(135deg, #052e16, #15803d)",
  "linear-gradient(135deg, #1c1917, #b45309)",
  "linear-gradient(135deg, #0f172a, #0369a1)",
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Headline size that keeps long lines inside a 58 %-wide box. */
export function headlineFontSize(text: string): number {
  const n = text.length;
  return n <= 24 ? 54 : n <= 40 ? 46 : n <= 60 ? 38 : 32;
}

export interface ScriptApplyOptions {
  /** Brand kit for new elements (fonts, button style). */
  brand?: BrandKit | null;
  /** What the call-to-action button does. Default: open the link from the script, else open the cart. */
  ctaAction?: Action;
  /** `replace` (default) swaps the current scenes for the script's; `append` adds them after the last scene. */
  mode?: "replace" | "append";
}

/**
 * Builds scenes from a script. With a main video the scenes split that video proportionally; otherwise
 * existing footage per position is kept and the rest get gradient backgrounds. Every scene gets a
 * headline, optional subline, the CTA where the script asks for one, and `script` notes for the
 * voiceover / shot steps.
 */
export function applyScript(project: Project, script: AiScript, opts: ScriptApplyOptions = {}): { project: Project; sceneIds: string[] } {
  const mode = opts.mode ?? "replace";
  const kit = opts.brand ?? null;
  const total = script.scenes.reduce((s, x) => s + x.duration, 0) || 1;
  const video = project.video;
  // Durations: scale to the main video's length when there is one (the scenes *are* the video).
  const scale = video ? video.duration / total : 1;
  const ctaAction: Action = opts.ctaAction ?? (script.cta?.url ? { type: "OPEN_URL", url: script.cta.url, newTab: true } : { type: "OPEN_CART" });

  let t = mode === "append" ? (project.scenes[project.scenes.length - 1]?.end ?? 0) : 0;
  const scenes: Scene[] = script.scenes.map((s, i) => {
    const duration = Math.max(1, round2(s.duration * scale));
    const existing = mode === "replace" ? project.scenes[i] : undefined;
    let background: Scene["background"];
    if (video) background = { type: "video", assetId: video.assetId, sourceStart: round2(t) };
    else if (existing && (existing.background.type === "video" || existing.background.type === "image")) background = existing.background;
    else background = { type: "gradient", css: PALETTE[i % PALETTE.length]! };

    // Explicit styles first (they describe the layout), then the brand kit on top (fonts, button look).
    const branded = (l: Layer) => (kit ? brandLayer(l, kit) : l);
    const layers: Layer[] = [];
    layers.push(
      branded(
        createLayer("text", {
          name: "Headline",
          content: { text: s.headline },
          frame: { x: 6, y: s.subline ? 16 : 24, w: 58, h: s.subline ? 30 : 34, rotation: 0 },
          style: { color: "#ffffff", fontSize: headlineFontSize(s.headline), fontWeight: 800, textAlign: "left", textShadow: "0 2px 12px rgba(0,0,0,.45)" },
          animation: { in: { type: "slide-up", duration: 0.6, delay: 0 } },
        }),
      ),
    );
    if (s.subline) {
      layers.push(
        branded(
          createLayer("text", {
            name: "Subline",
            content: { text: s.subline },
            frame: { x: 6, y: 50, w: 54, h: 16, rotation: 0 },
            style: { color: "rgba(255,255,255,.88)", fontSize: 22, fontWeight: 500, textAlign: "left", textShadow: "0 1px 8px rgba(0,0,0,.4)" },
            animation: { in: { type: "fade", duration: 0.6, delay: 0.25 } },
          }),
        ),
      );
    }
    const ctaLabel = s.cta || (i === script.scenes.length - 1 ? script.cta?.label : undefined);
    if (ctaLabel) {
      layers.push(branded(createLayer("button", { name: "Call to action", content: { label: ctaLabel }, frame: { x: 6, y: 76, w: 28, h: 12, rotation: 0 }, action: ctaAction, animation: { in: { type: "fade", duration: 0.5, delay: 0.45 } } })));
    }
    const scene: Scene = {
      id: newId("s"),
      name: s.name,
      start: round2(t),
      end: round2(t + duration),
      background,
      layers,
      transition: { type: "fade", duration: 0.3 },
      script: { voiceover: s.voiceover || undefined, shot: s.shot || undefined },
    };
    t += duration;
    return scene;
  });

  const next: Project = normalizeTiming({ ...project, scenes: mode === "append" ? [...project.scenes, ...scenes] : scenes });
  if (mode === "replace" && next.captions) delete next.captions; // old cues no longer match
  return { project: next, sceneIds: scenes.map((s) => s.id) };
}

/** A ready-to-paste prompt for Veo / Sora / Runway / Kling from a scene's shot description (docs/ai-video-prompts.md rules). */
export function videoPromptFor(shot: string, seconds: number, ratio = "16:9"): string {
  const s = Math.max(4, Math.min(10, Math.round(seconds)));
  return `${shot.trim().replace(/\.?$/, ".")} One slow continuous camera move, ${s} seconds, ${ratio}, subject on the left with empty space on the right. Photorealistic, smooth steady motion, no cuts, no text, no logos, no watermark.`;
}

// ---------- captions ----------

/** Splits text into caption-sized pieces (sentences first, then commas / words; ≤ `maxChars`). */
export function splitForCaptions(text: string, maxChars = 64): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    // Prefer a comma / dash split, otherwise pack words.
    let cur = "";
    for (const word of sentence.split(" ")) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length > maxChars && cur) {
        out.push(cur);
        cur = word;
      } else cur = candidate;
      if (/[,;:—–]$/.test(cur) && cur.length > maxChars * 0.55) {
        out.push(cur);
        cur = "";
      }
    }
    if (cur) out.push(cur);
  }
  // Very short fragments read better glued to their neighbour.
  const merged: string[] = [];
  for (const piece of out) {
    const prev = merged[merged.length - 1];
    if (prev && piece.length < 12 && prev.length + piece.length + 1 <= maxChars) merged[merged.length - 1] = `${prev} ${piece}`;
    else merged.push(piece);
  }
  return merged;
}

/**
 * Spreads text over [start, end] proportionally to its length (a good estimate of speech pace), with a
 * minimum cue length so single words do not flash. Contiguous — no gaps — so the bar never flickers.
 */
export function estimateCues(text: string, start: number, end: number, opts: { maxChars?: number; minSeconds?: number } = {}): CaptionCue[] {
  const pieces = splitForCaptions(text, opts.maxChars);
  const span = end - start;
  if (!pieces.length || span <= 0) return [];
  const minSeconds = Math.min(opts.minSeconds ?? 0.8, span / pieces.length);
  const weights = pieces.map((p) => Math.max(1, p.length));
  const totalW = weights.reduce((a, b) => a + b, 0);
  // Proportional first; cues under the minimum are lifted and the deficit is taken from the longer ones.
  let durations = weights.map((w) => (w / totalW) * span);
  let deficit = 0;
  durations = durations.map((d) => {
    if (d >= minSeconds) return d;
    deficit += minSeconds - d;
    return minSeconds;
  });
  if (deficit > 0) {
    const flexible = durations.map((d) => Math.max(0, d - minSeconds));
    const flexTotal = flexible.reduce((a, b) => a + b, 0);
    if (flexTotal > 0) durations = durations.map((d, i) => d - (flexible[i]! / flexTotal) * deficit);
  }
  const cues: CaptionCue[] = [];
  let t = start;
  for (let i = 0; i < pieces.length; i++) {
    const e = i === pieces.length - 1 ? end : t + durations[i]!;
    cues.push({ start: round3(t), end: round3(e), text: pieces[i]! });
    t = e;
  }
  return cues;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The voiceover audio layer of a scene (added by `addVoiceoverLayer`), if any. */
export function voiceoverLayer(scene: Scene): Layer | undefined {
  return scene.layers.find((l) => l.type === "audio" && l.content.voiceover === true);
}

/**
 * Captions for the whole project from each scene's script: timed over the scene's voiceover audio when it
 * has one (its exact window), otherwise over the scene itself. Scenes without script text add nothing.
 */
export function captionsFromScript(project: Project, language = project.captions?.language ?? "en"): Captions {
  const cues: CaptionCue[] = [];
  for (const scene of project.scenes) {
    const text = scene.script?.voiceover?.trim();
    if (!text) continue;
    const vo = voiceoverLayer(scene);
    const start = scene.start + (vo?.start ?? 0);
    const end = vo?.end !== undefined ? Math.min(scene.end, scene.start + vo.end) : scene.end;
    cues.push(...estimateCues(text, start, Math.max(start + 0.5, end)));
  }
  return { language, cues: normalizeCues(cues), style: project.captions?.style ?? { position: "bottom", size: "m" }, source: "script" };
}

export function setCaptions(project: Project, captions: Captions | null): Project {
  const next = { ...project };
  if (captions && captions.cues.length) next.captions = { ...captions, cues: normalizeCues(captions.cues) };
  else delete next.captions;
  return next;
}

export function setSceneScript(project: Project, sceneId: string, patch: Partial<NonNullable<Scene["script"]>>): Project {
  return {
    ...project,
    scenes: project.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      const script = { ...s.script, ...patch };
      for (const k of Object.keys(script) as Array<keyof typeof script>) if (!script[k]) delete script[k];
      return Object.keys(script).length ? { ...s, script } : (({ script: _drop, ...rest }) => rest)(s);
    }),
  };
}

/**
 * Puts a generated voiceover on a scene as an audio layer that starts with the scene. A previous
 * voiceover of that scene is replaced. When the audio is longer than the scene, the scene grows to fit
 * (people want to hear the whole line); later scenes shift accordingly.
 */
export function addVoiceoverLayer(project: Project, sceneId: string, audio: { assetId: string; src: string; duration: number; name?: string }): { project: Project; layerId: string } {
  const layer = createLayer("audio", {
    name: audio.name ?? "Voiceover",
    assetId: audio.assetId,
    src: audio.src,
    content: { volume: 1, voiceover: true },
    start: 0,
    end: round2(Math.max(0.5, audio.duration)),
  });
  const scenes = project.scenes.map((s) => {
    if (s.id !== sceneId) return s;
    const layers = s.layers.filter((l) => !(l.type === "audio" && l.content.voiceover === true));
    const need = audio.duration + 0.3;
    const end = s.end - s.start < need ? s.start + round2(need) : s.end;
    return { ...s, end, layers: [...layers, layer] };
  });
  return { project: normalizeTiming({ ...project, scenes }), layerId: layer.id };
}

/** Default voiceover text for a scene that has none: its headline and subline, read in order. */
export function suggestedVoiceover(scene: Scene): string {
  const texts = scene.layers.filter((l) => l.type === "text" && typeof l.content.text === "string").map((l) => String(l.content.text).trim()).filter(Boolean);
  return texts.join(". ").replace(/\.\./g, ".");
}

/** Makes sure a project has a playback block the captions toggle can live in (older drafts). */
export function ensurePlayback(project: Project): Project {
  return project.playback ? project : { ...project, playback: playbackSchema.parse({}) };
}
