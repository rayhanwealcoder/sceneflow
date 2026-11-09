import { AnthropicTextProvider, DEFAULT_MODEL } from "./anthropic.js";
import { ElevenLabsProvider } from "./elevenlabs.js";
import { detectSystemEngine, SystemSpeechProvider } from "./speech-system.js";
import { StarterTextProvider } from "./starter.js";
import type { AiServices, AiStatus, SpeechProvider, TextProvider, TranscriptionProvider } from "./types.js";

export * from "./types.js";
export * from "./captions.js";
export { StarterTextProvider, subjectOf, splitDurations } from "./starter.js";
export { AnthropicTextProvider, DEFAULT_MODEL } from "./anthropic.js";
export { SystemSpeechProvider, detectSystemEngine, psString } from "./speech-system.js";
export { ElevenLabsProvider } from "./elevenlabs.js";

export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  /** auto (default) | anthropic | starter */
  AI_TEXT_PROVIDER?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  /** auto (default) | elevenlabs | system | off */
  AI_SPEECH_PROVIDER?: string;
}

/** Wires the providers from environment variables; every slot degrades gracefully. */
export async function createAi(env: AiEnv = process.env as AiEnv): Promise<AiServices> {
  const textChoice = env.AI_TEXT_PROVIDER ?? "auto";
  const text: TextProvider = textChoice !== "starter" && env.ANTHROPIC_API_KEY ? new AnthropicTextProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL || DEFAULT_MODEL }) : new StarterTextProvider();

  const speechChoice = env.AI_SPEECH_PROVIDER ?? "auto";
  let speech: SpeechProvider | null = null;
  let transcription: TranscriptionProvider | null = null;
  const eleven = env.ELEVENLABS_API_KEY && speechChoice !== "system" && speechChoice !== "off" ? new ElevenLabsProvider(env.ELEVENLABS_API_KEY, { defaultVoiceId: env.ELEVENLABS_VOICE_ID }) : null;
  if (eleven) {
    speech = eleven;
    transcription = eleven;
  } else if (speechChoice !== "off" && speechChoice !== "elevenlabs") {
    const engine = await detectSystemEngine();
    if (engine) speech = new SystemSpeechProvider(engine);
  }
  return buildServices({ text, speech, transcription });
}

/** Assembles services from explicit providers (tests inject fakes here). */
export function buildServices(p: { text: TextProvider; speech: SpeechProvider | null; transcription: TranscriptionProvider | null }): AiServices {
  return {
    ...p,
    async status(): Promise<AiStatus> {
      const hints: string[] = [];
      if (p.text.id === "starter") hints.push("Add ANTHROPIC_API_KEY to the API .env for real AI scripts and copy (Claude).");
      if (!p.speech) hints.push("Add ELEVENLABS_API_KEY for natural voiceovers (no built-in speech engine was found on this server).");
      else if (p.speech.id === "system") hints.push("Voiceovers use the server's built-in voices. Add ELEVENLABS_API_KEY for natural voices and captions from audio.");
      if (!p.transcription && p.speech?.id !== "system") hints.push("Add ELEVENLABS_API_KEY to transcribe uploaded audio into captions.");
      let voices: Awaited<ReturnType<SpeechProvider["voices"]>> = [];
      if (p.speech) {
        try {
          voices = await p.speech.voices();
        } catch {
          voices = [];
        }
      }
      return {
        text: { provider: p.text.id, label: p.text.label, real: p.text.id !== "starter" },
        speech: p.speech ? { provider: p.speech.id, label: p.speech.label, voices } : null,
        transcription: p.transcription ? { provider: p.transcription.id, label: p.transcription.label } : null,
        hints,
      };
    },
  };
}
