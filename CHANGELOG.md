# Changelog

## Phase 6 — Performance + guided onboarding (2026-11-09)

### Added
- **Worker offloading**: two queues. `media.process` makes an upload usable within seconds (poster, 540p proxy, thumbnails, waveform; progress stages shown in the UI), then queues `media.renditions`, which encodes 720p / 1080p playback files (never upscaled) and a **scroll-optimized MP4** (24 fps, 6-frame GOP, no B-frames, no audio) for clips up to 3 minutes. Fast jobs run in parallel (`WORKER_CONCURRENCY`), renditions one at a time; failures are marked per job and never undo the "ready" state.
- **Device profiles** (doc 11.4): `video.sources` / `background.sources` carry every rendition; the runtime picks by rendered width × pixel density, connection (`saveData`, 2g/3g → low profile, ≤ 540p) and playback mode (scroll prefers the scrub rendition). Pure `pickSource()` + `detectProfile()`, unit-tested.
- **Publish-time resolution** (doc 11.2): publishing swaps the editor proxy for the best renditions available and reports `media.hdPending`; the UI says "publish again later to ship HD". Adjacent scenes' posters/videos are prefetched (`<link rel=prefetch>`).
- **Runtime split**: the Shopify adapter left the core (`sceneflow.shopify.min.js`, 1.2 KB gzip, auto-registers; `@sceneflow/core/shopify` for bundlers). Core runtime 27.8 KB gzip, zero platform code. `SceneFlow.VERSION`.
- **Guided onboarding (zero learning curve)**: goal-first start ("Sell a product from a video", "Explain something interactively", "Scroll-driven story", blank) creating a working project from a template and opening the editor with a **guided tour** (canvas → elements → inspector → product → devices → publish; keyboard-friendly, "Tour" button to replay); a **getting-started checklist** computed from real state; a **"Something not working?"** panel that runs server-side diagnostics across the whole chain (draft, media, publish, site reachability, plugin connected, WooCommerce capability, pushed version, what the site actually serves, placements) and offers the fix for each line. Project JSON size indicator in the editor (warns over 100 KB).
- WordPress plugin 0.3.0: scripts registered with `strategy: defer`; readme/changelog.
- Tests: 103 Node tests (renditions pipeline against real FFmpeg, source picker, templates, publish-time resolution + diagnostics), rate limits disabled in the test config. Verified end to end on the running stack (720p upload → proxy in 1.5 s → renditions → publish swaps sources → diagnostics).

### Decisions
- Progressive MP4 ladders instead of HLS for now: marketing videos are short, every browser plays MP4 without a 40 KB module, and seek-friendly progressive files are what scroll-scrub needs. HLS stays an option for long-form video.
- Renditions never retro-update a published version (versions are immutable); publishing again ships HD.

## Phase 5 — Commerce (2026-11-09)

### Added
- **Commerce adapter pattern** (doc §14): `ProductRef` (provider + product id + display snapshot) on `product` layers and on `ADD_TO_CART` / `BUY_NOW` / `VIEW_PRODUCT` actions; `APPLY_COUPON`, `OPEN_CART`, `OPEN_CHECKOUT`. Legacy `productId` actions are upgraded on parse. 25 schema tests.
- `@sceneflow/core`: `CommerceAdapter` interface + global registry (`SceneFlow.commerce.register()`), resolved per product provider → site default → link fallback (opens the product URL, so videos work on any site). **Product card** element: image, name, live price, sale price, variant selector, quantity, stock state, button (add to cart / buy now / view), per-player hydration via `adapter.getProduct`. In-player toasts, `addToCart` / `buyNow` / `couponApplied` / `productClick` events, busy state. Shopify adapter (`createShopifyAdapter`, AJAX cart API; unit-tested only). Bundle 27.7 KB gzip, 24 tests.
- `@sceneflow/server`: `CatalogProvider` interface with `WooCommerceCatalog` (signed connector `/products`, `/products/:id`) and `ManualCatalog` (new `catalog_products` table, migration `0002`); defensive normalization of remote products. **Storage factory** `createStorage()` + `STORAGE_PROVIDER=local|s3`: new `S3StorageProvider` for Cloudflare R2 / AWS S3 / MinIO / B2 (presigned PUT with signed Content-Type + Content-Length, HEAD confirmation, download for processing), tested against an in-process fake S3. Cloudflare stays optional.
- API: `GET /projects/:id/commerce` (available catalogs), `GET /projects/:id/products[/:pid]`, manual products CRUD (`/api/v1/products`), `POST /media/uploads/:id/complete` for remote storage; `/health` reports the storage provider. 11 tests.
- Worker shares the storage config with the API (local or bucket).
- Web: **Product** element with product picker (tabs per source: WooCommerce of the connected site / My products, search, "+ Add product" form), variant pinning, button action/label/layout/toggles, text/button colours; shop actions on buttons and hotspots (product picker opens first, quantity, coupon code); `/connect` page for one-click WordPress connect; login honours `?next=`; uploads call the completion endpoint when storage is remote.
- WordPress plugin 0.2.0: **WooCommerce adapter** (`class-sceneflow-woocommerce.php` + `assets/sceneflow-woo.js`): normalized products with variations and store-formatted prices for the editor, public cached `/product/:id` for front-end hydration, Store API add-to-cart / buy-now / coupon with nonce refresh and mini-cart notifications; capability `woocommerce` only when active. **One-click "Connect with SceneFlow"** in Settings → SceneFlow (pairing code kept as fallback), "Open SceneFlow" / "Edit in SceneFlow" links, advanced app-URL setting (`SCENEFLOW_APP_URL` constant / `sceneflow_app_url` filter).
- Verified for real against `development.local` with WooCommerce 11: catalog through the signed connector, publish with a product card, public hydration endpoint, Store API add-to-cart of a variation, sold-out rejection, coupon.

### Security / WordPress.org review pass
- `max_width` shortcode/block attribute limited to a single CSS length (no CSS injection via `style`).
- Preview / pick tokens are lowercase so `sanitize_key()` and case-sensitive object caches cannot break them.
- Picker status bar built with DOM nodes instead of `innerHTML`; placement ids re-validated client side.
- Uninstall removes all `sceneflow_*` transients and the app-URL option.
- Readable runtime build shipped next to the minified one; readme gains "External services" and "Source code" sections, Tested up to 7.1. `wp plugin check` and WPCS clean.

### Decisions
- Payments never pass through SceneFlow: the player only talks to the store's own cart (Store API for WooCommerce, cart API for Shopify, product links otherwise).
- Manual products are the "no shop" path: they make product cards work for payment links, Gumroad, or stores without an adapter yet.

### Deferred
- Server-side Shopify / EDD / SureCart catalogs (runtime adapter pattern ready); live Shopify verification.
- Cart badge / mini-cart element inside the player.

## Phase 4 — WordPress (2026-11-09)

### Added
- **WordPress plugin** `wordpress/sceneflow` (WP 6.2+, PHP 7.4+, WordPress coding standards clean): pairing with a one-time code (Settings → SceneFlow or `wp sceneflow pairing-code`), HMAC-SHA256 signed requests with timestamp + nonce anti-replay, config validation (size, schema major, project id, URL scheme allowlist), local storage of published configs (site keeps working if the cloud is down), same-origin `GET /wp-json/sceneflow/v1/project/:id`, `[sceneflow id]` shortcode, “SceneFlow Video” Gutenberg block, **element placements** (mount the player into any existing element picked visually — replace / before / after / append / prepend), visual **element picker** (`?sceneflow_pick=TOKEN`, posts the CSS selector to the SceneFlow app), draft **preview inside the theme** (`?sceneflow_preview=TOKEN&sceneflow_embed=1`), media-library listing, admin page, WP-CLI commands, uninstall cleanup. PHP tests share a signature fixture with the Node implementation.
- `@sceneflow/server`: connector client (health, pairing, signed publish/preview/pick-session/pages/placements/media), signature utilities, AES-256-GCM secret encryption. Migration `0001`: sites (secret, rest base, versions, capabilities), `site_publications`, `placements`.
- API: `POST /sites/connect`, `GET /sites`, `GET/POST /sites/:id/check|pages|pick-session|media`, `DELETE /sites/:id`; projects gain `siteId`, publish pushes to the site and records the result, `POST /projects/:id/preview-session`, placements CRUD. Private/local site URLs are allowed outside production (`ALLOW_PRIVATE_SITES`). Plugin zip served at `/downloads/sceneflow.zip`.
- Web: WordPress sites card (connect, re-check, disconnect, download plugin), project page step 3 (site selector, publish-to-site result, shortcode, “Preview draft on site”), step 4 “Place on your site” (page search, iframe element picker, insert mode, manual selector fallback, list/remove), editor “Preview on site”.
- Tests: fake-WordPress integration test (pairing, publish push, failed signature path, preview, pages, pick, placements, media), 21 PHP assertions, 81 Node tests. Verified for real against a LocalWP site (`development.local`).

### Decisions
- Placements are injected client-side by the plugin's init script (no theme/page edits); a server-side injection path can follow if layout shift matters.
- Pairing model: the plugin shows a code, the cloud generates the shared secret and hands it over once; secrets are encrypted at rest on both sides.

### Deferred
- Elementor / Bricks / Divi / Breakdance native widgets (the shortcode works in all of them today).
- WooCommerce product picker and cart actions (Phase 5).

## Phase 3 — Timeline and Playback (2026-11-09)

### Added
- Schema: layer `animation` (enter/exit: fade, slide ×4, zoom; duration, delay), `assetId` on layers, audio layers, Scroll Scrub settings (`pin`, `scrollDistance`, `scrollAxis`, `smoothness`, `startOffset`/`endOffset`, `showProgress`, `mobileFallback`, `reducedMotion`). `layerMotion()` is a pure function of time, so motion scrubs correctly in both directions. 20 tests.
- `@sceneflow/editor`: `setLayerTiming`, `moveLayerClip`, `splitLayer`, `splitScene`, `moveSceneBoundary`, `snapTime`, `rulerStep`, `projectDuration`. 27 tests.
- `@sceneflow/core`: **Scroll Scrub engine** — pinned sticky container sized from `scrollDistance`, scroll → time mapping (forward and backward), smoothing, dead zones, progress bar, native controls hidden, muted; phone and reduced-motion fallbacks (AC-006). Enter/exit motion applied per tick; audio layers kept in sync with the clock; `Stage.setPreviewTime()` for editor scrubbing. 19 tests; bundle 23.7 KB gzip.
- Worker: `waveform.json` peaks for anything with audio; `audio.m4a` web variant for audio uploads. 3 tests.
- Web editor (Advanced mode): **Timeline** with ruler, zoom/fit, draggable playhead and scrubbing, scene track with draggable scene boundaries, virtualized layer tracks, clip move/trim with magnetic snapping (scene edges, other clips, playhead), waveforms on audio clips, split element/scene at playhead, play/pause (Space) with the canvas following the playhead (visibility, motion and the video frame). Playback time lives in a separate store so it never re-renders the editor tree.
- Inspector: **Motion** tab (enter/exit), Audio element (file, volume, timing), Scroll Scrub settings under Project.
- Login: show/hide password toggle.

### Deferred
- Markers and animation presets library (Phase 7), audio in editor playback (preview page plays it), scene transitions animation.

## Phase 2 — Editor (2026-11-09)

### Added
- `@sceneflow/schema`: `canvas.aspectRatio`, resolved `src`/`poster` on scene backgrounds, `resolveLayer()` (desktop → tablet → mobile cascade), timing helpers. 16 tests.
- `@sceneflow/editor` (framework-free domain package): geometry (move, anchored resize, rotate, snapping with guides, align, distribute), scene ops (add/duplicate/remove/reorder with contiguous timing), layer ops (add with strong defaults, duplicate, paste, reorder, lock/hide), responsive overrides, undo/redo history with gesture coalescing. 20 tests.
- `@sceneflow/core`: `Stage` renderer shared by runtime and editor — text, image, shape, badge, button, hotspot; percent geometry; styles scale with stage width; time-based visibility; typed actions (open URL, go to scene, seek, toggle layer, commerce hooks + events). Player now has two models: base video (scenes are time ranges) and scene-based (each scene brings its own background). 11 tests; bundle 21.5 KB gzip.
- API: `PUT /api/v1/projects/:id/draft` autosave (updates the latest draft version in place; published versions stay immutable). 7 tests.
- Web editor at `/projects/:id/editor`: scenes panel, canvas with drag / resize / rotate / smart guides / safe area / multi-select, inspector (content, style, layout, action; scene background, transition; project canvas + playback in Advanced), layers panel (Advanced), Simple/Advanced modes, device switch with per-device overrides and reset, undo/redo, keyboard shortcuts, autosave (1.2 s debounce), publish, draft preview at `/projects/:id/preview` running the real runtime.

### Deferred
- Timeline, trimming and scroll-scrub playback (Phase 3). Scene transitions are stored but not animated yet.
- Product picker and commerce elements (Phase 5): the action editor accepts a product ID for now.

## Phase 1 — Foundation (2026-11-09)

### Added
- Monorepo: pnpm workspaces + Turborepo, TypeScript strict, Vitest.
- `@sceneflow/schema`: project JSON schema v1.0 (scenes, layers, typed actions, playback, responsive overrides) with URL allowlisting, size limit, unknown-field stripping and major-version gate. 10 unit tests.
- `@sceneflow/core`: runtime skeleton — `Player` with `init/play/pause/seek/goToScene/getState/destroy`, events `ready/sceneChange/complete/error`, poster-first rendering, lazy media mount via IntersectionObserver. IIFE bundle `sceneflow.runtime.min.js` (17 KB gzip, budget 80 KB). 5 tests.
- `@sceneflow/server`: Drizzle schema + first migration (users, sessions, workspaces, members, sites, projects, project_versions, media_assets), HMAC helpers, `StorageProvider` interface + local-disk provider with signed upload URLs, pg-boss queue (Postgres only, no Redis).
- `@sceneflow/api`: register/login/logout/me, workspaces, projects CRUD, immutable versions (server assigns projectId + version), publish/rollback-ready, signed direct uploads (PUT handler for the local provider), media listing, public `/p/:id.json`, `/runtime/*`, `/demo/:id`. Rate limits on auth + publish. 6 integration tests.
- `@sceneflow/worker`: FFmpeg processing (metadata, poster, seek-friendly 540p proxy, thumbnails, WebP image variant). 2 integration tests.
- `@sceneflow/web` (Next.js 15): sign in / create account, project list, project page with drag-and-drop upload (progress + processing status), simple CTA button, publish, live preview link, embed snippet, version history.
- Root `pnpm bootstrap` creates `.env` files; `pnpm dev` runs web + API + worker; `pnpm smoke` runs an end-to-end check against a running stack.
- Default API port is 4800 (LocalWP occupies 4000 on the dev machine).

### Decisions
- Local dev and VPS run without Docker and without Redis (queue lives in Postgres).
- FFmpeg binaries come from `@ffmpeg-installer` / `@ffprobe-installer` (npm-hosted, no GitHub download at install).
- Drizzle ORM instead of Prisma (single schema file, simpler deploy).
- Uploads: oversize bodies answered with 413 without destroying the socket.

### Carried forward
- S3/R2 storage provider (interface ready; TODO phase-6).
- The project page's "Use this video" step is a stand-in for the Phase 2 scene editor.
