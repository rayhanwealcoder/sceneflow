// Scroll-scrub smoothness, measured in a real Chrome against the RUNNING stack with a generated dummy clip.
//   node scripts/e2e/scroll-smoothness.mjs            (headless Chrome; add --headed to watch)
// Generates a 10 s 720p30 clip, uploads it, waits for the renditions, publishes a pinned scroll-scrub
// project, then scrolls the demo page down and back up at a steady speed while recording, per animation
// frame, the page position and the frame the <video> shows. Two variants on the same page:
//   A  as published (runtime picks the scrub rendition + downloads it whole)
//   B  the same config with `sources` removed (plain 720p progressive file, 2 s keyframes) — the baseline
// Reported: frame update rate, longest stall, seek latency and how far the picture lags the scroll.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const HEADED = process.argv.includes("--headed");
const ffmpeg = createRequire(resolve(import.meta.dirname, "../../apps/worker/package.json"))("@ffmpeg-installer/ffmpeg").path;
const exec = promisify(execFile);
let cookie = "";
const step = (m) => console.log("✓ " + m);
const fail = (m) => { console.error("✗ " + m); process.exit(1); };
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) fail(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
const reg = await api("POST", "/api/v1/auth/register", { email: `scroll-${Date.now()}@sceneflow.test`, password: "scroll-pass-123", name: "Scroll Tester" });
const workspaceId = reg.workspaceId;

// Dummy content: a moving, colourful 10 s clip with a frame counter when the FFmpeg build has drawtext.
const tmp = await mkdtemp(join(tmpdir(), "sf-scroll-"));
const clip = join(tmp, "dummy.mp4");
const base = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=10:size=1280x720:rate=30"];
try {
  await exec(ffmpeg, [...base, "-vf", "drawtext=text='frame %{n}':fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6:x=40:y=40", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
} catch {
  await exec(ffmpeg, [...base, "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
}
const bytes = await readFile(clip);
const { assetId, upload, complete } = await api("POST", "/api/v1/media/uploads", { workspaceId, filename: "dummy.mp4", mimeType: "video/mp4", sizeBytes: bytes.length });
const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes });
if (!put.ok) fail("upload failed " + put.status);
if (complete) await api("POST", complete);
step(`uploaded dummy clip (${(bytes.length / 1024).toFixed(0)} KB, 10 s, 720p30)`);

let asset;
for (let i = 0; i < 240; i++) {
  asset = (await api("GET", `/api/v1/media/${assetId}`)).asset;
  if (asset.status === "failed") fail("processing failed: " + asset.error);
  const st = asset.metadataJson.renditions?.status;
  if (asset.status === "ready" && (st === "ready" || st === "failed" || st === "skipped")) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const scrub = asset.metadataJson.renditions?.items.find((r) => r.kind === "scrub");
if (!scrub) fail("no scrub rendition: " + JSON.stringify(asset.metadataJson.renditions));
step(`renditions ready: ${asset.metadataJson.renditions.items.map((r) => `${r.kind}@${r.height}p ${(r.sizeBytes / 1024).toFixed(0)}KB`).join(", ")}`);

const { project } = await api("POST", "/api/v1/projects", { workspaceId, name: "Scroll smoothness" });
const m = asset.metadataJson;
const config = {
  video: { provider: "local", assetId, src: m.proxyUrl, poster: m.posterUrl, duration: m.duration },
  // smoothness 0 so the measurement sees the seek pipeline itself, not the easing.
  playback: { mode: "scroll", pin: true, scrollDistance: "400vh", smoothness: 0, showProgress: true },
  scenes: [{ id: "s1", name: "Scroll", start: 0, end: m.duration, background: { type: "video", assetId, sourceStart: 0 }, layers: [{ id: "t", type: "text", frame: { x: 6, y: 8, w: 60, h: 14 }, content: { text: "Scroll to scrub" }, style: { color: "#fff", fontSize: 40, fontWeight: 800 } }] }],
};
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
await api("POST", `/api/v1/projects/${project.id}/publish`, {});
const live = await (await fetch(`${API}/p/${project.id}.json`)).json();
if (!live.video.sources?.some((s) => s.kind === "scrub")) fail("published config has no scrub source");
step(`published scroll project (src ${live.video.src.split("/").pop()}, ${live.video.sources.length} sources)`);

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required"] });
const INSTRUMENT = `
  (() => {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    window.__m = { sets: 0, seeks: [], ticks: [], pending: null };
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__m.sets++; window.__m.pending = performance.now(); return d.set.call(this, v); } });
    document.addEventListener('seeked', () => { const p = window.__m.pending; if (p) { window.__m.seeks.push(performance.now() - p); window.__m.pending = null; } }, true);
    const tick = () => { const v = document.querySelector('video'); window.__m.ticks.push([performance.now(), scrollY, v ? v.currentTime : -1]); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })();
`;

async function measure(label, patchConfig, { streamingOnly = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mediaFiles = new Set();
  page.on("request", (req) => { if (req.url().includes("/files/") && /\.mp4(\?|$)/.test(req.url())) mediaFiles.add(req.url().split("/").pop()); });
  if (patchConfig) await page.route(`**/p/${project.id}.json`, async (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(patchConfig(structuredClone(live))) }));
  // "Streaming only": block the runtime's whole-file fetch so the <video> keeps using range requests.
  if (streamingOnly) await page.route("**/files/**", (route) => (route.request().resourceType() === "fetch" ? route.abort() : route.continue()));
  await page.addInitScript(INSTRUMENT);
  await page.goto(`${API}/demo/${project.id}`);
  await page.waitForSelector("video", { timeout: 20000 });
  await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.readyState >= 2; }, null, { timeout: 30000 });
  await page.waitForTimeout(2500); // let the blob upgrade finish when it applies
  const info = await page.evaluate(() => { const v = document.querySelector("video"); return { src: v.currentSrc.split("/").pop().slice(0, 40), blob: v.currentSrc.startsWith("blob:"), buffered: v.buffered.length ? +(v.buffered.end(v.buffered.length - 1) - v.buffered.start(0)).toFixed(1) : 0, duration: +v.duration.toFixed(1) }; });
  await page.evaluate(() => { window.__m.ticks = []; window.__m.seeks = []; window.__m.sets = 0; });
  const geo = await page.evaluate(() => { const r = document.querySelector(".sf-scroll").getBoundingClientRect(); return { top: r.top + scrollY, usable: r.height - innerHeight }; });
  const dist = geo.top + geo.usable;
  // Steady scroll: 12 px per frame down, then back up (reverse scrubbing) — about 2200 px each way.
  await page.evaluate(async (total) => {
    const run = (from, to) => new Promise((res) => { let y = from; const dir = to > from ? 1 : -1; const s = () => { y += 12 * dir; if ((dir > 0 && y >= to) || (dir < 0 && y <= to)) { scrollTo(0, to); return res(); } scrollTo(0, y); requestAnimationFrame(s); }; s(); });
    await run(0, total);
    await new Promise((r) => setTimeout(r, 300));
    await run(total, 0);
    await new Promise((r) => setTimeout(r, 300));
  }, dist);
  const mm = await page.evaluate(() => window.__m);
  await page.close();

  const dur = live.video.duration;
  let updates = 0, maxStall = 0, stallStart = null;
  const lags = [];
  for (let i = 1; i < mm.ticks.length; i++) {
    const [ts, y, ct] = mm.ticks[i];
    const [pts, py, pct] = mm.ticks[i - 1];
    const moving = y !== py;
    if (ct !== pct) { updates++; stallStart = null; } else if (moving) { if (stallStart === null) stallStart = pts; maxStall = Math.max(maxStall, ts - stallStart); }
    if (moving && y >= geo.top) lags.push(Math.abs(ct - Math.min(1, Math.max(0, (y - geo.top) / geo.usable)) * dur));
  }
  const moving = mm.ticks.filter((t, i) => i > 0 && t[1] !== mm.ticks[i - 1][1]).length;
  const file = [...mediaFiles].sort().join("+") || "?";
  const r = { label, src: file, blob: info.blob, bufferedSec: info.buffered, frames: moving, updateRate: +(updates / Math.max(1, moving)).toFixed(2), maxStallMs: Math.round(maxStall), seekP50: Math.round(pct(mm.seeks, 0.5)), seekP95: Math.round(pct(mm.seeks, 0.95)), seekMax: Math.round(Math.max(0, ...mm.seeks)), lagP95s: +pct(lags, 0.95).toFixed(2), sets: mm.sets };
  return r;
}

const stripSources = (c) => { delete c.video.sources; delete c.scenes[0].background.sources; return c; };
const A = await measure("A scrub file, downloaded whole (as published)");
const B = await measure("B scrub file, streamed (range requests)", null, { streamingOnly: true });
const C = await measure("C 720p progressive 2 s GOP, streamed (old)", stripSources, { streamingOnly: true });
await browser.close();
await rm(tmp, { recursive: true, force: true });

console.log("\n  variant                                        file             blob   frames  update-rate  max-stall  seek p50/p95/max   lag p95");
for (const r of [A, B, C]) console.log(`  ${r.label.padEnd(46)} ${r.src.padEnd(16)} ${String(r.blob).padEnd(6)} ${String(r.frames).padEnd(7)} ${String(r.updateRate).padEnd(12)} ${(r.maxStallMs + " ms").padEnd(10)} ${`${r.seekP50}/${r.seekP95}/${r.seekMax} ms`.padEnd(18)} ${r.lagP95s} s`);
console.log("  (update-rate = share of animation frames during scrolling on which the video showed a new frame; lag = picture vs. scroll position with smoothing off)\n");

if (!A.src.includes("scrub")) fail(`variant A did not use the scrub rendition (${A.src})`);
if (!A.blob) console.warn("! scrub file was not downloaded whole (CORS / size?) — seeks still go through range requests");
if (A.updateRate < 0.5) fail(`variant A update rate too low: ${A.updateRate}`);
if (A.maxStallMs > 400) fail(`variant A stalled for ${A.maxStallMs} ms`);
if (A.seekP95 > 150) fail(`variant A seek p95 ${A.seekP95} ms`);
step(`scroll scrub is smooth: ${Math.round(A.updateRate * 100)}% of frames updated, worst stall ${A.maxStallMs} ms, seek p95 ${A.seekP95} ms (old pipeline: ${Math.round(C.updateRate * 100)}%, ${C.maxStallMs} ms, ${C.seekP95} ms)`);
console.log(`\nAll good. Demo: ${API}/demo/${project.id}`);
