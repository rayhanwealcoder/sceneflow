# Architecture notes

The handoff document (`SceneFlow_AI_Implementation_Handoff_v1.0.md`) is the source of truth. This file records how the phases map to it and the choices made where the document left room.

## Boundaries

| Layer | Package | Rule |
| --- | --- | --- |
| Project format | `packages/schema` | One Zod schema; everything else imports types from here. No executable code in config, URLs allowlisted to http(s). |
| Runtime | `packages/core` | Zero platform code, zero editor code. Ships as ESM (for React/embed wrappers) and as an IIFE bundle (`window.SceneFlow`). Size budget enforced at build. |
| Backend shared | `packages/server` | DB schema/migrations, storage + queue providers and commerce catalogs behind interfaces. |
| API | `apps/api` | Fastify. Routes are thin; auth and workspace roles are checked per request. |
| Worker | `apps/worker` | Heavy work only (FFmpeg). Never touches HTTP. |
| Connectors | `connectors/*` | Delivery layers over `@sceneflow/core`, released as zips: WordPress plugin (+ WooCommerce adapter), Shopify theme app extension (+ Shopify adapter), Webflow / plain embed. No editor code. |

## Adapters: nothing is mandatory

Every external system sits behind an interface with at least two implementations, so a deployment picks by configuration and the product works with none of them:

| Concern | Interface | Implementations | Chosen by |
| --- | --- | --- | --- |
| File storage | `StorageProvider` (`packages/server/src/storage`) | `local` (disk, signed PUT handler) · `s3` (Cloudflare R2, AWS S3, MinIO, B2 via presigned PUT) | `STORAGE_PROVIDER` env, same for API and worker |
| Product catalog (editor picker) | `CatalogProvider` (`packages/server/src/commerce/catalog.ts`) | `woocommerce` (signed connector) · `manual` (hand-entered products in Postgres) | the project's connected site capabilities; manual is always there |
| Cart / live products (runtime) | `CommerceAdapter` (`packages/core/src/commerce.ts`) | `woocommerce` (plugin JS, Store API) · `shopify` (AJAX cart API, `createShopifyAdapter`) · `link` fallback (opens the product URL) | `SceneFlow.commerce.register()` on the host page; resolved per product `provider` |
| Job queue | pg-boss on Postgres | — | no Redis anywhere |
| Site delivery | connector protocol / public config | WordPress plugin (signed push, same-origin config) · Shopify theme app extension and plain embed (`data-sceneflow-id`, config fetched from the API with CORS) | per site |

Cloudflare is therefore optional: R2 is one `STORAGE_PROVIDER=s3` endpoint among others, and no Cloudflare Stream / Workers are required.

## Infrastructure (deliberately small)

- **Postgres only.** The job queue is pg-boss, so there is no Redis to install locally or on the VPS.
- **No Docker.** Local uses the native PostgreSQL 17 install; the VPS uses its existing Postgres.
- **Storage** is behind `StorageProvider`. Local: originals under `<STORAGE_DIR>/originals` (never served), derived files under `<STORAGE_DIR>/public` (served at `/files/*`), upload URLs HMAC-signed. S3-compatible: originals under `originals/`, derived under `public/`, uploads are presigned PUTs with Content-Type and Content-Length in the signature; the browser then calls `POST /media/uploads/:id/complete`, which HEADs the object and queues processing. The worker downloads originals to a temp folder before FFmpeg.
- **FFmpeg** binaries are installed from npm (`@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`).

## Data flow

```
browser -> POST /api/v1/media/uploads        (asset row: pending, signed/presigned PUT url, optional complete url)
browser -> PUT  <upload url>                 (local handler streams to disk; S3/R2 takes the presigned PUT)
browser -> POST /api/v1/media/uploads/:id/complete   (remote storage only: HEAD check, then enqueue)
api     -> pg-boss send media.process
worker  -> ffprobe + ffmpeg -> poster.jpg, proxy-540.mp4, thumb-*.jpg, waveform.json -> public storage
editor  -> PUT  /api/v1/projects/:id/draft    (autosave; server assigns projectId + version, validates schema)
editor  -> POST /api/v1/projects/:id/publish  (marks version published; pushes signed config to the site)
site    -> GET  /wp-json/sceneflow/v1/project/<id>  (same-origin, etag = checksum)  -> SceneFlow.Player
```

## Security choices

- Sessions: random 256-bit token in an httpOnly, SameSite=Lax cookie; only its SHA-256 is stored. Passwords: scrypt.
- Workspace roles: viewer < editor < admin < owner; every project/media/product route resolves the workspace and checks membership.
- Project config is validated on write (`parseProject`) and again by the runtime on read; product URLs/images are http(s) only, catalog responses are re-normalized server side.
- Rate limits: auth 10/min, publish 30/min (per IP). Upload PUT is bounded by the signed declared size and `MAX_UPLOAD_MB`.
- Public endpoints expose only published configs, derived media and (WooCommerce) published product data, never originals or editor code.

## Editor (Phase 2)

- `packages/editor` holds every document operation as a pure `Project -> Project` function plus geometry and history. The React app only wires UI events to these functions through a small zustand store (`apps/web/lib/editorStore.ts`), so the editor logic is unit-tested without a browser.
- The canvas paints layers with the **same `Stage` renderer the published runtime uses** (`packages/core/src/stage.ts`, `editing: true`), and overlays transparent hit boxes + handles for interaction. What the user sees is what the embed renders.
- Geometry is stored as percentages of the stage; numeric style values (font size, radius, padding) are authored at a 1280 px reference and scaled with `--sf-scale`, so layouts hold on any embed width.
- Responsive overrides cascade desktop → tablet → mobile. Editing on tablet/mobile writes only the changed fields into `layer.responsive[device]`; the inspector shows a reset.
- Autosave: `PUT /projects/:id/draft` rewrites the latest *draft* version in place; after publishing, the next save opens a new draft version. Publishing therefore never mutates a live version.

## Timeline and playback (Phase 3)

- One clock, three drivers: the base video's `timeupdate`, the scenes-mode rAF loop, or page scroll (Scroll Scrub). All three end in `renderTime(t)`, which updates the stage, audio layers and the progress bar — so behaviour is identical regardless of what moves time.
- Motion is **stateless**: `layerMotion(layer, scene, t)` returns the opacity/transform for a time. Nothing is "played"; this is what makes reverse scrubbing and timeline jumps correct for free.
- Scroll Scrub: `.sf-scroll` gets `height = scrollDistance`; the player inside is `position: sticky`. Progress is `(scrollY - containerTop) / (containerHeight - viewport)`, remapped through dead zones and smoothed per frame (`scroll.ts`, pure and unit-tested). Video is muted, `preload=auto`, never played — only `currentTime` is set, which the 1 s-keyframe proxy makes cheap.
- Fallbacks are resolved once at mount (`resolveMode`): `prefers-reduced-motion` → `reducedMotion`, width < 640 → `mobileFallback`.
- Editor playback uses a separate zustand store (`lib/playhead.ts`); the canvas, playhead line and time label subscribe imperatively, so a running playhead re-renders nothing else.

## WordPress connector (Phase 4)

- The plugin is a delivery layer only: it stores published configs locally and serves them same-origin; the editor never ships to WordPress. The packaged runtime (`assets/sceneflow.runtime.min.js`, plus a readable `sceneflow.runtime.js`) is the same bundle as `@sceneflow/core`.
- Protocol: `canonical = METHOD \n ROUTE \n TIMESTAMP \n NONCE \n sha256(BODY)`, HMAC-SHA256 with a per-site secret, ±300 s skew, nonces stored as transients. `packages/server/src/connector.ts` and `includes/class-sceneflow-signature.php` are kept in lock-step by a shared fixture (`connectors/wordpress/sceneflow/tests/fixtures/signature.json`, generated by the Node test, verified by `php tests/run.php`).
- Pairing: the plugin issues a one-time 8-character code; the cloud generates `siteId` + secret and posts them to `/connect` together with the code. Both sides encrypt the secret at rest (AES-256-GCM in Postgres, AES-256-CBC with the WP auth salt in options). **One-click connect** (Phase 5) reuses the same code: wp-admin redirects the admin to `<app>/connect?site&code&return`, the app calls `/sites/connect` after login/approval and sends the browser back to wp-admin. The return URL must share the site's origin.
- Publishing sends `configJson` as a string plus its sha256; the plugin re-validates (size, schema major, project id, no `javascript:`/`data:` URLs) before storing. jsonb reorders keys, so the API serializes and hashes right before sending.
- Element placements: the cloud owns the placement id; the plugin stores `(post_id | path, selector, mode)` and, on matching requests, inlines `window.SceneFlowPlacements` so `sceneflow-init.js` can mount players into the picked elements. The picker runs on the real page inside an iframe (`?sceneflow_pick=TOKEN`) and `postMessage`s the selector to the app origin recorded at pairing.
- Draft preview: `/preview-session` stores the draft in a 30-minute transient; `/?sceneflow_preview=TOKEN&sceneflow_embed=1` renders a bare theme page with the player, and the same token overrides that project's shortcode/placements on any page. Tokens are lowercase so they survive `sanitize_key()` and case-sensitive object caches.

## Commerce (Phase 5)

- **Config side**: a `ProductRef` (`provider`, `productId`, optional `variantId`, plus a display snapshot: title, price, image, url, inStock) lives on `product` layers and on `ADD_TO_CART` / `BUY_NOW` / `VIEW_PRODUCT` actions. The snapshot makes a published video render on any site; the adapter only *improves* it with live data. Legacy `productId` actions are upgraded on parse.
- **Runtime side**: the player resolves `SceneFlow.commerce.resolve(ref.provider)` → exact adapter, else the site default, else the link fallback. Product cards hydrate once per product per player (`adapter.getProduct`), show variants/stock/price, and the card button composes the action from the current selection. Results surface as an in-player toast (`.sf-toast`) and as events (`addToCart`, `buyNow`, `couponApplied`, `productClick`).
- **WooCommerce**: `class-sceneflow-woocommerce.php` normalizes products (doc §14.1) for the signed `/products` routes (editor picker) and a public, cached `/product/:id` (front-end hydration). `assets/sceneflow-woo.js` registers the adapter before `sceneflow-init.js` runs and drives the cart through the Store API (`/cart/add-item`, `/cart/apply-coupon`), refreshing the nonce from responses and notifying classic fragments + the block mini cart. Payments never pass through SceneFlow.
- **Without WooCommerce**: the `manual` catalog stores products in Postgres (`catalog_products`) for sites with no shop system, payment links or Shopify; the Shopify runtime adapter is shipped but not yet exercised against a live store.

## Performance (Phase 6)

- **Two-stage processing**: `media.process` (fast: poster, 540p proxy, thumbnails, waveform → asset "ready") then `media.renditions` (slow: 720p/1080p progressive, scroll-optimized MP4 for ≤ 3 min clips). Progress is written to `metadataJson.progress`; rendition state to `metadataJson.renditions`. The editor works on the proxy the whole time.
- **Device profiles**: configs carry `sources[]` per video; `pickSource()` chooses by rendered width × DPR, bounded by the connection profile (`saveData`/2g/3g → ≤ 540p; retina on fast networks may exceed 1080p). Scroll mode prefers `kind: "scrub"`. `src` remains the universal fallback (set to 720p at publish when available).
- **Publish-time resolution** keeps versions self-contained: `resolvePublishedMedia()` rewrites the version's config right before it is marked published; nothing is resolved at play time, so the WordPress copy is complete.
- **Runtime split**: the core IIFE has zero platform code; platform adapters are separate files (`sceneflow.shopify.min.js`, the WooCommerce adapter inside the plugin). Budget check stays on the core.
- **Onboarding**: templates are pure data in `packages/editor/src/templates.ts`; the tour anchors on `data-tour` attributes and stores completion in localStorage only; the checklist derives from real state; diagnostics live in the API (`GET /projects/:id/diagnostics`) so the same checks can later feed support tooling.

## Presets and brand kits (Phase 7)

- **One shape for every preset**: `Preset { id, type, scope, name, inputs, version, config }` with `config` a discriminated union (`element` → layers, `scene` → scene, `animation` → enter/exit, `template` → project). Official presets are code in `packages/editor/src/presets.ts` (scope `official`), library presets are rows in `presets` (scope `personal` | `workspace`); the editor treats both the same.
- **Independent copies (doc 22.3)**: applying regenerates every id, remaps `TOGGLE_LAYER` / `GO_TO_SCENE` inside the copy, re-chains scene timing and stamps `preset: { id, version, part }` on the copies. Nothing links back; `outdatedPresets()` compares the stamps against the library and `refreshFromPreset()` pulls style + motion into one element only when the user asks. Replacing a library preset's content bumps its `version` server-side.
- **Smart inputs**: `detectInputs()` derives what the user still has to supply (product, logo, image, link, video) from the config; the panel shows "Needs your product" and the save dialog tells the author.
- **Brand kit as a transform**: `applyBrandKit(project, kit)` is a pure function used in three places — templates at creation, `createLayer()` for new elements, and "Apply brand kit" in the editor. The project records `brand: { kitId, version }` so a changed kit is *offered*, never pushed. Text colours over video are deliberately left alone. Web fonts: the editor always previews Google fonts; the published page loads them only with the kit's opt-in (`project.fonts.google`, names validated to `[A-Za-z0-9 ]`).
- **Thumbnails** are the real `Stage` renderer at small size, so a preset looks exactly like what lands on the canvas.
- **Connectors folder**: `connectors/<platform>/connector.json` + `README.md`; `scripts/build-connectors.mjs` copies the runtime in, zips each connector and writes `dist/connectors/manifest.json` (versions, sha256). The runtime gained a platform-neutral embed (`SceneFlow.mount()`, `<script data-auto>`) so Webflow-style sites need no connector code beyond a script tag; the Shopify theme app extension uses the same embed plus the Shopify adapter module.

## Scroll-scrub smoothness (Phase 8 prelude)

- **Seek coalescing** (`nextSeek()` in `scroll.ts`): browsers cancel an in-flight seek when `currentTime` is set again, and a cancelled seek never paints. Setting it on every scroll tick therefore showed *fewer* frames. Rule: one seek in flight, remember only the newest wanted time, apply it on `seeked`.
- **Whole-file download** in scroll mode: the scrub rendition (≤ 40 MB) is fetched once and swapped in as an object URL via a double-buffered second `<video>` (seeked to the current frame before the swap), so no range request can stall a scroll. Needs CORS on the media origin (`/files/*` sends `*`; buckets need a GET CORS rule); without it the player keeps streaming.
- **Encoding**: the scrub MP4 is 30 fps, keyframe every 4 frames, no B-frames, one reference frame — a seek decodes at most 3 frames.
- Measured in a real Chrome (`scripts/e2e/scroll-smoothness.mjs`, dummy 10 s clip, steady 12 px/frame scroll down and back): new pipeline paints a new frame on 95 % of animation frames, seek p95 7 ms; the previous 720p 2 s-GOP file managed 73 % and 33 ms.

## Analytics (Phase 8)

- **Event client** (`packages/core/src/analytics.ts`, ~1.5 KB gzip): doc §24.1 events plus `watch` ranges (from → to seconds, closed every 5 s / on pause, seek, scene change, hide) and `coupon_applied`. Batches of ≤ 20 leave every 4 s as a `text/plain` POST (no CORS preflight), the remainder on `pagehide` via `sendBeacon`. Session id = random per-tab value in sessionStorage; no cookies; Do Not Track / Global Privacy Control switch it off entirely. The published config carries `analytics.endpoint` (stamped at publish) and `analytics.enabled`; hosts can also pass `analytics: false` to the Player (the WordPress plugin exposes this as a setting).
- **Ingest** `POST /api/v1/analytics/events`: CORS `*` for this path only (cors `delegator`), 240 req/min per IP, ≤ 50 events, Zod-validated, timestamps clamped to ±1 day, event ids are the primary key (`ON CONFLICT DO NOTHING`), only published projects are stored (positive lookups cached 60 s). No IP address is written.
- **Summary** `GET /projects/:id/analytics?days=7|30|90`: one SQL pass per block — totals with `count(…) filter`, per-day series, engagement timeline (50 buckets × distinct sessions whose `watch` range overlaps the bucket, via `generate_series`), scenes, elements (impressions / clicks / CTR), products, devices, pages. Names come from the published config, so renamed elements stay readable.
- **Dashboard** (`/projects/:id/analytics`): stat tiles, loads-vs-plays line chart, engagement timeline with scene bands, funnel (loaded → played → 25/50/75 → finished), devices, tables. Hand-written SVG; two fixed categorical hues from a validated palette (`--viz-1/2`, separate dark steps), thin marks, hover tooltips, text in text tokens.

## AI assistance (Phase 9)

- **Providers behind interfaces** (`packages/server/src/ai`): `TextProvider` (script, copy), `SpeechProvider` (voiceover), `TranscriptionProvider` (captions from audio). `createAi(env)` wires them from environment variables and *always* returns something usable: Claude (`@anthropic-ai/sdk`, `messages.parse` + `zodOutputFormat`, model `claude-opus-5-5`) or the rule-based `starter` text; ElevenLabs or the operating system's voice (`sapi` / `say` / `espeak-ng`); ElevenLabs Scribe or nothing. `GET /api/v1/ai/status` reports the slots plus one-line setup hints, so the panel can say "starter text — add ANTHROPIC_API_KEY".
- **Validate at the boundary**: the model fills a plain shape (strings / numbers only) and `aiScriptSchema` tightens it (lengths, 1–12 scenes, safe CTA URL). A provider can never produce something the editor cannot load.
- **AI output is ordinary content**: `applyScript()` produces scenes and layers like a template would (brand kit applied, CTA action from the script link or the cart); `scene.script` keeps the voiceover line and shot description for later steps and is stripped at publish. Undo works on every AI step because they all go through the same `apply()`.
- **Voiceover = media asset**: the API synthesizes, writes the original with `StorageProvider.putOriginal()` (new; local + S3) and queues the normal `media.process` job, so the worker makes the m4a + waveform exactly as for an upload. The editor polls the asset and places an `audio` layer flagged `content.voiceover: true` (replacing an older take; the scene grows to fit the line). The runtime already played audio layers.
- **Captions on the project clock**: `project.captions.cues` (start / end / text in project seconds, ≤ 2000, non-overlapping via `normalizeCues`). Default timing is estimated from the text — sentence / clause pieces ≤ 64 chars, duration proportional to length with a 0.8 s floor — over the exact window of the scene's voiceover audio when it exists. Transcription (word timings → `wordsToCues`) is the upgrade. The runtime renders the bar itself (`cueAt` binary search in `renderTime`), which also works for scene-based projects and scroll-scrub; the CC choice is per browser (`localStorage sf_cc`).
- **Untrusted text never reaches a command line**: the spoken text goes to the OS voice through a temp file; a voice id must be an identifier *and* one the machine listed; `psString()` doubles every quote PowerShell understands (ASCII and U+2018–U+201B). This came out of the phase's security review — apostrophe-only escaping is a known bypass.
- **Sign-in protection** (`apps/api/src/lib/loginGuard.ts`): per-account and per-address failure counters with progressive blocks on top of the per-IP request limit; `TRUST_PROXY` decides whether `X-Forwarded-For` is believed (off unless behind a proxy). Baseline security headers are set in `app.ts` (API) and `next.config.ts` (web).
- **Zod versions**: the Anthropic SDK's structured-output helper speaks Zod 4, the repo's schemas stay on the classic API; both come from the same `zod` ≥ 3.25 package (`zod` vs `zod/v4` imports). Adding the SDK also pulled `@opentelemetry/api` into one package, which gave `drizzle-orm` two peer sets and broke type identity across packages — every drizzle user now lists that optional peer, so one copy resolves.

## Agency workflow (Phase 10)

- **Two doors, one project** (`apps/api/src/routes/review.ts`): signed-in members use `/api/v1/projects/:id/comments` and `/review`; clients use `/api/v1/review/:token/*`. Both write to the same `comments` table (`source` says who), so the editor panel, the review page and the dashboard are three views of one thread. Client routes are rate-limited and answer 404 (unknown / revoked) or 410 (expired); the token is 32 random bytes, stored as sha256 for lookup *and* AES-GCM encrypted (`siteSecretKey`) so the project page can show the link again — a hash alone would force a new link on every visit.
- **Approval is a checksum, not a version**. Autosave edits the latest draft row in place until it is published, so `approved_version` alone cannot tell an approved draft from one edited afterwards. `approved_checksum` is compared with the draft's checksum at publish time (`approvalCurrent()`); the UI derives "Approved · edited since" the same way. Publish enforces it only for editors (`roleAtLeast(role, "admin")` bypasses) — doc §23 "role-based publish permission".
- **Comments are anchors, not document data**: `t` (project seconds), `scene_id`, `layer_id`, `x`/`y` in stage percent. They are independent of the project JSON (no undo, never published) and live in their own zustand store (`apps/web/lib/commentsStore.ts`). The canvas renders pins for the current scene and turns one click into an anchor while "placing"; elements ignore the pointer during placing via CSS so the click reaches the overlay. Mentions are resolved server-side against workspace members (`parseMentions`: longest name first, full name before first name, each `@` claimed once) and stored as user ids, which makes "mentions of you" a `jsonb ? userId` query.
- **Invitations without e-mail**: `workspace_invites` holds a token hash, role, optional e-mail restriction, expiry (7 days) and acceptance; the admin copies the link. Accepting never downgrades an existing member. The web app gained a real multi-workspace model (`useSession().workspace`, switcher in the header, remembered in `localStorage`), which every page uses instead of "the first workspace".
- **Dashboard = one query per concern**: projects, clients and sites of the workspace, then `comments` grouped by project, `analytics_events` of the last 7 days grouped by project, mentions of the caller, and the activity feed — six round trips, no N+1. Alerts are derived in code from those rows (site error, waiting ≥ 3 days, approved-unpublished, changes requested, player errors, stale draft) and sorted by severity. `project_activity` is written by the routes that change state (`logActivity` never throws — the feed must not break an approval).

## Open items carried forward

- Elementor / Bricks / Divi / Breakdance native widgets (the shortcode and placements already work inside them).
- Shopify / Easy Digital Downloads / SureCart catalogs on the server side (runtime adapter pattern is ready); Shopify extension not yet exercised on a live store.
- Preset marketplace / sharing across workspaces (agency scope), scene-level "refresh from preset".
- Analytics: revenue / conversion attribution (doc 24.2) needs order webhooks from the shop; A/B comparison; CSV export; retention policy for `analytics_events`.
- E-mail (SMTP) for invitations, mentions, approvals and password reset; client portal with several projects per link.
