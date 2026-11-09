"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { captionsFromScript, suggestedVoiceover, videoPromptFor, voiceoverLayer } from "@sceneflow/editor";
import { AI_TONES, normalizeCues, type AiCopyKind, type AiScript, type AiTone, type CaptionCue, type Layer, type Scene } from "@sceneflow/schema";
import { api, errorMessage } from "@/lib/api";
import { useEditor, useSelectedLayers, type AiTab } from "@/lib/editorStore";
import type { AiStatus, MediaAsset } from "@/lib/types";

/*
 * ✨ AI assistant (doc §10.2 / Phase 9). Four small jobs, one modal:
 *   Script    — describe the video → scenes with headline, voiceover, shot description → build them
 *   Copy      — better words for the selected element (or a new headline)
 *   Voiceover — read each scene's line with a voice; the audio lands on the scene
 *   Captions  — subtitles from the script (timed over the voiceover) or transcribed from audio; editable
 * Everything it produces is ordinary project content; Ctrl+Z undoes any step.
 */

const TABS: Array<{ id: AiTab; label: string }> = [
  { id: "script", label: "Script" },
  { id: "copy", label: "Copy" },
  { id: "voiceover", label: "Voiceover" },
  { id: "captions", label: "Captions" },
];
const TONE_LABEL: Record<AiTone, string> = { friendly: "Friendly", confident: "Confident", playful: "Playful", premium: "Premium", urgent: "Urgent", calm: "Calm" };
const LENGTHS = [10, 15, 20, 30, 45, 60];

export function AiPanel({ projectId, workspaceId, onNotice }: { projectId: string; workspaceId: string; onNotice: (m: string) => void }) {
  const { ai, openAi, closeAi } = useEditor();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  useEffect(() => {
    api<AiStatus>("/api/v1/ai/status")
      .then(setStatus)
      .catch((e) => setStatusError(errorMessage(e)));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAi();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAi]);

  return (
    <div className="modal-backdrop" onClick={closeAi} role="dialog" aria-modal="true" aria-label="AI assistant">
      <div className="modal ai-modal stack" onClick={(e) => e.stopPropagation()} data-testid="ai-panel">
        <div className="row between">
          <h2 style={{ margin: 0 }}>✨ AI assistant</h2>
          <button className="btn sm" onClick={closeAi}>
            Close
          </button>
        </div>
        <div className="tabs ai-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className={ai.tab === t.id ? "on" : ""} onClick={() => openAi(t.id)} type="button" role="tab" aria-selected={ai.tab === t.id}>
              {t.label}
            </button>
          ))}
        </div>
        {statusError && <div className="alert error small">{statusError}</div>}
        {ai.tab === "script" && <ScriptTab projectId={projectId} status={status} onDone={(n) => { onNotice(`Built ${n} scene${n === 1 ? "" : "s"} from the script. Ctrl+Z undoes it. Next: give it a voice.`); openAi("voiceover"); }} />}
        {ai.tab === "copy" && <CopyTab projectId={projectId} status={status} />}
        {ai.tab === "voiceover" && <VoiceoverTab projectId={projectId} status={status} />}
        {ai.tab === "captions" && <CaptionsTab projectId={projectId} workspaceId={workspaceId} status={status} />}
        {status && status.hints.length > 0 && (
          <details className="ai-status small muted">
            <summary>Setup notes for the site owner ({status.hints.length})</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {status.hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

// ---------------- Script ----------------

function ScriptTab({ projectId, status, onDone }: { projectId: string; status: AiStatus | null; onDone: (scenes: number) => void }) {
  const { project, applyScript } = useEditor();
  const [brief, setBrief] = useState("");
  const [length, setLength] = useState(20);
  const [tone, setTone] = useState<AiTone>("friendly");
  const [sceneCount, setSceneCount] = useState<number | 0>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState<AiScript | null>(null);
  const video = project.video;
  const total = script?.scenes.reduce((s, x) => s + x.duration, 0) ?? 0;

  async function write() {
    if (brief.trim().length < 3) return setError("Say what the video is about first.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ script: AiScript }>("/api/v1/ai/script", { method: "POST", json: { projectId, brief: brief.trim(), durationSeconds: video ? Math.min(180, Math.max(5, Math.round(video.duration))) : length, tone, sceneCount: sceneCount || undefined } });
      setScript(r.script);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const build = (mode: "replace" | "append") => {
    if (!script) return;
    if (mode === "replace" && project.scenes.some((s) => s.layers.length > 0) && !confirm("Replace your current scenes with the script? Ctrl+Z brings them back.")) return;
    const ids = applyScript(script, mode);
    onDone(ids.length);
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="ed-field">
        <span>What is this video about, and for whom?</span>
        <textarea className="input" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Our new ceramic pour-over coffee set for home baristas — warm, premium, show the ritual, end with a 10% launch offer" maxLength={1500} data-testid="ai-brief" />
      </label>
      <div className="row">
        {video ? (
          <span className="small muted">Scenes will split your {video.duration.toFixed(0)} s video.</span>
        ) : (
          <label className="ed-field">
            <span>Length</span>
            <select className="input sm" value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {l} seconds
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ed-field">
          <span>Tone</span>
          <select className="input sm" value={tone} onChange={(e) => setTone(e.target.value as AiTone)}>
            {AI_TONES.map((t) => (
              <option key={t} value={t}>
                {TONE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          <span>Scenes</span>
          <select className="input sm" value={sceneCount} onChange={(e) => setSceneCount(Number(e.target.value))}>
            <option value={0}>Auto</option>
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" onClick={() => void write()} disabled={busy} style={{ alignSelf: "end" }} data-testid="ai-write">
          {busy ? "Writing…" : script ? "Write again" : "Write script"}
        </button>
      </div>
      {status && !status.text.real && <p className="small muted" style={{ margin: 0 }}>Starter text: without an AI key you get sensible placeholder lines to edit, built from your brief.</p>}
      {error && <div className="alert error small">{error}</div>}
      {script && (
        <div className="stack" style={{ gap: 8 }} data-testid="ai-script">
          <div className="row between">
            <strong>{script.title}</strong>
            <span className="small muted">
              {script.scenes.length} scenes · {total.toFixed(0)} s
            </span>
          </div>
          {script.scenes.map((s, i) => (
            <div key={i} className="ai-scene">
              <div className="row between">
                <span className="small muted">
                  {i + 1}. {s.name} · {s.duration.toFixed(0)} s{s.cta ? ` · button “${s.cta}”` : ""}
                </span>
                <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(videoPromptFor(s.shot || s.headline, s.duration, project.canvas.aspectRatio))} title="Copy a ready prompt for Veo / Sora / Runway / Kling (see docs/ai-video-prompts.md)">
                  Copy video prompt
                </button>
              </div>
              <strong>{s.headline}</strong>
              {s.subline && <div className="small">{s.subline}</div>}
              {s.voiceover && <div className="small muted">🎙 {s.voiceover}</div>}
              {s.shot && <div className="small muted">🎬 {s.shot}</div>}
            </div>
          ))}
          <div className="row">
            <button className="btn primary" onClick={() => build("replace")} data-testid="ai-build">
              Build these scenes
            </button>
            <button className="btn" onClick={() => build("append")}>
              Add after my scenes
            </button>
            <span className="small muted">Headline, subline and button per scene; the voiceover lines wait in the next tab.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Copy ----------------

const KIND_LABEL: Record<AiCopyKind, string> = { headline: "Headline", subline: "Supporting line", button: "Button label", badge: "Badge", tooltip: "Hotspot tooltip", product: "Product blurb", voiceover: "Voiceover line" };
const CHIPS = ["Shorter", "More urgent", "Benefit-led", "As a question", "Simpler words"];

function kindFor(layer: Layer | undefined): AiCopyKind {
  if (!layer) return "headline";
  if (layer.type === "button" || layer.type === "commerce-button") return "button";
  if (layer.type === "badge") return "badge";
  if (layer.type === "hotspot") return "tooltip";
  if (layer.type === "product") return "product";
  const size = Number(layer.style.fontSize);
  return (layer.name ?? "").toLowerCase().includes("sub") || (Number.isFinite(size) && size < 28) ? "subline" : "headline";
}
const contentKey = (kind: AiCopyKind, layer: Layer | undefined) => (layer?.type === "button" || layer?.type === "commerce-button" ? "label" : layer?.type === "hotspot" ? "tooltip" : kind === "product" ? "blurb" : "text");

function CopyTab({ projectId, status }: { projectId: string; status: AiStatus | null }) {
  const { updateLayer, addLayer, select } = useEditor();
  const selected = useSelectedLayers();
  const layer = selected.length === 1 ? selected[0] : undefined;
  const autoKind = kindFor(layer);
  const [kind, setKind] = useState<AiCopyKind>(autoKind);
  useEffect(() => setKind(autoKind), [autoKind, layer?.id]);
  const current = layer ? String(layer.content[contentKey(kind, layer)] ?? "") : "";
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current, layer?.id]);
  const [tone, setTone] = useState<AiTone>("friendly");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<string[]>([]);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ variants: string[] }>("/api/v1/ai/copy", { method: "POST", json: { projectId, kind, text, tone, instruction: instruction || undefined, count: 5 } });
      setVariants(r.variants);
      if (!r.variants.length) setError("No suggestions came back. Try a different instruction.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const use = (v: string) => {
    if (layer) updateLayer(layer.id, { content: { ...layer.content, [contentKey(kind, layer)]: v } });
    else {
      addLayer("text", { content: { text: v }, name: kind === "subline" ? "Subline" : "Headline" });
      select([]);
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>
        {layer ? (
          <>
            Suggestions for the selected <strong>{layer.name ?? layer.type}</strong>. Click one to use it (Ctrl+Z undoes).
          </>
        ) : (
          "Select an element on the canvas for suggestions about it, or write a new headline below."
        )}
      </p>
      <div className="row">
        <label className="ed-field" style={{ flex: 1, minWidth: 220 }}>
          <span>Current text</span>
          <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave empty for fresh ideas" maxLength={1200} />
        </label>
        <label className="ed-field">
          <span>Kind</span>
          <select className="input sm" value={kind} onChange={(e) => setKind(e.target.value as AiCopyKind)}>
            {(Object.keys(KIND_LABEL) as AiCopyKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          <span>Tone</span>
          <select className="input sm" value={tone} onChange={(e) => setTone(e.target.value as AiTone)}>
            {AI_TONES.map((t) => (
              <option key={t} value={t}>
                {TONE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {CHIPS.map((c) => (
          <button key={c} type="button" className={`ai-chip ${instruction === c ? "on" : ""}`} onClick={() => setInstruction(instruction === c ? "" : c)}>
            {c}
          </button>
        ))}
        <button className="btn primary sm" onClick={() => void suggest()} disabled={busy} style={{ marginLeft: "auto" }} data-testid="ai-suggest">
          {busy ? "Thinking…" : "Suggest"}
        </button>
      </div>
      {status && !status.text.real && <p className="small muted" style={{ margin: 0 }}>Starter suggestions (no AI key): simple rewrites of your text.</p>}
      {error && <div className="alert error small">{error}</div>}
      {variants.length > 0 && (
        <div className="stack" style={{ gap: 6 }} data-testid="ai-variants">
          {variants.map((v) => (
            <div key={v} className="ai-variant">
              <span>{v}</span>
              <span className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(v)} title="Copy">
                  Copy
                </button>
                <button className="btn sm primary" onClick={() => use(v)}>
                  {layer ? "Use" : "Add as text"}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Voiceover ----------------

type VoState = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "done"; seconds: number } | { kind: "error"; message: string };

function VoiceoverTab({ projectId, status }: { projectId: string; status: AiStatus | null }) {
  const { project, setSceneScript, addVoiceover, regenerateCaptions } = useEditor();
  const voices = status?.speech?.voices ?? [];
  const [voice, setVoice] = useState<string>("");
  useEffect(() => {
    if (!voice && voices.length) setVoice(voices.find((v) => /zira|female|aria|jenny/i.test(`${v.name} ${v.gender}`))?.id ?? voices[0]!.id);
  }, [voices, voice]);
  const [withCaptions, setWithCaptions] = useState(true);
  const [states, setStates] = useState<Record<string, VoState>>({});
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const setState = (id: string, s: VoState) => alive.current && setStates((m) => ({ ...m, [id]: s }));

  const textFor = (scene: Scene) => scene.script?.voiceover ?? suggestedVoiceover(scene);

  async function generate(scene: Scene): Promise<boolean> {
    const text = textFor(scene).trim();
    if (!text) {
      setState(scene.id, { kind: "error", message: "Write a line first." });
      return false;
    }
    if (!scene.script?.voiceover) setSceneScript(scene.id, { voiceover: text }); // keep what was read, for captions
    setState(scene.id, { kind: "busy", label: "Generating voice…" });
    try {
      const r = await api<{ asset: MediaAsset; durationSeconds: number | null }>("/api/v1/ai/voiceover", { method: "POST", json: { projectId, sceneId: scene.id, text, voiceId: voice || undefined } });
      setState(scene.id, { kind: "busy", label: "Preparing audio…" });
      let asset = r.asset;
      for (let i = 0; i < 90 && asset.status !== "ready" && asset.status !== "failed"; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        asset = (await api<{ asset: MediaAsset }>(`/api/v1/media/${asset.id}`)).asset;
      }
      if (asset.status !== "ready" || !asset.metadataJson.audioUrl) throw new Error(asset.error ?? "Audio processing did not finish. Is the worker running?");
      const duration = asset.metadataJson.duration ?? r.durationSeconds ?? 3;
      addVoiceover(scene.id, { assetId: asset.id, src: asset.metadataJson.audioUrl, duration });
      setState(scene.id, { kind: "done", seconds: duration });
      return true;
    } catch (e) {
      setState(scene.id, { kind: "error", message: errorMessage(e) });
      return false;
    }
  }

  async function generateAll() {
    let any = false;
    for (const scene of useEditor.getState().project.scenes) {
      if (!alive.current) return;
      if (await generate(useEditor.getState().project.scenes.find((s) => s.id === scene.id) ?? scene)) any = true;
    }
    if (any && withCaptions) regenerateCaptions();
  }

  if (!status) return <p className="muted small">Checking what this server can do…</p>;
  if (!status.speech) return <div className="alert small">No voice is available on this server. {status.hints.find((h) => /ELEVENLABS/.test(h)) ?? "Add ELEVENLABS_API_KEY to the API .env."}</div>;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <label className="ed-field" style={{ minWidth: 220 }}>
          <span>Voice · {status.speech.label}</span>
          <select className="input sm" value={voice} onChange={(e) => setVoice(e.target.value)} data-testid="ai-voice">
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.language ? ` (${v.language})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={withCaptions} onChange={(e) => setWithCaptions(e.target.checked)} /> Also create captions from the text
        </label>
        <button className="btn primary" onClick={() => void generateAll()} style={{ marginLeft: "auto" }} data-testid="ai-voice-all">
          Generate all scenes
        </button>
      </div>
      {status.speech.provider === "system" && <p className="small muted" style={{ margin: 0 }}>Built-in voices are clear but robotic — fine to time the video; swap in ElevenLabs later for a natural voice.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {project.scenes.map((scene, i) => {
          const st = states[scene.id] ?? { kind: "idle" };
          const existing = voiceoverLayer(scene);
          return (
            <div key={scene.id} className="ai-scene">
              <div className="row between">
                <span className="small muted">
                  {i + 1}. {scene.name} · {(scene.end - scene.start).toFixed(1)} s
                  {existing && st.kind === "idle" ? " · has a voiceover" : ""}
                </span>
                <span className="row" style={{ gap: 8 }}>
                  {st.kind === "busy" && <span className="small muted">{st.label}</span>}
                  {st.kind === "done" && <span className="small" style={{ color: "var(--success)" }}>✓ {st.seconds.toFixed(1)} s</span>}
                  {st.kind === "error" && <span className="small" style={{ color: "var(--danger)" }}>{st.message}</span>}
                  <button className="btn sm primary" disabled={st.kind === "busy"} onClick={() => void generate(scene).then((ok) => ok && withCaptions && regenerateCaptions())} data-testid="ai-voice-one">
                    {existing ? "Regenerate" : "Generate"}
                  </button>
                </span>
              </div>
              <textarea className="input sm" rows={2} value={textFor(scene)} onChange={(e) => setSceneScript(scene.id, { voiceover: e.target.value })} placeholder="What should the voice say in this scene?" maxLength={1200} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Captions ----------------

function CaptionsTab({ projectId, workspaceId, status }: { projectId: string; workspaceId: string; status: AiStatus | null }) {
  const { project, setCaptions, regenerateCaptions, setPlaybackCaptions } = useEditor();
  const caps = project.captions;
  const cues = caps?.cues ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [source, setSource] = useState("");
  const hasScript = project.scenes.some((s) => s.script?.voiceover?.trim());
  const canTranscribe = !!status?.transcription;

  useEffect(() => {
    if (!canTranscribe) return;
    api<{ assets: MediaAsset[] }>(`/api/v1/media?workspaceId=${workspaceId}`)
      .then((r) => setAssets(r.assets.filter((a) => a.type !== "image" && a.status === "ready")))
      .catch(() => setAssets([]));
  }, [workspaceId, canTranscribe]);

  /** Audio sources that live on the timeline: voiceover layers (offset by their scene) and the main video (offset 0). */
  const sources = useMemo(() => {
    const out: Array<{ id: string; label: string; assetId: string; offset: number }> = [];
    if (project.video) out.push({ id: "video", label: "Main video", assetId: project.video.assetId, offset: 0 });
    for (const s of project.scenes) {
      const vo = voiceoverLayer(s);
      if (vo?.assetId) out.push({ id: vo.id, label: `Voiceover · ${s.name}`, assetId: vo.assetId, offset: s.start + (vo.start ?? 0) });
      else if (s.background.type === "video" && !project.video) out.push({ id: s.id, label: `Clip · ${s.name}`, assetId: s.background.assetId, offset: s.start - s.background.sourceStart });
    }
    return out;
  }, [project]);
  useEffect(() => {
    if (!source && sources.length) setSource(sources[0]!.id);
  }, [sources, source]);

  async function transcribe() {
    const src = sources.find((s) => s.id === source);
    if (!src) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ cues: CaptionCue[] }>("/api/v1/ai/captions", { method: "POST", json: { projectId, assetId: src.assetId, language: caps?.language } });
      const shifted = r.cues.map((c) => ({ ...c, start: c.start + src.offset, end: c.end + src.offset })).filter((c) => c.end > 0);
      const rest = cues.filter((c) => !shifted.some((n) => n.start < c.end && c.start < n.end));
      setCaptions({ language: caps?.language ?? "en", style: caps?.style ?? { position: "bottom", size: "m" }, cues: normalizeCues([...rest, ...shifted]), source: "transcript" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const edit = (i: number, patch: Partial<CaptionCue>) => {
    const next = cues.map((c, j) => (j === i ? { ...c, ...patch } : c));
    setCaptions({ language: caps?.language ?? "en", style: caps?.style ?? { position: "bottom", size: "m" }, cues: next, source: "manual" });
  };
  const remove = (i: number) => setCaptions(caps ? { ...caps, cues: cues.filter((_, j) => j !== i), source: "manual" } : null);
  const style = (patch: Partial<NonNullable<typeof caps>["style"]>) => caps && setCaptions({ ...caps, style: { ...caps.style, ...patch } });

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <button className="btn primary" onClick={regenerateCaptions} disabled={!hasScript} title={hasScript ? "Timed over each scene's voiceover (or the scene itself)" : "Write voiceover lines in the Voiceover tab first"} data-testid="ai-captions-script">
          Create from script
        </button>
        {canTranscribe && sources.length > 0 && (
          <>
            <select className="input sm" value={source} onChange={(e) => setSource(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => void transcribe()} disabled={busy}>
              {busy ? "Transcribing…" : "Transcribe audio"}
            </button>
          </>
        )}
        {cues.length > 0 && (
          <button className="btn" onClick={() => setCaptions(null)} style={{ marginLeft: "auto" }}>
            Clear
          </button>
        )}
      </div>
      {!canTranscribe && <p className="small muted" style={{ margin: 0 }}>Captions from your script text work offline. {status?.hints.find((h) => /transcribe/i.test(h)) ?? ""}</p>}
      {error && <div className="alert error small">{error}</div>}
      {caps && (
        <div className="row">
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={project.playback.captions !== false} onChange={(e) => setPlaybackCaptions(e.target.checked)} /> Show on the published video (visitors get a CC button)
          </label>
          <label className="ed-field">
            <span>Position</span>
            <select className="input sm" value={caps.style.position} onChange={(e) => style({ position: e.target.value as "bottom" | "top" })}>
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
            </select>
          </label>
          <label className="ed-field">
            <span>Size</span>
            <select className="input sm" value={caps.style.size} onChange={(e) => style({ size: e.target.value as "s" | "m" | "l" })}>
              <option value="s">Small</option>
              <option value="m">Medium</option>
              <option value="l">Large</option>
            </select>
          </label>
          <span className="small muted" style={{ marginLeft: "auto" }}>
            {cues.length} cue{cues.length === 1 ? "" : "s"}
            {caps.source === "script" ? " · timed from the script" : caps.source === "transcript" ? " · transcribed" : ""}
          </span>
        </div>
      )}
      {cues.length > 0 ? (
        <div className="ai-cues" data-testid="ai-cues">
          {cues.map((c, i) => (
            <div key={`${i}-${c.start}`} className="ai-cue">
              <input className="input sm" type="number" step={0.1} min={0} value={c.start} onChange={(e) => edit(i, { start: Number(e.target.value) })} aria-label="Start" />
              <input className="input sm" type="number" step={0.1} min={0} value={c.end} onChange={(e) => edit(i, { end: Number(e.target.value) })} aria-label="End" />
              <input className="input sm" value={c.text} onChange={(e) => edit(i, { text: e.target.value })} maxLength={200} aria-label="Text" />
              <button className="btn sm" onClick={() => remove(i)} title="Delete">
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>No captions yet. {hasScript ? "Click “Create from script”." : "Write voiceover lines first (Voiceover tab), then create captions from them."}</p>
      )}
      {cues.length > 0 && project.scenes.some((s) => s.script?.voiceover) && captionsFromScript(project).cues.length !== cues.length && caps?.source === "script" && <p className="small muted" style={{ margin: 0 }}>Scenes changed since these captions were made — “Create from script” re-times them.</p>}
    </div>
  );
}
