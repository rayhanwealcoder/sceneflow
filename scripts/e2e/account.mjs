// Password reset + account flow in a real Chrome against the RUNNING stack (api 4800, web 3000), the way a user does it:
// sign up -> sign out -> "Forgot your password?" -> request a link -> (no mail server here: read the outbox folder) ->
// open the link -> new password -> signed in; the other device is signed out; Account page: rename + change password;
// sign in with the newest password; Team: invite with an address -> invitation mail; unknown address -> same answer.
// Nothing is deleted afterwards.
//   node scripts/e2e/account.mjs [--headed]
// OUTBOX_DIR overrides where the API writes mails (default <repo>/data/outbox = the API's STORAGE_DIR default + /outbox).
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const ROOT = resolve(import.meta.dirname, "../..");
const OUTBOX = process.env.OUTBOX_DIR ?? join(ROOT, "data", "outbox");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const step = (m) => console.log(`\u2713 ${++n}. ${m}`);
const note = (m) => console.log(`  \u00b7 ${m}`);
const problems = [];
const fail = (m) => { console.error(`\u2717 ${m}`); if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  ")); process.exit(1); };
process.on("uncaughtException", (e) => fail(String(e.stack ?? e).split("\n").slice(0, 3).join(" | ")));
process.on("unhandledRejection", (e) => fail(String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")));
function watch(page, who) {
  page.on("pageerror", (e) => problems.push(`[${who} ${page.url()}] uncaught: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_|Failed to load resource/.test(m.text())) problems.push(`[${who} ${page.url()}] console: ${m.text().slice(0, 200)}`); });
}
const check = (what) => { if (problems.length) fail(`${what}\n  ` + problems.join("\n  ")); step(what); };
/** Newest outbox message matching `pred` (files are JSON: to, subject, text, html). */
async function waitForMail(pred, label, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const files = (await readdir(OUTBOX).catch(() => [])).sort().reverse();
    for (const f of files) {
      try {
        const m = JSON.parse(await readFile(join(OUTBOX, f), "utf8"));
        if (pred(m)) return m;
      } catch { /* partial write, try again */ }
    }
    await sleep(250);
  }
  fail(`no mail ${label} in ${OUTBOX} within ${ms / 1000}s (the API must run without MAIL_* settings for this test, so mails land in the outbox folder)`);
}
async function signIn(page, email, password) {
  await page.goto(`${WEB}/login`);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.click("button[type=submit]");
}

for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await sleep(1000); }

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctxA.newPage();
watch(page, "A");
const stamp = Date.now();
const email = `account-${stamp}@sceneflow.test`;
const pass1 = "first-pass-123";
const pass2 = "second-pass-456";
const pass3 = "third-pass-789";

// 1. Sign up through the real form.
await page.goto(`${WEB}/login`);
await page.click("text=Create account");
await page.fill("input[autocomplete=name]", "Account Tester");
await page.fill("input[type=email]", email);
await page.fill("input[type=password]", pass1);
await page.click("button[type=submit]");
await page.waitForURL(`${WEB}/projects`);
check(`sign up (${email})`);

// 2. A second device, to prove "signed out everywhere" later.
const ctxB = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const pageB = await ctxB.newPage();
watch(pageB, "B");
await signIn(pageB, email, pass1);
await pageB.waitForURL(`${WEB}/projects`);
check("second device signed in");

// 3. Sign out, then "Forgot your password?" carries the typed e-mail over.
await page.click("text=Sign out");
await page.waitForURL(`${WEB}/login`);
await page.fill("input[type=email]", email);
await page.click("[data-testid=forgot-link]");
await page.waitForURL(/\/forgot\?email=/);
if ((await page.inputValue("input[type=email]")) !== email) fail("forgot page did not pick up the e-mail from the sign-in form");
await page.click("[data-testid=forgot-submit]");
await page.waitForSelector("[data-testid=forgot-done]");
const delivery = await page.getAttribute("[data-testid=forgot-done]", "data-delivery");
check(`forgot password -> request accepted (delivery: ${delivery})`);
if (delivery !== "log") fail(`this API sends real mail (delivery=${delivery}); the test can only read the outbox folder - run the API without MAIL_* settings`);

// 4. The link, from the outbox folder (what the person running the server would copy).
const resetMail = await waitForMail((m) => m.to === email && /Reset your SceneFlow password/.test(m.subject), "with the reset link");
const link = resetMail.text.match(/http:\/\/localhost:3000\/reset\/[0-9a-f]{64}/)?.[0];
if (!link) fail("reset mail has no link: " + resetMail.text);
if (!/Account Tester/.test(resetMail.text) || !/60 minutes/.test(resetMail.text)) fail("reset mail text is off: " + resetMail.text);
note(link);
check("reset mail in the outbox with the link (greets by name, says 60 minutes)");

// 5. Open it: masked account, new password, signed in.
await page.goto(link);
await page.waitForSelector("[data-testid=reset-for]");
const masked = await page.textContent("[data-testid=reset-for]");
if (!/For the account a\u2022\u2022\u2022@sceneflow\.test/.test(masked)) fail("reset page does not mask the address as expected: " + masked);
await page.fill("[data-testid=reset-password]", pass2);
await page.click("[data-testid=reset-submit]");
await page.waitForURL(`${WEB}/projects`);
check("reset page -> new password -> signed in on this device");

// 6. The other device is out; the link is spent.
await pageB.goto(`${WEB}/projects`);
await pageB.waitForURL(/\/login/);
check("other device was signed out by the reset");
await pageB.goto(link);
await pageB.waitForSelector("[data-testid=reset-dead]");
const dead = await pageB.textContent("[data-testid=reset-dead]");
if (!/already used/.test(dead)) fail("used link should say so: " + dead);
await pageB.goto(`${WEB}/reset/${"0".repeat(64)}`);
await pageB.waitForSelector("[data-testid=reset-dead]");
check("a used link and an unknown link both explain themselves");
await waitForMail((m) => m.to === email && /password was changed/.test(m.subject), "'password was changed' notice");
check("'password was changed' notice in the outbox");

// 7. Account page from the header: rename, wrong current password refused, change password.
await page.click("[data-testid=account-link]");
await page.waitForURL(`${WEB}/account`);
await page.fill("[data-testid=account-name]", "Account Tester Renamed");
await page.click("[data-testid=profile-card] button[type=submit]");
await page.waitForSelector("[data-testid=name-msg]:has-text('Saved')");
const meNow = await page.evaluate(async (API) => (await (await fetch(API + "/api/v1/auth/me", { credentials: "include" })).json()).user, API);
if (meNow?.name !== "Account Tester Renamed") fail("rename did not stick: " + JSON.stringify(meNow));
await page.fill("[data-testid=current-password]", "wrong-pass-000");
await page.fill("[data-testid=new-password]", pass3);
await page.click("[data-testid=change-password]");
await page.waitForSelector("[data-testid=password-msg]:has-text('not correct')");
await page.fill("[data-testid=current-password]", pass2);
await page.fill("[data-testid=new-password]", pass3);
await page.click("[data-testid=change-password]");
await page.waitForSelector("[data-testid=password-msg]:has-text('Password changed')");
check("account: rename saved; wrong current password refused; password changed");

// 8. Sign in again: only the newest password works. (Signing out on /account lands on /login?next=/account.)
await page.click("text=Sign out");
await page.waitForURL(/\/login/);
await signIn(page, email, pass2);
await page.waitForSelector(".alert.error:has-text('incorrect')");
await signIn(page, email, pass3);
await page.waitForURL(`${WEB}/projects`);
check("sign in with the newest password; the previous one is refused");

// 9. Team: an invitation with an address is also mailed (here: to the outbox), the link stays visible.
const colleague = `colleague-${stamp}@sceneflow.test`;
await page.goto(`${WEB}/team`);
await page.waitForSelector("[data-testid=create-invite]", { timeout: 15000 });
await page.fill("input[type=email]", colleague);
await page.click("[data-testid=create-invite]");
await page.waitForSelector("[data-testid=invite-url]");
const inviteUrl = await page.textContent("[data-testid=invite-url]");
const inviteNotice = await page.textContent("[data-testid=invite-not-sent], [data-testid=invite-sent]");
const inviteMail = await waitForMail((m) => m.to === colleague && /invited you/.test(m.subject), "with the invitation");
if (!inviteMail.text.includes(inviteUrl)) fail("invitation mail does not carry the join link shown on the page");
note(`${inviteMail.subject} | page said: ${inviteNotice}`);
check("team invite with an address -> invitation mail with the join link");

// 10. Unknown address: same answer, nothing to read.
const nobody = `nobody-${stamp}@sceneflow.test`;
await page.goto(`${WEB}/forgot`);
await page.fill("input[type=email]", nobody);
await page.click("[data-testid=forgot-submit]");
await page.waitForSelector(`[data-testid=forgot-done][data-delivery="${delivery}"]`);
await sleep(600);
const recipients = await Promise.all((await readdir(OUTBOX).catch(() => [])).map(async (f) => { try { return JSON.parse(await readFile(join(OUTBOX, f), "utf8")).to; } catch { return null; } }));
if (recipients.includes(nobody)) fail("a mail was written for an address without an account");
check("unknown address gets the same answer and no mail");

// 13. Change the e-mail address: password needed, link to the new address, notice to the old one.
const moved = `account-moved-${stamp}@sceneflow.test`;
await page.goto(`${WEB}/account`);
await page.waitForSelector("[data-testid=email-card]");
await page.fill("[data-testid=new-email]", moved);
await page.fill("[data-testid=email-password]", "wrong-password");
await page.click("[data-testid=change-email]");
await page.waitForSelector("[data-testid=email-msg].error");
await page.fill("[data-testid=new-email]", moved);
await page.fill("[data-testid=email-password]", pass3);
await page.click("[data-testid=change-email]");
await page.waitForSelector("[data-testid=email-msg].ok");
const confirmMail = await waitForMail((m) => m.to === moved && /Confirm your new SceneFlow e-mail address/.test(m.subject), "confirming the new address");
await waitForMail((m) => m.to === email && /about to change/.test(m.subject), "warning the old address");
const confirmLink = confirmMail.text.match(/http:\/\/localhost:3000\/confirm-email\/[0-9a-f]{64}/)?.[0];
if (!confirmLink) fail("confirmation mail has no link");
if ((await page.textContent("[data-testid=current-email]")) !== email) fail("address changed before confirming");
await pageB.goto(confirmLink); // opened on the other device (signed out there), like a phone
await pageB.waitForSelector(`[data-testid=confirm-new-email]:text-is("${moved}")`);
await pageB.click("[data-testid=confirm-email]");
await pageB.waitForSelector("[data-testid=confirm-done]");
await waitForMail((m) => m.to === email && /e-mail address was changed/.test(m.subject), "telling the old address it changed");
await page.reload();
await page.waitForSelector(`[data-testid=current-email]:text-is("${moved}")`);
await signIn(pageB, moved, pass3);
await pageB.waitForURL(`${WEB}/projects`, { timeout: 10000 }).catch(async () => fail(`sign-in with the new address did not open projects (${pageB.url()}): ${await pageB.textContent("body").then((t) => t.replace(/\s+/g, " ").slice(0, 300))}`));
check("e-mail change: wrong password refused, confirm link on the new address, notice on the old, then signs in with the new address");

// 14. Comment / approval mails can be switched off and on.
await pageB.goto(`${WEB}/account`);
await pageB.waitForSelector("[data-testid=email-notifications]");
if (!(await pageB.isChecked("[data-testid=email-notifications]"))) fail("notifications should start on");
await pageB.click("[data-testid=email-notifications]");
await pageB.waitForSelector("[data-testid=notify-msg].ok");
await pageB.reload();
await pageB.waitForSelector("[data-testid=email-notifications]");
if (await pageB.isChecked("[data-testid=email-notifications]")) fail("notification switch did not stay off");
await pageB.click("[data-testid=email-notifications]");
await pageB.waitForSelector("[data-testid=notify-msg].ok");
check("comment / approval mail switch saves");

await browser.close();
console.log(`\nAll good: ${problems.length} page errors. Account ${moved} / ${pass3} (kept).`);
