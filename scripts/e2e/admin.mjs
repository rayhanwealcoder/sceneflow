// Super admin console in a real Chrome against the RUNNING stack (api 4800, web 3000, worker):
// an admin account is granted through the server CLI (`pnpm admin grant`), then works the console the way an
// operator does it: overview -> find an account -> disable it (the user's other browser is thrown out and cannot
// sign in) -> enable -> make super admin and back -> workspace plan change -> System (worker online, queues,
// services) -> audit log. A normal account sees "Page not found" and the API answers 404. At the end the test
// admin's role is revoked through the CLI again (accounts are kept).
//   node scripts/e2e/admin.mjs [--headed]
import { exec as execCb, execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const ROOT = resolve(import.meta.dirname, "../..");
const exec = promisify(execCb); // args are fixed words and generated test e-mails, never user input
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const step = (m) => console.log(`✓ ${++n}. ${m}`);
const note = (m) => console.log(`  · ${m}`);
const problems = [];
let grantedAdmin = null; // revoked again even when the run fails half-way
const fail = (m) => {
  console.error(`✗ ${m}`);
  if (grantedAdmin) {
    try {
      execSync(`pnpm -s admin revoke ${grantedAdmin}`, { cwd: ROOT, stdio: "ignore" });
      console.error(`  (revoked the test super admin ${grantedAdmin})`);
    } catch {
      console.error(`  run "pnpm admin revoke ${grantedAdmin}" by hand`);
    }
  }
  if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  "));
  process.exit(1);
};
process.on("uncaughtException", (e) => fail(String(e.stack ?? e).split("\n").slice(0, 3).join(" | ")));
process.on("unhandledRejection", (e) => fail(String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")));
function watch(page, who) {
  page.on("pageerror", (e) => problems.push(`[${who} ${page.url()}] uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|net::ERR_|Failed to load resource/.test(m.text())) problems.push(`[${who} ${page.url()}] console: ${m.text().slice(0, 200)}`);
  });
  page.on("dialog", (d) => void d.accept()); // the console confirms every action
}
const check = (what) => {
  if (problems.length) fail(`${what}\n  ` + problems.join("\n  "));
  step(what);
};
/** `pnpm admin <args>` from the repo root, like an operator on the server. */
async function cli(...args) {
  const { stdout } = await exec(`pnpm -s admin ${args.join(" ")}`, { cwd: ROOT, shell: true });
  return stdout.trim();
}
async function signUp(page, name, email, password) {
  await page.goto(`${WEB}/login?mode=signup`);
  await page.fill("input[autocomplete=name]", name);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${WEB}/projects`);
}
async function signIn(page, email, password) {
  await page.goto(`${WEB}/login`);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.click("button[type=submit]");
}
const status = (page, path) => page.evaluate(async ({ API, path }) => (await fetch(API + path, { credentials: "include" })).status, { API, path });
async function openUser(page, email) {
  await page.click("[data-testid=admin-tab-users]");
  await page.fill("[data-testid=user-search]", email);
  await page.waitForSelector(`[data-testid=users-table] tr[data-email="${email}"]`);
  await page.click(`[data-testid=users-table] tr[data-email="${email}"]`);
  await page.waitForSelector(`[data-testid=user-email]:text-is("${email}")`);
}

for (let i = 0; i < 30; i++) {
  try {
    if ((await fetch(API + "/health")).ok) break;
  } catch {}
  await sleep(1000);
}

const stamp = Date.now();
const adminEmail = `admin-e2e-${stamp}@sceneflow.test`;
const userEmail = `member-e2e-${stamp}@sceneflow.test`;
const PASS = "admin-e2e-pass-1";
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const admin = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const member = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
watch(admin, "admin");
watch(member, "member");

// 1. Two ordinary accounts; a normal user sees nothing at /admin.
await signUp(admin, "Ada Admin", adminEmail, PASS);
await signUp(member, "Max Member", userEmail, PASS);
if (await admin.$("[data-testid=admin-link]")) fail("Admin link visible before the grant");
await member.goto(`${WEB}/admin`);
await member.waitForSelector("[data-testid=admin-denied]");
if ((await status(member, "/api/v1/admin/overview")) !== 404) fail("admin API should answer 404 to a normal user");
check("normal account: no Admin link, /admin says page not found, admin API answers 404");

// 2. The first super admin comes from the server CLI.
const granted = await cli("grant", adminEmail);
grantedAdmin = adminEmail;
if (!/is now a super admin/.test(granted)) fail("CLI grant: " + granted);
if (!(await cli("list")).includes(adminEmail)) fail("CLI list does not show the new super admin");
note(granted);
await admin.reload();
await admin.waitForSelector("[data-testid=admin-link]");
await admin.click("[data-testid=admin-link]");
await admin.waitForSelector("[data-testid=admin-overview] .stat-grid");
const accounts = await admin.textContent("[data-testid=admin-overview] .stat:first-child .stat-value");
note(`overview: ${accounts} accounts`);
check("pnpm admin grant -> Admin link -> overview");

// 3. Users: find the member, disable -> their browser is thrown out and sign-in refused.
await openUser(admin, userEmail);
await admin.click("[data-testid=disable-user]");
await admin.waitForSelector("[data-testid=admin-msg]:has-text('Disabled')");
await admin.waitForSelector("[data-testid=user-status]:has-text('disabled')");
await member.goto(`${WEB}/projects`);
await member.waitForURL(/\/login/);
await signIn(member, userEmail, PASS);
await member.waitForSelector(".alert.error:has-text('incorrect')");
check("disable: member signed out everywhere and cannot sign in");

await admin.click("[data-testid=enable-user]");
await admin.waitForSelector("[data-testid=user-status]:has-text('active')");
await signIn(member, userEmail, PASS);
await member.waitForURL(`${WEB}/projects`);
check("enable: member signs in again");

// 4. Grant and remove super admin from the console; own account protected.
await admin.click("[data-testid=grant-admin]");
await admin.waitForSelector("[data-testid=admin-msg]:has-text('Now a super admin')");
await member.reload();
await member.waitForSelector("[data-testid=admin-link]");
await admin.click("[data-testid=revoke-admin]");
await admin.waitForSelector("[data-testid=admin-msg]:has-text('removed')");
if ((await status(member, "/api/v1/admin/overview")) !== 404) fail("revoked super admin still reaches the admin API");
await openUser(admin, adminEmail);
if (!(await admin.isDisabled("[data-testid=disable-user]")) || !(await admin.isDisabled("[data-testid=revoke-admin]"))) fail("own account can be disabled / demoted from the console");
check("make super admin -> member sees Admin; remove -> 404 again; own account cannot be disabled or demoted");

// 5. Workspaces: the member's workspace, plan change, history.
await admin.click("[data-testid=admin-tab-workspaces]");
await admin.fill("[data-testid=workspace-search]", userEmail);
await admin.waitForSelector(`[data-testid=workspaces-table] tr[data-owner="${userEmail}"]`);
await admin.click(`[data-testid=workspaces-table] tr[data-owner="${userEmail}"]`);
await admin.waitForSelector("[data-testid=workspace-detail]");
await admin.selectOption("[data-testid=plan-select]", "pro");
await admin.waitForSelector("[data-testid=admin-msg]:has-text('Plan changed to pro')");
await admin.waitForSelector("[data-testid=workspace-history]:has-text('free → pro')");
const plan = await member.evaluate(async (API) => (await (await fetch(API + "/api/v1/workspaces", { credentials: "include" })).json()).workspaces[0].planId, API);
if (plan !== "pro") fail("member's workspace plan is " + plan);
check("workspace: plan free -> pro, visible to the member, recorded");

// 6. System: a worker is online (heartbeat), queues have numbers, services listed.
await admin.click("[data-testid=admin-tab-system]");
await admin.waitForSelector("[data-testid=admin-system] [data-testid=queues]");
if (await admin.$("[data-testid=no-worker]")) fail("System says no worker is running (start the worker with the new code)");
const workers = await admin.$$eval("[data-testid=workers] tr", (rows) => rows.map((r) => r.textContent?.trim()));
const queues = await admin.$$eval("[data-testid=queues] tbody tr", (rows) => rows.map((r) => Array.from(r.querySelectorAll("td")).map((td) => td.textContent?.trim()).join(" | ")));
const services = await admin.textContent("[data-testid=services]");
note(`workers: ${workers.join(" ; ")}`);
for (const q of queues) note(`queue: ${q}`);
if (!/Outbox|Resend|SMTP/.test(services)) fail("services do not show the mail provider: " + services);
check("system: worker online, queue counts, services (mail, AI, storage, database)");

// 6b. Support tools: sign in as the member (banner, back to admin), reset link to their mailbox, CSV, Sites.
await openUser(admin, userEmail);
await admin.click("[data-testid=impersonate-user]");
await admin.waitForURL(`${WEB}/projects`);
await admin.waitForSelector("[data-testid=impersonation-bar]");
await admin.waitForSelector(".goal-card, .list-item", { timeout: 15000 }); // the member's own projects page
if (await admin.$(".alert.error")) fail("projects page shows an error while signed in as the member: " + (await admin.textContent(".alert.error")));
const bar = await admin.textContent("[data-testid=impersonation-bar]");
if (!bar.includes(userEmail) || !bar.includes(adminEmail)) fail("impersonation banner does not name both accounts: " + bar);
if ((await status(admin, "/api/v1/admin/overview")) !== 404) fail("admin API open while signed in as a member");
const pw = await admin.evaluate(async (API) => (await fetch(API + "/api/v1/auth/password", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: "x", newPassword: "hijack-pass-9" }) })).json(), API);
if (pw.error !== "IMPERSONATING") fail("password change allowed while impersonating: " + JSON.stringify(pw));
await admin.click("[data-testid=stop-impersonating]");
await admin.waitForURL(/\/admin\?tab=users/);
if (await admin.$("[data-testid=impersonation-bar]")) fail("banner still shown after returning");
check("sign in as member: banner names both, no console, no password change; Return to admin restores the admin session");

await openUser(admin, userEmail);
await admin.click("[data-testid=send-reset]");
await admin.waitForSelector("[data-testid=admin-msg]:has-text('link')");
const outbox = join(ROOT, "data", "outbox");
let resetMail = null;
for (let i = 0; i < 40 && !resetMail; i++) {
  for (const f of (await readdir(outbox).catch(() => [])).sort().reverse().slice(0, 30)) {
    const m = JSON.parse(await readFile(join(outbox, f), "utf8"));
    if (m.to === userEmail && /Reset your SceneFlow password/.test(m.subject)) { resetMail = m; break; }
  }
  if (!resetMail) await sleep(250);
}
if (!resetMail) fail("no reset mail for the member in the outbox");
const csv = await admin.evaluate(async ({ API, userEmail }) => { const r = await fetch(`${API}/api/v1/admin/users.csv?q=${encodeURIComponent(userEmail)}`, { credentials: "include" }); return { type: r.headers.get("content-type"), text: await r.text() }; }, { API, userEmail });
if (!/text\/csv/.test(csv.type) || !csv.text.includes(userEmail)) fail("CSV download: " + JSON.stringify(csv).slice(0, 200));
await admin.click("[data-testid=admin-tab-sites]");
await admin.fill("[data-testid=site-search]", "development.local");
await admin.waitForSelector("[data-testid=sites-table] tr[data-url*='development.local']", { timeout: 15000 });
// The stored version dates from pairing; "Check now" asks the plugin again.
// One retry: on Windows the first lookup of a ".local" host can stall past the connector's 10 s timeout.
const row = "[data-testid=sites-table] tr[data-url*='development.local']";
// The version development.local should run: the current release build (pnpm build:wp).
const pluginVersion = JSON.parse(await readFile(join(ROOT, "dist", "connectors", "manifest.json"), "utf8")).connectors.wordpress.version;
let fresh = false;
for (let attempt = 0; attempt < 2 && !fresh; attempt++) {
  await admin.click(`${row} [data-testid=site-check]`);
  fresh = await admin
    .waitForFunction(({ sel, v }) => (document.querySelector(sel)?.textContent ?? "").includes(v), { sel: row, v: pluginVersion }, { timeout: 20000 })
    .then(() => true, () => false);
}
if (!fresh) fail(`Check now did not refresh development.local to plugin ${pluginVersion} (install the current build there)`);
const siteRows = await admin.$$eval("[data-testid=sites-table] tbody tr[data-url]", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
note(`sites matching development.local: ${siteRows.length}; e.g. ${siteRows[0].slice(0, 140)}`);
await admin.click("[data-testid=admin-tab-system]");
await admin.waitForSelector("text=Failed MP4 exports");
check("reset link e-mailed to the member (outbox), accounts CSV, Sites tab (Check now refreshes the plugin version), failed exports on System");

// 6c. No mailbox: a temporary password (shown once) and a one-time sign-in link; both force a new password.
let memberPass = PASS;
await openUser(admin, userEmail);
await admin.click("[data-testid=temp-password]");
await admin.waitForSelector("[data-testid=secret-box]");
const temp = (await admin.textContent("[data-testid=secret-value]")).trim();
if (!/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(temp)) fail("temporary password looks wrong: " + temp);
// The member's open browser is signed out at once.
await member.goto(`${WEB}/account`);
await member.waitForURL(/\/login/);
await signIn(member, userEmail, PASS);
await member.waitForSelector(".alert.error"); // the old password is gone
await signIn(member, userEmail, temp);
await member.waitForURL(/\/account\?setup=1/);
await member.waitForSelector("[data-testid=password-setup-note]");
if (await member.$("[data-testid=current-password]")) fail("setup form still asks for the current password");
// Any other page sends them back until a password is chosen.
await member.goto(`${WEB}/projects`);
await member.waitForURL(/\/account\?setup=1/);
memberPass = "member-own-pass-2";
await member.fill("[data-testid=new-password]", memberPass);
await member.click("[data-testid=change-password]");
await member.waitForURL(`${WEB}/projects`);
check("temporary password: shown once, member signed out, old password dead, sign-in forces a new password, then back to work");

await openUser(admin, userEmail);
await admin.selectOption("[data-testid=link-hours]", "1");
await admin.click("[data-testid=create-login-link]");
await admin.waitForSelector("[data-testid=secret-box]:has-text('Sign-in link')");
const link = (await admin.textContent("[data-testid=secret-value]")).trim();
if (!link.startsWith(`${WEB}/sign-in-link/`)) fail("sign-in link looks wrong: " + link);
const guestCtx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const guest = await guestCtx.newPage();
watch(guest, "link");
await guest.goto(link);
await guest.waitForSelector(`[data-testid=link-for]:has-text("${"m\u2022\u2022\u2022@sceneflow.test"}")`);
await guest.click("[data-testid=link-sign-in]");
await guest.waitForURL(/\/account\?setup=1/);
memberPass = "member-own-pass-3";
await guest.fill("[data-testid=new-password]", memberPass);
await guest.click("[data-testid=change-password]");
await guest.waitForURL(`${WEB}/projects`);
// The link worked once.
const again = await (await browser.newContext()).newPage();
await again.goto(link);
await again.waitForSelector("[data-testid=link-dead]");
await again.context().close();
await guestCtx.close();
check("sign-in link: opens the account once, asks for a new password, a second use is refused");

// 7. Audit log lists what just happened.
await admin.click("[data-testid=admin-tab-audit]");
await admin.waitForSelector("[data-testid=audit-table] tbody tr");
const audit = await admin.textContent("[data-testid=audit-table]");
for (const want of ["Disabled account", "Enabled account", "Made super admin", "Removed super admin", "Changed plan", "Signed in as", "Returned from signing in as", "Sent password reset link", "Downloaded accounts CSV", "Checked site", "Set a temporary password", "Created a sign-in link", "Signed in with an admin's link"]) if (!audit.includes(want)) fail(`audit log misses "${want}"`);
if (!audit.includes(adminEmail)) fail("audit log does not name the admin");
check("audit log records every change with the admin's e-mail");

// 8. Back to normal: revoke the test admin through the CLI; the console closes for it.
const revoked = await cli("revoke", adminEmail);
grantedAdmin = null;
if (!/no longer a super admin/.test(revoked)) fail("CLI revoke: " + revoked);
await admin.goto(`${WEB}/admin`);
await admin.waitForSelector("[data-testid=admin-denied]");
check("pnpm admin revoke -> console closed for the test admin");

await browser.close();
console.log(`\nAll good: ${problems.length} page errors. Accounts kept: ${adminEmail}, ${userEmail} (admin password ${PASS}, member password ${memberPass}).`);
