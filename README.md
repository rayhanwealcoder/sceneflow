# SceneFlow

AI-assisted interactive and shoppable video platform. Source of truth: `docs/SceneFlow_AI_Implementation_Handoff_v1.0.md`.

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
pnpm test        # unit (schema, core) + integration (api, worker) — needs the `sceneflow_test` database
pnpm typecheck
```

Create the test database once: `psql -U postgres -c "create database sceneflow_test;"`.

## Layout

```
apps/web        Next.js app: sign in, projects, upload, scene editor + timeline (/projects/:id/editor), draft preview, publish, embed snippet
packages/editor Framework-free editor domain: geometry, scene/layer operations, responsive overrides, undo history
apps/api        Fastify API: auth, workspaces, projects, versions, publish, media uploads, public runtime config
apps/worker     Media processing jobs (pg-boss on Postgres): metadata, poster, 540p proxy, thumbnails
packages/schema Project JSON schema (Zod) — the single platform-agnostic format
packages/core   Published runtime (window.SceneFlow): poster-first, lazy, typed events, no editor code
packages/server Shared backend bits: Drizzle schema + migrations, storage provider, queue
```

```
wordpress/sceneflow  WordPress connector plugin (pairing, signed publish, shortcode, block, element placements, preview)
```

## WordPress plugin

```bash
pnpm build:wp    # copies the runtime into the plugin and writes wordpress/dist/sceneflow.zip (served at /downloads/sceneflow.zip)
pnpm test:wp     # plain-PHP tests; run `pnpm --filter @sceneflow/server test` first to generate the signature fixture
```

Install the zip on a site, go to Settings → SceneFlow → “Connect with SceneFlow” (one click; or generate a pairing code and enter it under Projects → WordPress sites).
For a local app the plugin must know where the app runs: `wp option update sceneflow_app_url http://localhost:3000` (or `define( 'SCENEFLOW_APP_URL', ... )` in wp-config.php).
With WP-CLI: `wp sceneflow pairing-code`, `wp sceneflow status`, `wp sceneflow disconnect`.
Coding standard: `phpcs --standard=WordPress wordpress/sceneflow`; WordPress.org checks: `wp plugin check sceneflow` (Plugin Check plugin).

## Commerce (adapter based)

- **WooCommerce**: connect the site, pick products in the editor, the player adds to the real cart (Store API). Nothing to configure.
- **No WooCommerce**: use “My products” (name, price, image, link) — product cards open the link (payment link, Gumroad, any store).
- **Shopify / custom**: register a runtime adapter on the page: `SceneFlow.commerce.register(SceneFlow.createShopifyAdapter())` or your own object implementing `addToCart` (see `packages/core/src/commerce.ts`).

See `docs/architecture.md` for decisions and `CHANGELOG.md` for progress by phase.

## Deploying to a VPS (no Docker)

1. Install Node 20+, PostgreSQL, pnpm. Create a database and user.
2. Clone, `pnpm install`, `pnpm build`.
3. Copy `.env.example` → `.env` in `apps/api` and `apps/worker`; set `DATABASE_URL`, a long `SESSION_SECRET`, `PUBLIC_URL=https://api.yourdomain`, `WEB_ORIGIN`, `STORAGE_DIR=/var/lib/sceneflow`.
4. Set `NEXT_PUBLIC_API_URL=https://api.yourdomain` in `apps/web/.env` before `pnpm build` (it is baked into the web bundle).
5. Run `pnpm --filter @sceneflow/api start`, `pnpm --filter @sceneflow/worker start` and `pnpm --filter @sceneflow/web start` under pm2; put nginx in front with `client_max_body_size 2g` for `/uploads/`.
6. Smoke-test the deployment: `API_URL=https://api.yourdomain pnpm smoke`.
