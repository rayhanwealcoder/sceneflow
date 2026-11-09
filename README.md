# SceneFlow

AI-assisted interactive and shoppable video platform. Source of truth: `docs/SceneFlow_AI_Implementation_Handoff_v1.0.md`. New here? Read **[docs/getting-started.md](docs/getting-started.md)** (using the product + running the repo).

## Run it locally (3 steps)

Requirements: Node 20.6+ and PostgreSQL (local install, no Docker). pnpm is installed with `npm i -g pnpm`.

```bash
pnpm install
pnpm bootstrap  # creates apps/api/.env and apps/worker/.env with a fresh secret
pnpm build && pnpm dev
```

- App (sign in, projects, upload, publish): http://localhost:3000
- API: http://localhost:4800 (health: `/health`)
- Worker: processes uploads in the background (FFmpeg ships with the npm packages, nothing to install). Fast path first (poster + 540p proxy), then 720p/1080p + scroll-optimized renditions; `WORKER_CONCURRENCY` controls the fast path.
- Demo player for a published project: `http://localhost:4800/demo/<projectId>`

Port 4800 was chosen because LocalWP uses 4000 on this machine.

The default `.env` points at `postgresql://postgres:sceneflow_dev@localhost:5432/sceneflow`. Change `DATABASE_URL` if your Postgres differs.
Migrations run automatically when the API starts.

Storage defaults to the local disk (`STORAGE_PROVIDER=local`). For Cloudflare R2 / AWS S3 / MinIO set `STORAGE_PROVIDER=s3` plus the `S3_*` variables in **both** `apps/api/.env` and `apps/worker/.env` (see `.env.example`). Nothing else changes.

## Tests

```bash
pnpm test        # unit (schema, core, editor) + integration (server, api, worker) — needs the `sceneflow_test` database
pnpm typecheck
```

Create the test database once: `psql -U postgres -c "create database sceneflow_test;"`.

End-to-end scripts against a **running** stack (`pnpm dev` or the built servers): `pnpm smoke` (upload → publish), `node scripts/e2e/perf.mjs` (renditions, device sources, diagnostics), `node scripts/e2e/presets.mjs` (brand kit, presets, templates, connector zips), `node scripts/e2e/wp-commerce.mjs <pairing-code>` (WooCommerce on the LocalWP site). Four of them drive a real Chrome through `playwright-core` (uses the installed Chrome, nothing to download): `node scripts/e2e/pages.mjs` walks every page and fails on any page error; `node scripts/e2e/scroll-smoothness.mjs` measures scroll-scrub frame updates and seek latency on a generated clip; `node scripts/e2e/analytics.mjs` plays a published video and checks the Analytics summary; `node scripts/e2e/ai.mjs --record` runs the AI flow through the UI and saves a walkthrough video to `dist/walkthrough/`.

## Layout

```
apps/web          Next.js app: sign in, projects, brand kit, upload, scene editor + timeline + presets (/projects/:id/editor), draft preview, publish, embed snippet
packages/editor   Framework-free editor domain: geometry, scene/layer operations, responsive overrides, undo history, templates, presets, brand kit
apps/api          Fastify API: auth, workspaces, projects, versions, publish, media uploads, commerce catalogs, presets, brand kits, AI (script/copy/voiceover/captions), analytics, public runtime config
apps/worker       Media processing jobs (pg-boss on Postgres): metadata, poster, proxy, thumbnails, renditions
packages/schema   Project JSON schema (Zod) — the single platform-agnostic format (+ preset and brand kit schemas)
packages/core     Published runtime (window.SceneFlow): poster-first, lazy, typed events, commerce adapters, plain embed, no editor code
packages/server   Shared backend bits: Drizzle schema + migrations, storage providers, queue, connector protocol, catalogs
connectors/       Platform connectors released as zips: wordpress/ (plugin), shopify/ (theme app extension), webflow/ (plain embed)
```

## Connectors (released from this repo)

```bash
pnpm build:connectors   # dist/connectors/sceneflow-wordpress.zip, sceneflow-shopify.zip, sceneflow-webflow.zip + manifest.json
pnpm build:wp           # WordPress only (served by the API at /downloads/sceneflow-wordpress.zip)
pnpm test:wp            # plain-PHP plugin tests; run `pnpm --filter @sceneflow/server test` first to generate the signature fixture
```

- **WordPress**: install the zip, Settings → SceneFlow → “Connect with SceneFlow” (one click; pairing code as fallback). For a local app: `wp option update sceneflow_app_url http://localhost:3000`. WP-CLI: `wp sceneflow pairing-code|status|disconnect`. Coding standard: `phpcs --standard=WordPress connectors/wordpress/sceneflow`; `wp plugin check sceneflow`.
- **Shopify**: theme app extension with a “SceneFlow video” block + the Shopify cart adapter (`connectors/shopify/README.md`).
- **Webflow / any site**: one script tag with `data-auto` + `<div data-sceneflow-id="…">` (`connectors/webflow/README.md`).

Each connector folder has a `connector.json` and a get-started `README.md`; see `connectors/README.md`.

## Commerce (adapter based)

- **WooCommerce**: connect the site, pick products in the editor, the player adds to the real cart (Store API). Nothing to configure.
- **No WooCommerce**: use “My products” (name, price, image, link) — product cards open the link (payment link, Gumroad, any store).
- **Shopify / custom**: register a runtime adapter on the page: `SceneFlow.commerce.register(SceneFlow.createShopifyAdapter())` (the Shopify connector does this) or your own object implementing `addToCart` (see `packages/core/src/commerce.ts`).

## Analytics

The runtime sends anonymous, batched playback events (loads, plays, quartiles, scene changes, clicks, add-to-carts, watched ranges) to `POST /api/v1/analytics/events`; the project page's **Analytics** view shows totals, loads vs plays per day, an engagement timeline, a funnel and per-element / scene / product / page tables. No cookies, no IP addresses, Do Not Track respected; WordPress sites can switch it off in Settings → SceneFlow. Need footage? `docs/ai-video-prompts.md` has prompts for AI video tools tuned for overlays and scroll-scrub.

## AI (optional, provider based)

✨ AI in the editor writes a script + storyboard from a brief and builds the scenes, suggests copy for any element, generates a voiceover per scene and makes captions (shown by the runtime with a CC button). Providers live in `packages/server/src/ai`: Claude through `@anthropic-ai/sdk` (`ANTHROPIC_API_KEY`), ElevenLabs for voices and transcription (`ELEVENLABS_API_KEY`), and no-key fallbacks (starter text, the OS voice) so the flow always works. `GET /api/v1/ai/status` tells the editor what is configured.

## Presets and brand kit

- Starter presets (elements, scenes, motions) ship in `packages/editor/src/presets.ts`; users save their own (elements, scenes, templates) to the cloud library (`/api/v1/presets`). Applying a preset is always an independent copy; newer library versions are offered per element, never pushed.
- Brand kit (`/api/v1/brand-kits`): colours, fonts, logo, button and card style per workspace. New projects and new elements follow it; `applyBrandKit()` re-styles an existing project on request.

See `docs/architecture.md` for decisions and `CHANGELOG.md` for progress by phase.

## Deploying to a VPS (no Docker)

1. Install Node 20+, PostgreSQL, pnpm. Create a database and user.
2. Clone, `pnpm install`, `pnpm build`, `pnpm build:connectors`.
3. Copy `.env.example` → `.env` in `apps/api` and `apps/worker`; set `DATABASE_URL`, a long `SESSION_SECRET`, `PUBLIC_URL=https://api.yourdomain`, `WEB_ORIGIN`, `STORAGE_DIR=/var/lib/sceneflow` (or the `S3_*` variables for R2).
4. Set `NEXT_PUBLIC_API_URL=https://api.yourdomain` in `apps/web/.env` before `pnpm build` (it is baked into the web bundle).
5. Run `pnpm --filter @sceneflow/api start`, `pnpm --filter @sceneflow/worker start` and `pnpm --filter @sceneflow/web start` under pm2; put nginx in front with `client_max_body_size 2g` for `/uploads/`.
6. Smoke-test the deployment: `API_URL=https://api.yourdomain pnpm smoke`.
