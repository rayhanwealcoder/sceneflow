// Phase 10 (Agency) end to end in a real Chrome against the RUNNING stack, the way an agency uses it:
//   owner signs up → Team & clients: adds a client, creates an invite link → project for that client with a draft
//   → Review & approval: requires approval, "Send to client" → the CLIENT (fresh browser, no account) opens the
//   review link, pins a note on the video, approves → owner sees "Approved by …", publishes → dashboard shows it
//   → a colleague joins through the invite link, opens the editor, comments with an @mention, pins it on the canvas
//   → owner's dashboard lists the mention; editor-role publish is blocked without approval (API check).
//   node scripts/e2e/agency.mjs      (add --headed to watch)
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const step = (m) => console.log("✓ " + m);
const fail = (m) => { console.error("✗ " + m); process.exit(1); };
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const problems = [];
function watch(page, who) {
  page.on("pageerror", (e) => problems.push(`[${who} ${page.url()}] uncaught: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_|Failed to load resource/.test(m.text())) problems.push(`[${who} ${page.url()}] console: ${m.text().slice(0, 200)}`); });
}
const check = (what) => { if (problems.length) fail(`${what}\n  ` + problems.join("\n  ")); step(what); };
process.on("uncaughtException", (e) => { console.error("✗ " + String(e.message ?? e).split("\n")[0]); if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  ")); process.exit(1); });
const stamp = Date.now();

async function signUp(page, name, email) {
  await page.goto(`${WEB}/login`);
  await page.click("text=Create account");
  await page.fill("input[autocomplete=name]", name);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", "agency-pass-123");
  await page.click("button[type=submit]");
}

/* ---------- owner ---------- */
const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const owner = await ownerCtx.newPage();
watch(owner, "owner");
await signUp(owner, "Olivia Owner", `agency-owner-${stamp}@sceneflow.test`);
await owner.waitForURL(`${WEB}/projects`);
await owner.waitForSelector(".goal-card");
check("owner signed up");

// Team & clients: add a client, create an invite link.
await owner.click("nav >> text=Team & clients");
await owner.waitForURL(`${WEB}/team`);
await owner.fill("[data-testid=client-name]", "Acme Coffee");
await owner.click("[data-testid=client-add]");
await owner.waitForSelector("[data-testid=clients] >> text=Acme Coffee");
await owner.click("[data-testid=create-invite]");
const inviteUrl = (await owner.textContent("[data-testid=invite-url]")).trim();
if (!/\/join\/[0-9a-f]{64}$/.test(inviteUrl)) fail(`unexpected invite url ${inviteUrl}`);
check("team page: client added, invite link created");

// Project for the client: pick the client chip, then a goal card (first project of a new workspace) — the video is filed under the client.
await owner.click("nav >> text=Projects");
await owner.waitForURL(`${WEB}/projects`);
await owner.waitForSelector(".goal-card");
await owner.click(".chip >> text=Acme Coffee");
await owner.click(".goal-card >> nth=0");
await owner.waitForURL(/\/projects\/[0-9a-f-]+\/editor\?tour=1$/, { timeout: 20000 });
const projectId = owner.url().match(/projects\/([0-9a-f-]+)\//)[1];
await owner.waitForSelector(".ed-canvas", { timeout: 20000 });
// Rename it and replace the template draft with a small known one (through the API, for speed).
await owner.evaluate(async ({ id }) => { await fetch(`http://localhost:4800/api/v1/projects/${id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Acme spring launch" }) }); }, { id: projectId });
const draft = { playback: { mode: "click" }, scenes: [{ id: "s1", name: "Intro", start: 0, end: 6, background: { type: "gradient", css: "linear-gradient(135deg,#1e3a8a,#9333ea)" }, layers: [{ id: "h", type: "text", name: "Headline", frame: { x: 8, y: 12, w: 60, h: 14 }, content: { text: "Spring blends are here" }, style: { color: "#fff", fontSize: 44, fontWeight: 800 } }, { id: "cta", type: "button", name: "Shop", frame: { x: 8, y: 70, w: 26, h: 10 }, content: { label: "Shop the set" }, style: { background: "#fff", color: "#1e3a8a", borderRadius: 10, fontWeight: 700 }, action: { type: "OPEN_URL", url: "https://example.com/shop", newTab: true } }] }] };
const saved = await owner.evaluate(async ({ id, config }) => { const r = await fetch(`http://localhost:4800/api/v1/projects/${id}/draft`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ config }) }); return r.status; }, { id: projectId, config: draft });
if (saved !== 200) fail(`draft save ${saved}`);
await owner.goto(`${WEB}/projects/${projectId}`);
await owner.waitForSelector("[data-testid=project-client]");
if ((await owner.inputValue("[data-testid=project-client]")) === "") fail("project not filed under the client");
await owner.waitForSelector("h1:has-text('Acme spring launch')");
check("project created for the client (goal card), draft saved");

// Review & approval: require approval (the owner can still publish — admins always can; editors are gated, checked below), send to client.
await owner.click("text=Require approval before publishing");
await owner.waitForSelector("#review input[type=checkbox]:checked", { timeout: 10000 });
await owner.click("[data-testid=send-to-client]");
await owner.waitForSelector("[data-testid=review-url]");
const reviewUrl = (await owner.textContent("[data-testid=review-url]")).trim();
if (!/\/review\/[0-9a-f]{64}$/.test(reviewUrl)) fail(`unexpected review url ${reviewUrl}`);
await owner.waitForSelector("text=Waiting for the client");
check("approval required → client review link created");

/* ---------- client (no account, fresh browser) ---------- */
const clientCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const client = await clientCtx.newPage();
watch(client, "client");
await client.goto(reviewUrl);
await client.waitForSelector("[data-testid=review-page]");
try {
  await client.waitForSelector(".sceneflow-root", { timeout: 30000 });
} catch {
  const text = await client.evaluate(() => document.body.innerText.slice(0, 1200));
  const stage = await client.$eval(".rv-stage", (e) => e.innerHTML.slice(0, 400)).catch(() => "(no .rv-stage)");
  fail(`client page: player did not mount.\n--- page text ---\n${text}\n--- stage ---\n${stage}`);
}
await client.fill("[data-testid=reviewer-name]", "Chris (Acme)");
await client.click("[data-testid=note-mode]");
const overlay = await client.$("[data-testid=review-overlay]");
const box = await overlay.boundingBox();
await client.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.75);
await client.waitForSelector("[data-testid=review-note]");
await client.fill("[data-testid=review-note]", "Can the button be green like our logo?");
await client.click("[data-testid=review-note-post]");
await client.waitForSelector("[data-testid=review-comments] >> text=Can the button be green");
await client.waitForSelector(".rv-overlay .cm-pin");
check("client: opened the link without an account, pinned a note on the video");

await client.click("[data-testid=review-approve]");
await client.fill("[data-testid=decision-note]", "Love it otherwise.");
await client.click("[data-testid=decision-confirm]");
await client.waitForSelector("text=/approval has been recorded/");
await client.waitForSelector("[data-testid=review-status]:has-text('Approved by Chris')");
check("client: approved");

/* ---------- owner publishes, dashboard ---------- */
await owner.reload();
await owner.waitForSelector("text=/Approved by Chris/");
await owner.waitForSelector("[data-testid=publish]:not(:disabled)");
await owner.click("[data-testid=publish]");
await owner.waitForSelector("text=/Published v1/", { timeout: 15000 });
check("owner: sees the approval, publishes");

await owner.click("nav >> text=Dashboard");
await owner.waitForURL(`${WEB}/dashboard`);
await owner.waitForSelector("[data-testid=dash-totals]");
await owner.waitForSelector("[data-testid=dash-group] >> text=Acme Coffee");
await owner.waitForSelector("[data-testid=dash-group] >> text=Acme spring launch");
await owner.waitForSelector("[data-testid=dash-activity] >> text=/Chris \\(Acme\\) approved/");
check("dashboard: client group, project, activity feed");

/* ---------- colleague joins through the invite ---------- */
const edCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ed = await edCtx.newPage();
watch(ed, "editor");
await ed.goto(inviteUrl);
await ed.waitForSelector("[data-testid=join-card]");
await ed.waitForSelector("text=/invited you to join/");
await ed.click("text=Create a free account");
await ed.waitForURL(/\/login\?/);
await ed.fill("input[autocomplete=name]", "Ed Editor");
await ed.fill("input[type=email]", `agency-editor-${stamp}@sceneflow.test`);
await ed.fill("input[type=password]", "agency-pass-123");
await ed.click("button[type=submit]");
await ed.waitForURL(/\/join\//);
await ed.click("[data-testid=accept-invite]");
await ed.waitForURL(`${WEB}/projects`);
await ed.waitForSelector("header select"); // workspace switcher: own + Olivia's
await ed.waitForSelector(".list-item >> text=Acme spring launch", { timeout: 10000 });
check("colleague: invite → sign up → joined, sees the shared workspace");

// Editor: comments panel, @mention, pin on canvas.
await ed.goto(`${WEB}/projects/${projectId}/editor?comments=1`);
await ed.waitForSelector(".ed-canvas", { timeout: 20000 });
await ed.waitForSelector("[data-testid=comments-panel]");
await ed.waitForSelector("[data-testid=comment] >> text=Can the button be green"); // client's note is here too
if (await ed.$(".tour-card")) await ed.click(".tour-card >> text=Skip tour");
await ed.click("[data-testid=pin-on-canvas]");
const stage = await ed.$(".ed-stage-wrap");
const sb = await stage.boundingBox();
await ed.mouse.click(sb.x + sb.width * 0.5, sb.y + sb.height * 0.3);
await ed.waitForSelector(".cm-pin.draft");
await ed.fill("[data-testid=comment-body]", "@Olivia green button done — can you approve again?");
await ed.click("[data-testid=comment-post]");
await ed.waitForSelector("[data-testid=comment] >> text=green button done");
await ed.waitForSelector("[data-testid=comment-pin]");
const mentionHighlighted = await ed.$("[data-testid=comment] .mention");
if (!mentionHighlighted) fail("mention not highlighted");
// Resolve the client's note.
// Open list: the client's pinned note, the client's approval note ("Love it otherwise.") and Ed's comment. Resolving one leaves two.
const openBefore = await ed.$$eval("[data-testid=comment]", (els) => els.length);
if (openBefore !== 3) fail(`expected 3 open comments, found ${openBefore}`);
const clientNote = ed.locator("[data-testid=comment]", { hasText: "Can the button be green" });
const [patched] = await Promise.all([ed.waitForResponse((r) => r.url().includes("/comments/") && r.request().method() === "PATCH"), clientNote.locator("[data-testid=comment-resolve]").click()]);
if (patched.status() !== 200) fail(`resolve → ${patched.status()} ${await patched.text()}`);
await ed.waitForFunction((n) => document.querySelectorAll("[data-testid=comment]").length === n - 1, openBefore, { timeout: 10000 });
await ed.click("text=Resolved (1)");
await ed.waitForSelector("[data-testid=comment].resolved >> text=Can the button be green");
await ed.click("text=Open (2)");
check("colleague: comments panel shows the client's note, pinned a comment with an @mention, resolved one");

// Editor-role publish is blocked while approval is required and the draft changed (API-level, same cookie).
await ed.evaluate(async ({ id }) => { await fetch(`http://localhost:4800/api/v1/projects/${id}/draft`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: { scenes: [{ id: "s1", name: "Intro", start: 0, end: 6, background: { type: "color", color: "#0a0" } }] } }) }); }, { id: projectId });
const blocked = await ed.evaluate(async ({ id }) => { const r = await fetch(`http://localhost:4800/api/v1/projects/${id}/publish`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" }); return { status: r.status, body: await r.json() }; }, { id: projectId });
if (blocked.status !== 409 || blocked.body.error !== "APPROVAL_REQUIRED") fail(`editor publish should be blocked, got ${blocked.status} ${JSON.stringify(blocked.body)}`);
check("colleague (editor role): publish blocked after edits — 409 APPROVAL_REQUIRED");

// Owner's dashboard: the mention shows up.
await owner.reload();
await owner.waitForSelector("[data-testid=dash-mentions] >> text=green button done");
check("owner dashboard: mention of you listed");

await browser.close();
console.log(`\nAll good: ${problems.length} page errors. Project ${projectId}`);
