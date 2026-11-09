import type { CaptionCue } from "@sceneflow/schema";

/** Duration of a PCM WAV buffer from its header (null when not a plain RIFF/WAVE file). */
export function wavDuration(buf: Buffer): number | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(offset + 8 + 8);
    else if (id === "data") {
      if (!byteRate) return null;
      const dataSize = Math.min(size, buf.length - offset - 8);
      return Math.round((dataSize / byteRate) * 1000) / 1000;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/**
 * Groups word timings (from a speech-to-text provider) into caption cues: break on sentence ends, on long
 * pauses, or when a line would pass `maxChars` / `maxSeconds`.
 */
export function wordsToCues(words: TimedWord[], opts: { maxChars?: number; maxSeconds?: number; pause?: number } = {}): CaptionCue[] {
  const maxChars = opts.maxChars ?? 64;
  const maxSeconds = opts.maxSeconds ?? 4;
  const pause = opts.pause ?? 0.7;
  const cues: CaptionCue[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.text.trim()).filter(Boolean).join(" ");
    const start = cur[0]!.start;
    const end = Math.max(cur[cur.length - 1]!.end, start + 0.3);
    if (text) cues.push({ start: round3(start), end: round3(end), text: text.slice(0, 200) });
    cur = [];
  };
  for (const w of words) {
    if (!w.text.trim()) continue;
    const prev = cur[cur.length - 1];
    const len = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (prev && (w.start - prev.end > pause || len > maxChars || w.end - cur[0]!.start > maxSeconds)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text.trim())) flush();
  }
  flush();
  return cues;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
