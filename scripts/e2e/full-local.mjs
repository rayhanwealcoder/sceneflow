// FULL local walkthrough against the RUNNING stack (api 4800, web 3000, worker; WordPress on development.local when
// it is up): one fresh account goes through everything SceneFlow does, in a real Chrome, with generated dummy media.
// Nothing is deleted afterwards — log in with the printed credentials and look around.
//
//   node scripts/e2e/full-local.mjs                 headless, exits when done
//   node scripts/e2e/full-local.mjs --headed        watch it
//   node scripts/e2e/full-local.mjs --headed --keep-open   …and leave the browser open on the result pages
//   node scripts/e2e/full-local.mjs --skip-wp       never touch WordPress
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const WP = "http://development.local";
const WP_PATH = "C:/Users/UseR/Local Sites/development/app/public";
const PHP = "D:/programs/local/resources/extraResources/lightning-services/php-8.2.27+1/bin/win64/php.exe";
const WP_CLI = "D:/programs/local/resources/extraResources/bin/wp-cli/wp-cli.phar";
const HEADED = process.argv.includes("--headed");
const KEEP_OPEN = process.argv.includes("--keep-open");
const SKIP_WP = process.argv.includes("--skip-wp");
const ROOT = resolve(import.meta.dirname, "../..");
const workerRequire = createRequire(resolve(ROOT, "apps/worker/package.json"));
const FFMPEG = workerRequire("@ffmpeg-installer/ffmpeg").path;
const FFPROBE = workerRequire("@ffprobe-installer/ffprobe").path;
const ed = await import(pathToFileURL(`${ROOT}/packages/editor/dist/index.js`).href);
const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const step = (m) => console.log(`✓ ${++n}. ${m}`);
const note = (m) => console.log(`  · ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
process.on("uncaughtException", (e) => { console.error("✗ " + String(e.stack ?? e).split("\n").slice(0, 3).join(" | ")); if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  ")); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("✗ " + String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); process.exit(1); });

/* ---------- helpers ---------- */
const problems = [];
function watch(page, who) {
  page.on("pageerror", (e) => problems.push(`[${who} ${page.url()}] uncaught: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_|Failed to load resource|ERR_BLOCKED_BY_CLIENT/.test(m.text())) problems.push(`[${who} ${page.url()}] console: ${m.text().slice(0, 200)}`); });
}
/** Authenticated API call from inside a signed-in page (cookies travel with it). */
async function pageApi(page, method, path, body, { allowError = false } = {}) {
  const r = await page.evaluate(async ({ API, method, path, body }) => {
    const res = await fetch(API + path, { method, credentials: "include", headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  }, { API, method, path, body });
  if (r.status >= 400 && !allowError) fail(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
async function pub(path) { const r = await fetch(path); if (!r.ok) fail(`GET ${path} -> ${r.status}`); return r; }
async function probe(file) {
  const { stdout } = await exec(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const d = JSON.parse(stdout); const v = d.streams.find((s) => s.codec_type === "video");
  return { duration: Number(d.format.duration), width: v?.width, height: v?.height, codec: v?.codec_name, hasAudio: d.streams.some((s) => s.codec_type === "audio") };
}
async function frameLuma(file, at) {
  const { stdout } = await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 1 << 20 });
  let sum = 0; for (let i = 0; i < stdout.length; i += 3) sum += 0.299 * stdout[i] + 0.587 * stdout[i + 1] + 0.114 * stdout[i + 2];
  return { px: stdout, luma: sum / (stdout.length / 3) };
}
const pxDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
async function wp(...args) {
  const { stdout } = await exec(PHP, ["-d", "extension_dir=D:/programs/local/resources/extraResources/lightning-services/php-8.2.27+1/bin/win64/ext", "-d", "extension=mysqli", "-d", "extension=openssl", "-d", "extension=mbstring", "-d", "extension=curl", "-d", "extension=gd", "-d", "mysqli.default_port=10005", WP_CLI, `--path=${WP_PATH}`, ...args], { timeout: 180_000, maxBuffer: 8 << 20, windowsHide: true });
  return stdout.trim();
}
async function uploadBytes(page, workspaceId, filename, mimeType, bytes) {
  const ticket = await pageApi(page, "POST", "/api/v1/media/uploads", { workspaceId, filename, mimeType, sizeBytes: bytes.length });
  const put = await fetch(ticket.upload.url, { method: ticket.upload.method, headers: ticket.upload.headers, body: bytes });
  if (!put.ok) fail(`upload PUT ${filename} -> ${put.status}`);
  if (ticket.complete) await pageApi(page, "POST", ticket.complete);
  return ticket.assetId;
}
async function waitAsset(page, assetId, what, { renditions = false } = {}) {
  for (let i = 0; i < 180; i++) {
    const { asset } = await pageApi(page, "GET", `/api/v1/media/${assetId}`);
    if (asset.status === "failed") fail(`${what} failed to process: ${asset.error}`);
    if (asset.status === "ready" && (!renditions || ["ready", "failed", "skipped"].includes(asset.metadataJson.renditions?.status))) return asset;
    await sleep(1000);
  }
  fail(`${what} never became ready (is the worker running?)`);
}

/* ---------- 0. stack ---------- */
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await sleep(1000); }
const health = await (await pub(`${API}/health`)).json();
const runtime = await (await pub(`${API}/runtime/sceneflow.runtime.min.js`)).text();
const rtVersion = runtime.match(/"(\d+\.\d+\.\d+)"/)?.[1];
if (!runtime.includes("data-sceneflow-id")) fail("runtime bundle lacks the embed loader");
let wpUp = false, wpHealth = null;
if (!SKIP_WP) {
  try { const r = await fetch(`${WP}/wp-json/sceneflow/v1/health`, { signal: AbortSignal.timeout(45_000) }); if (r.ok) { wpHealth = await r.json(); wpUp = true; } } catch { /* down */ }
}
step(`stack: api ${JSON.stringify(health)}, runtime ${(runtime.length / 1024).toFixed(1)} KB v${rtVersion}, web ${(await fetch(WEB + "/login")).status}, WordPress ${wpUp ? `${WP} plugin ${wpHealth.version} / WP ${wpHealth.wp} / PHP ${wpHealth.php} (${wpHealth.capabilities.join(",")})` : "not reachable — WordPress steps skipped"}`);

/* ---------- 1. dummy media ---------- */
const stamp = Date.now();
const tmp = await mkdtemp(join(tmpdir(), "sf-full-"));
const clipPath = join(tmp, "glow-cream-demo.mp4");
await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=12:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-af", "volume=0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clipPath]);
const imgPath = join(tmp, "glow-cream-jar.png");
await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xEAC9A8:s=800x800:d=0.1", "-frames:v", "1", imgPath]);
const musicPath = join(tmp, "soft-music.wav");
await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-af", "volume=0.4", musicPath]);
const gifPath = join(tmp, "sparkle.gif");
await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=200x200:rate=10", gifPath]);
step(`dummy media generated: 12 s 720p clip with tone, 800×800 product image, 6 s music, 2 s GIF`);

/* ---------- 2. sign up through the UI ---------- */
// Base-video projects use the browser's own video controls (no overlay play button), so playback is started on the
// <video> itself; the autoplay flag lets that work without a prior click in a fresh profile.
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required"] });
const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const owner = await ownerCtx.newPage();
watch(owner, "owner");
owner.on("dialog", (d) => void d.accept());
const email = `fulltest-${stamp}@sceneflow.test`;
const password = "fulltest-pass-123";
await owner.goto(`${WEB}/login`);
await owner.click("text=Create account");
await owner.fill("input[autocomplete=name]", "Rina Tester");
await owner.fill("input[type=email]", email);
await owner.fill("input[type=password]", password);
await owner.click("button[type=submit]");
await owner.waitForURL(`${WEB}/projects`);
await owner.waitForSelector(".goal-card");
const me = await pageApi(owner, "GET", "/api/v1/auth/me");
const { workspaces } = await pageApi(owner, "GET", "/api/v1/workspaces");
const workspaceId = workspaces[0].id;
step(`signed up as "${me.user?.name ?? "Rina Tester"}" <${email}> — welcome page with the goal picker, workspace ${workspaceId}`);

/* ---------- 3. goal picker → editor + tour → add elements ---------- */
await owner.click(".goal-card >> nth=0");
await owner.waitForURL(/\/projects\/[0-9a-f-]+\/editor\?tour=1$/, { timeout: 30000 });
const projectId = owner.url().match(/projects\/([0-9a-f-]+)\//)[1];
await owner.waitForSelector(".ed-canvas", { timeout: 30000 });
await owner.waitForSelector(".tour-card", { timeout: 8000 });
let tourSteps = 0;
while (await owner.$(".tour-card") && tourSteps++ < 12) {
  const btn = owner.locator(".tour-card button.primary");
  const label = (await btn.textContent())?.trim();
  await btn.click();
  await owner.waitForTimeout(HEADED ? 450 : 120);
  if (label === "Done") break;
}
if (await owner.$(".tour-card")) fail("tour did not finish");
await pageApi(owner, "PATCH", `/api/v1/projects/${projectId}`, { name: "Glow Face Cream launch" });
for (const t of ["Text", "Button", "Hotspot", "Product"]) { await owner.click(`.ed-el[title='Add ${t}']`); await owner.waitForTimeout(HEADED ? 300 : 80); }
await owner.waitForSelector(".ed-side.right input");
await owner.keyboard.press("Escape");
await owner.click("text=Advanced");
await owner.waitForSelector(".ed-center .tl", { timeout: 5000 });
await owner.click(".ed-devices button >> nth=2");
await owner.click(".ed-devices button >> nth=0");
await owner.click("text=Simple");
await owner.waitForFunction(() => document.querySelector(".ed-save")?.textContent?.startsWith("Saved"), null, { timeout: 15000 });
step(`project "Glow Face Cream launch" from the first goal card; tour finished (${tourSteps} steps); added text, button, hotspot, product in the editor; Advanced timeline, device switch, autosave`);

/* ---------- 4. upload the dummy video through the project page, quick start ---------- */
await owner.click(".ed-top a[title='Back to project']");
await owner.waitForURL(`${WEB}/projects/${projectId}`);
await owner.waitForSelector("input[type=file]", { state: "attached" });
await owner.setInputFiles("input[type=file]", clipPath);
await owner.waitForSelector(".asset", { timeout: 30000 });
await owner.fill("input[placeholder^='https://yourshop']", "https://example.com/glow-cream");
const useBtn = owner.locator(".asset button", { hasText: "Use this video" }).first();
await useBtn.waitFor({ timeout: 120_000 });
await owner.waitForFunction(() => { const b = [...document.querySelectorAll(".asset button")].find((x) => x.textContent?.includes("Use this video")); return b && !b.disabled; }, null, { timeout: 120_000 });
await useBtn.click();
await owner.waitForSelector("text=/Saved draft v\\d+/", { timeout: 15000 });
const { assets } = await pageApi(owner, "GET", `/api/v1/media?workspaceId=${workspaceId}`);
const clip = assets.find((a) => a.originalName === "glow-cream-demo.mp4");
const cm = clip.metadataJson;
step(`uploaded the clip through the Upload box (${(clip.sizeBytes / 1024).toFixed(0)} KB) → worker: ${cm.width}×${cm.height}, ${cm.duration.toFixed(1)} s, poster, proxy, ${cm.thumbnails?.length} thumbnails, waveform ${cm.waveformUrl ? "yes" : "no"}; quick start "Use this video" saved a draft`);

/* ---------- 5. more media through the API: image, music, GIF ---------- */
const imgId = await uploadBytes(owner, workspaceId, "glow-cream-jar.png", "image/png", await readFile(imgPath));
const musicId = await uploadBytes(owner, workspaceId, "soft-music.wav", "audio/wav", await readFile(musicPath));
const gifId = await uploadBytes(owner, workspaceId, "sparkle.gif", "image/gif", await readFile(gifPath));
const img = await waitAsset(owner, imgId, "image");
const music = await waitAsset(owner, musicId, "music");
const gif = await waitAsset(owner, gifId, "gif");
if (!img.metadataJson.editorUrl || !music.metadataJson.audioUrl || gif.type !== "video" || !gif.metadataJson.proxyUrl) fail("derived files missing: " + JSON.stringify({ img: img.metadataJson, music: music.metadataJson, gif: gif.type }));
step(`image → editor.webp, music → audio.m4a + waveform (${music.metadataJson.duration.toFixed(1)} s), GIF normalised to video (${gif.metadataJson.duration.toFixed(1)} s proxy)`);

/* ---------- 6. AI: status, script, copy, voiceover with the built-in voice ---------- */
const ai = await pageApi(owner, "GET", "/api/v1/ai/status");
const script = await pageApi(owner, "POST", "/api/v1/ai/script", { projectId, brief: "Glow Face Cream: a light moisturiser for 24-hour hydration without grease. Warm, premium, for busy people. End with 25% off the launch set.", durationSeconds: 20, tone: "premium" });
const scriptScenes = script.script?.scenes ?? script.scenes ?? [];
const copy = await pageApi(owner, "POST", "/api/v1/ai/copy", { projectId, kind: "headline", text: "Glow Face Cream", count: 4, context: { brief: "light moisturiser, 24-hour hydration" } });
const variants = copy.variants ?? copy.suggestions ?? [];
let voiceAsset = null;
if (ai.speech?.voices?.length) {
  const vo = await pageApi(owner, "POST", "/api/v1/ai/voiceover", { projectId, sceneId: "s2", text: "Glow Face Cream. Twenty four hour hydration, zero grease. Your skin, finally comfortable.", voiceId: ai.speech.voices[0].id });
  voiceAsset = await waitAsset(owner, vo.asset.id, "voiceover");
}
step(`AI: text provider "${ai.text.label}" (${ai.text.real ? "real" : "starter"}), script → ${scriptScenes.length} scenes, ${variants.length} headline suggestions (e.g. “${variants[0]?.text ?? variants[0] ?? "-"}”), voiceover ${voiceAsset ? `via ${ai.speech.label} → ${voiceAsset.metadataJson.duration?.toFixed(1)} s m4a` : "skipped (no voice on this server)"}`);

/* ---------- 7. brand kit, manual product, the real project config ---------- */
const { kit } = await pageApi(owner, "POST", "/api/v1/brand-kits", { workspaceId, name: "Glow", config: { colors: { primary: "#c2410c", secondary: "#fff7ed" }, fonts: { heading: '"Poppins", system-ui, sans-serif', body: "system-ui, sans-serif", loadGoogleFonts: false }, button: { borderRadius: 999, textTransform: "uppercase" } } });
const { product: manualProduct } = await pageApi(owner, "POST", "/api/v1/products", { workspaceId, name: "Glow Face Cream 50 ml", priceAmount: 29, regularPriceAmount: 39, currency: "USD", productUrl: "https://example.com/glow-cream", imageUrl: img.metadataJson.editorUrl });
const manualRef = { provider: "manual", productId: manualProduct.id, title: manualProduct.name, price: manualProduct.price, regularPrice: manualProduct.regularPrice ?? undefined, priceAmount: 29, url: manualProduct.productUrl, image: manualProduct.imageUrl ?? undefined, inStock: true };
const D = cm.duration;
const baseConfig = {
  canvas: { aspectRatio: "16:9" },
  video: { provider: "local", assetId: clip.id, src: cm.proxyUrl, poster: cm.posterUrl, duration: D },
  playback: { mode: "click", controls: true, muted: false },
  captions: { language: "en", cues: [{ start: 0.6, end: 3.2, text: "Glow Face Cream" }, { start: 4.4, end: 7.2, text: "24-hour hydration, zero grease" }, { start: 8.4, end: 11.4, text: "25% off the launch set" }], style: { position: "bottom", size: "m" } },
  scenes: [
    { id: "s1", name: "Hero", start: 0, end: 4, background: { type: "video", assetId: clip.id, sourceStart: 0 }, layers: [
      { id: "hl", type: "text", name: "Headline", frame: { x: 6, y: 10, w: 62, h: 16 }, content: { text: "Glow Face Cream" }, style: { color: "#fff", fontSize: 60, fontWeight: 800 }, animation: { in: { type: "slide-up", duration: 0.6 } } },
      { id: "sub", type: "text", name: "Subline", frame: { x: 6, y: 28, w: 60, h: 10 }, content: { text: "24-hour hydration. Zero grease." }, style: { color: "#fff", fontSize: 26 }, animation: { in: { type: "fade", duration: 0.5, delay: 0.3 } } },
      { id: "badge", type: "badge", name: "New", frame: { x: 80, y: 8, w: 14, h: 8 }, content: { text: "NEW" }, style: { background: "#c2410c", color: "#fff", borderRadius: 999, fontWeight: 800, fontSize: 18 } },
    ] },
    { id: "s2", name: "Benefits", start: 4, end: 8, background: { type: "video", assetId: clip.id, sourceStart: 4 }, layers: [
      { id: "jar", type: "image", name: "Jar", frame: { x: 64, y: 14, w: 30, h: 54 }, assetId: img.id, src: img.metadataJson.editorUrl, content: { alt: "Glow Face Cream jar" }, style: { borderRadius: 16, fit: "cover" }, animation: { in: { type: "zoom", duration: 0.6 } } },
      { id: "b1", type: "text", name: "Benefit 1", frame: { x: 6, y: 18, w: 50, h: 10 }, content: { text: "• Hyaluronic + ceramides" }, style: { color: "#fff", fontSize: 28, fontWeight: 600 }, start: 0.2, animation: { in: { type: "slide-left", duration: 0.4 } } },
      { id: "b2", type: "text", name: "Benefit 2", frame: { x: 6, y: 32, w: 50, h: 10 }, content: { text: "• Absorbs in 10 seconds" }, style: { color: "#fff", fontSize: 28, fontWeight: 600 }, start: 0.8, animation: { in: { type: "slide-left", duration: 0.4 } } },
      { id: "b3", type: "text", name: "Benefit 3", frame: { x: 6, y: 46, w: 50, h: 10 }, content: { text: "• Fragrance free" }, style: { color: "#fff", fontSize: 28, fontWeight: 600 }, start: 1.4, animation: { in: { type: "slide-left", duration: 0.4 } } },
      { id: "hs", type: "hotspot", name: "See the offer", frame: { x: 77, y: 72, w: 4, h: 7 }, content: { tooltip: "See the launch offer" }, action: { type: "GO_TO_SCENE", sceneId: "s3" } },
      { id: "music", type: "audio", name: "Soft music", frame: { x: 0, y: 0, w: 10, h: 10 }, assetId: music.id, src: music.metadataJson.audioUrl, content: { volume: 0.35 } },
      ...(voiceAsset ? [{ id: "vo2", type: "audio", name: "Voiceover", frame: { x: 0, y: 0, w: 10, h: 10 }, assetId: voiceAsset.id, src: voiceAsset.metadataJson.audioUrl, content: { volume: 1, voiceover: true } }] : []),
    ] },
    { id: "s3", name: "Offer", start: 8, end: D, background: { type: "video", assetId: clip.id, sourceStart: 8 }, layers: [
      { id: "card", type: "product", name: "Product card", frame: { x: 62, y: 8, w: 32, h: 84 }, product: manualRef, content: { quantity: true, buttonAction: "add_to_cart", buttonLabel: "Add to cart" }, style: { background: "#fff", color: "#111", accent: "#c2410c", borderRadius: 14, fontSize: 16 } },
      { id: "offer", type: "badge", name: "Offer", frame: { x: 6, y: 10, w: 20, h: 9 }, content: { text: "-25% launch" }, style: { background: "#fff7ed", color: "#c2410c", borderRadius: 8, fontWeight: 800, fontSize: 20 } },
      { id: "cta", type: "button", name: "Shop now", frame: { x: 6, y: 72, w: 26, h: 12 }, content: { label: "Shop now" }, style: { background: "#c2410c", color: "#fff", borderRadius: 999, fontWeight: 700, fontSize: 20 }, action: { type: "OPEN_URL", url: "https://example.com/glow-cream", newTab: true } },
      { id: "coupon", type: "button", name: "Coupon", frame: { x: 34, y: 72, w: 24, h: 12 }, content: { label: "Code GLOW10" }, style: { background: "#fff", color: "#c2410c", borderRadius: 999, fontWeight: 700, fontSize: 18 }, action: { type: "APPLY_COUPON", code: "GLOW10" } },
    ] },
  ],
};
const savedRich = await pageApi(owner, "PUT", `/api/v1/projects/${projectId}/draft`, { config: baseConfig });
const { preset } = await pageApi(owner, "POST", "/api/v1/presets", { workspaceId, name: "Glow headline", description: "Launch headline", config: ed.presetFromLayers([baseConfig.scenes[0].layers[0], baseConfig.scenes[0].layers[1]]), inputs: ed.detectInputs(ed.presetFromLayers([baseConfig.scenes[0].layers[0], baseConfig.scenes[0].layers[1]])) });
const lib = await pageApi(owner, "GET", `/api/v1/presets?workspaceId=${workspaceId}&type=element`);
if (!lib.presets.some((p) => p.id === preset.id)) fail("saved preset not listed");
step(`brand kit "Glow" (default), manual product "${manualProduct.name}" ${manualProduct.price}, draft v${savedRich.version}: 3 scenes on the uploaded video — headline/subline/badge with motion, image + 3 timed benefits + hotspot + music${voiceAsset ? " + voiceover" : ""}, product card + offer + Shop now + coupon; captions; element preset "Glow headline" saved to the library`);

/* ---------- 8. editor on the real config: apply the brand kit from the ⋯ menu, preview page ---------- */
await owner.goto(`${WEB}/projects/${projectId}/editor`);
await owner.waitForSelector(".ed-canvas", { timeout: 30000 });
if (await owner.$(".tour-card")) await owner.click(".tour-card >> text=Skip tour");
await owner.waitForFunction(() => document.querySelectorAll(".ed-scene").length === 3, null, { timeout: 10000 });
await owner.click(".ed-menu summary");
await owner.waitForSelector("button:has-text('Apply brand kit “Glow”')", { timeout: 10000 });
await owner.click("button:has-text('Apply brand kit “Glow”')");
await owner.waitForFunction(() => document.querySelector(".ed-save")?.textContent?.startsWith("Saved"), null, { timeout: 15000 });
await owner.waitForTimeout(1500);
const afterBrand = await pageApi(owner, "GET", `/api/v1/projects/${projectId}`);
if (afterBrand.draft.config.brand?.kitId !== kit.id) fail("brand kit not recorded on the draft: " + JSON.stringify(afterBrand.draft.config.brand));
await owner.goto(`${WEB}/projects/${projectId}/preview`);
await owner.waitForSelector("[data-sceneflow=ready], .sf-player", { timeout: 20000 });
step(`editor shows the 3 scenes; ⋯ → Apply brand kit “Glow” → draft carries brand ref (kit v${afterBrand.draft.config.brand.version}); preview page renders the player`);

/* ---------- 9. renditions ready, then publish from the project page ---------- */
const clipReady = await waitAsset(owner, clip.id, "clip renditions", { renditions: true });
const rend = clipReady.metadataJson.renditions;
await owner.goto(`${WEB}/projects/${projectId}`);
await owner.waitForSelector("[data-testid=publish]:not(:disabled)", { timeout: 15000 });
await owner.click("[data-testid=publish]");
await owner.waitForSelector("text=/Published v\\d+/", { timeout: 20000 });
const live1 = await (await pub(`${API}/p/${projectId}.json`)).json();
const srcs = live1.video.sources.map((s) => `${s.kind}@${s.height}`);
if (!live1.video.src.includes("video-720") || !srcs.includes("scrub@720") || !live1.analytics?.endpoint || live1.scenes.some((s) => s.script)) fail("published config unexpected: " + JSON.stringify({ src: live1.video.src, srcs, analytics: live1.analytics }));
step(`renditions ${rend.status}: ${rend.items.map((r) => `${r.kind}@${r.height}p`).join(", ")}; published v${live1.version} from the project page → /p/${projectId.slice(0, 8)}….json uses the 720p file, sources [${srcs.join(", ")}], analytics endpoint set, no editor notes`);

/* ---------- 10. the published player on the demo page: play, captions, scenes, button, coupon, add to cart, hotspot, finish ---------- */
const demo = await ownerCtx.newPage();
watch(demo, "demo");
const posted = [];
demo.on("request", (r) => { if (r.url().endsWith("/api/v1/analytics/events") && r.method() === "POST") { try { posted.push(JSON.parse(r.postData())); } catch {} } });
await demo.goto(`${API}/demo/${projectId}`);
await demo.waitForSelector("[data-sceneflow=ready] .sf-media video", { timeout: 20000 });
await demo.evaluate(() => window.SceneFlow.commerce.register({ id: "manual", addToCart: async (line) => ({ ok: true, message: `Added ${line.quantity} × ${line.product.title} (test adapter)` }), applyCoupon: async (code) => ({ ok: true, message: `Coupon ${code} applied (test adapter)` }) }, { default: true }));
await demo.click(".sf-media video", { position: { x: 8, y: 8 } }); // user activation, like a visitor pressing the native play control
await demo.evaluate(() => document.querySelector(".sf-media video").play());
await demo.waitForFunction(() => document.querySelector(".sf-player")?.dataset.sfState === "playing", null, { timeout: 10000 });
await demo.waitForFunction(() => (document.querySelector(".sf-captions")?.textContent ?? "").length > 0, null, { timeout: 8000 });
const cue1 = await demo.textContent(".sf-captions");
await demo.waitForFunction(() => player.getCurrentScene() === "s2", null, { timeout: 10000 });
await demo.waitForTimeout(1800);
const benefitsVisible = await demo.evaluate(() => ["b1", "b2", "b3"].map((id) => getComputedStyle(document.querySelector(`[data-sf-layer=${id}]`)).visibility !== "hidden"));
await demo.click("[data-sf-layer=hs]"); // GO_TO_SCENE s3
await demo.waitForFunction(() => player.getCurrentScene() === "s3", null, { timeout: 5000 });
const [popup] = await Promise.all([demo.waitForEvent("popup", { timeout: 10000 }), demo.click("[data-sf-layer=cta]")]);
await popup.waitForLoadState("domcontentloaded").catch(() => {});
const popupUrl = popup.url();
await popup.close();
await demo.click("[data-sf-layer=coupon]");
await demo.waitForSelector(".sf-toast:has-text('Coupon GLOW10 applied')", { timeout: 5000 });
await demo.click(".sf-product-btn");
await demo.waitForSelector(".sf-toast:has-text('Added 1 ×')", { timeout: 5000 });
await demo.waitForFunction(() => document.querySelector(".sf-player")?.dataset.sfState === "ended", null, { timeout: 15000 });
await demo.waitForTimeout(4600);
const types = [...new Set(posted.flatMap((b) => b.events.map((e) => e.type)))];
for (const t of ["player_loaded", "video_play", "scene_enter", "hotspot_click", "element_click", "add_to_cart", "coupon_applied", "video_complete"]) if (!types.includes(t)) fail("analytics missing " + t + " in " + types.join(","));
step(`demo page: click to play → caption “${cue1}” → scene 2 benefits appear in time [${benefitsVisible.join(",")}] → hotspot jumps to the offer → “Shop now” opened ${popupUrl} in a new tab → coupon + add-to-cart toasts → finished; ${types.length} analytics event types sent`);

/* ---------- 11. scroll-scrub mode on the same video ---------- */
await pageApi(owner, "PUT", `/api/v1/projects/${projectId}/draft`, { config: { ...baseConfig, playback: { mode: "scroll", pin: true, scrollDistance: "300vh", smoothness: 0.2 } } });
const pubScroll = await pageApi(owner, "POST", `/api/v1/projects/${projectId}/publish`, {});
// A new visitor (fresh browser context): the published config is cached for 60 s per browser by design, and the
// demo link carries the version so the publisher's own browser never shows the previous one.
const visitorCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const visitor = await visitorCtx.newPage();
watch(visitor, "visitor");
await visitor.goto(`${API}/demo/${projectId}?v=${pubScroll.publishedVersion}`);
await visitor.waitForSelector(".sf-player[data-sf-mode=scroll]", { timeout: 20000 });
await visitor.waitForFunction(() => { const v = document.querySelector(".sf-media video"); return v && v.readyState >= 2; }, null, { timeout: 20000 });
for (let i = 0; i < 6; i++) { await visitor.mouse.wheel(0, 500); await visitor.waitForTimeout(250); }
await visitor.waitForTimeout(800);
const scrub = await visitor.evaluate(() => { const v = document.querySelector(".sf-media video"); return { t: v?.currentTime ?? -1, src: v?.currentSrc ?? "", scene: player.getCurrentScene() }; });
if (!(scrub.t > 0.3) || !(scrub.src.startsWith("blob:") || scrub.src.includes("scrub-"))) fail("scroll scrub did not drive the video: " + JSON.stringify(scrub));
await visitorCtx.close();
await pageApi(owner, "PUT", `/api/v1/projects/${projectId}/draft`, { config: baseConfig });
const pubBack = await pageApi(owner, "POST", `/api/v1/projects/${projectId}/publish`, {});
step(`scroll-scrub published (v${pubScroll.publishedVersion}): scrolling drives the video to ${scrub.t.toFixed(2)} s (scene ${scrub.scene}) from the ${scrub.src.startsWith("blob:") ? "fully downloaded scrub file" : "scrub rendition"}; back to click-to-play as v${pubBack.publishedVersion}`);

/* ---------- 12. analytics dashboard + diagnostics ---------- */
const summary = await pageApi(owner, "GET", `/api/v1/projects/${projectId}/analytics?days=7`);
const T = summary.totals;
if (T.loads < 2 || T.plays < 1 || T.clicks < 2 || T.addToCarts < 1 || T.coupons < 1) fail("analytics totals unexpected: " + JSON.stringify(T));
await owner.goto(`${WEB}/projects/${projectId}/analytics`);
await owner.waitForSelector(".stat-grid", { timeout: 15000 });
const diag = await pageApi(owner, "GET", `/api/v1/projects/${projectId}/diagnostics`);
const diagLine = diag.checks.map((c) => `${c.id}:${c.status}`).join(" ");
if (!diagLine.startsWith("draft:ok media:ok published:ok")) fail("diagnostics: " + diagLine);
step(`analytics: ${T.loads} loads, ${T.plays} plays, ${T.completes} complete, ${T.clicks} clicks, ${T.addToCarts} add-to-cart, ${T.coupons} coupon, avg watch ${T.avgWatchSeconds}s; dashboard page renders; diagnostics ${diagLine}`);

/* ---------- 13. agency: client, invite, approval, client review link ---------- */
await owner.goto(`${WEB}/team`);
await owner.fill("[data-testid=client-name]", "Glow Skincare Ltd");
await owner.click("[data-testid=client-add]");
await owner.waitForSelector("[data-testid=clients] >> text=Glow Skincare Ltd");
await owner.click("[data-testid=create-invite]");
const inviteUrl = (await owner.textContent("[data-testid=invite-url]")).trim();
await owner.goto(`${WEB}/projects/${projectId}`);
await owner.waitForSelector("[data-testid=project-client]");
await owner.selectOption("[data-testid=project-client]", { label: "Glow Skincare Ltd" });
await owner.waitForTimeout(800);
await owner.click("text=Require approval before publishing");
await owner.waitForSelector("#review input[type=checkbox]:checked", { timeout: 10000 });
await owner.click("[data-testid=send-to-client]");
await owner.waitForSelector("[data-testid=review-url]");
const reviewUrl = (await owner.textContent("[data-testid=review-url]")).trim();
await owner.waitForSelector("text=Waiting for the client");
step(`Team & clients: client "Glow Skincare Ltd" + invite link; project filed under the client; approval required; review link created for the client`);

const clientCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const client = await clientCtx.newPage();
watch(client, "client");
await client.goto(reviewUrl);
await client.waitForSelector("[data-testid=review-page]");
await client.waitForSelector(".sf-player", { timeout: 30000 });
await client.fill("[data-testid=reviewer-name]", "Maya (Glow Skincare)");
await client.click("[data-testid=note-mode]");
const ovBox = await (await client.$("[data-testid=review-overlay]")).boundingBox();
await client.mouse.click(ovBox.x + ovBox.width * 0.7, ovBox.y + ovBox.height * 0.4);
await client.waitForSelector("[data-testid=review-note]");
await client.fill("[data-testid=review-note]", "Can the jar be a bit bigger in scene 2?");
await client.click("[data-testid=review-note-post]");
await client.waitForSelector("[data-testid=review-comments] >> text=Can the jar be a bit bigger");
await client.click("[data-testid=review-approve]");
await client.fill("[data-testid=decision-note]", "Looks great otherwise — approved.");
await client.click("[data-testid=decision-confirm]");
await client.waitForSelector("[data-testid=review-status]:has-text('Approved by Maya')");
await owner.reload();
await owner.waitForSelector("text=/Approved by Maya/");
await owner.goto(`${WEB}/dashboard`);
await owner.waitForSelector("[data-testid=dash-group] >> text=Glow Skincare Ltd");
await owner.waitForSelector("[data-testid=dash-activity] >> text=/Maya \\(Glow Skincare\\) approved/");
step(`client (no account) opened the review link, watched the real player, pinned a note, approved; owner sees “Approved by Maya”; dashboard groups the project under the client and lists the approval`);

/* ---------- 14. colleague joins by invite, comments with a mention, editor-role publish is gated ---------- */
const edCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const colleague = await edCtx.newPage();
watch(colleague, "colleague");
const colleagueEmail = `fulltest-colleague-${stamp}@sceneflow.test`;
await colleague.goto(inviteUrl);
await colleague.waitForSelector("[data-testid=join-card]");
await colleague.click("text=Create a free account");
await colleague.waitForURL(/\/login\?/);
await colleague.fill("input[autocomplete=name]", "Cora Colleague");
await colleague.fill("input[type=email]", colleagueEmail);
await colleague.fill("input[type=password]", password);
await colleague.click("button[type=submit]");
await colleague.waitForURL(/\/join\//);
await colleague.click("[data-testid=accept-invite]");
await colleague.waitForURL(`${WEB}/projects`);
await colleague.waitForSelector(".list-item >> text=Glow Face Cream launch", { timeout: 15000 });
await colleague.goto(`${WEB}/projects/${projectId}/editor?comments=1`);
await colleague.waitForSelector(".ed-canvas", { timeout: 30000 });
await colleague.waitForSelector("[data-testid=comments-panel]");
await colleague.waitForSelector("[data-testid=comment] >> text=Can the jar be a bit bigger");
if (await colleague.$(".tour-card")) await colleague.click(".tour-card >> text=Skip tour");
// Place a pin: wait for the canvas to be in "placing" state before clicking it (the stage can still be settling after load).
for (let attempt = 0; attempt < 3; attempt++) {
  if (!(await colleague.$(".ed-canvas.placing"))) await colleague.click("[data-testid=pin-on-canvas]");
  await colleague.waitForSelector(".ed-canvas.placing", { timeout: 5000 }).catch(() => {});
  await colleague.waitForTimeout(300);
  const sb = await (await colleague.$(".ed-stage-wrap")).boundingBox();
  await colleague.mouse.click(sb.x + sb.width * 0.75, sb.y + sb.height * 0.35);
  if (await colleague.waitForSelector(".cm-pin.draft", { timeout: 5000 }).catch(() => null)) break;
}
await colleague.waitForSelector(".cm-pin.draft", { timeout: 5000 });
await colleague.fill("[data-testid=comment-body]", "@Rina jar made bigger — please approve again");
await colleague.click("[data-testid=comment-post]");
await colleague.waitForSelector("[data-testid=comment] >> text=jar made bigger");
if (!(await colleague.$("[data-testid=comment] .mention"))) fail("mention not highlighted");
// A small real edit by the colleague (bigger jar) changes the draft → an editor cannot publish without a fresh approval.
const bigger = { ...baseConfig, scenes: baseConfig.scenes.map((s) => (s.id === "s2" ? { ...s, layers: s.layers.map((l) => (l.id === "jar" ? { ...l, frame: { x: 60, y: 10, w: 34, h: 62 } } : l)) } : s)) };
await pageApi(colleague, "PUT", `/api/v1/projects/${projectId}/draft`, { config: bigger });
const blocked = await pageApi(colleague, "POST", `/api/v1/projects/${projectId}/publish`, {}, { allowError: true });
if (blocked.error !== "APPROVAL_REQUIRED") fail("editor publish should be blocked: " + JSON.stringify(blocked));
await owner.reload();
await owner.waitForSelector("[data-testid=dash-mentions] >> text=jar made bigger");
step(`colleague joined through the invite (second account <${colleagueEmail}>), saw the client's note in the editor, pinned a comment with @Rina, made the jar bigger; editor-role publish blocked (APPROVAL_REQUIRED); owner's dashboard lists the mention`);

/* ---------- 15. WordPress: pair, WooCommerce product, landing page with shortcode + element placement ---------- */
let wpPage = null, wpResult = "skipped";
if (wpUp) {
  const code = await wp("eval", "echo SceneFlow_Settings::create_pairing_code();");
  const { site } = await pageApi(owner, "POST", "/api/v1/sites/connect", { workspaceId, url: WP, pairingCode: code });
  await pageApi(owner, "PATCH", `/api/v1/projects/${projectId}`, { siteId: site.id });
  const admin = (await wp("user", "list", "--role=administrator", "--field=user_login")).split(/\r?\n/)[0];
  const wooId = await wp("wc", "product", "create", "--name=Glow Face Cream", "--type=simple", "--regular_price=39", "--sale_price=29", `--sku=GLOW-${stamp}`, "--short_description=Light moisturiser for 24-hour hydration without grease.", "--description=Hyaluronic acid and ceramides. Absorbs in 10 seconds. Fragrance free. Dummy product created by the SceneFlow full local test.", `--user=${admin}`, "--porcelain");
  const mediaId = await wp("media", "import", imgPath, "--title=Glow Face Cream jar", "--porcelain");
  await wp("wc", "product", "update", wooId, `--images=[{"id":${mediaId}}]`, `--user=${admin}`);
  const list = await pageApi(owner, "GET", `/api/v1/projects/${projectId}/products?provider=woocommerce&search=Glow`);
  const woo = list.items.find((p) => String(p.id) === String(wooId));
  if (!woo) fail("WooCommerce product not returned through the connector: " + JSON.stringify(list.items.map((p) => p.name)));
  const wooRef = { provider: "woocommerce", productId: woo.id, title: woo.name, price: woo.price, regularPrice: woo.regularPrice ?? undefined, image: woo.image ?? undefined, url: woo.productUrl, inStock: woo.stockStatus !== "outofstock" };
  const wooConfig = { ...bigger, scenes: bigger.scenes.map((s) => (s.id === "s3" ? { ...s, layers: s.layers.map((l) => (l.id === "card" ? { ...l, product: wooRef } : l.id === "cta" ? { ...l, content: { label: "Add Glow Cream" }, action: { type: "ADD_TO_CART", product: wooRef, quantity: 1 } } : l)) } : s)) };
  await pageApi(owner, "PUT", `/api/v1/projects/${projectId}/draft`, { config: wooConfig });
  const pushed = await pageApi(owner, "POST", `/api/v1/projects/${projectId}/publish`, {});
  if (!pushed.sites?.[0]?.ok) fail("publish to WordPress failed: " + JSON.stringify(pushed.sites));
  const onSite = await (await fetch(`${WP}/wp-json/sceneflow/v1/project/${projectId}`)).json();
  if (onSite.version !== pushed.publishedVersion) fail(`WordPress serves v${onSite.version}, published v${pushed.publishedVersion} (stale cache?)`);
  const content = `<!-- wp:html -->
<section class="glow-hero" style="max-width:960px;margin:40px auto;font-family:system-ui,sans-serif">
  <p style="letter-spacing:.2em;text-transform:uppercase;color:#c2410c;font-weight:700;margin:0 0 8px">New · Glow Skincare</p>
  <h1 style="font-size:44px;line-height:1.1;margin:0 0 12px">Glow Face Cream</h1>
  <p style="font-size:20px;color:#444;margin:0 0 24px">24-hour hydration without the grease. Hyaluronic acid, ceramides, zero fragrance.</p>
  ${pushed.sites[0].shortcode}
  <ul style="font-size:18px;line-height:1.7;margin:28px 0"><li>Absorbs in 10 seconds</li><li>Dermatologist tested</li><li>Vegan, cruelty free</li></ul>
  <p style="font-size:24px"><s style="color:#999">$39</s> <strong>$29</strong> · launch offer, code <code>GLOW10</code></p>
</section>
<section style="max-width:960px;margin:40px auto;font-family:system-ui,sans-serif">
  <h2>See it again — placed on an existing element</h2>
  <div class="glow-video-spot" style="min-height:120px;background:#fff7ed;border:1px dashed #c2410c;display:grid;place-items:center;color:#c2410c">this box is replaced by the player through an element placement</div>
</section>
<!-- /wp:html -->`;
  const contentFile = join(tmp, "landing.html");
  await writeFile(contentFile, content, "utf8");
  const pageId = await wp("post", "create", contentFile, "--post_type=page", "--post_status=publish", "--post_title=Glow Face Cream — dummy landing", `--post_name=glow-cream-${stamp}`, "--porcelain");
  const pageUrl = await wp("eval", `echo get_permalink(${pageId});`);
  await pageApi(owner, "POST", `/api/v1/projects/${projectId}/placements`, { postId: Number(pageId), pageUrl, pageTitle: "Glow Face Cream — dummy landing", selector: ".glow-video-spot", mode: "replace" });
  wpPage = await ownerCtx.newPage();
  watch(wpPage, "wordpress");
  await wpPage.goto(pageUrl, { timeout: 120_000, waitUntil: "domcontentloaded" });
  await wpPage.waitForFunction(() => document.querySelectorAll(".sf-player").length >= 2, null, { timeout: 60000 });
  await wpPage.click(".sf-player >> nth=0 >> .sf-media video", { position: { x: 8, y: 8 } });
  await wpPage.evaluate(() => document.querySelector(".sf-player .sf-media video").play());
  await wpPage.waitForFunction(() => document.querySelector(".sf-player")?.dataset.sfState === "playing", null, { timeout: 15000 });
  await wpPage.evaluate(() => { const v = document.querySelector(".sf-media video"); if (v) v.currentTime = 8.6; });
  await wpPage.waitForSelector(".sf-player >> nth=0 >> .sf-product-btn", { state: "visible", timeout: 10000 });
  // The WooCommerce adapter talks to the Store API with a cart token; the add-item answer carries the resulting cart.
  const [addRes] = await Promise.all([wpPage.waitForResponse((r) => /wc\/store\/v1\/cart\/add-item/.test(r.url()), { timeout: 20000 }), wpPage.click(".sf-player >> nth=0 >> .sf-product-btn")]);
  const storeCart = await addRes.json().catch(() => ({}));
  const cart = { count: storeCart.items_count ?? 0, names: (storeCart.items ?? []).map((i) => i.name) };
  const toast = await wpPage.waitForSelector(".sf-toast", { timeout: 10000 }).then((t) => t.evaluate((el) => ({ kind: el.dataset.kind, text: el.textContent }))).catch(() => null);
  if (!addRes.ok() || toast?.kind === "error" || !(cart.count >= 1) || !cart.names.some((x) => /Glow Face Cream/.test(x))) fail(`WooCommerce add-to-cart from the player: store ${addRes.status()}, toast ${JSON.stringify(toast)}, cart ${JSON.stringify(cart)}`);
  const diag2 = await pageApi(owner, "GET", `/api/v1/projects/${projectId}/diagnostics`);
  const d2 = Object.fromEntries(diag2.checks.map((c) => [c.id, c.status]));
  if (d2.site !== "ok" || d2.onsite !== "ok" || d2.placement !== "ok") fail("WordPress diagnostics: " + JSON.stringify(d2));
  wpResult = `${pageUrl} — plugin ${site.connectorVersion}, WooCommerce product #${wooId} "${woo.name}" ${woo.price}, published v${pushed.publishedVersion} pushed (site serves v${onSite.version}), shortcode ${pushed.sites[0].shortcode}, element placement .glow-video-spot → 2 players on the page, add-to-cart → toast “${toast?.text ?? "-"}”, WooCommerce cart holds ${cart.count} × ${cart.names[0]}, diagnostics site/onsite/placement ok`;
  step(`WordPress: ${wpResult}`);
} else {
  note("WordPress steps skipped (development.local not reachable)");
}

/* ---------- 16. plain HTML embed (any website) ---------- */
const embed = await ownerCtx.newPage();
watch(embed, "embed");
await embed.setContent(`<!doctype html><body style="margin:0;background:#111"><div data-sceneflow-id="${projectId}" style="max-width:900px;margin:30px auto"></div><script src="${API}/runtime/sceneflow.runtime.min.js" data-auto defer></script></body>`);
await embed.waitForSelector("[data-sceneflow=ready] .sf-player", { timeout: 20000 });
await embed.close();
step(`plain HTML embed (one script tag + data-sceneflow-id) mounts the player from /p/…json on a page of another origin`);

/* ---------- 17. MP4 export from the project page ---------- */
await owner.goto(`${WEB}/projects/${projectId}`);
await owner.waitForSelector("[data-testid=export-card]");
await owner.selectOption("[data-testid=export-quality]", "720p");
await owner.click("[data-testid=export-start]");
await owner.waitForSelector("[data-testid=export-item]", { timeout: 15000 });
const t0 = Date.now();
let exStatus = "";
while (Date.now() - t0 < 360_000) {
  exStatus = (await owner.locator("[data-testid=export-item]").first().getAttribute("data-status")) ?? "";
  if (exStatus === "ready") break;
  if (exStatus === "failed") fail("export failed: " + (await owner.locator("[data-testid=export-item]").first().innerText()).replace(/\s+/g, " ").slice(0, 400));
  await sleep(1500);
}
if (exStatus !== "ready") fail(`export still "${exStatus}" after ${Math.round((Date.now() - t0) / 1000)}s`);
const [download] = await Promise.all([owner.waitForEvent("download", { timeout: 30000 }), owner.click("[data-testid=export-download]")]);
const outDir = resolve(ROOT, "dist/e2e");
await mkdir(outDir, { recursive: true });
const exportFile = join(outDir, `full-local-${stamp}.mp4`);
await download.saveAs(exportFile);
const ep = await probe(exportFile);
const fa = await frameLuma(exportFile, 1.5);
const fb = await frameLuma(exportFile, 9.5);
if (ep.width !== 1280 || ep.height !== 720 || ep.codec !== "h264" || !ep.hasAudio || Math.abs(ep.duration - D) > 0.3 || fa.luma < 20 || pxDiff(fa.px, fb.px) < 3) fail("export file unexpected: " + JSON.stringify(ep));
step(`MP4 export: ${download.suggestedFilename()} rendered in ${Math.round((Date.now() - t0) / 1000)} s → ${ep.width}×${ep.height} ${ep.codec}, ${ep.duration.toFixed(2)} s, audio ${ep.hasAudio}, frames at 1.5 s / 9.5 s differ → ${exportFile}`);

/* ---------- 18. versions / caches ---------- */
const live = await (await pub(`${API}/p/${projectId}.json`)).json();
let manifest = null;
try { manifest = JSON.parse(await readFile(resolve(ROOT, "dist/connectors/manifest.json"), "utf8")); } catch { /* connectors not built */ }
const zips = [];
for (const f of ["sceneflow-wordpress.zip", "sceneflow-shopify.zip", "sceneflow-webflow.zip"]) zips.push(`${f.replace("sceneflow-", "").replace(".zip", "")}:${(await fetch(`${API}/downloads/${f}`, { method: "HEAD" })).status}`);
step(`versions: runtime ${rtVersion}${manifest ? ` (connector zips built with ${manifest.runtimeVersion})` : ""}, live config v${live.version} checksum ${((await pub(`${API}/p/${projectId}.json`)).headers.get("etag") ?? "").slice(0, 12)}…${wpUp ? `, WordPress plugin ${wpHealth.version}` : ""}; connector downloads ${zips.join(" ")}`);

/* ---------- done ---------- */
await clientCtx.close();
await edCtx.close();
await demo.close();
console.log(`
All good: ${problems.length} page errors.
  Login      ${WEB}/login  →  ${email}  /  ${password}   (colleague: ${colleagueEmail} / same password)
  Project    ${WEB}/projects/${projectId}
  Editor     ${WEB}/projects/${projectId}/editor
  Analytics  ${WEB}/projects/${projectId}/analytics
  Dashboard  ${WEB}/dashboard
  Live demo  ${API}/demo/${projectId}
  Review link (client) ${reviewUrl}
  WordPress  ${wpResult === "skipped" ? "skipped" : wpResult.split(" — ")[0]}
  Export     ${exportFile}
`);
if (problems.length) { console.error("page errors:\n  " + problems.join("\n  ")); process.exitCode = 1; }

if (KEEP_OPEN) {
  await owner.goto(`${WEB}/projects/${projectId}`);
  const tabs = [`${WEB}/dashboard`, `${API}/demo/${projectId}`, ...(wpPage ? [] : []), pathToFileURL(exportFile).href];
  for (const u of tabs) { const p = await ownerCtx.newPage(); await p.goto(u).catch(() => {}); }
  if (wpPage) await wpPage.bringToFront().catch(() => {});
  await owner.bringToFront();
  console.log("Browser left open (project page, dashboard, live demo, WordPress landing, exported MP4). Close the Chrome window to end this script.");
  await new Promise((r) => browser.on("disconnected", r));
} else {
  await browser.close();
}
