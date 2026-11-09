// Phase 6 end-to-end against the RUNNING local stack: HD upload -> fast path -> renditions job -> publish swaps sources -> diagnostics -> onboarding pages.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const ffmpeg = createRequire(resolve(import.meta.dirname, "../../apps/worker/package.json"))("@ffmpeg-installer/ffmpeg").path;
const exec = promisify(execFile);
let cookie = "";
const step = (m) => console.log("âœ“ " + m);
const fail = (m) => { console.error("âœ— " + m); process.exit(1); };
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) fail(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }

const reg = await api("POST", "/api/v1/auth/register", { email: `perf-${Date.now()}@sceneflow.test`, password: "perf-pass-123", name: "Perf Tester" });
const workspaceId = reg.workspaceId; step("registered");

// 1280x720, 4 s clip with audio -> plan: 720p progressive + scroll version (no 1080p: never upscale).
const tmp = await mkdtemp(join(tmpdir(), "sf-perf-"));
const clip = join(tmp, "hd.mp4");
await exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=4:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
const bytes = await readFile(clip);
const { assetId, upload, complete } = await api("POST", "/api/v1/media/uploads", { workspaceId, filename: "hd.mp4", mimeType: "video/mp4", sizeBytes: bytes.length });
const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes });
if (!put.ok) fail("upload failed " + put.status);
if (complete) await api("POST", complete);
step(`uploaded ${(bytes.length / 1024).toFixed(0)} KB 720p clip`);

let asset; let sawProgress = false; const t0 = Date.now();
for (let i = 0; i < 120; i++) {
  asset = (await api("GET", `/api/v1/media/${assetId}`)).asset;
  if (asset.metadataJson.progress) sawProgress = true;
  if (asset.status === "ready" || asset.status === "failed") break;
  await new Promise(r => setTimeout(r, 500));
}
if (asset.status !== "ready") fail("fast path did not finish: " + asset.status + " " + asset.error);
step(`fast path ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (progress stages reported: ${sawProgress}); renditions ${asset.metadataJson.renditions?.status}`);
if (asset.metadataJson.renditions?.status !== "pending") fail("renditions job was not queued");

// Publish immediately (HD pending) -> sources only contain the proxy; response says hdPending.
const { project } = await api("POST", "/api/v1/projects", { workspaceId, name: "Perf" });
const m = asset.metadataJson;
const config = { video: { provider: "local", assetId, src: m.proxyUrl, poster: m.posterUrl, duration: m.duration }, playback: { mode: "scroll", pin: true, scrollDistance: "300vh" }, scenes: [{ id: "s1", name: "A", start: 0, end: m.duration, background: { type: "video", assetId, sourceStart: 0 }, layers: [{ id: "t", type: "text", frame: { x: 10, y: 10, w: 60, h: 20 }, content: { text: "Scroll" } }] }] };
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
const pub1 = await api("POST", `/api/v1/projects/${project.id}/publish`, {});
if (pub1.media.hdPending !== 1) fail("publish did not report pending HD: " + JSON.stringify(pub1.media));
const live1 = await (await fetch(`${API}/p/${project.id}.json`)).json();
if (live1.video.sources.length !== 1 || live1.video.sources[0].height !== 540) fail("early publish should carry only the proxy: " + JSON.stringify(live1.video.sources));
step(`published v1 while HD pending (sources: proxy only, api says hdPending=${pub1.media.hdPending})`);

// Wait for the renditions job.
const t1 = Date.now();
for (let i = 0; i < 240; i++) {
  asset = (await api("GET", `/api/v1/media/${assetId}`)).asset;
  const st = asset.metadataJson.renditions?.status;
  if (st === "ready" || st === "failed") break;
  await new Promise(r => setTimeout(r, 1000));
}
const rend = asset.metadataJson.renditions;
if (rend?.status !== "ready") fail("renditions did not finish: " + JSON.stringify(rend));
const kinds = rend.items.map(r => `${r.kind}@${r.height}p ${(r.sizeBytes / 1024).toFixed(0)}KB`);
if (!rend.items.some(r => r.kind === "progressive" && r.height === 720) || !rend.items.some(r => r.kind === "scrub") || rend.items.some(r => r.height > 720)) fail("unexpected renditions: " + kinds.join(", "));
step(`renditions ready in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${kinds.join(", ")}`);
for (const r of rend.items) { const h = await fetch(r.src, { method: "HEAD" }); if (!h.ok) fail("rendition not served: " + r.src); }
step("all renditions served from /files");

// Publish again -> sources swapped in, src = 720p, scene background too.
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config: { ...config, scenes: [{ ...config.scenes[0], name: "B" }] } });
const pub2 = await api("POST", `/api/v1/projects/${project.id}/publish`, {});
if (pub2.media.hdPending !== 0) fail("hd still pending after renditions");
const live2 = await (await fetch(`${API}/p/${project.id}.json`)).json();
const srcs = live2.video.sources.map(s => `${s.kind}@${s.height}`);
if (!live2.video.src.includes("video-720") || !srcs.includes("scrub@720") || !live2.scenes[0].background.sources?.length) fail("published config lacks renditions: " + JSON.stringify(live2.video));
step(`published v${pub2.publishedVersion} with src=720p and sources [${srcs.join(", ")}] (scene background too)`);

// Runtime picks the scrub rendition for scroll mode; the demo page serves the runtime + the Shopify module exists.
const runtime = await fetch(`${API}/runtime/sceneflow.runtime.min.js`);
const rtSrc = await runtime.text();
if (!runtime.ok || !rtSrc.includes("scrub") || !rtSrc.includes("saveData")) fail("runtime lacks the source picker");
const shop = await fetch(`${API}/runtime/sceneflow.shopify.min.js`);
step(`runtime ${(rtSrc.length / 1024).toFixed(1)} KB served; shopify module ${shop.ok ? "served" : "MISSING (" + shop.status + ")"}`);
if (!shop.ok) fail("shopify module not served");

// Diagnostics.
const diag = await api("GET", `/api/v1/projects/${project.id}/diagnostics`);
const summary = diag.checks.map(c => `${c.id}:${c.status}`).join(" ");
if (!summary.startsWith("draft:ok media:ok published:ok site:info")) fail("diagnostics unexpected: " + summary);
step(`diagnostics: ${summary}`);

// Onboarding pages render.
for (const u of [`${WEB}/projects`, `${WEB}/projects/${project.id}`, `${WEB}/projects/${project.id}/editor?tour=1`]) {
  const r = await fetch(u); if (!r.ok) fail(`${u} -> ${r.status}`);
}
step("projects, project and editor (tour) pages respond");
await rm(tmp, { recursive: true, force: true });
console.log(`\nAll good. Editor with tour: ${WEB}/projects/${project.id}/editor?tour=1`);
