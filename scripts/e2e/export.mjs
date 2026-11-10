// MP4 export end-to-end against the RUNNING stack (api + worker + web): upload a clip and a voice track, build a
// project with text / button / hotspot / captions / voiceover, then — through the UI in a real Chrome — render a
// 720p MP4, wait for the worker, download it, and check the file with ffprobe + frame samples.
//   node scripts/e2e/export.mjs      (add --headed to watch)
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const workerRequire = createRequire(resolve("apps/worker/package.json"));
const FFMPEG = workerRequire("@ffmpeg-installer/ffmpeg").path;
const FFPROBE = workerRequire("@ffprobe-installer/ffprobe").path;
const exec = promisify(execFile);
let cookie = "";
const step = (m) => console.log("✓ " + m);
const fail = (m) => { console.error("✗ " + m); process.exit(1); };
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { ...(body && !(body instanceof Buffer) ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) });
  const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) fail(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await sleep(1000); }

async function upload(workspaceId, filename, mimeType, bytes) {
  const { assetId, upload } = await api("POST", "/api/v1/media/uploads", { workspaceId, filename, mimeType, sizeBytes: bytes.length });
  const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes });
  if (!put.ok) fail(`upload PUT -> ${put.status}`);
  for (let i = 0; i < 90; i++) {
    const { asset } = await api("GET", `/api/v1/media/${assetId}`);
    if (asset.status === "ready") return asset;
    if (asset.status === "failed") fail(`asset ${filename} failed: ${asset.error}`);
    await sleep(1000);
  }
  fail(`asset ${filename} never became ready (worker running?)`);
}
async function probe(file) {
  const { stdout } = await exec(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const d = JSON.parse(stdout);
  const v = d.streams.find((s) => s.codec_type === "video");
  return { duration: Number(d.format.duration), width: v?.width, height: v?.height, codec: v?.codec_name, hasAudio: d.streams.some((s) => s.codec_type === "audio") };
}
async function frame(file, at) {
  const { stdout } = await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 1 << 20 });
  let luma = 0, max = 0;
  for (let i = 0; i < stdout.length; i += 3) { const y = 0.299 * stdout[i] + 0.587 * stdout[i + 1] + 0.114 * stdout[i + 2]; luma += y; max = Math.max(max, y); }
  return { px: stdout, luma: luma / (stdout.length / 3), max };
}
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };

// ---- content: a 5 s clip with a tone + a 2 s "voiceover" ----
const email = `export-${Date.now()}@sceneflow.test`;
const password = "export-pass-123";
const reg = await api("POST", "/api/v1/auth/register", { email, password, name: "Export Tester" });
const workspaceId = reg.workspaceId;
const { project } = await api("POST", "/api/v1/projects", { workspaceId, name: "Export e2e" });
const tmp = await mkdtemp(join(tmpdir(), "sceneflow-export-e2e-"));
const clipPath = join(tmp, "clip.mp4");
await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=5:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clipPath]);
const voicePath = join(tmp, "voice.wav");
await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", voicePath]);
const clip = await upload(workspaceId, "clip.mp4", "video/mp4", await readFile(clipPath));
const voice = await upload(workspaceId, "voice.wav", "audio/wav", await readFile(voicePath));
const m = clip.metadataJson;
step(`uploaded clip (${m.width}x${m.height}, ${m.duration.toFixed(1)}s) and voice track`);

const config = {
  canvas: { aspectRatio: "16:9" },
  video: { provider: "local", assetId: clip.id, src: m.proxyUrl, poster: m.posterUrl, duration: m.duration },
  playback: { mode: "click", controls: true },
  captions: { cues: [{ start: 0.5, end: 2.5, text: "Captions ride along" }] },
  scenes: [
    { id: "s1", name: "Main", start: 0, end: m.duration, background: { type: "video", assetId: clip.id, sourceStart: 0 }, layers: [
      { id: "hl", type: "text", frame: { x: 6, y: 8, w: 60, h: 16 }, content: { text: "Export e2e" }, style: { color: "#fff", fontSize: 56, fontWeight: 800 }, animation: { in: { type: "slide-up", duration: 0.6 } } },
      { id: "cta", type: "button", frame: { x: 6, y: 72, w: 26, h: 12 }, content: { label: "Shop now" }, style: { background: "#facc15", color: "#111", fontSize: 20, fontWeight: 700, borderRadius: 10 }, action: { type: "OPEN_URL", url: "https://example.com", newTab: true } },
      { id: "hs", type: "hotspot", frame: { x: 70, y: 40, w: 4, h: 7 }, content: { tooltip: "A hotspot" }, action: { type: "SEEK", time: 0 } },
      { id: "vo", type: "audio", name: "Voiceover", frame: { x: 0, y: 0, w: 10, h: 10 }, start: 0.5, assetId: voice.id, src: voice.metadataJson.audioUrl, content: { volume: 0.9, voiceover: true } },
    ] },
  ],
};
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
step("saved a draft with text, button, hotspot, captions and a voiceover layer");

// ---- UI: sign in, render 720p, download ----
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const problems = [];
page.on("pageerror", (e) => problems.push(`[${page.url()}] uncaught: ${e.message}`));
page.on("console", (c) => { if (c.type() === "error" && !/favicon|net::ERR_|Failed to load resource/.test(c.text())) problems.push(`[${page.url()}] console: ${c.text().slice(0, 200)}`); });
await page.goto(`${WEB}/login`);
await page.fill("input[type=email]", email);
await page.fill("input[type=password]", password);
await page.click("button[type=submit]");
await page.waitForURL(`${WEB}/projects`);
await page.goto(`${WEB}/projects/${project.id}`);
await page.waitForSelector("[data-testid=export-card]");
await page.selectOption("[data-testid=export-quality]", "720p");
await page.selectOption("[data-testid=export-fps]", "24");
await page.click("[data-testid=export-start]");
await page.waitForSelector("[data-testid=export-item]", { timeout: 15000 });
step("asked for a 720p / 24 fps render from the project page");

const started = Date.now();
let status = "";
while (Date.now() - started < 240_000) {
  const item = page.locator("[data-testid=export-item]").first();
  status = (await item.getAttribute("data-status")) ?? "";
  if (status === "ready") break;
  if (status === "failed") fail("export failed: " + (await item.innerText()).replace(/\s+/g, " ").slice(0, 400));
  await sleep(1500);
}
if (status !== "ready") fail(`export still "${status}" after ${Math.round((Date.now() - started) / 1000)}s`);
const itemText = (await page.locator("[data-testid=export-item]").first().innerText()).replace(/\s+/g, " ");
if (!/1280×720/.test(itemText) || !/24 fps/.test(itemText) || !/desktop layout/.test(itemText)) fail("export row text unexpected: " + itemText);
step(`worker rendered it in ${Math.round((Date.now() - started) / 1000)}s: ${itemText.slice(0, 140)}`);

const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("[data-testid=export-download]")]);
const outDir = resolve("dist/e2e");
await mkdir(outDir, { recursive: true });
const out = join(outDir, "export-e2e.mp4");
await download.saveAs(out);
if (download.suggestedFilename() !== "export-e2e-720p.mp4") fail("download file name unexpected: " + download.suggestedFilename());
step(`downloaded ${download.suggestedFilename()} → ${out}`);

// ---- the file ----
const p = await probe(out);
if (p.width !== 1280 || p.height !== 720) fail(`frame size ${p.width}x${p.height}`);
if (p.codec !== "h264") fail("codec " + p.codec);
if (Math.abs(p.duration - m.duration) > 0.3) fail(`duration ${p.duration} vs clip ${m.duration}`);
if (!p.hasAudio) fail("no audio track");
const f1 = await frame(out, 0.4);
const f2 = await frame(out, 3.6);
if (f1.luma < 20 || f2.luma < 20) fail(`frames too dark (${f1.luma.toFixed(0)}, ${f2.luma.toFixed(0)})`);
if (diff(f1.px, f2.px) < 3) fail("video does not change between 0.4 s and 3.6 s");
if (f1.max < 200) fail("no bright pixels at 0.4 s (text / caption missing?)");
step(`file checks: ${p.width}x${p.height} ${p.codec}, ${p.duration.toFixed(2)}s, audio ${p.hasAudio}, frames differ (Δ ${diff(f1.px, f2.px).toFixed(1)})`);

// ---- WebM and GIF from the same card ----
async function renderAs(format, quality) {
  await page.selectOption("[data-testid=export-format]", format);
  await page.selectOption("[data-testid=export-quality]", quality);
  const before = await page.locator("[data-testid=export-item]").count();
  await page.click("[data-testid=export-start]");
  await page.waitForFunction((n) => document.querySelectorAll("[data-testid=export-item]").length > n, before, { timeout: 15000 });
  const t0 = Date.now();
  for (;;) {
    const st = await page.locator("[data-testid=export-item]").first().getAttribute("data-status");
    if (st === "ready") break;
    if (st === "failed") fail(`${format} export failed: ` + (await page.locator("[data-testid=export-item]").first().innerText()).replace(/\s+/g, " ").slice(0, 300));
    if (Date.now() - t0 > 240_000) fail(`${format} export not ready after 4 minutes`);
    await sleep(1500);
  }
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.locator("[data-testid=export-download]").first().click()]);
  const file = join(outDir, `export-e2e.${format}`);
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename(), probe: await probe(file), seconds: Math.round((Date.now() - t0) / 1000) };
}
const webm = await renderAs("webm", "480p");
if (webm.name !== "export-e2e-480p.webm" || webm.probe.codec !== "vp9" || webm.probe.width !== 854 || !webm.probe.hasAudio) fail("WebM unexpected: " + JSON.stringify({ name: webm.name, ...webm.probe }));
step(`WebM: ${webm.name} ${webm.probe.width}x${webm.probe.height} ${webm.probe.codec} with audio, ${webm.seconds}s`);
const gif = await renderAs("gif", "480p");
if (gif.name !== "export-e2e-480p.gif" || gif.probe.codec !== "gif" || gif.probe.hasAudio) fail("GIF unexpected: " + JSON.stringify({ name: gif.name, ...gif.probe }));
if ((await page.isDisabled("[data-testid=export-fps]")) !== true) fail("frame rate should be fixed for GIFs");
step(`GIF: ${gif.name} ${gif.probe.width}x${gif.probe.height}, silent, ${gif.seconds}s`);

// ---- around it: editor menu link, dashboard feed, delete ----
await page.goto(`${WEB}/projects/${project.id}/editor`);
await page.waitForSelector(".ed-canvas", { timeout: 20000 });
if (await page.$(".tour-card")) await page.click(".tour-card >> text=Skip tour");
await page.click(".ed-menu summary");
await page.waitForSelector("[data-testid=export-link]");
step("editor ⋯ menu offers “Download as video…”");
const dash = await api("GET", `/api/v1/workspaces/${workspaceId}/dashboard`);
const ex = dash.activity.find((a) => a.type === "exported");
if (!dash.activity.some((a) => a.type === "exported" && a.detail === "v1 480p GIF")) fail("dashboard feed lacks the GIF export");
if (!ex || ex.actorName !== "Export Tester" || !/^v1 (720p|480p)/.test(ex.detail)) fail("dashboard feed lacks the export: " + JSON.stringify(dash.activity.map((a) => a.type)));
step("dashboard activity lists the export");
const { exports } = await api("GET", `/api/v1/projects/${project.id}/exports`);
for (const e of exports) await api("DELETE", `/api/v1/exports/${e.id}`);
if ((await api("GET", `/api/v1/projects/${project.id}/exports`)).exports.length !== 0) fail("export not deleted");
step(`deleted the ${exports.length} exports`);

await browser.close();
await rm(tmp, { recursive: true, force: true });
if (problems.length) fail("page errors:\n  " + problems.join("\n  "));
console.log(`\nAll good: 0 page errors. File kept at ${out}`);
