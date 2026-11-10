// Phase 16 on development.local (WooCommerce + Elementor active), against the RUNNING stack (api 4800, web 3000):
// a shoppable video placed with the Elementor "SceneFlow Video" widget -> a visitor adds the product from the
// video -> checks out through the WooCommerce Store API -> the order line carries the video (hidden meta) ->
// the shop owner opens the video's Analytics page in SceneFlow -> orders + revenue from that video, also in the
// CSV. Then the widget in the Elementor editor: the player mounts in the preview.
//   node scripts/e2e/wp-sales.mjs [--headed] [--email x --password y]
// Reuses the account whose workspace is paired with development.local (pairing a new one would move the site).
// Cash on delivery is switched on for the checkout and back to its previous state at the end. Nothing is deleted.
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const WP = "http://development.local";
const WP_PATH = "C:/Users/UseR/Local Sites/development/app/public";
const PHP = "D:/programs/local/resources/extraResources/lightning-services/php-8.2.27+1/bin/win64/php.exe";
const WP_CLI = "D:/programs/local/resources/extraResources/bin/wp-cli/wp-cli.phar";
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const HEADED = argv.includes("--headed");
const EMAIL = flag("--email") ?? "fulltest-1794290183803@sceneflow.test";
const PASSWORD = flag("--password") ?? "fulltest-pass-123";
const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const step = (m) => console.log(`✓ ${++n}. ${m}`);
const note = (m) => console.log(`  · ${m}`);
const problems = [];
let restoreCod = null;
async function cleanup() {
  if (restoreCod !== null) {
    await wp("eval", `$s = get_option('woocommerce_cod_settings', array()); $s['enabled'] = '${restoreCod}'; update_option('woocommerce_cod_settings', $s);`).catch(() => {});
    restoreCod = null;
  }
}
const fail = async (m) => { console.error(`✗ ${m}`); if (problems.length) console.error("  page errors so far:\n  " + problems.join("\n  ")); await cleanup(); process.exit(1); };
function watch(page, who) {
  page.on("pageerror", (e) => problems.push(`[${who} ${page.url()}] uncaught: ${e.message}`));
}
async function wp(...args) {
  const { stdout } = await exec(PHP, ["-d", "extension_dir=D:/programs/local/resources/extraResources/lightning-services/php-8.2.27+1/bin/win64/ext", "-d", "extension=mysqli", "-d", "extension=openssl", "-d", "extension=mbstring", "-d", "extension=curl", "-d", "extension=gd", "-d", "mysqli.default_port=10005", "-d", "memory_limit=1G", WP_CLI, `--path=${WP_PATH}`, ...args], { timeout: 180_000, maxBuffer: 8 << 20, windowsHide: true });
  return stdout.trim();
}
async function pageApi(page, method, path, body) {
  const r = await page.evaluate(async ({ API, method, path, body }) => {
    const res = await fetch(API + path, { method, credentials: "include", headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  }, { API, method, path, body });
  if (r.status >= 400) await fail(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await sleep(1000); }
const health = await (await fetch(`${WP}/wp-json/sceneflow/v1/health`, { signal: AbortSignal.timeout(45_000) })).json().catch(() => null);
if (!health) await fail(`${WP} not reachable`);
if (!health.capabilities.includes("orders")) await fail(`plugin ${health.version} does not offer orders (install the 0.8.0 build): ${health.capabilities}`);
step(`site: plugin ${health.version}, capabilities ${health.capabilities.join(",")}`);

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required"] });
const owner = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
watch(owner, "owner");
await owner.goto(`${WEB}/login`);
await owner.fill("input[type=email]", EMAIL);
await owner.fill("input[type=password]", PASSWORD);
await owner.click("button[type=submit]");
await owner.waitForURL(`${WEB}/projects`, { timeout: 20000 }).catch(() => fail(`cannot sign in as ${EMAIL} (pass --email/--password of the account paired with ${WP})`));
const { workspaces } = await pageApi(owner, "GET", "/api/v1/workspaces");
let site = null;
let workspaceId = null;
for (const w of workspaces) {
  const { sites } = await pageApi(owner, "GET", `/api/v1/sites?workspaceId=${w.id}`);
  site = sites.find((s) => s.url.replace(/\/$/, "") === WP) ?? null;
  if (site) { workspaceId = w.id; break; }
}
if (!site) await fail(`no workspace of ${EMAIL} is connected to ${WP}`);
// The stored capabilities date from pairing: "Check" asks the plugin again (now with "orders").
// One retry: Windows' first lookup of a ".local" host can outlast the connector's timeout.
for (let i = 0; i < 2 && (!site.capabilitiesJson.includes("orders") || site.connectionStatus !== "connected"); i++) site = (await pageApi(owner, "POST", `/api/v1/sites/${site.id}/check`)).site ?? site;
if (site.connectionStatus !== "connected") await fail(`site check: ${site.connectionStatus} ${site.lastError ?? ""}`);
if (!site.capabilitiesJson.includes("orders")) await fail("site check did not pick up the orders capability: " + JSON.stringify(site.capabilitiesJson));
step(`signed in as ${EMAIL}; workspace ${workspaceId} paired with ${WP}; check -> ${site.capabilitiesJson.join(",")}`);

// 1. A small shoppable video for the GLOW-LIVE product, published to the site.
const admin = (await wp("user", "list", "--role=administrator", "--field=user_login")).split(/\r?\n/)[0];
const wooId = (await wp("wc", "product", "list", "--sku=GLOW-LIVE", "--field=id", `--user=${admin}`)).split(/\r?\n/)[0];
if (!wooId) await fail("WooCommerce product GLOW-LIVE missing (run wp-landing.mjs once)");
const stamp = Date.now();
const { project } = await pageApi(owner, "POST", "/api/v1/projects", { workspaceId, name: `Sales test ${stamp}` });
await pageApi(owner, "PATCH", `/api/v1/projects/${project.id}`, { siteId: site.id });
const list = await pageApi(owner, "GET", `/api/v1/projects/${project.id}/products?provider=woocommerce&search=Glow`);
const woo = list.items.find((p) => String(p.id) === String(wooId));
const ref = { provider: "woocommerce", productId: String(woo.id), title: woo.name, price: woo.price, image: woo.image, url: woo.productUrl, inStock: true };
const config = {
  canvas: { aspectRatio: "16:9" },
  playback: { mode: "autoplay", muted: true, controls: false, loop: true },
  scenes: [{ id: "s1", name: "Buy", start: 0, end: 6, background: { type: "color", color: "#1d1d1f" }, layers: [
    { id: "buy", type: "button", name: "Buy button", frame: { x: 35, y: 40, w: 30, h: 14 }, content: { label: "Add to bag" }, style: { background: "#c8755a", color: "#fff", borderRadius: 999, fontSize: 22 }, action: { type: "ADD_TO_CART", product: ref, quantity: 2 } },
  ] }],
};
await pageApi(owner, "PUT", `/api/v1/projects/${project.id}/draft`, { config });
const pub = await pageApi(owner, "POST", `/api/v1/projects/${project.id}/publish`, {});
if (!pub.sites?.[0]?.ok) await fail("publish to WordPress failed: " + JSON.stringify(pub.sites));
step(`project "${project.name}" with an Add-to-bag button for #${wooId} ${woo.name} (${woo.price}) published to the site (v${pub.publishedVersion})`);

// 2. A page built with Elementor: one "SceneFlow Video" widget.
const elementorData = JSON.stringify([{ id: "a1b2c3d", elType: "container", settings: {}, elements: [{ id: "e4f5a6b", elType: "widget", widgetType: "sceneflow-video", settings: { project_id: project.id, max_width: "860px" }, elements: [] }], isInner: false }]);
const dataFile = join(tmpdir(), `sf-elementor-${stamp}.json`);
await writeFile(dataFile, elementorData, "utf8");
const pageId = await wp("post", "create", "--post_type=page", "--post_status=publish", `--post_title=Sales test ${stamp}`, "--porcelain");
await wp("eval", `$id = ${pageId}; update_post_meta($id, '_elementor_edit_mode', 'builder'); update_post_meta($id, '_elementor_template_type', 'wp-page'); update_post_meta($id, '_elementor_version', ELEMENTOR_VERSION); update_post_meta($id, '_wp_page_template', 'elementor_canvas'); update_post_meta($id, '_elementor_data', wp_slash(file_get_contents('${dataFile.replace(/\\/g, "/")}')));`);
const pageUrl = await wp("eval", `echo get_permalink(${pageId});`);
const widget = await wp("eval", `echo \\Elementor\\Plugin::$instance->widgets_manager->get_widget_types('sceneflow-video') ? 'registered' : 'missing';`);
if (widget !== "registered") await fail("Elementor widget sceneflow-video is " + widget);
step(`Elementor page ${pageUrl} with the "SceneFlow Video" widget (max width 860px); widget ${widget}`);

// 3. Visitor: player renders from the widget, "Add to bag" -> cart, then checkout (cash on delivery).
restoreCod = await wp("eval", "$s = get_option('woocommerce_cod_settings', array()); echo isset($s['enabled']) ? $s['enabled'] : 'no';");
await wp("eval", "$s = get_option('woocommerce_cod_settings', array()); $s['enabled'] = 'yes'; update_option('woocommerce_cod_settings', $s);");
const visitorCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const visitor = await visitorCtx.newPage();
watch(visitor, "visitor");
let sourceHeader = null;
visitor.on("request", (r) => { if (r.url().includes("/wc/store/v1/cart/add-item")) sourceHeader = r.headers()["x-sceneflow-source"] ?? null; });
await visitor.goto(pageUrl);
await visitor.waitForSelector(".elementor-widget-sceneflow-video .sceneflow-player .sceneflow-root", { timeout: 30000 });
const maxWidth = await visitor.$eval(".elementor-widget-sceneflow-video .sceneflow-player", (el) => getComputedStyle(el).maxWidth);
if (maxWidth !== "860px") await fail("widget max width not applied: " + maxWidth);
await visitor.waitForSelector(".sceneflow-root [data-sceneflow-layer=buy]", { state: "visible", timeout: 20000 });
await visitor.click(".sceneflow-root [data-sceneflow-layer=buy]");
await visitor.waitForSelector(".sceneflow-toast", { timeout: 15000 });
const toast = (await visitor.textContent(".sceneflow-toast")).trim();
if (!sourceHeader || !sourceHeader.startsWith(`${project.id}:`)) await fail("add-to-cart request did not carry X-SceneFlow-Source: " + sourceHeader);
// The product must be in the site's own cart (what the cart and checkout pages show), not in a side session.
const siteCart = await visitor.evaluate(async (WP) => (await (await fetch(`${WP}/wp-json/wc/store/v1/cart`, { credentials: "include" })).json()).items_count, WP);
if (!(siteCart >= 2)) await fail(`the site's cart holds ${siteCart} items after "Add to bag" (expected 2)`);
step(`visitor: Elementor widget renders the player (max width ${maxWidth}); "Add to bag" -> "${toast}"; the cart request named the video (${sourceHeader.slice(0, 44)}…)`);

const order = await visitor.evaluate(async (WP) => {
  const cart = await fetch(`${WP}/wp-json/wc/store/v1/cart`, { credentials: "include" });
  const nonce = cart.headers.get("Nonce");
  const address = { first_name: "Test", last_name: "Buyer", address_1: "1 Test Street", city: "Dhaka", postcode: "1207", country: "BD", email: "buyer@sceneflow.test", phone: "0123456789" };
  const res = await fetch(`${WP}/wp-json/wc/store/v1/checkout`, { method: "POST", credentials: "include", headers: { "content-type": "application/json", Nonce: nonce }, body: JSON.stringify({ billing_address: address, shipping_address: address, payment_method: "cod" }) });
  return { status: res.status, body: await res.json() };
}, WP);
if (order.status !== 200 || !order.body.order_id) await fail("checkout failed: " + JSON.stringify(order).slice(0, 400));
const orderId = order.body.order_id;
await cleanup(); // cash on delivery back to how it was
const meta = JSON.parse(await wp("eval", `$o = wc_get_order(${orderId}); $items = array(); foreach ($o->get_items() as $i) { $items[] = array('product' => $i->get_product_id(), 'qty' => $i->get_quantity(), 'total' => $i->get_total(), 'project' => $i->get_meta('_sceneflow_project'), 'session' => $i->get_meta('_sceneflow_session')); } echo wp_json_encode(array('status' => $o->get_status(), 'attributed' => $o->get_meta('_sceneflow_attributed'), 'currency' => $o->get_currency(), 'items' => $items));`));
const line = meta.items.find((i) => String(i.product) === String(wooId));
if (meta.attributed !== "1" || !line || line.project !== project.id || !line.session) await fail("order is not credited to the video: " + JSON.stringify(meta));
step(`checkout: order #${orderId} (${meta.status}, ${meta.currency}) — line ${line.qty} × ${woo.name} = ${line.total} carries the video id and the anonymous session id`);

// 4. The order counts once it is paid (processing); the owner sees it on the Analytics page and in the CSV.
await wp("wc", "shop_order", "update", String(orderId), "--status=processing", `--user=${admin}`);
let summary = null;
for (let i = 0; i < 30 && !(summary?.totals?.orders > 0); i++) {
  if (i > 0) await sleep(3000);
  summary = await pageApi(owner, "GET", `/api/v1/projects/${project.id}/analytics?days=7`);
}
if (!(summary?.totals?.orders >= 1)) await fail("analytics shows no order: " + JSON.stringify(summary?.totals));
const rev = summary.totals.revenue[0];
if (Math.abs(rev.revenue - Number(line.total)) > 0.01 || rev.currency !== meta.currency) await fail(`revenue ${JSON.stringify(rev)} does not match the order line ${line.total} ${meta.currency}`);
await owner.goto(`${WEB}/projects/${project.id}/analytics`);
await owner.waitForSelector("[data-testid=stat-orders]", { timeout: 30000 });
const statOrders = (await owner.textContent("[data-testid=stat-orders]")).replace(/\s+/g, " ");
const statRevenue = (await owner.textContent("[data-testid=stat-revenue]")).replace(/\s+/g, " ");
const csv = await owner.evaluate(async (u) => (await fetch(u, { credentials: "include" })).text(), `${API}/api/v1/projects/${project.id}/analytics.csv?days=7`);
const today = new Date().toISOString().slice(0, 10);
const csvLine = csv.split("\r\n").find((l) => l.startsWith(`"${today}"`)) ?? "";
if (!csvLine.includes(`"${meta.currency}"`) || !csvLine.includes(`"${Number(line.total)}"`)) await fail("CSV row for today lacks the order: " + csvLine);
step(`owner: Analytics shows ${statOrders.trim()} | ${statRevenue.trim()}; CSV today: ${csvLine}`);

// 5. The widget in the Elementor editor: the preview mounts the player too.
const cookies = JSON.parse(await wp("eval", `$exp = time() + 3600; echo wp_json_encode(array(array('name' => AUTH_COOKIE, 'value' => wp_generate_auth_cookie(1, $exp, 'auth')), array('name' => LOGGED_IN_COOKIE, 'value' => wp_generate_auth_cookie(1, $exp, 'logged_in'))));`));
const editorCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await editorCtx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: "development.local", path: "/", httpOnly: true })));
const editor = await editorCtx.newPage();
watch(editor, "elementor");
await editor.goto(`${WP}/wp-admin/post.php?post=${pageId}&action=elementor`, { timeout: 90000 });
const frame = await (await editor.waitForSelector("#elementor-preview-iframe", { timeout: 90000 })).contentFrame();
await frame.waitForSelector(".elementor-widget-sceneflow-video .sceneflow-player .sceneflow-root", { timeout: 60000 });
step("Elementor editor: the widget's preview mounts the player");

const sceneflowErrors = problems.filter((p) => /sceneflow/i.test(p));
if (sceneflowErrors.length) await fail("page errors from SceneFlow:\n  " + sceneflowErrors.join("\n  "));
if (problems.length) note(`other page errors (not SceneFlow): ${problems.length}`);
await browser.close();
console.log(`\nAll good. Page ${pageUrl}, order #${orderId}, project ${project.id} (kept).`);
