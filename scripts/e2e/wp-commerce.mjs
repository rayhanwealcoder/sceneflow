// Phase 5 end-to-end against development.local (WooCommerce active) through the SceneFlow API.
// Usage: node scripts/e2e/wp-commerce.mjs <pairing-code>
const API = "http://localhost:4800";
const SITE = "http://development.local";
const CODE = process.argv[2];
if (!CODE) throw new Error("pairing code required");
let cookie = "";
const step = (m) => console.log("âœ“ " + m);
const fail = (m) => { console.error("âœ— " + m); process.exit(1); };
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) fail(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
for (let i = 0; i < 30; i++) { try { if ((await fetch(API + "/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }

const reg = await api("POST", "/api/v1/auth/register", { email: `woo-${Date.now()}@sceneflow.test`, password: "wp-pass-12345", name: "Woo Tester" });
const workspaceId = reg.workspaceId; step("registered");
const { site } = await api("POST", "/api/v1/sites/connect", { workspaceId, url: SITE, pairingCode: CODE });
if (!site.capabilitiesJson.includes("woocommerce")) fail("site does not report the woocommerce capability: " + site.capabilitiesJson.join(","));
step(`connected "${site.name}" plugin ${site.connectorVersion} caps=${site.capabilitiesJson.join(",")}`);

const { project } = await api("POST", "/api/v1/projects", { workspaceId, name: "Woo e2e" });
await api("PATCH", `/api/v1/projects/${project.id}`, { siteId: site.id });

// Catalog providers + WooCommerce products through the signed connector.
const providers = await api("GET", `/api/v1/projects/${project.id}/commerce`);
if (providers.providers.map(p => p.id).join(",") !== "woocommerce,manual") fail("unexpected providers " + JSON.stringify(providers));
step(`providers: ${providers.providers.map(p => p.label).join(" | ")}`);
const list = await api("GET", `/api/v1/projects/${project.id}/products?provider=woocommerce`);
const runner = list.items.find(p => p.name === "Runner Pro");
const jacket = list.items.find(p => p.name === "Trail Jacket");
if (!runner || !jacket) fail("seeded products missing: " + list.items.map(p => p.name).join(", "));
// Prices come formatted by the store itself (currency/symbol are whatever the shop uses); amounts must match the seed.
if (runner.priceAmount !== 129 || !runner.price || !runner.regularPrice || !runner.regularPrice.includes("149") || !runner.currency) fail("runner prices wrong: " + JSON.stringify(runner));
step(`woo products: ${list.items.map(p => `${p.name} ${p.price}${p.regularPrice ? ` (was ${p.regularPrice})` : ""}`).join(" Â· ")}`);
const detail = (await api("GET", `/api/v1/projects/${project.id}/products/${jacket.id}?provider=woocommerce`)).product;
if (detail.type !== "variable" || detail.variations.length !== 3 || !detail.variations.find(v => v.title === "L" && v.inStock === false)) fail("variations wrong: " + JSON.stringify(detail.variations));
step(`variable product "${detail.name}" ${detail.price}: ${detail.variations.map(v => `${v.title} ${v.price}${v.inStock ? "" : " (sold out)"}`).join(", ")}`);

// Manual catalog (no shop needed) still available alongside.
const manual = await api("POST", "/api/v1/products", { workspaceId, name: "Gift card", priceAmount: 25, currency: "USD", productUrl: "https://example.com/gift" });
step(`manual product created: ${manual.product.name} ${manual.product.price}`);

// Build a shoppable project: product card (variable jacket, visitor picks size), add-to-cart button (runner), coupon button.
const refOf = (p, extra = {}) => ({ provider: "woocommerce", productId: p.id, title: p.name, price: p.price, image: p.image, url: p.productUrl, inStock: p.stockStatus !== "outofstock", ...extra });
const config = { canvas: { aspectRatio: "16:9" }, playback: { mode: "click" }, scenes: [{ id: "s1", name: "Shop", start: 0, end: 6, background: { type: "gradient", css: "linear-gradient(135deg,#0f172a,#4f46e5)" }, layers: [
  { id: "card", type: "product", frame: { x: 62, y: 8, w: 32, h: 84 }, product: refOf(jacket), content: { quantity: true, buttonAction: "add_to_cart" }, style: { background: "#fff", color: "#111", accent: "#4f46e5", borderRadius: 14, fontSize: 16 } },
  { id: "buy", type: "button", frame: { x: 6, y: 74, w: 30, h: 12 }, content: { label: "Add Runner Pro" }, style: { background: "#fff", color: "#111", borderRadius: 12, fontWeight: 700 }, action: { type: "ADD_TO_CART", product: refOf(runner), quantity: 1 } },
  { id: "coupon", type: "button", frame: { x: 6, y: 58, w: 30, h: 12 }, content: { label: "10% off: SCENE10" }, style: { background: "#22c55e", color: "#fff", borderRadius: 12, fontWeight: 700 }, action: { type: "APPLY_COUPON", code: "SCENE10" } },
] }] };
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
const pub = await api("POST", `/api/v1/projects/${project.id}/publish`, {});
if (!pub.sites[0]?.ok) fail("push failed: " + JSON.stringify(pub.sites));
step(`published v${pub.publishedVersion} to WordPress (${pub.sites[0].shortcode})`);

// WordPress serves config + the public product endpoint the front-end adapter hydrates from.
const wpCfg = await (await fetch(`${SITE}/wp-json/sceneflow/v1/project/${project.id}`)).json();
if (wpCfg.scenes?.[0]?.layers?.[0]?.product?.productId !== jacket.id) fail("config on WP lost the product reference");
const live = await fetch(`${SITE}/wp-json/sceneflow/v1/product/${jacket.id}`);
const liveJson = await live.json();
if (!live.ok || liveJson.variations?.length !== 3 || !live.headers.get("cache-control")?.includes("max-age=60")) fail("public product endpoint wrong: " + JSON.stringify(liveJson).slice(0, 200));
step(`WP public product endpoint hydrates "${liveJson.name}" with ${liveJson.variations.length} variations (cache ${live.headers.get("cache-control")})`);
const draft = await fetch(`${SITE}/wp-json/sceneflow/v1/products`);
if (draft.status !== 401) fail("signed products route is reachable without a signature: " + draft.status);
step("signed products route rejects unsigned requests (401)");

// The preview page must load the Woo adapter before the init script.
const prev = await api("POST", `/api/v1/projects/${project.id}/preview-session`, {});
const html = await (await fetch(prev.previewUrl)).text();
const iWoo = html.indexOf("sceneflow-woo.js"), iInit = html.indexOf("sceneflow-init.js");
if (iWoo < 0 || iInit < 0 || iWoo > iInit || !html.includes("SceneFlowWoo")) fail("woo adapter not enqueued before init on the preview page");
step("theme page enqueues runtime â†’ WooCommerce adapter â†’ init, with Store API config");

// AC-007: add to cart through the WooCommerce Store API exactly like the browser adapter does (nonce + cart token).
const cartRes = await fetch(`${SITE}/wp-json/wc/store/v1/cart`);
const nonce = cartRes.headers.get("nonce"); const token = cartRes.headers.get("cart-token");
if (!nonce || !token) fail("Store API did not hand out nonce/cart-token");
const headers = { "content-type": "application/json", nonce, "cart-token": token };
const sizeM = liveJson.variations.find(v => v.title === "M");
const add = await fetch(`${SITE}/wp-json/wc/store/v1/cart/add-item`, { method: "POST", headers, body: JSON.stringify({ id: Number(sizeM.id), quantity: 2 }) });
const cart = await add.json();
if (!add.ok || cart.items_count !== 2 || cart.items?.[0]?.id !== Number(sizeM.id)) fail("add-item failed: " + JSON.stringify(cart).slice(0, 300));
step(`Store API add-to-cart: ${cart.items[0].name} (${cart.items[0].variation?.map(v => v.value).join("/")}) Ã—${cart.items_count}, total ${cart.totals.total_price / 10 ** cart.totals.currency_minor_unit} ${cart.totals.currency_code}`);
const soldOut = liveJson.variations.find(v => v.title === "L");
const bad = await fetch(`${SITE}/wp-json/wc/store/v1/cart/add-item`, { method: "POST", headers: { ...headers, nonce: add.headers.get("nonce") ?? nonce }, body: JSON.stringify({ id: Number(soldOut.id), quantity: 1 }) });
if (bad.ok) fail("sold-out variation was added");
step(`sold-out variation rejected by the store (${(await bad.json()).code})`);
const coupon = await fetch(`${SITE}/wp-json/wc/store/v1/cart/apply-coupon`, { method: "POST", headers: { ...headers, nonce: bad.headers.get("nonce") ?? nonce }, body: JSON.stringify({ code: "SCENE10" }) });
const withCoupon = await coupon.json();
if (!coupon.ok || !withCoupon.coupons?.some(c => c.code === "scene10")) fail("coupon failed: " + JSON.stringify(withCoupon).slice(0, 300));
step(`coupon SCENE10 applied, discount ${withCoupon.totals.total_discount / 10 ** withCoupon.totals.currency_minor_unit} ${withCoupon.totals.currency_code}`);

console.log(`\nAll good.\nProject: http://localhost:3000/projects/${project.id}/editor\nPreview on site: ${prev.previewUrl}\nShortcode: ${pub.sites[0].shortcode}`);
