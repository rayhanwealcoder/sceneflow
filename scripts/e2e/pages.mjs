// Every web page, walked in a real Chrome against the RUNNING stack, the way a new user does it:
// sign up → goal picker → editor (client-side navigation + tour) → edit a bit → project page → analytics
// → preview → connect → sign out. Fails on any uncaught exception or console error on any page.
//   node scripts/e2e/pages.mjs      (add --headed to watch)
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const step = (m) => console.log("✓ " + m);
const fail = (m) => { console.error("✗ " + m); process.exit(1); };
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`[${page.url()}] uncaught: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_|Failed to load resource/.test(m.text())) problems.push(`[${page.url()}] console: ${m.text().slice(0, 200)}`); });
const check = (what) => { if (problems.length) fail(`${what}\n  ` + problems.join("\n  ")); step(what); };
process.on("uncaughtException", (e) => { console.error("✗ " + String(e.message ?? e).split("\n")[0]); if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  ")); process.exit(1); });
const email = `pages-${Date.now()}@sceneflow.test`;

// Sign up through the real form.
await page.goto(`${WEB}/login`);
await page.click("text=Create account");
await page.fill("input[autocomplete=name]", "Pages Tester");
await page.fill("input[type=email]", email);
await page.fill("input[type=password]", "pages-pass-123");
await page.click("button[type=submit]");
await page.waitForURL(`${WEB}/projects`);
await page.waitForSelector(".goal-card");
check("login → sign up → /projects (first-time welcome + goal picker)");

// Goal picker → editor via client-side navigation with the tour (this is where React #185 used to hit).
await page.click(".goal-card >> nth=0");
await page.waitForURL(/\/projects\/[0-9a-f-]+\/editor\?tour=1$/, { timeout: 20000 });
const projectId = page.url().match(/projects\/([0-9a-f-]+)\//)[1];
await page.waitForSelector(".ed-canvas", { timeout: 20000 });
await page.waitForSelector(".tour-card", { timeout: 5000 });
let guard = 0;
while (await page.$(".tour-card") && guard++ < 12) {
  const btn = page.locator(".tour-card button.primary");
  const label = await btn.textContent();
  await btn.click();
  await page.waitForTimeout(150);
  if (label?.trim() === "Done") break;
}
if (await page.$(".tour-card")) fail("tour did not finish");
check(`goal picker → editor ?tour=1 → tour completed (${guard} steps)`);

// Use the editor a little: add elements, select, undo, switch mode/device, save a preset dialog open/close.
await page.click(".ed-el >> nth=0"); // text
await page.click(".ed-el >> nth=2"); // button
await page.waitForSelector(".ed-side.right input"); // layer inspector showed up
await page.keyboard.press("Escape");
await page.click(".ed-canvas", { position: { x: 10, y: 10 } });
await page.keyboard.press("Control+z");
await page.click("text=Advanced");
await page.waitForSelector(".ed-center .tl", { timeout: 5000 });
await page.click(".ed-devices button >> nth=2"); // mobile
await page.click(".ed-devices button >> nth=0"); // desktop
await page.click("text=Simple");
await page.click("text=Scenes"); // presets tab
await page.click("text=Motion");
await page.click("text=Elements");
await page.waitForFunction(() => document.querySelector(".ed-save")?.textContent?.startsWith("Saved"), null, { timeout: 10000 });
check("editor: add elements, select/deselect, undo, Advanced/Simple, devices, preset tabs, autosave");

// Tour again from the top bar, then skip it.
await page.click("text=Tour");
await page.waitForSelector(".tour-card");
await page.click(".tour-card >> text=Skip tour");
check("editor: Tour button → Skip");

// Back to the project page (client-side Link), then analytics, preview, connect, home.
await page.click(".ed-top a[title='Back to project']");
await page.waitForURL(`${WEB}/projects/${projectId}`);
await page.waitForSelector("text=Open editor");
await page.waitForSelector("[data-testid=export-card] [data-testid=export-start]");
check("editor → project page (with the MP4 export card)");

await page.click("text=Analytics");
await page.waitForURL(`${WEB}/projects/${projectId}/analytics`);
await page.waitForSelector("h1:has-text('Analytics')");
await page.waitForSelector(".stat-grid", { timeout: 10000 });
check("project → analytics (no data yet)");

await page.goto(`${WEB}/projects/${projectId}/preview`);
await page.waitForSelector("text=Back to editor");
await page.waitForSelector("[data-sceneflow=ready], .sf-player", { timeout: 15000 });
check("preview page renders the player");

await page.goto(`${WEB}/projects/${projectId}/editor`);
await page.waitForSelector(".ed-canvas", { timeout: 20000 });
if (await page.$(".tour-card")) fail("tour reappeared although it was completed");
check("editor direct load: no tour after completion");

await page.goto(`${WEB}/projects`);
await page.waitForSelector(".list-item");
await page.click(".list-item >> nth=0");
await page.waitForURL(`${WEB}/projects/${projectId}`);
check("projects list → project (client-side)");

await page.goto(`${WEB}/dashboard`);
await page.waitForSelector("[data-testid=dash-totals]", { timeout: 10000 });
await page.waitForSelector("[data-testid=dash-group], [data-testid=dash-empty]");
check("dashboard");

await page.goto(`${WEB}/team`);
await page.waitForSelector("[data-testid=members]", { timeout: 10000 });
await page.waitForSelector("[data-testid=create-invite]");
check("team & clients");

await page.goto(`${WEB}/review/${"0".repeat(64)}`);
await page.waitForSelector("[data-testid=review-error]");
await page.goto(`${WEB}/join/${"0".repeat(64)}`);
await page.waitForSelector("[data-testid=join-card] .alert.error");
check("review / join pages with an invalid link explain themselves");

await page.goto(`${WEB}/connect?site=${encodeURIComponent("https://example.test")}&code=ABCD1234&name=Example`);
await page.waitForSelector("text=/connect|Connect/i");
check("connect page");

await page.goto(`${WEB}/`);
await page.waitForLoadState("networkidle");
check("home");

await page.click("text=Sign out");
await page.waitForURL(`${WEB}/login`);
check("sign out → login");

// Unauthenticated visit of a protected page bounces to login.
await page.goto(`${WEB}/projects/${projectId}/editor`);
await page.waitForURL(/\/login/);
check("signed-out editor visit → login");

await browser.close();
console.log(`\nAll good: ${problems.length} page errors. Project ${projectId} (${email})`);
