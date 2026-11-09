# SceneFlow — working notes for Claude Code

- Spec: `docs/SceneFlow_AI_Implementation_Handoff_v1.0.md` (source of truth). Work goes **phase by phase**; after each phase update `CHANGELOG.md` + `docs/architecture.md`, then tell the user what was built, how to try it, and what is next. Phases done: 1–9 (next: 10 Agency, then VPS deploy).
- The user writes Banglish (Bengali in Latin letters); reply in Banglish. Keep end-user UX simple — no learning curve, guided (tour, goal picker, diagnostics).
- Everything lives in this repo: https://github.com/rayhanwealcoder/sceneflow (branch `main`). Commit/push only when the user asks ("git add koro" / "push koro").
- **No Docker, no Redis, never WAMP.** Local Postgres 17; queue is pg-boss. WordPress testing uses the LocalWP site **`development.local`** (WP-CLI via LocalWP's PHP, see below).
- Connectors are released from here as zips: `pnpm build:connectors` → `dist/connectors/*.zip` + `manifest.json`. **"wp build"** from the user means: `pnpm build && pnpm build:wp`, then hand over `dist/connectors/sceneflow-wordpress.zip`. New platform = new folder under `connectors/` with `connector.json` + get-started `README.md`.
- Keep both placement methods in WordPress: `[sceneflow id="…"]` shortcode/block **and** element-pick placements.
- WordPress plugin must stay WordPress.org-clean: `phpcs --standard=WordPress --extensions=php --ignore="*/tests/*" connectors/wordpress/sceneflow` and `wp plugin check sceneflow` (Plugin Check plugin on development.local) before calling a phase done. Plugin tests: `pnpm test:wp` (needs the fixture from `pnpm --filter @sceneflow/server test`).
- Verify before reporting: `pnpm typecheck`, `pnpm test` (needs DB `sceneflow_test`), `pnpm build`, PHP tests + phpcs + Plugin Check, and an end-to-end script against the running stack (`scripts/smoke.mjs` or a phase-specific one in `scripts/e2e/`). Browser-level checks use `playwright-core` with the installed Chrome (`channel: "chrome"`, never download browsers): `scripts/e2e/pages.mjs` (every page, fails on any page error — run after any editor/web change; it caught a zustand 5 selector loop), `scripts/e2e/scroll-smoothness.mjs`, `scripts/e2e/analytics.mjs`, `scripts/e2e/ai.mjs` (`--record` writes `dist/walkthrough/sceneflow-walkthrough.mp4`).
- zustand 5: selectors that return a new array/object must be wrapped in `useShallow`, or React loops under transitions (#185).
- AI (Phase 9) is provider-based and optional: without keys the API uses starter text + the OS voice (Windows SAPI here). Keys go in `apps/api/.env` (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`). Claude is called only through `@anthropic-ai/sdk`; every drizzle user lists `@opentelemetry/api` so drizzle resolves once (the SDK pulls it in). "Properly test with dummy content" = generate a clip with FFmpeg (`testsrc2`), run it through the real pipeline, measure in Chrome.

## Local tooling (this machine)

- LocalWP PHP: `D:\programs\local\resources\extraResources\lightning-services\php-8.2.27+1\bin\win64\php.exe`; WP-CLI phar: `D:\programs\local\resources\extraResources\bin\wp-cli\wp-cli.phar`. Run as
  `php -d extension_dir=<phpdir>/ext -d extension=mysqli -d extension=openssl -d extension=mbstring -d extension=curl -d extension=gd -d mysqli.default_port=10005 wp-cli.phar --path="C:/Users/UseR/Local Sites/development/app/public" <command>` (quote `--fields=ID,user_login` in PowerShell).
- phpcs: `C:\Users\UseR\AppData\Roaming\Composer\vendor\bin\phpcs.bat`.
- Ports: API 4800 (LocalWP owns 4000), web 3000. Stopping background servers can leave orphan node processes — kill by port before restarting.
- Zips: use bsdtar (`tar -a -c -f`), not `Compress-Archive`.
