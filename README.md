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

E-mail is optional: without `MAIL_*` settings, password-reset links, invitations and "your video is ready" are written to `<STORAGE_DIR>/outbox/*.json` (links also in the API log) and the pages say so. For real mail set `MAIL_FROM` plus `RESEND_API_KEY` (Resend, HTTP) or `SMTP_URL` (any SMTP server) in `apps/api/.env` and `apps/worker/.env`.

## Tests

```bash
pnpm test        # unit (schema, core, editor) + integration (server, api, worker) — needs the `sceneflow_test` database
pnpm typecheck
```

Create the test database once: `psql -U postgres -c "create database sceneflow_test;"`.

End-to-end scripts against a **running** stack (`pnpm dev` or the built servers): `pnpm smoke` (upload → publish), `node scripts/e2e/perf.mjs` (renditions, device sources, diagnostics), `node scripts/e2e/presets.mjs` (brand kit, presets, templates, connector zips), `node scripts/e2e/wp-commerce.mjs <pairing-code>` (WooCommerce on the LocalWP site). Four of them drive a real Chrome through `playwright-core` (uses the installed Chrome, nothing to download): `node scripts/e2e/pages.mjs` walks every page and fails on any page error; `node scripts/e2e/scroll-smoothness.mjs` measures scroll-scrub frame updates and seek latency on a generated clip; `node scripts/e2e/analytics.mjs` plays a published video and checks the Analytics summary; `node scripts/e2e/ai.mjs --record` runs the AI flow through the UI and saves a walkthrough video to `dist/walkthrough/`; `node scripts/e2e/agency.mjs` runs the agency flow (client review link, approval, invite, comments, dashboard) across three browser contexts; `node scripts/e2e/export.mjs` renders a 720p MP4 through the UI, downloads it and checks the file; `node scripts/e2e/admin.mjs` runs the super admin console (CLI grant, disable / enable, roles, plan, System, sign in as, reset link, CSV, Sites, audit log) in two browser contexts; `node scripts/e2e/account.mjs` runs forgot-password / reset / account-page / invitation-mail in two browser contexts (reads the outbox folder); `node scripts/e2e/full-local.mjs` walks the whole product with one fresh account; `node scripts/e2e/wp-landing.mjs` builds a designed landing page on the LocalWP site with a Chrome-rendered product clip (`make-demo-clip.mjs`) and checks the element picker, the shortcode, scroll pinning on a smooth-scroll theme, WooCommerce add-to-cart and analytics.

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

## Agency workflow (clients, team, review, dashboard)

Clients group projects (and can carry their own brand kit); team members join through one-time invitation links with a role (viewer / editor / admin); comments in the editor are anchored to scene, moment, element and a point on the canvas and support `@mentions`; the approval workflow (Draft → Internal review → Client review → Approved → Published) gates publishing for editors when a project requires approval; a client reviews and approves through a revocable link without an account (`/review/:token`); the **Dashboard** shows alerts, mentions, every project per client with site health and 7-day numbers, and an activity feed. Routes live in `apps/api/src/routes/workspace.ts` and `review.ts`.

## MP4 export

Project page → **Download as MP4**: the worker renders the project in headless Google Chrome with the published runtime (so text, motion, captions, product cards and voiceover look exactly as on the site), pipes the frames into FFmpeg and mixes the audio from the source files. 1080p / 720p, 24–60 fps, draft or published version, portrait canvases in the phone layout; the file downloads with the project's name. Needs Google Chrome on the worker host (`EXPORT_BROWSER` to point at it). Routes in `apps/api/src/routes/exports.ts`, renderer in `apps/worker/src/export.ts`, planning in `packages/server/src/export/plan.ts`.

## Presets and brand kit

- Starter presets (elements, scenes, motions) ship in `packages/editor/src/presets.ts`; users save their own (elements, scenes, templates) to the cloud library (`/api/v1/presets`). Applying a preset is always an independent copy; newer library versions are offered per element, never pushed.
- Brand kit (`/api/v1/brand-kits`): colours, fonts, logo, button and card style per workspace. New projects and new elements follow it; `applyBrandKit()` re-styles an existing project on request.

See `docs/architecture.md` for decisions and `CHANGELOG.md` for progress by phase.

## Deploying to a VPS (no Docker)

1. Install Node 20+, PostgreSQL, pnpm. Create a database and user. For MP4 export install Google Chrome (`google-chrome-stable`; Chromium lacks H.264) and, if it is not on the default path, set `EXPORT_BROWSER` in `apps/worker/.env`.
2. Clone, `pnpm install`, `pnpm build`, `pnpm build:connectors`.
3. Copy `.env.example` → `.env` in `apps/api` and `apps/worker`; set `DATABASE_URL`, a long `SESSION_SECRET`, `PUBLIC_URL=https://api.yourdomain`, `WEB_ORIGIN`, `STORAGE_DIR=/var/lib/sceneflow` (or the `S3_*` variables for R2).
4. Set `NEXT_PUBLIC_API_URL=https://api.yourdomain` in `apps/web/.env` before `pnpm build` (it is baked into the web bundle).
5. Run `pnpm --filter @sceneflow/api start`, `pnpm --filter @sceneflow/worker start` and `pnpm --filter @sceneflow/web start` under pm2; put nginx in front with `client_max_body_size 2g` for `/uploads/`.
6. Smoke-test the deployment: `API_URL=https://api.yourdomain pnpm smoke`.
7. Make yourself the super admin: sign up in the app, then `pnpm admin grant you@yourdomain` on the server; the **Admin** link opens the console (accounts, workspaces, plans, workers / queues, audit log).
8. Mail: `MAIL_FROM` + `RESEND_API_KEY` (or `SMTP_URL`) in both `.env` files, otherwise reset links end up in `<STORAGE_DIR>/outbox`.

## Hosting without a VPS (free tiers)

SceneFlow is three processes plus Postgres and file storage. Everything except the worker fits on free tiers; the worker (FFmpeg + headless Chrome) needs a real machine.

| Part | Fits on | Notes |
| --- | --- | --- |
| Web (`apps/web`, Next.js) | Vercel Hobby, Cloudflare Pages / Workers via OpenNext, Netlify | `NEXT_PUBLIC_API_URL` is baked in at build time. |
| API (`apps/api`, Fastify) | Render free web service (Koyeb / Fly are similar) | Free instances sleep after ~15 idle minutes and wake in about a minute — fine for trying things, not for a live site: visitors' players fetch the config from the API. Use `STORAGE_PROVIDER=s3` (the free disk is wiped on every deploy) and `TRUST_PROXY=true`. |
| Postgres | Supabase free (500 MB) or Neon free (1 GB) | pg-boss polls every 1–3 s, which keeps the database awake: on Neon that spends the 100 compute-hours/month in about two weeks, so prefer Supabase for an always-on queue. Render's own free Postgres is deleted after 30 days. |
| Media (`S3_*`) | Cloudflare R2 (10 GB, no egress fees) | Already supported: `STORAGE_PROVIDER=s3`, `S3_PUBLIC_URL` on a custom domain. |
| E-mail | Resend free tier | `RESEND_API_KEY` + `MAIL_FROM` on a verified domain. |
| Worker (`apps/worker`) | **Nothing free that fits well** | Needs FFmpeg + Google Chrome on x86. Run it on any PC that is on when you upload or export (it needs only `DATABASE_URL` and the `S3_*` bucket, no inbound port), on the cheapest VPS (€4–6 / month), or on Oracle Cloud's Always Free ARM instance (capacity is hit-and-miss and Chrome has no ARM Linux build, so H.264 sources may not decode there). |

So a **demo or internal setup** can run for $0 (Vercel + Render free + Supabase + R2 + the worker on your own PC). **A real site** wants the API awake: a $7 Render instance, or simply the one small VPS from the previous section, which runs everything. Free-tier terms change often — check the providers' pricing pages before relying on the numbers above (checked 2026-11-10).
