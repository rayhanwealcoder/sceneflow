import type { AiCopyRequest, AiScript, AiScriptRequest, CaptionCue } from "@sceneflow/schema";

/*
 * AI providers (doc §10.2: "AI media generation must be provider-based and optional").
 * Text = script / storyboard / copy. Speech = voiceover. Transcription = captions from audio.
 * Every slot has a no-key fallback or is reported as unavailable; the product never breaks without keys.
 */

export interface ScriptBrief extends Omit<AiScriptRequest, "projectId"> {
  projectName?: string;
  /** The project already has footage: scenes split it rather than invent a new one. */
  hasVideo: boolean;
  videoDuration?: number;
  /** Product the project sells (first product card), for copy that mentions it. */
  product?: { title: string; price?: string };
}

export type CopyBrief = Omit<AiCopyRequest, "projectId">;

export interface TextProvider {
  readonly id: string;
  readonly label: string;
  script(brief: ScriptBrief): Promise<AiScript>;
  copy(brief: CopyBrief): Promise<string[]>;
}

export interface Voice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
}

export interface SynthesizedAudio {
  audio: Buffer;
  mimeType: string;
  /** File extension without the dot. */
  ext: string;
  /** Known duration in seconds when the format makes it cheap to read (WAV); the worker measures otherwise. */
  durationSeconds?: number;
}

export interface SpeechProvider {
  readonly id: string;
  readonly label: string;
  voices(): Promise<Voice[]>;
  synthesize(text: string, voiceId?: string): Promise<SynthesizedAudio>;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  transcribe(audio: Buffer, mimeType: string, language?: string): Promise<CaptionCue[]>;
}

export interface AiStatus {
  text: { provider: string; label: string; real: boolean };
  speech: { provider: string; label: string; voices: Voice[] } | null;
  transcription: { provider: string; label: string } | null;
  /** Short setup hints for the admin ("add ANTHROPIC_API_KEY …"); empty when everything is configured. */
  hints: string[];
}

export interface AiServices {
  text: TextProvider;
  speech: SpeechProvider | null;
  transcription: TranscriptionProvider | null;
  status(): Promise<AiStatus>;
}
