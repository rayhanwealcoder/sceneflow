import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { wavDuration } from "./captions.js";
import type { SpeechProvider, SynthesizedAudio, Voice } from "./types.js";

const exec = promisify(execFile);

/*
 * Voiceover without any account: the operating system's own speech synthesis.
 *   Windows  — SAPI via PowerShell (System.Speech), WAV out
 *   macOS    — `say`, WAV out
 *   Linux    — `espeak-ng` / `espeak`, WAV out
 * Quality is "clear, robotic"; good enough to time a video and test the flow. ElevenLabs takes over when a key is set.
 */

export type SystemEngine = "sapi" | "say" | "espeak-ng" | "espeak";

export async function detectSystemEngine(): Promise<SystemEngine | null> {
  if (process.platform === "win32") return "sapi";
  if (process.platform === "darwin") return (await has("say")) ? "say" : null;
  if (await has("espeak-ng")) return "espeak-ng";
  if (await has("espeak")) return "espeak";
  return null;
}

async function has(bin: string): Promise<boolean> {
  try {
    await exec(bin, ["--version"], { timeout: 5000 });
    return true;
  } catch (err) {
    // `say --version` is not a thing but the binary exists when the error is not ENOENT.
    return (err as { code?: string }).code !== "ENOENT";
  }
}

const PS_LIST = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo; "$($v.Name)|$($v.Culture)|$($v.Gender)" }; $s.Dispose()`;

export class SystemSpeechProvider implements SpeechProvider {
  readonly id = "system";
  readonly label: string;
  private voiceCache: Voice[] | null = null;

  constructor(private readonly engine: SystemEngine) {
    this.label = engine === "sapi" ? "Windows voices (built in)" : engine === "say" ? "macOS voices (built in)" : "espeak (built in)";
  }

  async voices(): Promise<Voice[]> {
    if (this.voiceCache) return this.voiceCache;
    let out: Voice[] = [];
    try {
      if (this.engine === "sapi") {
        const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_LIST], { timeout: 20000 });
        out = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [name = "", culture = "", gender = ""] = l.split("|");
            return { id: name, name: name.replace(/^Microsoft\s+|\s+Desktop$/g, ""), language: culture, gender: gender.toLowerCase() };
          });
      } else if (this.engine === "say") {
        const { stdout } = await exec("say", ["-v", "?"], { timeout: 10000 });
        out = stdout
          .split(/\r?\n/)
          .map((l) => /^(\S.*?)\s{2,}(\S+)/.exec(l))
          .filter((m): m is RegExpExecArray => !!m)
          .map((m) => ({ id: m[1]!, name: m[1]!, language: m[2]!.replace("_", "-") }));
      } else {
        out = [
          { id: "en", name: "English", language: "en" },
          { id: "en-us", name: "English (US)", language: "en-US" },
          { id: "de", name: "German", language: "de" },
          { id: "fr", name: "French", language: "fr" },
          { id: "es", name: "Spanish", language: "es" },
          { id: "bn", name: "Bengali", language: "bn" },
        ];
      }
    } catch {
      out = [];
    }
    this.voiceCache = out;
    return out;
  }

  async synthesize(text: string, voiceId?: string): Promise<SynthesizedAudio> {
    // Only a voice this machine reported may reach the command line; anything else means "default voice".
    // The spoken text never touches the command line: it goes through a temp file.
    const known = voiceId ? (await this.voices()).find((v) => v.id === voiceId) : undefined;
    const voice = known?.id;
    const dir = await mkdtemp(join(tmpdir(), "sf-tts-"));
    const txt = join(dir, "text.txt");
    const wav = join(dir, "voice.wav");
    try {
      await writeFile(txt, text, "utf8");
      if (this.engine === "sapi") {
        const select = voice ? `try { $s.SelectVoice(${psString(voice)}) } catch {}` : "";
        const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${select}; $s.Rate = 0; $s.SetOutputToWaveFile(${psString(wav)}); $s.Speak([IO.File]::ReadAllText(${psString(txt)}, [Text.Encoding]::UTF8)); $s.Dispose()`;
        await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 120000 });
      } else if (this.engine === "say") {
        await exec("say", [...(voice ? ["-v", voice] : []), "--data-format=LEI16@22050", "-o", wav, "-f", txt], { timeout: 120000 });
      } else {
        await exec(this.engine, ["-w", wav, ...(voice ? ["-v", voice] : []), "-s", "165", "-f", txt], { timeout: 120000 });
      }
      const audio = await readFile(wav);
      if (audio.length < 100) throw new Error("Speech synthesis produced no audio");
      return { audio, mimeType: "audio/wav", ext: "wav", durationSeconds: wavDuration(audio) ?? undefined };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Single-quoted PowerShell literal. PowerShell also accepts the Unicode single quotes (U+2018–U+201B) as
 * string delimiters, so every one of them is doubled as an ASCII quote; control characters and the
 * backtick / `$` are harmless inside single quotes but stripped anyway.
 */
export const psString = (s: string) => `'${s.replace(/['‘’‚‛]/g, "''").replace(/[\u0000-\u001f\u007f]/g, "")}'`;
