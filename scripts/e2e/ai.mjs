// Phase 9 end-to-end in a real Chrome against the RUNNING stack (API 4800, web 3000, worker), driven through
// the UI the way a user does it: sign up → pick a goal → ✨ AI → write script → build scenes → voiceover for
// every scene (server's built-in voice) → captions → publish → the published player shows captions in time
// and carries the voiceover audio.
//   node scripts/e2e/ai.mjs              (add --headed to watch, --record to save a walkthrough video)
import { execFile } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const RECORD = process.argv.includes("--record");
const step = (m) => console.log("✓ " + m);
const fail = (m) => { console.error("✗ " + m); process.exit(1); };
const problems = [];
process.on("uncaughtException", (e) => { console.error("✗ " + String(e.message ?? e).split("\n")[0]); if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  ")); process.exit(1); });
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }

const videoDir = resolve("dist/walkthrough");
if (RECORD) { await rm(videoDir, { recursive: true, force: true }); await mkdir(videoDir, { recursive: true }); }
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(RECORD ? { recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } } : {}) });
const page = await context.newPage();
page.on("pageerror", (e) => problems.push(`[${page.url()}] uncaught: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_|Failed to load resource/.test(m.text())) problems.push(`[${page.url()}] console: ${m.text().slice(0, 200)}`); });
page.on("dialog", (d) => void d.accept());
const check = (what) => { if (problems.length) fail(`${what}\n  ` + problems.join("\n  ")); step(what); };
const pause = (ms) => page.waitForTimeout(RECORD ? ms : Math.min(ms, 150)); // slower when recording so a viewer can follow

// Sign up and start from the goal picker.
await page.goto(`${WEB}/login`);
await page.click("text=Create account");
await page.fill("input[autocomplete=name]", "AI Walkthrough");
await page.fill("input[type=email]", `ai-${Date.now()}@sceneflow.test`);
await page.fill("input[type=password]", "ai-pass-12345");
await pause(600);
await page.click("button[type=submit]");
await page.waitForURL(`${WEB}/projects`);
await page.waitForSelector(".goal-card");
await pause(1200);
await page.click(".goal-card >> nth=0");
await page.waitForURL(/\/projects\/[0-9a-f-]+\/editor\?tour=1$/, { timeout: 20000 });
const projectId = page.url().match(/projects\/([0-9a-f-]+)\//)[1];
await page.waitForSelector(".ed-canvas", { timeout: 20000 });
await page.waitForSelector(".tour-card", { timeout: 5000 });
await page.click(".tour-card >> text=Skip tour");
check("signed up → goal picker → editor");

// ✨ AI → script.
await page.click("[data-testid=ai-open]");
await page.waitForSelector("[data-testid=ai-panel]");
await page.fill("[data-testid=ai-brief]", "Our new ceramic pour-over coffee set for home baristas. Warm and premium, show the morning ritual, end with a 10% launch offer.");
await pause(900);
await page.click("[data-testid=ai-write]");
await page.waitForSelector("[data-testid=ai-script]", { timeout: 60000 });
const sceneCards = await page.locator("[data-testid=ai-script] .ai-scene").count();
if (sceneCards < 2) fail("script has fewer than 2 scenes");
await pause(1800);
await page.click("[data-testid=ai-build]");
await page.waitForFunction((n) => document.querySelectorAll(".ed-scene").length === n, sceneCards, { timeout: 10000 });
check(`script written (${sceneCards} scenes) and built into the project`);

// Voiceover (optional, behind the "🎙 Voice" link) for every scene with the server's voice; the worker turns each one into an m4a.
await page.click("[data-testid=ai-voice-open]");
await page.waitForSelector("[data-testid=ai-voice-all]", { timeout: 10000 });
const voiceOptions = await page.locator("[data-testid=ai-voice] option").count();
if (voiceOptions < 1) fail("no voice offered");
await pause(800);
await page.click("[data-testid=ai-voice-all]");
await page.waitForFunction((n) => document.querySelectorAll("[data-testid=ai-panel] .ai-scene").length === n && [...document.querySelectorAll("[data-testid=ai-panel] .ai-scene")].every((el) => el.textContent.includes("✓")), sceneCards, { timeout: 180000 });
check(`voiceover generated for ${sceneCards} scenes (voice options: ${voiceOptions})`);

// Captions were created from the lines; look at them.
await page.click("[data-testid=ai-panel] [role=tab]:has-text('Captions')");
await page.waitForSelector("[data-testid=ai-cues] .ai-cue", { timeout: 5000 });
const cueCount = await page.locator("[data-testid=ai-cues] .ai-cue").count();
await pause(1500);
await page.keyboard.press("Escape");
await page.waitForSelector("[data-testid=ai-panel]", { state: "detached" });
if (!(await page.$(".ed-caption"))) fail("caption preview missing on the canvas");
check(`${cueCount} caption cues, preview visible on the canvas`);

// Publish and watch the real player.
await page.waitForFunction(() => document.querySelector(".ed-save")?.textContent?.startsWith("Saved"), null, { timeout: 15000 });
await page.click("[data-tour=publish]");
await page.waitForSelector(".ed-notice:has-text('Published')", { timeout: 20000 });
check("published");

const live = await (await fetch(`${API}/p/${projectId}.json`)).json();
const voLayers = live.scenes.flatMap((s) => s.layers.filter((l) => l.type === "audio" && l.content?.voiceover === true));
if (voLayers.length !== sceneCards) fail(`published config has ${voLayers.length} voiceover layers, expected ${sceneCards}`);
if (!live.captions?.cues?.length) fail("published config has no captions");
if (live.scenes.some((s) => s.script)) fail("storyboard notes leaked into the published config");
for (const l of voLayers) { const r = await fetch(l.src, { method: "HEAD" }); if (!r.ok) fail(`voiceover audio not reachable: ${l.src} (${r.status})`); }
step(`published config: ${voLayers.length} voiceover tracks reachable, ${live.captions.cues.length} cues, no editor notes`);

console.log("  project", projectId);
await page.goto(`${API}/demo/${projectId}`);
await page.waitForSelector("[data-sceneflow=ready] .sceneflow-play", { timeout: 20000 });
if (!(await page.$(".sceneflow-captions"))) fail("runtime did not mount the caption bar");
if (!(await page.$(".sceneflow-cc"))) fail("runtime did not mount the CC button");
/** Clicks with a diagnosis of what covers the element when the click cannot land. */
async function clickOrExplain(selector) {
  try {
    await page.click(selector, { timeout: 10000 });
  } catch (e) {
    const info = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return "element missing";
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return `rect ${JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })} display=${getComputedStyle(el).display} covered by <${top?.tagName.toLowerCase()} class="${top?.className}">`;
    }, selector);
    fail(`click ${selector} failed: ${String(e.message).split("\n")[0]} — ${info}`);
  }
}
await clickOrExplain(".sceneflow-play");
await page.waitForFunction(() => (document.querySelector(".sceneflow-captions")?.textContent ?? "").length > 0, null, { timeout: 8000 });
const firstCue = await page.textContent(".sceneflow-captions");
const audioPlaying = await page.evaluate(() => new Promise((res) => setTimeout(() => res(performance.getEntriesByType("resource").some((e) => /audio\.m4a/.test(e.name))), 1500)));
if (!audioPlaying) fail("the player did not fetch any voiceover audio");
await clickOrExplain(".sceneflow-cc");
await page.waitForFunction(() => document.querySelector(".sceneflow-root")?.dataset.sceneflowCc === "off");
const hidden = await page.evaluate(() => getComputedStyle(document.querySelector(".sceneflow-captions")).display === "none");
if (!hidden) fail("CC button did not hide the captions");
await clickOrExplain(".sceneflow-cc");
await pause(2500);
check(`published player: captions show (“${firstCue}”), voiceover audio loads, CC toggles`);

await page.close();
await context.close();
await browser.close();

if (RECORD) {
  const [video] = (await import("node:fs")).readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
  const webm = resolve(videoDir, video);
  const out = resolve(videoDir, "sceneflow-walkthrough.mp4");
  try {
    const ffmpeg = createRequire(resolve(import.meta.dirname, "../../apps/worker/package.json"))("@ffmpeg-installer/ffmpeg").path;
    await promisify(execFile)(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
    await rm(webm);
    step(`walkthrough video: ${out}`);
  } catch {
    const kept = resolve(videoDir, "sceneflow-walkthrough.webm");
    await rename(webm, kept);
    step(`walkthrough video: ${kept}`);
  }
}
console.log(`\nAll good. Project ${projectId} · editor ${WEB}/projects/${projectId}/editor · live ${API}/demo/${projectId}`);
