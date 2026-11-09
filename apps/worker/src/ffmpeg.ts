import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const exec = promisify(execFile);

// Binaries ship inside npm packages (no GitHub download at install time), so installs are reliable locally and on the VPS.
export const FFMPEG = ffmpegInstaller.path;
export const FFPROBE = ffprobeInstaller.path;

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  codec?: string;
  hasAudio: boolean;
}

/** Runs a binary and turns a non-zero exit into a readable error (exit code + stderr), never a silent failure. */
async function run(bin: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(bin, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (err) {
    const e = err as { code?: number | string; signal?: string; stderr?: string };
    const name = bin.replace(/^.*[\\/]/, "");
    throw new Error(`${name} failed (exit ${e.code ?? "?"}${e.signal ? `, signal ${e.signal}` : ""}): ${(e.stderr ?? "").trim() || "no output"}`);
  }
}

export async function ffprobe(input: string): Promise<ProbeResult> {
  const stdout = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>;
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0) || 0;
  return { duration, width: video?.width, height: video?.height, codec: video?.codec_name ?? audio?.codec_name, hasAudio: Boolean(audio) };
}

export async function ffmpeg(args: string[]): Promise<void> {
  await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

/** Runs ffmpeg and returns its binary stdout (used for raw PCM extraction). */
export async function ffmpegBuffer(args: string[]): Promise<Buffer> {
  try {
    const { stdout } = await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (err) {
    const e = err as { code?: number | string; stderr?: Buffer | string };
    throw new Error(`ffmpeg failed (exit ${e.code ?? "?"}): ${String(e.stderr ?? "").trim() || "no output"}`);
  }
}

/** Mono 8 kHz signed 16-bit PCM on stdout; cheap to decode and plenty for a waveform preview. */
export const pcmArgs = (input: string) => ["-i", input, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"];

/** Web-friendly audio variant for audio uploads. */
export const audioArgs = (input: string, out: string) => ["-i", input, "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];

/** Normalized peak per bucket (0..1), suitable for drawing a waveform at any width. */
export function peaksFromPcm16(pcm: Buffer, buckets = 800): number[] {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return [];
  const per = Math.max(1, Math.floor(samples / buckets));
  const out: number[] = [];
  for (let b = 0; b < buckets && b * per < samples; b++) {
    let max = 0;
    const end = Math.min(samples, (b + 1) * per);
    for (let i = b * per; i < end; i++) {
      const v = Math.abs(pcm.readInt16LE(i * 2));
      if (v > max) max = v;
    }
    out.push(Math.round((max / 32768) * 100) / 100);
  }
  return out;
}

/** Frame grab for the poster. */
export const posterArgs = (input: string, at: number, out: string) => ["-ss", at.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", out];

/**
 * 540p editor proxy. Keyframe every second + faststart makes it seek-friendly,
 * which is also what scroll-scrub playback needs (doc 11.4).
 */
export const proxyArgs = (input: string, out: string, fps = 30) => [
  "-i", input,
  "-vf", "scale=-2:'min(540,ih)'",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
  "-g", String(fps), "-keyint_min", String(fps), "-sc_threshold", "0",
  "-c:a", "aac", "-b:a", "96k",
  "-movflags", "+faststart",
  out,
];

export const thumbnailArgs = (input: string, everySec: number, outPattern: string) => ["-i", input, "-vf", `fps=1/${everySec},scale=160:-2`, "-frames:v", "10", "-q:v", "5", outPattern];

/**
 * Playback rendition at a given height (720 / 1080). 2 s GOP + faststart; audio kept.
 * `-threads 0` lets FFmpeg use the cores the host has; concurrency is bounded by the worker, not here.
 */
export const renditionArgs = (input: string, out: string, height: number, hasAudio: boolean, fps = 30) => [
  "-i", input,
  "-vf", `scale=-2:'min(${height},ih)'`,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", height >= 1080 ? "23" : "24", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
  "-g", String(fps * 2), "-keyint_min", String(fps), "-sc_threshold", "0",
  ...(hasAudio ? ["-c:a", "aac", "-b:a", height >= 1080 ? "160k" : "128k"] : ["-an"]),
  "-movflags", "+faststart", "-threads", "0",
  out,
];

/**
 * Scroll-optimized MP4 (doc 11.4): no audio, constant 30 fps, a keyframe every 4 frames, no B-frames and a
 * single reference frame, so a `currentTime` seek in either direction decodes at most 3 frames before it
 * can paint. Larger than the proxy, which is why it is only produced for short clips (≤ 3 minutes); the
 * runtime downloads it whole in scroll mode so seeks never wait on the network.
 */
export const scrubArgs = (input: string, out: string, height: number) => [
  "-i", input,
  "-vf", `scale=-2:'min(${height},ih)',fps=30`,
  "-an",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-tune", "fastdecode",
  "-g", "4", "-keyint_min", "4", "-sc_threshold", "0", "-bf", "0", "-refs", "1",
  "-movflags", "+faststart", "-threads", "0",
  out,
];

/** Which renditions a source deserves: never upscale, 1080p only for 1080p+ sources. */
export function renditionPlan(sourceHeight: number | undefined, duration: number): Array<{ height: number; kind: "progressive" | "scrub" }> {
  const h = sourceHeight ?? 0;
  const plan: Array<{ height: number; kind: "progressive" | "scrub" }> = [];
  if (h >= 700) plan.push({ height: 720, kind: "progressive" });
  if (h >= 1060) plan.push({ height: 1080, kind: "progressive" });
  if (duration > 0 && duration <= 180) plan.push({ height: Math.min(720, h || 720), kind: "scrub" });
  return plan;
}

/** Optimized editor variant for images (max 1920px wide, WebP). */
export const imageArgs = (input: string, out: string) => ["-i", input, "-vf", "scale='min(1920,iw)':-2", "-quality", "82", out];

/** Tiny synthetic clip for tests and local demos. */
export const testClipArgs = (out: string, seconds = 2) => [
  "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=320x240:rate=24`,
  "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
];
