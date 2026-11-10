// WordPress landing-page walkthrough against the RUNNING stack (api 4800, web 3000, worker) and the LocalWP site
// development.local: a professional product clip rendered with Chrome, two projects (an Apple-style autoplay hero
// with a WooCommerce card, and a pinned scroll-scrub story), a real landing page, the element *picker* UI, the
// shortcode, scroll pinning + smoothness measured on the theme (GSAP ScrollSmoother → transform pin) and on the
// plain demo page (sticky pin), WooCommerce add-to-cart from the player, analytics, diagnostics, resource hints.
//
//   node scripts/e2e/wp-landing.mjs [--headed] [--keep-open] [--email x --password y]
// Reuses the account from the full walkthrough by default (its workspace is already connected to the site);
// registers a fresh one (and pairs the site) when that login fails. Nothing is deleted.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { landingHtml } from "./landing-template.mjs";
import { makeDemoClip, makeProductStill } from "./make-demo-clip.mjs";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const WP = "http://development.local";
const WP_PATH = "C:/Users/UseR/Local Sites/development/app/public";
const PHP = "D:/programs/local/resources/extraResources/lightning-services/php-8.2.27+1/bin/win64/php.exe";
const WP_CLI = "D:/programs/local/resources/extraResources/bin/wp-cli/wp-cli.phar";
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const HEADED = argv.includes("--headed");
const KEEP_OPEN = argv.includes("--keep-open");
const EMAIL = flag("--email") ?? "fulltest-1794290183803@sceneflow.test";
const PASSWORD = flag("--password") ?? "fulltest-pass-123";
const ROOT = resolve(import.meta.dirname, "../..");
const workerRequire = createRequire(resolve(ROOT, "apps/worker/package.json"));
const FFPROBE = workerRequire("@ffprobe-installer/ffprobe").path;
const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const step = (m) => console.log(`✓ ${++n}. ${m}`);
const note = (m) => console.log(`  · ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  ")); process.exit(1); };
process.on("uncaughtException", (e) => fail(String(e.stack ?? e).split("\n").slice(0, 3).join(" | ")));
process.on("unhandledRejection", (e) => fail(String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")));

/* ---------- helpers ---------- */
const problems = [];
function watch(page, who) {
  page.on("pageerror", (e) => problems.push(`[${who} ${page.url()}] uncaught: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_|Failed to load resource|ERR_BLOCKED_BY_CLIENT|preloaded|was preloaded/.test(m.text())) problems.push(`[${who} ${page.url()}] console: ${m.text().slice(0, 200)}`); });
}
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
  for (let i = 0; i < 300; i++) {
    const { asset } = await pageApi(page, "GET", `/api/v1/media/${assetId}`);
    if (asset.status === "failed") fail(`${what} failed to process: ${asset.error}`);
    if (asset.status === "ready" && (!renditions || ["ready", "failed", "skipped"].includes(asset.metadataJson.renditions?.status))) return asset;
    await sleep(1000);
  }
  fail(`${what} never became ready (is the worker running?)`);
}
async function probe(file) {
  const { stdout } = await exec(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const d = JSON.parse(stdout); const v = d.streams.find((s) => s.codec_type === "video");
  return { duration: Number(d.format.duration), width: v?.width, height: v?.height, codec: v?.codec_name, hasAudio: d.streams.some((s) => s.codec_type === "audio") };
}
const sha = async (buf) => { const { createHash } = await import("node:crypto"); return createHash("sha256").update(buf).digest("hex").slice(0, 12); };

/* ---------- 0. stack + versions ---------- */
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await sleep(1000); }
const runtime = Buffer.from(await (await fetch(`${API}/runtime/sceneflow.runtime.min.js`)).arrayBuffer());
const rtVersion = runtime.toString().match(/"(\d+\.\d+\.\d+)"/)?.[1];
const wpHealth = await (await fetch(`${WP}/wp-json/sceneflow/v1/health`, { signal: AbortSignal.timeout(45_000) })).json().catch(() => null);
if (!wpHealth) fail(`${WP} not reachable (LocalWP site running?)`);
const wpRuntime = Buffer.from(await (await fetch(`${WP}/wp-content/plugins/sceneflow/assets/sceneflow.runtime.min.js`)).arrayBuffer());
if ((await sha(runtime)) !== (await sha(wpRuntime))) fail(`the plugin's runtime bundle differs from the API's (api ${await sha(runtime)}, plugin ${await sha(wpRuntime)}) — run pnpm build && pnpm build:wp and reinstall the plugin`);
step(`stack: runtime ${rtVersion} (API and plugin identical), WordPress ${WP} plugin ${wpHealth.version} / WP ${wpHealth.wp} (${wpHealth.capabilities.join(",")})`);

/* ---------- 1. professional media: clip (Chrome-rendered, 1080p, ambient pad) + product still ---------- */
const stamp = Date.now();
const tmp = await mkdtemp(join(tmpdir(), "sf-wp-"));
const clipPath = join(tmp, "glow-face-cream.mp4");
const stillPath = join(tmp, "glow-face-cream.png");
const made = await makeDemoClip({ out: clipPath, width: 1920, height: 1080, fps: 30, seconds: 12, quiet: true });
await makeProductStill({ out: stillPath, size: 1000 });
const cp = await probe(clipPath);
if (cp.width !== 1920 || cp.height !== 1080 || !cp.hasAudio || Math.abs(cp.duration - 12) > 0.2) fail("clip unexpected: " + JSON.stringify(cp));
step(`rendered the product clip with Chrome: ${made.frames} frames in ${(made.ms / 1000).toFixed(0)} s → 1920×1080 ${cp.codec}, ${cp.duration.toFixed(1)} s, ambient audio; 1000×1000 product still`);

/* ---------- 2. sign in (or register) ---------- */
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required"] });
const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const owner = await ownerCtx.newPage();
watch(owner, "owner");
owner.on("dialog", (d) => void d.accept());
await owner.goto(`${WEB}/login`);
await owner.fill("input[type=email]", EMAIL);
await owner.fill("input[type=password]", PASSWORD);
await owner.click("button[type=submit]");
let email = EMAIL;
const loggedIn = await owner.waitForURL(`${WEB}/projects`, { timeout: 15000 }).then(() => true).catch(() => false);
if (!loggedIn) {
  email = `wplanding-${stamp}@sceneflow.test`;
  await owner.goto(`${WEB}/login`);
  await owner.click("text=Create account");
  await owner.fill("input[autocomplete=name]", "Rina Tester");
  await owner.fill("input[type=email]", email);
  await owner.fill("input[type=password]", PASSWORD);
  await owner.click("button[type=submit]");
  await owner.waitForURL(`${WEB}/projects`);
}
const { workspaces } = await pageApi(owner, "GET", "/api/v1/workspaces");
const workspaceId = workspaces[0].id;
let { sites } = await pageApi(owner, "GET", `/api/v1/sites?workspaceId=${workspaceId}`);
let site = sites.find((s) => s.url.replace(/\/$/, "") === WP);
if (!site) {
  const code = await wp("eval", "echo SceneFlow_Settings::create_pairing_code();");
  site = (await pageApi(owner, "POST", "/api/v1/sites/connect", { workspaceId, url: WP, pairingCode: code })).site;
}
step(`${loggedIn ? "signed in as" : "registered"} ${email}; workspace ${workspaceId} connected to ${site.name ?? site.url} (plugin ${site.connectorVersion})`);

/* ---------- 3. upload + processing (poster, proxy, thumbnails, 720p/1080p/scrub renditions) ---------- */
const clipId = await uploadBytes(owner, workspaceId, "glow-face-cream.mp4", "video/mp4", await readFile(clipPath));
const stillId = await uploadBytes(owner, workspaceId, "glow-face-cream.png", "image/png", await readFile(stillPath));
const still = await waitAsset(owner, stillId, "product still");
const clip = await waitAsset(owner, clipId, "clip renditions", { renditions: true });
const cm = clip.metadataJson;
const rend = cm.renditions;
if (rend.status !== "ready" || !rend.items.some((r) => r.kind === "scrub") || !rend.items.some((r) => r.height === 1080)) fail("renditions unexpected: " + JSON.stringify(rend));
step(`uploaded: clip → ${cm.width}×${cm.height} ${cm.duration.toFixed(1)} s, poster, proxy, ${cm.thumbnails?.length} thumbnails, renditions [${rend.items.map((r) => `${r.kind}@${r.height}p`).join(", ")}]; still → webp`);

/* ---------- 4. WooCommerce product with the professional still ---------- */
const admin = (await wp("user", "list", "--role=administrator", "--field=user_login")).split(/\r?\n/)[0];
let wooId = (await wp("wc", "product", "list", "--sku=GLOW-LIVE", "--field=id", `--user=${admin}`)).split(/\r?\n/)[0];
if (!wooId) wooId = await wp("wc", "product", "create", "--name=Glow Face Cream", "--type=simple", "--regular_price=39", "--sale_price=29", "--sku=GLOW-LIVE", "--short_description=Light moisturiser for 24-hour hydration without grease.", "--description=Hyaluronic acid and ceramides. Absorbs in 10 seconds. Fragrance free, vegan, dermatologist tested.", `--user=${admin}`, "--porcelain");
const mediaId = await wp("media", "import", stillPath, "--title=Glow Face Cream", "--porcelain");
await wp("wc", "product", "update", wooId, `--images=[{"id":${mediaId}}]`, `--user=${admin}`);
const { project: heroProject } = await pageApi(owner, "POST", "/api/v1/projects", { workspaceId, name: `Glow — hero ${stamp}` });
const { project: storyProject } = await pageApi(owner, "POST", "/api/v1/projects", { workspaceId, name: `Glow — scroll story ${stamp}` });
for (const p of [heroProject, storyProject]) await pageApi(owner, "PATCH", `/api/v1/projects/${p.id}`, { siteId: site.id });
const list = await pageApi(owner, "GET", `/api/v1/projects/${heroProject.id}/products?provider=woocommerce&search=Glow`);
const woo = list.items.find((p) => String(p.id) === String(wooId));
if (!woo || !woo.image) fail("WooCommerce product not returned with its image: " + JSON.stringify(list.items.map((p) => [p.name, p.image])));
const wooRef = { provider: "woocommerce", productId: woo.id, title: woo.name, price: woo.price, regularPrice: woo.regularPrice ?? undefined, image: woo.image, url: woo.productUrl, inStock: woo.stockStatus !== "outofstock" };
step(`WooCommerce product #${wooId} "${woo.name}" ${woo.price} (was ${woo.regularPrice ?? "-"}) with the rendered still; two projects created and assigned to the site`);

/* ---------- 5. the hero project (Apple-style: autoplay, no controls, blends into the page, custom thumbnail) ---------- */
const D = cm.duration;
const dark = "#1d1d1f";
const accent = "#c8755a";
const baseVideo = { provider: "local", assetId: clip.id, src: cm.proxyUrl, poster: cm.posterUrl, duration: D };
const text = (id, name, txt, frame, extra = {}) => ({ id, type: "text", name, frame, content: { text: txt }, style: { color: dark, fontSize: 30, fontWeight: 500, ...(extra.style ?? {}) }, ...(extra.rest ?? {}) });
const heroConfig = {
  canvas: { aspectRatio: "16:9", background: "transparent" },
  video: baseVideo,
  playback: { mode: "autoplay", controls: false, muted: true, speed: 1 },
  scenes: [
    { id: "s1", name: "Intro", start: 0, end: 4, background: { type: "video", assetId: clip.id, sourceStart: 0 }, layers: [
      text("eyebrow", "Eyebrow", "NEW · GLOW SKINCARE", { x: 6, y: 16, w: 40, h: 6 }, { style: { fontSize: 16, fontWeight: 700, color: accent, letterSpacing: 4 }, rest: { animation: { in: { type: "fade", duration: 0.6 } } } }),
      text("hl", "Headline", "Skin that drinks it in.", { x: 6, y: 23, w: 46, h: 20 }, { style: { fontSize: 64, fontWeight: 700, lineHeight: 1.05 }, rest: { animation: { in: { type: "slide-up", duration: 0.7, delay: 0.2 } } } }),
      text("sub", "Subline", "24-hour hydration. Zero grease. Nothing you can feel but softness.", { x: 6, y: 46, w: 40, h: 14 }, { style: { fontSize: 24, color: "#55555c" }, rest: { animation: { in: { type: "fade", duration: 0.6, delay: 0.6 } } } }),
    ] },
    { id: "s2", name: "Benefits", start: 4, end: 8, background: { type: "video", assetId: clip.id, sourceStart: 4 }, layers: [
      text("b1", "Benefit 1", "Hyaluronic acid pulls water in", { x: 6, y: 22, w: 42, h: 9 }, { rest: { start: 0.2, animation: { in: { type: "slide-left", duration: 0.5 } } } }),
      text("b2", "Benefit 2", "Ceramides keep it there", { x: 6, y: 34, w: 42, h: 9 }, { rest: { start: 1.0, animation: { in: { type: "slide-left", duration: 0.5 } } } }),
      text("b3", "Benefit 3", "Absorbs in 10 seconds", { x: 6, y: 46, w: 42, h: 9 }, { rest: { start: 1.8, animation: { in: { type: "slide-left", duration: 0.5 } } } }),
      { id: "hs", type: "hotspot", name: "See the offer", frame: { x: 66, y: 44, w: 3.2, h: 5.7 }, content: { tooltip: "See the launch offer" }, style: { color: accent }, action: { type: "GO_TO_SCENE", sceneId: "s3" } },
    ] },
    { id: "s3", name: "Offer", start: 8, end: D, background: { type: "video", assetId: clip.id, sourceStart: 8 }, layers: [
      { id: "card", type: "product", name: "Product card", frame: { x: 6, y: 12, w: 30, h: 76 }, product: wooRef, content: { quantity: false, buttonAction: "add_to_cart", buttonLabel: "Add to bag" }, style: { background: "#ffffff", color: dark, accent, borderRadius: 18, fontSize: 16, boxShadow: "0 24px 60px rgba(40,20,10,.14)" }, animation: { in: { type: "slide-up", duration: 0.6 } } },
      { id: "offer", type: "badge", name: "Offer", frame: { x: 40, y: 14, w: 16, h: 7 }, content: { text: "-25% launch" }, style: { background: "#fbeee4", color: accent, borderRadius: 999, fontWeight: 700, fontSize: 16 }, animation: { in: { type: "fade", duration: 0.5, delay: 0.4 } } },
      text("why", "Why", "Launch set: cream + travel size.", { x: 40, y: 24, w: 36, h: 10 }, { style: { fontSize: 22 }, rest: { animation: { in: { type: "fade", duration: 0.5, delay: 0.6 } } } }),
    ] },
  ],
};
let saved = await pageApi(owner, "PUT", `/api/v1/projects/${heroProject.id}/draft`, { config: heroConfig });
// Custom thumbnail through the editor UI: VIDEO → "Pick a frame…" → a moment from the strip (the worker extracts it at full size).
await owner.goto(`${WEB}/projects/${heroProject.id}/editor`);
await owner.waitForSelector(".ed-canvas", { timeout: 30000 });
// A fresh browser profile gets the tour; it appears a moment after the canvas and keeps its target scrolled into view, so skip it before using the panels.
await owner.waitForSelector(".tour-card", { timeout: 6000 }).catch(() => null);
if (await owner.$(".tour-card")) await owner.click(".tour-card >> text=Skip tour");
await owner.waitForSelector("[data-testid=video-look]");
const autoPoster = await owner.getAttribute("[data-testid=poster-preview]", "src");
await owner.click("[data-testid=poster-pick-frame]");
await owner.waitForSelector("[data-testid=frame-picker] [data-testid=frame-thumb]", { timeout: 15000 });
await owner.click("[data-testid=frame-picker] [data-testid=frame-thumb] >> nth=2");
await owner.waitForSelector("[data-testid=frame-picker]", { state: "detached", timeout: 40000 });
await owner.waitForFunction((prev) => document.querySelector("[data-testid=poster-preview]")?.getAttribute("src") !== prev, autoPoster, { timeout: 10000 });
const heroPoster = await owner.getAttribute("[data-testid=poster-preview]", "src");
if (!/frame-\d+\.jpg$/.test(heroPoster ?? "")) fail("poster is not an extracted frame: " + heroPoster);
if (!(await fetch(heroPoster, { method: "HEAD" })).ok) fail("poster frame not reachable: " + heroPoster);
await owner.waitForFunction(() => document.querySelector(".ed-save")?.textContent?.startsWith("Saved"), null, { timeout: 15000 });
const heroDraft = await pageApi(owner, "GET", `/api/v1/projects/${heroProject.id}`);
if (heroDraft.draft.config.poster !== heroPoster || heroDraft.draft.config.canvas.background !== "transparent") fail("draft lacks the poster / transparent background: " + JSON.stringify({ poster: heroDraft.draft.config.poster, canvas: heroDraft.draft.config.canvas }));
step(`hero project: autoplay, no controls, transparent player, 3 scenes over the clip (headline → timed benefits + hotspot → WooCommerce card + offer); thumbnail picked from the frame strip in the editor → ${heroPoster.split("/").pop()} (full-size frame by the worker), autosaved as draft v${heroDraft.draft.version}`);

/* ---------- 6. the scroll story (pinned in the centre, GSAP-like) ---------- */
const storyConfig = {
  canvas: { aspectRatio: "16:9", background: "transparent" },
  video: baseVideo,
  poster: (await pageApi(owner, "POST", `/api/v1/media/${clip.id}/frame`, { time: 0.4 })).frame.url,
  playback: { mode: "scroll", pin: true, pinPosition: "center", pinOffset: 0, scrollDistance: "250vh", smoothness: 0.35, markers: false, mobileFallback: "autoplay", controls: false },
  scenes: [
    { id: "a", name: "Hydration", start: 0, end: 4, background: { type: "video", assetId: clip.id, sourceStart: 0 }, layers: [
      text("t1", "Title", "Hydration, layer by layer.", { x: 6, y: 20, w: 36, h: 22 }, { style: { fontSize: 54, fontWeight: 700, lineHeight: 1.05 }, rest: { animation: { in: { type: "slide-up", duration: 0.8 }, out: { type: "fade", duration: 0.5 } } } }),
      text("t1b", "Lead", "Scroll to open the jar.", { x: 6, y: 44, w: 34, h: 8 }, { style: { fontSize: 22, color: "#55555c" }, rest: { animation: { in: { type: "fade", duration: 0.6, delay: 0.4 }, out: { type: "fade", duration: 0.4 } } } }),
    ] },
    { id: "b", name: "Inside", start: 4, end: 8, background: { type: "video", assetId: clip.id, sourceStart: 4 }, layers: [
      text("t2", "Title", "Hyaluronic acid draws water in.", { x: 6, y: 22, w: 34, h: 24 }, { style: { fontSize: 44, fontWeight: 700, lineHeight: 1.05 }, rest: { animation: { in: { type: "slide-up", duration: 0.8 }, out: { type: "fade", duration: 0.5 } } } }),
      text("t2b", "Lead", "Up to 1000× its weight in water, held against the skin.", { x: 6, y: 48, w: 32, h: 14 }, { style: { fontSize: 20, color: "#55555c" }, rest: { animation: { in: { type: "fade", duration: 0.6, delay: 0.5 }, out: { type: "fade", duration: 0.4 } } } }),
    ] },
    { id: "c", name: "Lock", start: 8, end: D, background: { type: "video", assetId: clip.id, sourceStart: 8 }, layers: [
      text("t3", "Title", "Ceramides lock it in. 24 hours.", { x: 6, y: 22, w: 34, h: 24 }, { style: { fontSize: 44, fontWeight: 700, lineHeight: 1.05 }, rest: { animation: { in: { type: "slide-up", duration: 0.8 } } } }),
      { id: "cta", type: "button", name: "Shop", frame: { x: 6, y: 46, w: 20, h: 10 }, content: { label: "Shop the set" }, style: { background: dark, color: "#fff", borderRadius: 999, fontWeight: 600, fontSize: 18 }, action: { type: "OPEN_URL", url: woo.productUrl, newTab: false }, animation: { in: { type: "fade", duration: 0.6, delay: 0.6 } } },
    ] },
  ],
};
await pageApi(owner, "PUT", `/api/v1/projects/${storyProject.id}/draft`, { config: storyConfig });
const pubHero = await pageApi(owner, "POST", `/api/v1/projects/${heroProject.id}/publish`, {});
const pubStory = await pageApi(owner, "POST", `/api/v1/projects/${storyProject.id}/publish`, {});
for (const [p, pub] of [[heroProject, pubHero], [storyProject, pubStory]]) {
  if (!pub.sites?.[0]?.ok) fail(`publish to WordPress failed: ${JSON.stringify(pub.sites)}`);
  const onSite = await (await fetch(`${WP}/wp-json/sceneflow/v1/project/${p.id}?v=${pub.publishedVersion}`)).json();
  if (onSite.version !== pub.publishedVersion || onSite.canvas?.background !== "transparent" || !onSite.poster) fail(`WordPress serves ${JSON.stringify({ version: onSite.version, canvas: onSite.canvas, poster: onSite.poster })} for ${p.name}`);
  if (!onSite.video?.sources?.some((s) => s.height === 1080)) fail("published config lacks the 1080p rendition: " + JSON.stringify(onSite.video?.sources));
}
step(`scroll story: pinned centre, 250vh travel, smoothness 0.35, 3 scenes with enter/exit motion; both projects published and pushed (hero v${pubHero.publishedVersion}, story v${pubStory.publishedVersion}); the site serves them with transparent background, custom poster and the 1080p + scrub renditions`);

/* ---------- 7. the landing page (default theme template, so the theme's smooth-scroll wrapper is in play) ---------- */
const slug = `glow-face-cream-${stamp}`;
const landing = landingHtml({ siteUrl: WP, storyProjectId: storyProject.id, productUrl: woo.productUrl, wooId });
const landingFile = join(tmp, "landing.html");
await writeFile(landingFile, landing, "utf8");
const pageId = await wp("post", "create", landingFile, "--post_type=page", "--post_status=publish", "--post_title=Glow Face Cream", `--post_name=${slug}`, "--porcelain");
const pageUrl = await wp("eval", `echo get_permalink(${pageId});`);
step(`landing page published on WordPress (default template): ${pageUrl} — hero spot for the element placement, shortcode [sceneflow id=…] in the story section, benefits, ingredients, reviews, buy, FAQ`);

/* ---------- 8. element picker UI: project page → Place on your site → pick the hero spot inside the iframe ---------- */
await owner.goto(`${WEB}/projects/${heroProject.id}`);
await owner.waitForSelector("#place");
await owner.fill("#place input[placeholder='Search pages…']", "Glow Face Cream");
// Several test pages share the title; the chips carry the URL as their tooltip (and show the path when titles repeat).
const chip = owner.locator(`#place button[title="${pageUrl}"]`);
await chip.waitFor({ timeout: 20000 });
const chipText = (await chip.textContent())?.trim();
await chip.click();
await owner.waitForSelector("#place >> text=Selected page:");
if (!(await owner.textContent("#place div.small.muted:has-text('Selected page:')")).includes(pageUrl)) fail(`the chip "${chipText}" selected another page`);
await owner.click("#place >> text=Pick element on page");
const frame = owner.frameLocator("iframe[title='Pick an element']");
await frame.locator(".gc-hero-video").waitFor({ timeout: 60000 });
await owner.waitForTimeout(1500); // theme preloader / smooth-scroll init
await frame.locator(".gc-hero-video").click({ position: { x: 40, y: 40 } });
await owner.waitForSelector(".modal >> text=Selected", { timeout: 10000 });
const pickedSel = (await owner.textContent(".modal code"))?.trim();
if (!/gc-hero-video/.test(pickedSel ?? "")) fail("picker chose another element: " + pickedSel);
await owner.selectOption(".modal select", "replace");
await owner.click(".modal >> text=Place video here");
await owner.waitForSelector(".list-item >> text=" + pickedSel, { timeout: 15000 });
const placements = await pageApi(owner, "GET", `/api/v1/projects/${heroProject.id}/placements`);
step(`element picker: searched the page, opened it inside the app, clicked the hero spot → selector "${pickedSel}" posted back, "Replace the element's content", saved → ${placements.placements.length} placement on the site`);

/* ---------- 9. a visitor on the landing page: hero + shortcode players, Apple-style look, hints, WooCommerce ---------- */
const visitorCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const visitor = await visitorCtx.newPage();
watch(visitor, "visitor");
const nav = await visitor.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
const html = await nav.text();
const hints = { fetch: (html.match(/rel="preload" as="fetch"/g) ?? []).length, image: (html.match(/rel="preload" as="image"/g) ?? []).length, preconnect: (html.match(/rel="preconnect" href="http:\/\/localhost:4800"/g) ?? []).length };
if (hints.fetch < 2 || hints.image < 2 || hints.preconnect < 1) fail("resource hints missing in the page HTML: " + JSON.stringify(hints));
await visitor.waitForFunction(() => document.querySelectorAll(".sf-player").length >= 2, null, { timeout: 60000 });
await visitor.waitForSelector(".gc-hero-video .sf-player video", { state: "attached", timeout: 30000 }); // media mounts lazily, a moment after the player
const look = await visitor.evaluate(() => {
  const hero = document.querySelector(".gc-hero-video .sf-player");
  const story = document.querySelector(".story-stage .sf-player");
  const v = hero?.querySelector("video");
  return { heroMode: hero?.dataset.sfMode, storyMode: story?.dataset.sfMode, heroBg: hero && getComputedStyle(hero).backgroundColor, storyBg: story && getComputedStyle(story).backgroundColor, playBtn: !!hero?.querySelector(".sf-play"), controls: v?.controls, poster: v?.poster ?? "", storyPin: story?.dataset.sfPin, wrapper: !!document.querySelector("#smooth-wrapper"), smoother: !!(window.ScrollSmoother || document.querySelector("#smooth-content")) };
});
if (look.heroMode !== "autoplay" || look.storyMode !== "scroll" || look.heroBg !== "rgba(0, 0, 0, 0)" || look.storyBg !== "rgba(0, 0, 0, 0)" || look.playBtn || look.controls || !/frame-\d+\.jpg/.test(look.poster)) fail("players do not look as designed: " + JSON.stringify(look));
if (look.storyPin !== "transform") fail(`expected the transform pin inside the theme's smooth-scroll wrapper, got "${look.storyPin}" (wrapper ${look.wrapper})`);
await visitor.waitForFunction(() => document.querySelector(".gc-hero-video .sf-player")?.dataset.sfState === "playing", null, { timeout: 20000 });
// Jump to the offer scene and buy from the WooCommerce card (Store API with a cart token; the response carries the cart).
await visitor.evaluate(() => { const v = document.querySelector(".gc-hero-video video"); v.currentTime = 8.6; });
await visitor.waitForSelector(".gc-hero-video .sf-product-btn", { state: "visible", timeout: 15000 });
const priceText = await visitor.textContent(".gc-hero-video .sf-product-price");
if (!/29/.test(priceText ?? "")) fail("live WooCommerce price not shown on the card: " + priceText);
const [addRes] = await Promise.all([visitor.waitForResponse((r) => /wc\/store\/v1\/cart\/add-item/.test(r.url()), { timeout: 20000 }), visitor.click(".gc-hero-video .sf-product-btn")]);
const storeCart = await addRes.json().catch(() => ({}));
const toast = await visitor.waitForSelector(".sf-toast", { timeout: 10000 }).then((t) => t.evaluate((el) => ({ kind: el.dataset.kind, text: el.textContent }))).catch(() => null);
if (!addRes.ok() || toast?.kind === "error" || !(storeCart.items_count >= 1) || !(storeCart.items ?? []).some((i) => /Glow Face Cream/.test(i.name))) fail(`WooCommerce add-to-cart: store ${addRes.status()}, toast ${JSON.stringify(toast)}, cart ${JSON.stringify({ count: storeCart.items_count, items: (storeCart.items ?? []).map((i) => i.name) })}`);
step(`visitor: page HTML carries resource hints (config preload ×${hints.fetch}, thumbnail preload ×${hints.image}, preconnect ×${hints.preconnect}); hero autoplays muted with no controls and no play button, transparent player, custom thumbnail; story player pins by ${look.storyPin} (theme uses ScrollSmoother: ${look.smoother}); card shows the live price “${priceText?.trim()}”; "Add to bag" → toast “${toast?.text}”, WooCommerce cart holds ${storeCart.items_count} × ${storeCart.items[0].name}`);

/* ---------- 10. scroll-scrub on the theme: pinned in the centre, smooth, both directions ---------- */
const anchorInfo = await visitor.evaluate(() => {
  const p = document.querySelector(".story-stage .sf-player");
  const c = p.parentElement; // .sf-scroll
  const r = c.getBoundingClientRect();
  return { docTop: r.top + window.scrollY, containerH: r.height, playerH: p.getBoundingClientRect().height, viewport: innerHeight };
});
const anchor = (anchorInfo.viewport - anchorInfo.playerH) / 2;
// Park just above the story so the first wheel ticks lead into the pin.
await visitor.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, anchorInfo.docTop - anchorInfo.viewport + 60));
await visitor.waitForTimeout(1200);
await visitor.evaluate(() => {
  window.__samples = [];
  const p = document.querySelector(".story-stage .sf-player");
  const tick = () => { const v = p.querySelector("video"); const r = p.getBoundingClientRect(); window.__samples.push({ ts: performance.now(), top: r.top, phase: p.dataset.sfPinPhase, t: v ? v.currentTime : -1, sy: scrollY }); window.__raf = requestAnimationFrame(tick); };
  tick();
});
const travelPx = anchorInfo.containerH - anchorInfo.playerH;
const ticks = Math.ceil((travelPx + anchorInfo.viewport) / 80);
for (let i = 0; i < ticks; i++) { await visitor.mouse.wheel(0, 80); await visitor.waitForTimeout(45); }
await visitor.waitForTimeout(1500);
const down = await visitor.evaluate(() => window.__samples.splice(0));
for (let i = 0; i < 14; i++) { await visitor.mouse.wheel(0, -80); await visitor.waitForTimeout(45); }
await visitor.waitForTimeout(1200);
const up = await visitor.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__samples.splice(0); });
// Pin accuracy is judged at rest: a rAF sampler can run before the engine's update in the same frame, so a moving
// page shows one frame of lag that is not a drift. Step through the travel again and read the settled position.
await visitor.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, anchorInfo.docTop - anchorInfo.viewport + 60));
await visitor.waitForTimeout(900);
const settled = [];
for (let i = 0; i < 10; i++) {
  await visitor.mouse.wheel(0, 300);
  await visitor.waitForTimeout(650);
  settled.push(await visitor.evaluate(() => { const p = document.querySelector(".story-stage .sf-player"); const v = p.querySelector("video"); return { top: p.getBoundingClientRect().top, phase: p.dataset.sfPinPhase, t: v?.currentTime ?? -1 }; }));
}
const pinned = settled.filter((s) => s.phase === "pinned");
const offPin = pinned.filter((s) => Math.abs(s.top - anchor) > 3).length;
const lag = down.filter((s) => s.phase === "pinned").map((s) => Math.abs(s.top - anchor)).sort((a, b) => a - b);
const lagP50 = lag[Math.floor(lag.length / 2)] ?? 0;
const times = down.map((s) => s.t);
let reversals = 0;
for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1] - 0.05) reversals++;
const maxT = Math.max(...times);
const moving = down.filter((s, i) => i > 0 && s.t !== down[i - 1].t);
const spanMs = down[down.length - 1].ts - down[0].ts;
const frameRate = (new Set(times.map((t) => t.toFixed(3))).size / (spanMs / 1000));
const stalls = (() => { let worst = 0, last = down[0]; for (const s of down) { if (s.t !== last.t) { worst = Math.max(worst, s.ts - last.ts); last = s; } } return Math.round(worst); })();
const upMin = Math.min(...up.map((s) => s.t));
if (pinned.length < 4) fail(`story player was pinned at only ${pinned.length} of ${settled.length} settled scroll positions`);
if (offPin > 0) fail(`pinned player sat ${offPin}× more than 3 px from its anchor (${anchor.toFixed(0)} px): ${JSON.stringify(pinned.map((s) => Math.round(s.top)))}`);
if (!pinned.every((s, i) => i === 0 || s.t >= pinned[i - 1].t)) fail("video time did not increase with the settled scroll positions: " + JSON.stringify(pinned.map((s) => s.t.toFixed(2))));
if (reversals > 0) fail(`video time ran backwards ${reversals}× while scrolling down`);
if (maxT < D * 0.9) fail(`scrolling through the travel only reached ${maxT.toFixed(2)} s of ${D.toFixed(1)} s`);
if (frameRate < 12) fail(`frame update rate ${frameRate.toFixed(1)}/s is too low for a smooth scrub`);
if (upMin > maxT - 1) fail(`scrolling back up did not rewind (min ${upMin.toFixed(2)} s after max ${maxT.toFixed(2)} s)`);
step(`scroll on the theme (ScrollSmoother page, ${look.storyPin} pin): at rest the player sits at ${pinned.map((s) => Math.round(s.top)).join("/")} px (anchor ${anchor.toFixed(0)} px, centre of the screen) across ${pinned.length} pinned positions, video ${pinned[0].t.toFixed(2)} → ${pinned[pinned.length - 1].t.toFixed(2)} s; while gliding: 0 → ${maxT.toFixed(2)} s with ${reversals} reversals, ${frameRate.toFixed(0)} distinct frames/s, longest stall ${stalls} ms, ${moving.length} frame changes, median pin lag ${lagP50.toFixed(0)} px (one frame of the theme's glide); scrolling back rewinds to ${upMin.toFixed(2)} s`);

/* ---------- 11. the same story on the plain demo page: CSS sticky pin ---------- */
const demo = await visitorCtx.newPage();
watch(demo, "demo");
await demo.goto(`${API}/demo/${storyProject.id}?v=${pubStory.publishedVersion}`);
await demo.waitForSelector(".sf-player[data-sf-mode=scroll]", { timeout: 20000 });
const demoPin = await demo.evaluate(() => document.querySelector(".sf-player").dataset.sfPin);
if (demoPin !== "sticky") fail(`demo page should pin with CSS sticky, got ${demoPin}`);
await demo.waitForFunction(() => { const v = document.querySelector(".sf-media video"); return v && v.readyState >= 2; }, null, { timeout: 30000 });
for (let i = 0; i < 12; i++) { await demo.mouse.wheel(0, 150); await demo.waitForTimeout(60); }
await demo.waitForTimeout(900);
const demoState = await demo.evaluate(() => { const p = document.querySelector(".sf-player"); const v = p.querySelector("video"); return { phase: p.dataset.sfPinPhase, top: p.getBoundingClientRect().top, t: v.currentTime, src: v.currentSrc.startsWith("blob:") ? "blob (whole scrub file)" : v.currentSrc.split("/").pop(), position: getComputedStyle(p).position }; });
if (demoState.phase !== "pinned" || demoState.position !== "sticky" || !(demoState.t > 0.5)) fail("demo page scroll state unexpected: " + JSON.stringify(demoState));
step(`demo page (no theme): sticky pin, phase ${demoState.phase} at ${demoState.top.toFixed(0)} px, video at ${demoState.t.toFixed(2)} s from ${demoState.src}`);

/* ---------- 12. analytics from the WordPress page + diagnostics for both projects ---------- */
await visitor.waitForTimeout(5500);
await demo.close();
await visitorCtx.close(); // pagehide flushes the remaining events
await sleep(1500);
const heroStats = await pageApi(owner, "GET", `/api/v1/projects/${heroProject.id}/analytics?days=1`);
const storyStats = await pageApi(owner, "GET", `/api/v1/projects/${storyProject.id}/analytics?days=1`);
if (!(heroStats.totals.loads >= 1) || !(heroStats.totals.plays >= 1) || !(heroStats.totals.addToCarts >= 1) || !(storyStats.totals.loads >= 2)) fail("analytics totals unexpected: " + JSON.stringify({ hero: heroStats.totals, story: storyStats.totals }));
const diags = {};
for (const p of [heroProject, storyProject]) {
  const d = await pageApi(owner, "GET", `/api/v1/projects/${p.id}/diagnostics`);
  diags[p.id] = Object.fromEntries(d.checks.map((c) => [c.id, c.status]));
}
const dh = diags[heroProject.id], ds = diags[storyProject.id];
if (dh.site !== "ok" || dh.onsite !== "ok" || dh.placement !== "ok" || ds.site !== "ok" || ds.onsite !== "ok") fail("diagnostics: " + JSON.stringify(diags));
step(`analytics: hero ${heroStats.totals.loads} loads / ${heroStats.totals.plays} plays / ${heroStats.totals.addToCarts} add-to-cart, story ${storyStats.totals.loads} loads (WordPress page + demo); diagnostics hero ${Object.entries(dh).map(([k, v]) => `${k}:${v}`).join(" ")}; story ${Object.entries(ds).map(([k, v]) => `${k}:${v}`).join(" ")}`);

/* ---------- done ---------- */
console.log(`
All good: ${problems.length} page errors.
  Landing page   ${pageUrl}
  Hero project   ${WEB}/projects/${heroProject.id}   (editor ${WEB}/projects/${heroProject.id}/editor)
  Story project  ${WEB}/projects/${storyProject.id}   (editor ${WEB}/projects/${storyProject.id}/editor)
  Demo (story)   ${API}/demo/${storyProject.id}?v=${pubStory.publishedVersion}
  Login          ${WEB}/login → ${email} / ${PASSWORD}
  Clip           ${clipPath}
`);
if (problems.length) { console.error("page errors:\n  " + problems.join("\n  ")); process.exitCode = 1; }
await mkdir(resolve(ROOT, "dist/e2e"), { recursive: true });
await writeFile(resolve(ROOT, "dist/e2e/wp-landing-last.json"), JSON.stringify({ pageUrl, heroProject: heroProject.id, storyProject: storyProject.id, email, stamp }, null, 2));

if (KEEP_OPEN) {
  const show = await ownerCtx.newPage();
  await show.goto(pageUrl).catch(() => {});
  const ed = await ownerCtx.newPage();
  await ed.goto(`${WEB}/projects/${storyProject.id}/editor`).catch(() => {});
  await owner.goto(`${WEB}/projects/${heroProject.id}`).catch(() => {});
  await show.bringToFront();
  console.log("Browser left open (landing page, hero project, story editor). Close the Chrome window to end this script.");
  await new Promise((r) => browser.on("disconnected", r));
} else {
  await browser.close();
}
