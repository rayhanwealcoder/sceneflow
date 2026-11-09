# Getting started with SceneFlow

SceneFlow turns a video into an interactive, shoppable experience: text, buttons, hotspots and product cards sit on top of the video, and the result is published to your own site (WordPress today; Shopify and Webflow through the connectors in this repo). You never touch code; your visitors never leave your site.

This guide has two halves: **using SceneFlow** (site owners, marketers) and **running it from this repo** (developers).

---

## Part 1 — Using SceneFlow

### 1. Make your first video (2 minutes)

1. Sign in and open **Projects**.
2. Under *What do you want to make?* pick a goal — *Sell a product from a video*, *Explain something interactively*, *Scroll-driven story* — or start blank. You get a video that already works.
3. The editor opens with a short **tour** (6 steps). Skip it any time; the **Tour** button in the top bar brings it back.
4. Click an empty spot on the canvas → *Background* → choose or upload your video. It is usable in seconds; HD versions finish in the background.
5. Edit the texts, drag things around, swap the product. Everything autosaves.

### 2. Set your brand once (optional, 2 minutes)

Projects → **Brand kit** → *Set up brand kit*: logo, primary/secondary colours, heading and body font, button shape, card corners, shadow.

- Every **new** video and every element you add follows it automatically.
- For an existing video: editor → **⋯ → Apply brand kit**. If you change the kit later the editor offers *Apply new look* — it never changes a video on its own.
- Fonts: pick one from the list. It shows if your site loads that font (most themes do). Turn on *Load from Google Fonts on my site* if it does not.

### 3. Presets — build once, reuse everywhere

In the editor the left panel has **Presets**:

- **Starter**: headline + subtitle, call to action, sale badge, lower third, price callout, product spotlight, logo in the corner, caption bar; whole scenes (title card, feature callout, product showcase, testimonial, end card); motions.
- **Your library**: select any element (or several) → **★** in the right panel → *Save to library*. Same for a scene (*★ Save scene as preset*) and for a whole video (**⋯ → Save as template**, which then appears under *Your templates* when you make a new video).
- Applying a preset always makes an independent copy. If you later improve a library preset (hover → ⟳ *Replace with selection*), videos that use it show *Update* next to that element — you decide.
- *Only visible to me* keeps a preset personal; otherwise the whole workspace can use it.

### 4. Connect your site and publish

**WordPress**

1. Projects → *WordPress sites* → **Download plugin** (`sceneflow-wordpress.zip`) → install and activate it on your site.
2. In WordPress: Settings → SceneFlow → **Connect with SceneFlow**. Approve once; you are sent back connected.
3. On the project page choose the site and press **Publish**. Then either paste the shortcode `[sceneflow id="…"]`, add the *SceneFlow Video* block, or use **Place on your site** to drop the player onto any existing element of a page — pick it visually, no page editing.
4. *Preview on site* in the editor shows the draft inside your theme before you publish.
5. WooCommerce: product cards pick real products, show live price and stock, and add to the real cart. Without WooCommerce, *My products* (name, price, link) works everywhere.

**Shopify** — install the theme app extension from `sceneflow-shopify.zip` (see `connectors/shopify/README.md`), add the *SceneFlow video* block in the theme editor and paste the project ID.

**Webflow and any other site** — add one script tag in the site's footer code and a `<div data-sceneflow-id="…">` where the video goes (see `connectors/webflow/README.md`).

### 5. When something does not work

Project page → **Something not working?** runs the whole chain for you: draft, media, published version, site reachable, plugin connected, WooCommerce available, pushed version, what the site actually serves, placements. Each line that fails has a button that takes you to the fix.

---

## Part 2 — Running SceneFlow from this repo

Requirements: Node 20.6+, PostgreSQL (native install, no Docker), pnpm (`npm i -g pnpm`). FFmpeg comes from npm.

```bash
pnpm install
pnpm bootstrap          # creates apps/api/.env and apps/worker/.env with a fresh secret
pnpm build && pnpm dev  # web :3000, api :4800, worker
```

| Command | What it does |
| --- | --- |
| `pnpm test` / `pnpm typecheck` | Unit + integration tests for every package (needs a `sceneflow_test` database) |
| `pnpm build:connectors` | Zips every connector into `dist/connectors/` with a `manifest.json` |
| `pnpm build:wp` | WordPress plugin only (`sceneflow-wordpress.zip`, served by the API at `/downloads/`) |
| `pnpm test:wp` | Plain-PHP plugin tests (signature fixture shared with the Node tests) |
| `pnpm smoke` | End-to-end check against a running stack |

Local WordPress testing uses a LocalWP site; point the plugin at the local app with `wp option update sceneflow_app_url http://localhost:3000`.

Where things are: `packages/schema` (project format), `packages/core` (published runtime), `packages/editor` (editor domain: ops, templates, presets, brand kit), `packages/server` (DB, storage, queue, connector protocol), `apps/api`, `apps/worker`, `apps/web`, `connectors/*`. Decisions and phase notes: `docs/architecture.md`, `CHANGELOG.md`; the product spec: `docs/SceneFlow_AI_Implementation_Handoff_v1.0.md`.

Deploying to a VPS (no Docker): see the README.
