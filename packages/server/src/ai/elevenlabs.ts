import type { CaptionCue } from "@sceneflow/schema";
import { wordsToCues } from "./captions.js";
import type { SpeechProvider, SynthesizedAudio, TranscriptionProvider, Voice } from "./types.js";

/*
 * ElevenLabs: natural voiceovers (text-to-speech) and captions from audio (speech-to-text "Scribe").
 * One key enables both. Plain fetch, no SDK.
 */

const BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsProvider implements SpeechProvider, TranscriptionProvider {
  readonly id = "elevenlabs";
  readonly label = "ElevenLabs";
  private voiceCache: Voice[] | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly opts: { defaultVoiceId?: string; ttsModel?: string; sttModel?: string } = {},
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "xi-api-key": this.apiKey, ...extra };
  }

  async voices(): Promise<Voice[]> {
    if (this.voiceCache) return this.voiceCache;
    const res = await fetch(`${BASE}/voices`, { headers: this.headers() });
    if (!res.ok) throw new Error(`ElevenLabs voices failed (${res.status})`);
    const data = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> };
    this.voiceCache = (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, language: v.labels?.language, gender: v.labels?.gender }));
    return this.voiceCache;
  }

  async synthesize(text: string, voiceId?: string): Promise<SynthesizedAudio> {
    const voice = voiceId || this.opts.defaultVoiceId || (await this.voices())[0]?.id;
    if (!voice) throw new Error("No ElevenLabs voice available");
    const res = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", accept: "audio/mpeg" }),
      body: JSON.stringify({ text, model_id: this.opts.ttsModel ?? "eleven_multilingual_v2" }),
    });
    if (!res.ok) throw new Error(`ElevenLabs text-to-speech failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mimeType: "audio/mpeg", ext: "mp3" };
  }

  async transcribe(audio: Buffer, mimeType: string, language?: string): Promise<CaptionCue[]> {
    const form = new FormData();
    form.append("model_id", this.opts.sttModel ?? "scribe_v1");
    form.append("timestamps_granularity", "word");
    if (language) form.append("language_code", language.split("-")[0]!);
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "audio");
    const res = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: this.headers(), body: form });
    if (!res.ok) throw new Error(`ElevenLabs speech-to-text failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { words?: Array<{ text: string; start: number; end: number; type?: string }> };
    const words = (data.words ?? []).filter((w) => w.type !== "spacing" && w.text.trim());
    return wordsToCues(words);
  }
}
