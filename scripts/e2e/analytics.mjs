// Phase 8 end-to-end against the RUNNING stack: publish a project, open the demo page in a real Chrome, play /
// click / finish, and check that the Analytics summary reflects what the visitor did.
//   node scripts/e2e/analytics.mjs      (add --headed to watch)
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
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
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }

const reg = await api("POST", "/api/v1/auth/register", { email: `analytics-${Date.now()}@sceneflow.test`, password: "analytics-pass-1", name: "Analytics Tester" });
const workspaceId = reg.workspaceId;
const { project } = await api("POST", "/api/v1/projects", { workspaceId, name: "Analytics e2e" });
// Two short scenes (colour backgrounds, 2 s each) so a headless browser finishes the video quickly.
const config = {
  playback: { mode: "click" },
  scenes: [
    { id: "a", name: "Intro", start: 0, end: 6, background: { type: "gradient", css: "linear-gradient(135deg,#0f172a,#4f46e5)" }, layers: [
      { id: "hl", type: "text", frame: { x: 6, y: 10, w: 60, h: 16 }, content: { text: "Analytics demo" }, style: { color: "#fff", fontSize: 44, fontWeight: 800 } },
      { id: "cta", name: "Shop now", type: "button", frame: { x: 6, y: 70, w: 26, h: 12 }, content: { label: "Shop now" }, style: { background: "#facc15", color: "#111", fontSize: 18, fontWeight: 700, borderRadius: 10 }, action: { type: "ADD_TO_CART", product: { provider: "manual", productId: "demo-1", title: "Demo lamp", price: "$10.00", priceAmount: 10, url: "https://example.com/lamp" }, quantity: 1 } },
      { id: "hs", name: "Tip", type: "hotspot", frame: { x: 70, y: 40, w: 4, h: 7 }, content: { tooltip: "A hotspot" }, action: { type: "GO_TO_SCENE", sceneId: "b" } },
    ] },
    { id: "b", name: "Outro", start: 6, end: 8, background: { type: "color", color: "#111827" }, layers: [{ id: "end", type: "text", frame: { x: 10, y: 30, w: 80, h: 20 }, content: { text: "Thanks" }, style: { color: "#fff", fontSize: 40, fontWeight: 700, textAlign: "center" } }] },
  ],
};
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
const pub = await api("POST", `/api/v1/projects/${project.id}/publish`, {});
const live = await (await fetch(`${API}/p/${project.id}.json`)).json();
if (live.analytics?.endpoint !== `${API}/api/v1/analytics/events`) fail("published config lacks the analytics endpoint: " + JSON.stringify(live.analytics));
step(`published v${pub.publishedVersion}; config points analytics at ${live.analytics.endpoint}`);

const before = await api("GET", `/api/v1/projects/${project.id}/analytics?days=7`);
if (before.totals.loads !== 0) fail("fresh project should have no events");

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const posted = [];
page.on("request", (r) => { if (r.url().endsWith("/api/v1/analytics/events") && r.method() === "POST") posted.push(JSON.parse(r.postData())); });
await page.goto(`${API}/demo/${project.id}`);
await page.waitForSelector("[data-sceneflow=ready] .sceneflow-play", { timeout: 20000 });
// A stand-in cart adapter (like the WooCommerce / Shopify ones) so "Add to cart" stays on the page instead of opening the product link.
await page.evaluate(() => window.SceneFlow.commerce.register({ id: "manual", addToCart: async () => ({ ok: true, message: "Added (test adapter)" }) }, { default: true }));
await page.click(".sceneflow-play");                                  // video_play, watch…
await page.waitForTimeout(700);
await page.click("[data-sceneflow-layer=cta]");                       // element_click + add_to_cart
await page.waitForTimeout(400);
await page.click("[data-sceneflow-layer=hs]");                        // hotspot_click → GO_TO_SCENE b (scene_exit/enter)
await page.waitForFunction(() => document.querySelector(".sceneflow-root")?.dataset.sceneflowState === "ended", null, { timeout: 15000 }); // video_complete
await page.waitForTimeout(4600);                                // > flush interval (4 s): the batch leaves as a normal fetch we can observe
await page.close();                                             // pagehide → sendBeacon flushes the rest (not visible to the request listener)
await browser.close();
const types = posted.flatMap((b) => b.events.map((e) => e.type));
step(`browser session sent ${posted.length} batch(es), ${types.length} events: ${[...new Set(types)].join(", ")}`);
for (const t of ["player_loaded", "scene_enter", "video_play", "element_click", "add_to_cart", "hotspot_click", "scene_exit", "video_complete", "watch"]) if (!types.includes(t)) fail("missing event " + t);
if (!posted.every((b) => b.sessionId === posted[0].sessionId)) fail("session id changed within one tab");

await new Promise((r) => setTimeout(r, 800));
const s = await api("GET", `/api/v1/projects/${project.id}/analytics?days=7`);
const t = s.totals;
if (t.loads !== 1 || t.plays !== 1 || t.completes !== 1 || t.clicks !== 2 || t.addToCarts !== 1) fail("summary totals unexpected: " + JSON.stringify(t));
if (t.completionRate !== 100 || t.playRate !== 100) fail("rates unexpected: " + JSON.stringify(t));
if (!s.timeline.values.some((v) => v > 0)) fail("engagement timeline is empty");
if (s.scenes.map((x) => `${x.name}:${x.sessions}`).join(",") !== "Intro:1,Outro:1") fail("scene stats unexpected: " + JSON.stringify(s.scenes));
const cta = s.elements.find((e) => e.layerId === "cta");
if (!cta || cta.clicks !== 1 || cta.impressions !== 1 || cta.name !== "Shop now") fail("element stats unexpected: " + JSON.stringify(s.elements));
if (s.products[0]?.title !== "Demo lamp" || s.products[0]?.addToCarts !== 1) fail("product stats unexpected: " + JSON.stringify(s.products));
if (s.devices.desktop !== 1) fail("device split unexpected: " + JSON.stringify(s.devices));
step(`summary: ${t.loads} load, ${t.plays} play, ${t.completes} complete, ${t.clicks} clicks, ${t.addToCarts} add-to-cart, avg watch ${t.avgWatchSeconds}s, timeline ${s.timeline.values.filter((v) => v > 0).length}/${s.timeline.buckets} buckets watched`);

// Do Not Track visitors are never counted.
const dntBrowser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const ctx = await dntBrowser.newContext({ extraHTTPHeaders: { DNT: "1" } });
const p2 = await ctx.newPage();
await p2.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" }));
let dntPosts = 0;
p2.on("request", (r) => { if (r.url().endsWith("/api/v1/analytics/events")) dntPosts++; });
await p2.goto(`${API}/demo/${project.id}`);
await p2.waitForSelector("[data-sceneflow=ready]");
await p2.waitForTimeout(1500);
await p2.close();
await dntBrowser.close();
if (dntPosts !== 0) fail("Do Not Track visitor still sent analytics");
step("Do Not Track visitor sent nothing");

const dash = await fetch(`${WEB}/projects/${project.id}/analytics`);
if (!dash.ok) fail("analytics page -> " + dash.status);
step("analytics page responds");
console.log(`\nAll good. Dashboard: ${WEB}/projects/${project.id}/analytics`);
