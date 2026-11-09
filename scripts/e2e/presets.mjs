// Phase 7 end-to-end against the RUNNING local stack: brand kit -> branded template -> official preset -> library
// preset (save, apply, new version, refresh) -> template preset -> publish (fonts/brand/preset refs) -> connector zips.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API = "http://localhost:4800";
const WEB = "http://localhost:3000";
const ROOT = resolve(import.meta.dirname, "../..");
const ed = await import(pathToFileURL(`${ROOT}/packages/editor/dist/index.js`).href);
const schema = await import(pathToFileURL(`${ROOT}/packages/schema/dist/index.js`).href);

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

const reg = await api("POST", "/api/v1/auth/register", { email: `presets-${Date.now()}@sceneflow.test`, password: "preset-pass-123", name: "Preset Tester" });
const workspaceId = reg.workspaceId; step("registered");

// 1. Brand kit
const { kit } = await api("POST", "/api/v1/brand-kits", { workspaceId, name: "Acme", config: { colors: { primary: "#facc15", secondary: "#0f172a" }, fonts: { heading: '"Poppins", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif', loadGoogleFonts: true }, button: { borderRadius: 999, textTransform: "uppercase" } } });
if (!kit.isDefault || kit.version !== 1) fail("first kit should be default v1");
step(`brand kit "${kit.name}" created (default)`);

// 2. Branded template -> project
const { project } = await api("POST", "/api/v1/projects", { workspaceId, name: "Branded shoppable" });
const brand = { kit: kit.config, ref: { kitId: kit.id, version: kit.version } };
let config = ed.createProjectFromTemplate("shoppable", project.id, brand);
const productLayer = config.scenes[0].layers.find((l) => l.type === "product");
if (productLayer.style.accent !== "#facc15" || !config.fonts?.google?.includes("Poppins") || config.brand?.kitId !== kit.id) fail("template was not branded: " + JSON.stringify({ accent: productLayer.style.accent, fonts: config.fonts, brand: config.brand }));
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
step("project created from the shoppable template with the brand kit applied (accent, fonts, brand ref)");

// 3. Official preset
const lowerThird = ed.OFFICIAL_PRESETS.find((p) => p.id === "official:lower-third");
let r = ed.applyElementPreset(config, config.scenes[0].id, lowerThird, { brand: kit.config });
config = r.project;
if (r.layerIds.length !== 3 || !config.scenes[0].layers.every((l) => !l.preset || l.preset.id === "official:lower-third")) fail("official preset not applied");
const saved = await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
const back = (await api("GET", `/api/v1/projects/${project.id}`)).draft.config;
if (back.scenes[0].layers.filter((l) => l.preset?.id === "official:lower-third").length !== 3) fail("preset refs did not survive the server round-trip");
step(`official "Lower third" applied (3 layers with preset refs), draft v${saved.version} round-trips`);

// 4. Library preset: save -> apply -> new version -> outdated -> refresh
const groupLayers = config.scenes[0].layers.filter((l) => l.preset?.id === "official:lower-third");
const { preset: lib } = await api("POST", "/api/v1/presets", { workspaceId, name: "Our lower third", description: "Brand bar", config: ed.presetFromLayers(groupLayers), inputs: ed.detectInputs(ed.presetFromLayers(groupLayers)) });
if (lib.version !== 1 || lib.type !== "element" || lib.scope !== "workspace") fail("library preset wrong: " + JSON.stringify(lib));
r = ed.applyElementPreset(config, config.scenes[0].id, lib);
config = r.project;
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
const nudged = config.scenes[0].layers.find((l) => l.preset?.id === lib.id);
if (!nudged || nudged.frame.x !== groupLayers[0].frame.x) fail("library copy placement unexpected"); // first copy of *this* id -> no nudge
const v2 = (await api("PATCH", `/api/v1/presets/${lib.id}`, { config: ed.presetFromLayers(groupLayers.map((l) => (l.type === "shape" ? { ...l, style: { ...l.style, background: "#7c3aed" } } : l))) })).preset;
if (v2.version !== 2) fail("version did not bump");
const library = (await api("GET", `/api/v1/presets?workspaceId=${workspaceId}&type=element`)).presets;
const outdated = ed.outdatedPresets(config, library);
if (outdated.length !== 3) fail("expected 3 outdated refs, got " + outdated.length);
for (const o of outdated) config = ed.refreshFromPreset(config, o.sceneId, o.layerId, o.preset);
if (ed.outdatedPresets(config, library).length !== 0) fail("refresh did not clear outdated refs");
const refreshedBar = config.scenes[0].layers.find((l) => l.preset?.id === lib.id && l.type === "shape");
if (refreshedBar.style.background !== "#7c3aed") fail("refresh did not pull the new style");
await api("PUT", `/api/v1/projects/${project.id}/draft`, { config });
step(`library preset saved (v1) -> applied -> replaced (v2) -> 3 outdated refs -> refreshed (new bar colour ${refreshedBar.style.background})`);

// 5. Template preset -> second project
const { preset: tpl } = await api("POST", "/api/v1/presets", { workspaceId, name: "Acme launch template", config: ed.presetFromProject(config), inputs: ed.detectInputs(ed.presetFromProject(config)) });
const templates = (await api("GET", `/api/v1/presets?workspaceId=${workspaceId}&type=template`)).presets;
if (templates.length !== 1 || templates[0].id !== tpl.id) fail("template listing");
const { project: p2 } = await api("POST", "/api/v1/projects", { workspaceId, name: tpl.name });
const cfg2 = ed.projectFromTemplateConfig(tpl.config, p2.id, { brand: kit.config, ref: brand.ref });
if (cfg2.projectId !== p2.id || cfg2.version !== 1 || cfg2.scenes[0].id === config.scenes[0].id) fail("template copy keeps old ids");
const parsed2 = schema.parseProject(cfg2); if (!parsed2.ok) fail("template copy invalid: " + JSON.stringify(parsed2.issues?.slice(0, 2)));
await api("PUT", `/api/v1/projects/${p2.id}/draft`, { config: cfg2 });
step(`template preset saved (${tpl.inputs.length ? "needs " + tpl.inputs.join(", ") : "no inputs"}) and a second project created from it with fresh ids`);

// 6. Publish -> public config carries fonts, brand, preset refs; runtime carries the embed + fonts loader
const pub = await api("POST", `/api/v1/projects/${project.id}/publish`, {});
const live = await (await fetch(`${API}/p/${project.id}.json`)).json();
if (!live.fonts?.google?.includes("Poppins") || live.brand?.kitId !== kit.id || !live.scenes[0].layers.some((l) => l.preset?.id === lib.id)) fail("published config lost phase 7 fields: " + JSON.stringify({ fonts: live.fonts, brand: live.brand }));
const rt = await (await fetch(`${API}/runtime/sceneflow.runtime.min.js`)).text();
if (!rt.includes("data-sceneflow-id") || !rt.includes("fonts.googleapis.com") || !rt.includes('"0.4.0"')) fail("runtime lacks embed / fonts / version");
step(`published v${pub.publishedVersion}: fonts ${live.fonts.google.join("+")}, brand ref, preset refs; runtime 0.4.0 has embed + font loader`);

// 7. Connector zips served
for (const f of ["sceneflow-wordpress.zip", "sceneflow-shopify.zip", "sceneflow-webflow.zip"]) {
  const h = await fetch(`${API}/downloads/${f}`, { method: "HEAD" });
  if (!h.ok) fail(`${f} not served (${h.status}) â€” run pnpm build:connectors`);
}
step("connector zips served at /downloads/ (wordpress, shopify, webflow)");

// 8. Pages
for (const u of [`${WEB}/projects`, `${WEB}/projects/${project.id}/editor?tour=1`]) { const res = await fetch(u); if (!res.ok) fail(`${u} -> ${res.status}`); }
step("projects + editor pages respond");
console.log(`\nAll good. Editor: ${WEB}/projects/${project.id}/editor`);
