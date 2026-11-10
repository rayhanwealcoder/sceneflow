// The Bricks "SceneFlow Video" element on a LocalWP site running the Bricks theme (default: bricks-try.local).
// No pairing: a video already published to development.local is copied into the Bricks site's plugin store
// (what a publish would store), a Bricks page gets one SceneFlow element, then:
//   front end  -> the player mounts inside the element, max width applied, no SceneFlow errors
//   builder    -> the canvas (iframe) mounts the player too (Bricks calls sceneflowBricksInit)
// The plugin is installed + activated for the run and deactivated again at the end (files and the page are kept).
//   node scripts/e2e/wp-bricks.mjs <projectId published on development.local> [--headed]
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const SOURCE = "http://development.local";
const SITE = process.env.BRICKS_SITE ?? "http://bricks-try.local";
const SITE_PATH = process.env.BRICKS_PATH ?? "E:/Local Sites/try-bricks/app/public";
const SITE_DB_PORT = process.env.BRICKS_DB_PORT ?? "10065";
const PHPDIR = "D:/programs/local/resources/extraResources/lightning-services/php-8.2.27+1/bin/win64";
const WP_CLI = "D:/programs/local/resources/extraResources/bin/wp-cli/wp-cli.phar";
const ROOT = resolve(import.meta.dirname, "../..");
const projectId = process.argv[2];
const HEADED = process.argv.includes("--headed");
if (!/^[0-9a-f-]{36}$/.test(projectId ?? "")) throw new Error("usage: node scripts/e2e/wp-bricks.mjs <projectId>");
const exec = promisify(execFile);
let n = 0;
const step = (m) => console.log(`✓ ${++n}. ${m}`);
const problems = [];
let activated = false;
async function wp(...args) {
  const { stdout } = await exec(`${PHPDIR}/php.exe`, ["-d", `extension_dir=${PHPDIR}/ext`, "-d", "extension=mysqli", "-d", "extension=openssl", "-d", "extension=mbstring", "-d", "extension=curl", "-d", "extension=gd", "-d", `mysqli.default_port=${SITE_DB_PORT}`, "-d", "memory_limit=1G", WP_CLI, `--path=${SITE_PATH}`, ...args], { timeout: 180_000, maxBuffer: 8 << 20, windowsHide: true });
  return stdout.trim();
}
const fail = async (m) => {
  console.error(`✗ ${m}`);
  if (problems.length) console.error("  page errors:\n  " + problems.join("\n  "));
  if (activated) await wp("plugin", "deactivate", "sceneflow").catch(() => {});
  process.exit(1);
};
const watch = (page, who) => page.on("pageerror", (e) => problems.push(`[${who}] ${e.message}`));

// 1. Plugin on the Bricks site; the published video copied into its store.
const theme = await wp("theme", "list", "--status=active", "--field=name");
if (!/bricks/i.test(theme)) await fail(`${SITE} does not run the Bricks theme (active: ${theme})`);
const wasActive = (await wp("plugin", "is-active", "sceneflow").then(() => true, () => false));
await wp("plugin", "install", join(ROOT, "dist/connectors/sceneflow-wordpress.zip"), "--force", "--activate");
activated = !wasActive;
const res = await fetch(`${SOURCE}/wp-json/sceneflow/v1/project/${projectId}`);
if (!res.ok) await fail(`project ${projectId} is not published on ${SOURCE}`);
const configJson = await res.text();
const cfg = JSON.parse(configJson);
const cfgFile = join(tmpdir(), `sf-bricks-${Date.now()}.json`);
await writeFile(cfgFile, configJson, "utf8");
await wp("eval", `SceneFlow_Store::save_project('${projectId}', 'Bricks test', ${Number(cfg.version) || 1}, hash('sha256', file_get_contents('${cfgFile.replace(/\\/g, "/")}')), file_get_contents('${cfgFile.replace(/\\/g, "/")}'));`);
const bricksVersion = await wp("eval", "echo defined('BRICKS_VERSION') ? BRICKS_VERSION : '?';");
const registered = await wp("eval", "echo isset(\\Bricks\\Elements::$elements['sceneflow-video']) ? 'yes' : 'no';");
step(`${SITE}: Bricks ${bricksVersion}, SceneFlow plugin installed, video ${projectId} (v${cfg.version}) in its store; element registered: ${registered}`);
if (registered !== "yes") await fail("Bricks did not register the sceneflow-video element");

// 2. A Bricks page with one SceneFlow element inside a section.
const stamp = Date.now();
// Bricks only lets users who may use the builder save page content: act as an administrator.
const admin = (await wp("user", "list", "--role=administrator", "--field=user_login")).split(/\r?\n/)[0];
const pageId = await wp("post", "create", "--post_type=page", "--post_status=publish", `--post_title=SceneFlow Bricks ${stamp}`, "--porcelain");
await wp("eval", `$els = array(
  array('id' => 'sfsec1', 'name' => 'section', 'parent' => 0, 'children' => array('sfcon1'), 'settings' => array()),
  array('id' => 'sfcon1', 'name' => 'container', 'parent' => 'sfsec1', 'children' => array('sfvid1'), 'settings' => array()),
  array('id' => 'sfvid1', 'name' => 'sceneflow-video', 'parent' => 'sfcon1', 'children' => array(), 'settings' => array('projectId' => '${projectId}', 'maxWidth' => '800px')),
);
update_post_meta(${pageId}, BRICKS_DB_PAGE_CONTENT, $els);
update_post_meta(${pageId}, BRICKS_DB_EDITOR_MODE, 'bricks');`, `--user=${admin}`);
const saved = await wp("eval", `echo count((array) get_post_meta(${pageId}, BRICKS_DB_PAGE_CONTENT, true));`);
if (saved !== "3") await fail(`Bricks page content not stored (${saved} elements)`);
const pageUrl = await wp("eval", `echo get_permalink(${pageId});`);

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required"] });
const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
watch(visitor, "front end");
await visitor.goto(pageUrl);
await visitor.waitForSelector(".brxe-sceneflow-video .sceneflow-player .sceneflow-root[data-sceneflow-state]", { state: "attached", timeout: 30000 }).catch(() => fail("player did not mount on the front end"));
const width = await visitor.$eval(".brxe-sceneflow-video .sceneflow-player", (el) => getComputedStyle(el).maxWidth);
if (width !== "800px") await fail("max width not applied: " + width);
step(`front end ${pageUrl}: the element renders the player (max width ${width})`);

// 3. The Bricks builder: the canvas mounts the player as well.
const cookies = JSON.parse(await wp("eval", "$admin = get_users(array('role' => 'administrator', 'number' => 1)); $id = $admin[0]->ID; $exp = time() + 3600; echo wp_json_encode(array(array('name' => AUTH_COOKIE, 'value' => wp_generate_auth_cookie($id, $exp, 'auth')), array('name' => LOGGED_IN_COOKIE, 'value' => wp_generate_auth_cookie($id, $exp, 'logged_in'))));"));
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: new URL(SITE).hostname, path: "/", httpOnly: true })));
const builder = await ctx.newPage();
watch(builder, "builder");
await builder.goto(`${pageUrl}${pageUrl.includes("?") ? "&" : "?"}bricks=run`, { timeout: 90000 });
const frame = await (await builder.waitForSelector("#bricks-builder-iframe", { timeout: 90000 })).contentFrame();
await frame.waitForSelector(".brxe-sceneflow-video .sceneflow-player .sceneflow-root[data-sceneflow-state]", { state: "attached", timeout: 60000 }).catch(() => fail("player did not mount in the Bricks builder canvas"));
step("Bricks builder: the canvas renders the element and mounts the player");

await browser.close();
const sf = problems.filter((p) => /sceneflow/i.test(p));
if (sf.length) await fail("SceneFlow errors:\n  " + sf.join("\n  "));
if (activated) {
  await wp("plugin", "deactivate", "sceneflow");
  activated = false;
}
console.log(`\nAll good${problems.length ? ` (${problems.length} non-SceneFlow page errors)` : ""}. Page ${pageUrl} kept; plugin ${wasActive ? "left active" : "deactivated again"}.`);
