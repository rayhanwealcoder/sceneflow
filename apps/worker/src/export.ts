import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { chromium, type Browser, type Route } from "playwright-core";
import type { Device, Project } from "@sceneflow/schema";
import { audioFilterGraph, audioPlan, EXPORT_MIME, exportConfig, exportFileName, exportSpeed, LocalStorageProvider, MAX_EXPORT_SECONDS, mediaAssets, projectActivity, projectDuration, useOriginalSource, videoAssetIds, videoExports, type AudioCue, type Db, type StorageProvider } from "@sceneflow/server";
import { FFMPEG, ffmpeg, ffprobe } from "./ffmpeg.js";

/*
 * MP4 export (doc §31; doc §30 "Complex export: Remotion + FFmpeg" — same idea, our own runtime instead of
 * Remotion): the published runtime renders the project in headless Chrome exactly as visitors see it (same
 * CSS, fonts, motion, captions), the page is stepped through time frame by frame, every frame is screenshotted
 * and piped into FFmpeg (H.264), then the audio the player would play is mixed on top from the source files.
 * Nothing is re-implemented: if it renders in the player, it renders in the file.
 */

export interface ExportDeps {
  db: Db;
  storage: StorageProvider;
  /** API origin; the render page is served on this origin (intercepted — the API need not be up). */
  publicUrl: string;
  /** Explicit Chrome binary (EXPORT_BROWSER); default: the installed Google Chrome. */
  browserPath?: string;
}

export interface ExportResult {
  sizeBytes: number;
  durationSec: number;
  frames: number;
  /** Frames that hit the per-frame media wait limit (should be 0). */
  slowFrames: number;
  renderMs: number;
  pageErrors: string[];
  format: "mp4" | "webm" | "gif";
  /** Videos played from their original upload instead of a rendition. */
  fromOriginal: number;
}

const RUNTIME_FILE = createRequire(import.meta.url).resolve("@sceneflow/core/runtime");
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Longest wait for the media of one frame before the frame is taken as is. */
const FRAME_WAIT_MS = 5000;
/** Local files are handed to Chrome in slices so a 1080p rendition never sits in memory twice. */
const CHUNK_BYTES = 8 * 1024 * 1024;
/**
 * Frames travel as JPEG q92: measured at 1080p, Chrome encodes one in ~120 ms against ~450 ms for PNG, at a fifth
 * of the bytes, and the output is 4:2:0 H.264 anyway — no visible difference after x264 at CRF 18.
 */
const FRAME_FORMAT = { format: "jpeg" as const, quality: 92, decoder: "mjpeg" };

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".json": "application/json", ".js": "text/javascript" };

/**
 * The page Chrome renders: the runtime, the frozen config, and a tiny harness that steps time. `frame(t)` seeks
 * the player and resolves once every <video> of the frame shows the wanted moment (and every <img> is loaded),
 * then waits two animation frames so the compositor has the picture. Chrome may skip the first frame of a
 * `preload=metadata` video (it shows the poster), so the harness forces `preload=auto` and nudges a video whose
 * clock is right but has no decoded frame yet.
 */
function renderPageHtml(config: Project, device: Device, width: number, height: number, runtimeUrl: string, alpha = false): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  // A transparent canvas renders on white for MP4 / GIF; a WebM with alpha keeps it see-through.
  const background = alpha ? "transparent" : config.canvas.background === "transparent" ? "#fff" : config.canvas.background;
  return `<!doctype html><html><head><meta charset="utf-8"><title>SceneFlow export</title>
<style>
html,body{margin:0;padding:0;background:${background};overflow:hidden}
#root{width:${width}px;height:${height}px;position:relative;overflow:hidden}
.sceneflow-play,.sceneflow-cc,.sceneflow-toast{display:none!important}
.sceneflow-layer,.sceneflow-captions,.sceneflow-media>*{transition:none!important}
.sceneflow-hotspot .sceneflow-dot{animation-play-state:paused!important;animation-delay:var(--sceneflow-export-t,0s)!important}
</style></head><body><div id="root"></div>
<script src="${runtimeUrl}"></script>
<script>
(function () {
  var cfg = ${json};
  var root = document.getElementById('root');
  var lastError = null;
  var player = new SceneFlow.Player({ target: root, config: cfg, lazy: false, analytics: false, device: ${JSON.stringify(device)} });
  player.on('error', function (e) { lastError = e.code + ': ' + e.message; });
  new MutationObserver(function () {
    root.querySelectorAll('video').forEach(function (v) { if (v.preload !== 'auto') v.preload = 'auto'; });
  }).observe(root, { childList: true, subtree: true });
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var paint = function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); };
  function sceneAt(t) {
    var s = cfg.scenes;
    for (var i = 0; i < s.length; i++) if (t >= s[i].start && t < s[i].end) return s[i];
    return s.length && t >= s[s.length - 1].end ? s[s.length - 1] : null;
  }
  // Media time the player wants at project time t (null = no video on screen).
  function wanted(t) {
    if (cfg.video) return t;
    var s = sceneAt(t);
    if (!s || s.background.type !== 'video') return null;
    return (s.background.sourceStart || 0) + (t - s.start);
  }
  async function settle(t) {
    var want = wanted(t), deadline = performance.now() + ${FRAME_WAIT_MS}, nudged = new Set(), slow = false;
    for (;;) {
      var ok = true;
      var vids = root.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        if (!(v.currentSrc || v.getAttribute('src')) || v.error) continue;
        if (v.readyState < 1 || v.seeking) { ok = false; continue; }
        if (want !== null) {
          var dur = v.duration;
          var target = isFinite(dur) && dur > 0 ? Math.min(want, Math.max(0, dur - 0.001)) : want;
          if (Math.abs(v.currentTime - target) > 0.02 || v.readyState < 2) {
            if (!nudged.has(v)) { nudged.add(v); v.currentTime = target; }
            ok = false;
          }
        } else if (v.readyState < 2) {
          if (!nudged.has(v)) { nudged.add(v); v.currentTime = v.currentTime; }
          ok = false;
        }
      }
      var imgs = root.querySelectorAll('img');
      for (var j = 0; j < imgs.length; j++) if (imgs[j].getAttribute('src') && !imgs[j].complete) ok = false;
      if (ok) break;
      if (performance.now() > deadline) { slow = true; break; }
      await sleep(4);
    }
    await paint();
    return slow;
  }
  async function waitFonts() {
    var links = Array.prototype.slice.call(document.querySelectorAll('link[id^="sceneflow-font-"]'));
    await Promise.all(links.map(function (l) {
      return l.sheet ? null : new Promise(function (r) { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); setTimeout(r, 8000); });
    }));
    await paint();
    var end = performance.now() + 8000;
    while (document.fonts && document.fonts.status === 'loading' && performance.now() < end) await sleep(50);
    if (document.fonts) await Promise.race([document.fonts.ready, sleep(2000)]);
  }
  window.__sfExport = {
    ready: (async function () {
      await player.init();
      if (player.getState() === 'error') throw new Error(lastError || 'The player could not load this project');
      await waitFonts();
      await settle(0);
      return { state: player.getState(), mode: player.getEffectiveMode(), device: player.getDevice() };
    })(),
    frame: async function (t) {
      root.style.setProperty('--sceneflow-export-t', '-' + (t % 1.6).toFixed(3) + 's');
      player.seek(t);
      return settle(t);
    }
  };
})();
</script></body></html>`;
}

/** Serves a file from the local public folder to Chrome, honouring Range requests the way a static server would. */
async function serveLocalFile(route: Route, path: string | null, contentType?: string): Promise<void> {
  const st = path ? await stat(path).catch(() => null) : null;
  if (!st?.isFile()) return route.fulfill({ status: 404, body: "" });
  const type = contentType ?? MIME[extname(path!).toLowerCase()] ?? "application/octet-stream";
  const m = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers()["range"] ?? "");
  let start = 0;
  let end = st.size - 1;
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), st.size - 1);
    } else start = Math.max(0, st.size - Number(m[2]));
  }
  if (start >= st.size || start > end) return route.fulfill({ status: 416, headers: { "content-range": `bytes */${st.size}` }, body: "" });
  end = Math.min(end, start + CHUNK_BYTES - 1);
  const length = end - start + 1;
  const fh = await open(path!, "r");
  const body = Buffer.alloc(length);
  try {
    await fh.read(body, 0, length, start);
  } finally {
    await fh.close();
  }
  const partial = Boolean(m) || length < st.size;
  return route.fulfill({
    status: partial ? 206 : 200,
    headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(length), ...(partial ? { "content-range": `bytes ${start}-${end}/${st.size}` } : {}), "access-control-allow-origin": "*", "cache-control": "no-store" },
    body,
  });
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0]!.trim();

async function launchBrowser(browserPath?: string): Promise<Browser> {
  const args = ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--hide-scrollbars", "--force-device-scale-factor=1", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
  try {
    return await chromium.launch(browserPath ? { executablePath: browserPath, headless: true, args } : { channel: "chrome", headless: true, args });
  } catch (err) {
    throw new Error(`Google Chrome is not available on the render worker (${firstLine(err)}). Install Google Chrome (not Chromium — H.264 video needs it) or set EXPORT_BROWSER to its path.`);
  }
}

/**
 * Where the audio of a cue is read from: audio assets (voiceovers, music) from their original upload — small
 * files, and the voice deserves it; videos from the rendition the config plays (a 1080p original can be a
 * gigabyte, its rendition keeps the sound at 128–160 kbps AAC); local public files straight from disk; anything
 * else downloaded. Null when nothing can be read — the cue is then skipped, never a failed export.
 */
async function resolveAudioFile(deps: ExportDeps, workDir: string, cue: AudioCue, workspaceId: string, index: number): Promise<string | null> {
  if (cue.assetId && uuidRe.test(cue.assetId)) {
    const asset = await deps.db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.id, cue.assetId), eq(mediaAssets.workspaceId, workspaceId)) });
    if (asset?.type === "audio" && asset.providerAssetId) {
      try {
        return await deps.storage.readOriginal(asset.providerAssetId);
      } catch {
        /* original gone: fall back to the URL */
      }
    }
  }
  if (deps.storage instanceof LocalStorageProvider) {
    const p = deps.storage.publicPathForUrl(cue.src);
    if (p && (await stat(p).catch(() => null))?.isFile()) return p;
  }
  try {
    const res = await fetch(cue.src);
    if (!res.ok) return null;
    const dest = join(workDir, `audio-${index}${extname(new URL(cue.src).pathname).toLowerCase() || ".bin"}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  } catch {
    return null;
  }
}

/** Frames arrive as JPEG (opaque) or PNG (alpha) on stdin; the video codec follows the file type. */
function encodeArgs(fps: number, out: string, kind: "h264" | "vp9", alpha: boolean): string[] {
  const input = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", alpha ? "png" : FRAME_FORMAT.decoder, "-i", "pipe:0"];
  const video =
    kind === "h264"
      ? ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "5.1", "-movflags", "+faststart"]
      : // VP9 constant quality; an alpha channel needs yuva420p and no alt-ref frames.
        ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "31", "-deadline", "good", "-cpu-used", "2", "-row-mt", "1", "-pix_fmt", alpha ? "yuva420p" : "yuv420p", ...(alpha ? ["-auto-alt-ref", "0"] : [])];
  return [...input, ...video, "-g", String(fps * 2), "-r", String(fps), "-an", "-threads", "0", out];
}

/** A silent MP4 turned into a looping GIF with a palette made for this very video (much better than the 256 web colours). */
function gifArgs(input: string, out: string, fps: number): string[] {
  return ["-i", input, "-vf", `fps=${fps},split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", out];
}

async function setProgress(db: Db, id: string, stage: string, percent: number): Promise<void> {
  await db.update(videoExports).set({ status: "rendering", progressJson: { stage, percent: Math.round(percent) }, updatedAt: new Date() }).where(eq(videoExports.id, id));
}

export async function renderExport(deps: ExportDeps, exportId: string): Promise<ExportResult> {
  const { db, storage } = deps;
  const row = await db.query.videoExports.findFirst({ where: eq(videoExports.id, exportId) });
  if (!row) throw new Error(`Export ${exportId} not found`);
  await db.update(videoExports).set({ status: "rendering", startedAt: new Date(), finishedAt: null, error: null, progressJson: { stage: "Starting the renderer", percent: 0 }, updatedAt: new Date() }).where(eq(videoExports.id, row.id));

  const workDir = await mkdtemp(join(tmpdir(), "sceneflow-x-"));
  let browser: Browser | null = null;
  try {
    const opts = row.optionsJson;
    const format = opts.format ?? "mp4";
    const alpha = format === "webm" && Boolean(opts.transparent);
    // Original uploads the browser can decode (and not much bigger than the frame) play instead of renditions.
    const base = deps.publicUrl.replace(/\/$/, "");
    const originals: Record<string, string> = {};
    const originalFiles = new Map<string, { path: string; type: string }>();
    const ids = videoAssetIds(row.configJson).filter((id) => uuidRe.test(id));
    if (ids.length) {
      const assets = await db.query.mediaAssets.findMany({ where: and(inArray(mediaAssets.id, ids), eq(mediaAssets.workspaceId, row.workspaceId)) });
      for (const a of assets) {
        if (a.type !== "video" || a.status !== "ready" || !useOriginalSource(a.metadataJson, opts)) continue;
        try {
          const path = await storage.readOriginal(a.providerAssetId);
          const ext = extname(path).toLowerCase();
          originalFiles.set(a.id, { path, type: ext === ".webm" ? "video/webm" : "video/mp4" });
          originals[a.id] = `${base}/__sceneflow_export__/original/${a.id}`;
        } catch {
          /* original not readable: the rendition plays */
        }
      }
    }
    const config = exportConfig(row.configJson, originals);
    // `duration` is timeline (video) seconds; the file is `duration / speed` seconds long and frame k shows timeline time k/fps·speed.
    const duration = Math.min(projectDuration(config), MAX_EXPORT_SECONDS);
    if (!(duration > 0) || !config.scenes.length) throw new Error("This project has no scenes yet — open the editor and add a video or a template first.");
    const speed = exportSpeed(config);
    const wallDuration = duration / speed;
    const fps = opts.fps;
    const frames = Math.max(1, Math.round(wallDuration * fps));

    // ---- the page ----
    browser = await launchBrowser(deps.browserPath);
    const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const cdp = await context.newCDPSession(page);
    // Alpha: Chrome paints a white page background unless told otherwise.
    if (alpha) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const runtimeUrl = `${base}/__sceneflow_export__/runtime.js`;
    const runtime = await readFile(RUNTIME_FILE);
    const html = renderPageHtml(config, opts.device, opts.width, opts.height, runtimeUrl, alpha);
    if (originalFiles.size) {
      await page.route(`${base}/__sceneflow_export__/original/*`, (r) => {
        const f = originalFiles.get(r.request().url().split("/").pop() ?? "");
        return serveLocalFile(r, f?.path ?? null, f?.type);
      });
    }
    await page.route(runtimeUrl, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: runtime }));
    await page.route(`${base}/__sceneflow_export__`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
    // Local storage: media straight from disk — no dependency on the API being up, no copy through HTTP.
    if (storage instanceof LocalStorageProvider) {
      const local = storage;
      await page.route(`${local.publicBaseUrl}/**`, (r) => serveLocalFile(r, local.publicPathForUrl(r.request().url())));
    }
    await setProgress(db, row.id, "Loading the project", 2);
    await page.goto(`${base}/__sceneflow_export__`, { waitUntil: "load", timeout: 60_000 });
    try {
      await page.evaluate("window.__sfExport.ready");
    } catch (err) {
      throw new Error(`The player could not load this project: ${firstLine(err)}`);
    }

    // ---- frames → H.264 (MP4, and the GIF's intermediate) or VP9 (WebM) ----
    const videoFile = join(workDir, format === "webm" ? "video.webm" : "video.mp4");
    const enc = spawn(FFMPEG, encodeArgs(fps, videoFile, format === "webm" ? "vp9" : "h264", alpha), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let encErr = "";
    enc.stderr.on("data", (d: Buffer) => (encErr += d.toString()));
    enc.stdin.on("error", () => {}); // EPIPE is reported through the exit code below
    const encExit = new Promise<number | null>((resolve) => enc.on("close", resolve));
    const started = Date.now();
    let slowFrames = 0;
    let lastReport = 0;
    for (let i = 0; i < frames; i++) {
      if (enc.exitCode !== null) throw new Error(`Video encoding stopped: ${encErr.trim().slice(-600) || "ffmpeg exited early"}`);
      const t = Math.min(duration, (i / fps) * speed);
      if (await page.evaluate(`window.__sfExport.frame(${t})`)) slowFrames++;
      const shot = await cdp.send("Page.captureScreenshot", { ...(alpha ? { format: "png" as const } : { format: FRAME_FORMAT.format, quality: FRAME_FORMAT.quality }), clip: { x: 0, y: 0, width: opts.width, height: opts.height, scale: 1 }, captureBeyondViewport: false, fromSurface: true });
      if (!enc.stdin.write(Buffer.from(shot.data, "base64"))) await once(enc.stdin, "drain");
      const now = Date.now();
      if (now - lastReport > 1500 || i === frames - 1) {
        lastReport = now;
        await setProgress(db, row.id, `Rendering frames (${i + 1} of ${frames})`, 3 + ((i + 1) / frames) * 87);
      }
    }
    const renderMs = Date.now() - started;
    enc.stdin.end();
    const code = await encExit;
    if (code !== 0) throw new Error(`Video encoding failed (exit ${code ?? "?"}): ${encErr.trim().slice(-600) || "no output"}`);
    await cdp.detach().catch(() => {});
    await browser.close().catch(() => {});
    browser = null;

    // ---- audio (none in a GIF) ----
    await setProgress(db, row.id, format === "gif" ? "Making the GIF" : "Mixing audio", 92);
    const inputs: Array<{ cue: AudioCue; file: string }> = [];
    for (const [i, cue] of (format === "gif" ? [] : audioPlan(config, duration)).entries()) {
      const file = await resolveAudioFile(deps, workDir, cue, row.workspaceId, i);
      if (!file) continue;
      const probe = await ffprobe(file).catch(() => null);
      if (probe?.hasAudio) inputs.push({ cue, file });
    }
    let finalFile = videoFile;
    if (inputs.length) {
      const graph = audioFilterGraph(inputs.map((x) => x.cue), wallDuration, speed);
      finalFile = join(workDir, format === "webm" ? "final.webm" : "final.mp4");
      const audioCodec = format === "webm" ? ["-c:a", "libopus", "-b:a", "128k"] : ["-c:a", "aac", "-b:a", "192k"];
      await ffmpeg(["-i", videoFile, ...inputs.flatMap((x) => ["-i", x.file]), "-filter_complex", graph.filter, "-map", "0:v", "-map", graph.out, "-c:v", "copy", ...audioCodec, "-ar", "48000", "-t", wallDuration.toFixed(3), ...(format === "webm" ? [] : ["-movflags", "+faststart"]), finalFile]);
    }
    if (format === "gif") {
      finalFile = join(workDir, "final.gif");
      await ffmpeg(gifArgs(videoFile, finalFile, fps));
    }

    // ---- store ----
    await setProgress(db, row.id, "Saving the file", 97);
    const probe = await ffprobe(finalFile);
    const sizeBytes = (await stat(finalFile)).size;
    const key = `${row.workspaceId}/exports/${row.id}.${format}`;
    const fileName = row.fileName ?? exportFileName("video", opts.quality, format);
    await storage.putPublic(key, finalFile, EXPORT_MIME[format], { contentDisposition: `attachment; filename="${fileName}"` });
    await db.update(videoExports).set({ status: "ready", storageKey: key, fileName, sizeBytes, durationSec: probe.duration, progressJson: null, error: null, finishedAt: new Date(), updatedAt: new Date() }).where(eq(videoExports.id, row.id));
    try {
      await db.insert(projectActivity).values({ workspaceId: row.workspaceId, projectId: row.projectId, type: "exported", actorName: row.requestedByName, detail: `v${row.version} ${opts.quality}${format === "mp4" ? "" : ` ${format.toUpperCase()}`}` });
    } catch {
      /* the feed is informational */
    }
    return { sizeBytes, durationSec: probe.duration, frames, slowFrames, renderMs, pageErrors, format, fromOriginal: Object.keys(originals).length };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    await db.update(videoExports).set({ status: "failed", error: message, progressJson: null, finishedAt: new Date(), updatedAt: new Date() }).where(eq(videoExports.id, row.id));
    throw err;
  } finally {
    await browser?.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}
