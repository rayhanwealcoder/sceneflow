# Changelog

## Phase 15 — WordPress.org readiness (plugin 0.7.0, runtime 0.7.0) + super admin support tools (2026-11-10)

### WordPress plugin 0.7.0 — audited against the Plugin Directory guidelines
- **Prefixes**: every PHP name was already `SceneFlow_` / `sceneflow_` / `SCENEFLOW_` (classes, functions, constants, options, transients, hooks, script handles, REST namespace, shortcode, block, template globals); the **player runtime** still used a 2-letter `sf-` prefix, which the guidelines reject ("don't use two or three letter prefixes") and which clashes with common theme libraries (Superfish menus use `sf-*`). Runtime classes are now `sceneflow-*` (root `sceneflow-root`, so it never collides with the plugin's own `.sceneflow-player` container), data attributes `data-sceneflow-*`, CSS variables `--sceneflow-*`, browser-storage keys `sceneflow_cc` / `sceneflow_sid`. 360 references updated (runtime, tests, editor CSS, export worker, e2e scripts); runtime 34.8 KB gzip.
- **Escaping late**: every place that prints player markup now passes it through `wp_kses()` with an explicit allow-list (`SceneFlow_Frontend::allowed_html()`: the container div and resource-hint links) instead of a `phpcs:ignore` comment; shortcode `class` values go through `sanitize_html_class()`; the draft-preview page loads its CSS with `wp_add_inline_style()`.
- **Sanitising / validation**: REST routes declare their arguments (`search` sanitized and capped, `page` 1–1000, media `type` enum); the cloud only sends `image` / `video`.
- **Redirects**: one-click connect uses `wp_safe_redirect()` with the SceneFlow app host added through `allowed_redirect_hosts` only for that request.
- **Capabilities / nonces** (re-checked, unchanged): admin screen and every admin-post handler need `manage_options` + a nonce; private REST routes need the HMAC signature (timestamp + single-use nonce); public routes serve only published content; the block's project list needs `edit_posts`.
- **Element picker** never posts to `*`: without the connected app's origin it does not start.
- **Privacy**: playback analytics is **opt-in** (off until the site owner turns it on; the settings page asks once after connecting); suggested privacy-policy text under Settings → Privacy; the public health check gives WordPress as major.minor and no PHP version.
- **On-demand assets**: nothing from the plugin is registered or loaded on pages without a player; the WooCommerce adapter (and its Store API nonce) is set up only when a player renders; the block script only loads in the editor; the picker only with a valid token.
- **Translations**: `Domain Path: /languages`, `languages/sceneflow.pot` (97 strings, PHP + block.js + block.json); picker texts are translatable.
- **Formatting**: PHP by phpcs (WordPress standard); the hand-written JS / block.json by `wp-prettier` with `@wordpress/prettier-config` (WordPress JavaScript style). `pnpm check:wp` runs phpcs, the JS formatting check, a fresh `.pot` comparison and the PHP tests; `pnpm format:wp` rewrites the JS.
- `block.asset.php` has the direct-access guard and follows the plugin version; readme: 0.7.0 changelog + upgrade notice.

### Super admin: support tools
- **Sign in as this user** (Users → account): a 1-hour session flagged with the admin's id (`sessions.impersonator_id`, migration 0009). An orange bar on every page names both accounts with **Return to admin**; password / profile changes answer 403 `IMPERSONATING`; the console stays closed; the user's own last sign-in is untouched; start and end are audited. Not for super admins or disabled accounts. Both directions reload the page, so no state of one account survives in the other.
- **Send password reset link**: the user gets the normal one-time link by mail; the admin never sees it (outbox fallback without a mail service). Reset issuing moved to `lib/reset.ts`, shared with "Forgot your password?".
- **Sites** tab: every connected site with status, last error, plugin version against the latest release (`update` badge from the release manifest), platform version, published count, last seen, and **Check now** (the stored version used to date from pairing time; `refreshSiteHealth()` is shared with the owner's Check button).
- **Download CSV** of accounts (same filters, ≤ 10 000 rows, spreadsheet-formula cells neutralised, audited as `users.export_csv`).
- **System** lists the last failed MP4 exports with their error. The worker heartbeat proved itself on day one: it showed a stale worker from an earlier run still pulling jobs with old code.

### Fixed
- After switching accounts in one tab (sign-in as someone else, "Sign in as"), the projects page could ask for the previous account's workspace ("You do not have access to this workspace"): the session now clears the workspace list whenever the account changes.

## Phase 14 — Super admin console (2026-11-10)

### Added
- **`/admin`** for the people who run the SceneFlow server (an *Admin* link in the header, only for them). Five tabs:
  - **Overview**: accounts (disabled, super admins), sign-ups and sign-ins over 7 / 30 days, workspaces and teams, published projects, connected sites, upload storage, MP4 exports (failed ones), player events, workspaces per plan, the five workspaces using the most storage.
  - **Users**: search by name or e-mail, filter by status and role, last sign-in, devices signed in. One account opens with its workspaces and admin history and four actions: **disable / enable** (disabling ends every session at once and blocks sign-in; nothing is deleted), **sign out everywhere**, **make / remove super admin**.
  - **Workspaces**: search by name or owner, filter by plan; members, sites (status, last seen), projects, usage (files, bytes, exports, player events); **change plan** (`free`, `pro`, `agency`, `enterprise` — placeholders until billing attaches prices and limits).
  - **System**: workers online (each worker now writes a heartbeat every 30 s to `worker_heartbeats`; a warning when none is running), the four job queues by state, stuck uploads / exports, **failed jobs with Retry**, and which mail / AI / storage providers are active, database size, API uptime.
  - **Audit log**: every console or CLI change with who, what, on what, before → after, and the IP.
- **`pnpm admin list | grant <email> | revoke <email>`**: the server-side command that makes the first super admin (and can always recover access).
- API under `/api/v1/admin/*` (`apps/api/src/routes/admin.ts`); `/auth/me` reports `superAdmin`; `users.last_sign_in_at` is recorded on every sign-in. Migration `0008` (`users.platform_role`, `users.last_sign_in_at`, `admin_audit`, `worker_heartbeats`).
- Tests: 7 API tests (`apps/api/test/admin.test.ts`); `scripts/e2e/admin.mjs` runs the console in two real browsers (CLI grant, disable throws the member out, enable, super admin grant / removal, plan change, System with the live worker and queues, audit log, CLI revoke); `pages.mjs` checks that a normal account sees "Page not found".

### Decisions
- **The role lives in the database and is granted by the CLI**, not by a list of e-mails in `.env`: there is no e-mail verification, so whoever signs up first with a listed address would become super admin.
- **Invisible to everyone else**: admin routes answer 404 (not 403) to visitors and normal users, and the role is re-read from the database on every request, so removing it takes effect immediately.
- **Guard rails instead of trust**: nobody can disable or demote their own account, the last active super admin cannot be removed from the console, only active accounts can be made super admin, and every write is audited in the same request (if the audit row cannot be written, the request fails).
- **No delete and no impersonation in this version.** Disabling covers abuse without losing data; "sign in as" needs its own audit trail and a visible banner, and comes later if it is needed.

## Phase 13 — E-mail, password reset, account page (2026-11-10)

### Added
- **Outgoing e-mail** (`packages/server/src/mail`): one `Mailer` behind three providers — **Resend** (HTTP, no dependency; `RESEND_API_KEY`), any **SMTP** server (nodemailer; `SMTP_URL` or `SMTP_HOST/PORT/USER/PASS`), and the **outbox folder** when neither is configured: the message is written as JSON to `<STORAGE_DIR>/outbox` and its links are printed to the API log, so password reset and invitations work on a laptop or a fresh server before any mail service exists. `MAIL_FROM` is required for real delivery; `MAIL_PROVIDER` forces a choice. Templates (`templates.ts`) produce text + a self-contained HTML card (no remote images or fonts): reset link, "password was changed", workspace invitation, "your video is ready".
- **Forgot password** (`POST /api/v1/auth/forgot`, page `/forgot`): a one-time link valid 60 minutes (`password_resets`: sha256 of the token, newest request replaces the earlier link). The answer is identical for known and unknown addresses and the mail leaves *after* the response, so neither the body nor the timing says who has an account; 5 requests per 15 minutes per IP. `delivery: "email" | "log"` tells the page whether a mail actually left — with no mail service the page explains where the link went instead of pretending.
- **Reset page** (`/reset/:token`, `GET/POST /api/v1/auth/reset`): shows the masked account (`r•••@domain`), takes the new password, signs out every session of the account, signs this browser in, marks the link used (410 `RESET_USED` / `RESET_EXPIRED` afterwards, 404 for anything else) and mails a "your password was changed" notice pointing at `/forgot`. A reset also lifts the sign-in brute-force lock on that account — whoever holds the mailbox owns it.
- **Account page** (`/account`, via your e-mail in the header): rename (`PATCH /api/v1/auth/me`) and change password (`POST /api/v1/auth/password`: current password required, other devices signed out, this one stays, notice mailed). The sign-in form has a *Forgot your password?* link that carries the typed address over.
- **Invitations by e-mail**: when the admin types an address, the invitation (with the join link) is also mailed; the response (`sent`) and the Team page say whether it went out or the link is all there is.
- **"Your video is ready"**: the worker mails the person who started an MP4 render when the file is ready (same `MAIL_*` settings in `apps/worker/.env`, plus `WEB_ORIGIN` for the link).
- `scripts/e2e/account.mjs`: the whole flow in a real Chrome against the running stack (two devices, outbox folder, reset, account page, newest password, invitation mail, unknown address). `pages.mjs` walks the new pages. 7 API tests (`apps/api/test/account.test.ts`), 7 mail tests (`packages/server/src/mail/mail.test.ts`).

### Decisions
- **Outbox fallback instead of a hard requirement.** A mail server is the first thing a self-hoster does not have, and the product must not dead-end at "forgot password". The link stays a real one-time link; it reaches the owner through whoever runs the server.
- **No account enumeration, no mail-timing leak**: same response for every address, mail sent after the reply (`Mailer.sendLater`). Reset tokens are 32 random bytes, stored hashed, single use, 60 minutes.
- **Changing the account e-mail is not offered yet** (needs a verification round trip to the new address); the account page says so.

## Phase 12 — Scroll engine, custom thumbnail, speed, "no visible player", page speed (2026-11-10)

### Fixed
- **Scroll-scrub did not pin on the WordPress landing page.** The test theme (hello-animation) wraps the page in a GSAP ScrollSmoother layout: `#smooth-wrapper` is `position: fixed; overflow: hidden` and `#smooth-content` is moved with a transform. CSS `position: sticky` can never work there (an overflow-clipping ancestor) and `position: fixed` breaks too (a transformed ancestor becomes its containing block). The runtime now has its own ScrollTrigger-like **pin engine** (`scroll.ts` + `Player`): it looks at the player's ancestors once and picks the technique the page allows — CSS **sticky** where nothing clips or transforms (compositor-only, zero JS per frame), **fixed** through overflow-clipping wrappers (most themes; geometry handed over explicitly), or a per-frame **transform** inside smooth-scroll wrappers (ScrollSmoother, Lenis, Locomotive). `data-sf-pin` on `.sf-player` says which one is in use. Progress is read from the container's on-screen rectangle instead of `window.scrollY`, so the picture and the scrub agree even while a smooth-scroll wrapper is still gliding; the loop keeps ticking while the page is still moving and goes idle six quiet frames later. The pin engine starts at mount (the page has its final height before the visitor gets there); only the media stays lazy, now one screen ahead.
- **Place on your site: picking a page whose title another page shares could select the wrong one.** The search box resolved the typed title on blur to the *first* page with that title, and the blur fired before the page chip's click landed (the chips row re-rendered away, losing the click). Chips now keep the search box focused (`mousedown` prevented), the blur resolves by URL or only an unambiguous title, and duplicate titles show their path. Found by `wp-landing.mjs` on its second run (two "Glow Face Cream" pages).
- The editor tour scrolled its target into view on *every* re-render while it was open (its effect depended on callbacks that change each render), which yanked the side panels back whenever anything updated — and made dialogs opened during the tour hard to use. It now scrolls once per step.
- `smoothness` could freeze the clock at 1 (the approach factor became 0). It is now a plain time constant (0 = snap, 1 ≈ 0.4 s, like ScrollTrigger's `scrub` seconds), frame-rate independent, and scroll events are answered in the same task — no frame of lag at the first wheel tick.

### Added
- **Scroll options like ScrollTrigger, without the library**: pin position (top / centre / bottom) with an offset for fixed headers, scroll length while pinned (`scrollDistance` now means the travel, like `end: "+=300%"`), GSAP-style `start` / `end` triggers for unpinned players (`"top bottom"`, `"center center"`, …), and test **markers** (start / end / pin lines on the page). Editor → Advanced → Scroll scrub exposes all of it; `packages/core/src/scroll.ts` holds the pure math (`pinState`, `triggerProgress`, `pinTypeFor`), 8 unit tests + 3 player tests cover sticky / fixed / transform / triggers / markers.
- **Custom thumbnail** (`project.poster`): editor → VIDEO → *Pick a frame…* shows the clip's thumbnail strip plus an exact second; the worker extracts the frame at full size (`POST /api/v1/media/:id/frame`, queue `media.frame`, answered in one round trip, frames recorded on the asset) — or *Use an image…* takes a designed picture from the library. The runtime shows it before play (first paint, `<video poster>`), the plugin preloads it, the exporter ignores it.
- **Playback speed** (`playback.speed`, 0.5×–2× in the editor, 0.25–3 in the schema): video and audio layers run at the rate, the scenes-mode clock too; the editor preview follows it; MP4 exports render frame k at timeline time k/fps·speed and tempo-shift the audio (`atempo` chain, FFmpeg 4-safe). Scroll projects ignore it — the scroll length sets the pace.
- **"No visible player"** (Apple-style): `canvas.background` — *Blend into the page* (transparent), black, or a colour — so a video shot on the page's colour sits in the page like a picture; together with autoplay, no controls and the custom thumbnail there is nothing that looks like a player. The export page uses white behind a transparent canvas.
- **Page speed on WordPress** (plugin **0.6.0**): each player prints resource hints — `preconnect` to the media host (plain + CORS), `preload` of the thumbnail (`fetchpriority=high`) and of the config JSON (`as=fetch crossorigin`), so the first picture and the config are on their way before the deferred runtime has run; placements get theirs in `<head>`. Runtime **0.6.0** (34.7 KB gzip).
- The demo page's player wrapper clips its rounded corners with `overflow: clip` instead of `overflow: hidden` — `hidden` makes an element a scroll container, which turns CSS sticky off for everything inside (the engine then falls back to `fixed`). Worth copying into any theme wrapper around a scroll-scrub player.
- `scripts/e2e/make-demo-clip.mjs`: a professional-looking product clip rendered with Chrome (cream jar built from CSS, studio glow, hydration droplets, lid lift, light sweep; every frame a function of time; H.264 1080p + an FFmpeg-synthesised ambient pad) and a matching product still — no stock footage, deterministic.
- `scripts/e2e/landing-template.mjs`: the designed landing page as a function (also a CLI to re-apply it to an existing page). It uses no 1 px borders: a smooth-scroll theme moves the page by fractional pixels, so hairlines blur and "blink" while gliding — measured identical with and without SceneFlow players on the page, i.e. a theme artifact; soft bands and shadows instead.
- `scripts/e2e/wp-landing.mjs`: real-Chrome walkthrough on development.local — the clip, an autoplay hero project with a WooCommerce card and a frame picked in the editor UI, a pinned scroll story, a designed landing page (default theme template, so the ScrollSmoother wrapper is in play), the **element picker UI** inside the app's iframe, the shortcode, the visitor's view (resource hints, transparent players, no controls, live price, add-to-cart into the real cart), scroll pinning + smoothness measured on the theme (transform pin) and on the demo page (sticky pin), analytics and diagnostics. `--headed --keep-open` leaves the browser on the result pages.

### Decisions
- **Our own pin engine, not GSAP.** ScrollTrigger is 40 KB and GPL-incompatible for the WordPress.org plugin; what we need from it is ~150 lines of pure math plus the three pin techniques. Measuring from `getBoundingClientRect()` rather than `scrollY` is what makes the same code work on native-scroll pages and on transform-based smooth-scroll pages.
- **`scrollDistance` now means travel (ScrollTrigger semantics)**, not container height: "300vh" scrubs the video over three screens whatever the player's height. Existing scroll projects scroll a little longer than before; the editor says so next to the field.
- **Thumbnail frames come from the worker**, not from a canvas in the browser: full resolution from the original, no CORS taint, and the same path works for every storage provider.

## Phase 11 — MP4 export (2026-11-10)

### Added
- **MP4 export** (doc §31 MVP "MP4 export"; doc §30 "Complex export: Remotion + FFmpeg" — same principle with our own runtime): the render worker opens the project in **headless Google Chrome with the published runtime** (same CSS, fonts, enter/exit motion, captions, product cards), steps the player through time frame by frame, screenshots every frame over the DevTools protocol and pipes it into **FFmpeg** (H.264 High, CRF 18, `+faststart`), then mixes the audio the player would play (the base video's sound or each scene's background clip, plus every audio layer at its start with its volume) from the source files — audio assets from their original upload, videos from the best rendition. Scroll-scrub projects export as a straight play-through; `playback.muted` exports silent, like the runtime.
- **Options**: 1080p / 720p (short side; 16:9 → 1920×1080, 9:16 → 1080×1920, 1:1, 4:5, 4:3 all even), 24 / 25 / 30 / 60 fps, responsive layout (auto = phone layout for portrait canvases, else desktop), source = current draft or published version. Limit 10 minutes. `packages/server/src/export/plan.ts` holds the pure planning (dimensions, device, best source, audio cues, FFmpeg filter graph, file name) — 8 unit tests.
- **API** (`apps/api/src/routes/exports.ts`): `POST /api/v1/projects/:id/exports` (editor; freezes the config *with renditions attached* into `video_exports`, queues `export.render`), `GET /api/v1/projects/:id/exports`, `GET /api/v1/exports/:id` (progress), `DELETE /api/v1/exports/:id` (file + row; 409 while rendering), `GET /api/v1/exports/:id/file` (members; local storage is streamed with `Content-Disposition: attachment; filename="<project>-1080p.mp4"`, remote storage redirects to the public URL which carries the same disposition). Migration `0006` (`video_exports`), queue `export.render`, activity type `exported`.
- **Worker** (`apps/worker/src/export.ts`): `playwright-core` drives the installed Chrome (`EXPORT_BROWSER` to point at a binary); the render page and runtime are served by request interception, local media straight from disk with Range support (no dependency on the API being up); per-frame media wait (`<video>` at the wanted time with a decoded frame, `<img>` complete, fonts loaded) with a 5 s cap; progress written every ~1.5 s ("Rendering frames (120 of 900)"); readable failures ("Google Chrome is not available on the render worker…"). Frames travel as JPEG q92: 3.7× faster than PNG at 1080p (≈120 vs 450 ms a frame) with no visible difference after x264 at 4:2:0. 2 worker tests render a real project (red scene + white text, blue scene with a hotspot, test-pattern clip with a voiceover) and check the frames' colours, the text's brightness, that the video advances, the audio track, the stored row and the feed entry; skipped automatically where Chrome is missing.
- **Web**: project page card **Download as MP4** (what / quality / frame rate / layout, *Render MP4*, list with live progress bar, *Download*, *Try again*, delete; viewers can download), editor ⋯ menu → *Download as MP4…*, dashboard feed line "downloaded … as MP4". `scripts/e2e/export.mjs`: uploads a clip + voice track, builds text / button / hotspot / captions / voiceover, renders 720p / 24 fps through the UI in a real Chrome, downloads, checks the file with ffprobe + frame samples, the editor menu link, the dashboard entry and deletion; `pages.mjs` checks the card.
- Tests: 179 Node tests (schema 34, editor 47, server 22, core 39, api 30, worker 7), typecheck 10/10.

### Fixed (full local walkthrough, 2026-11-10)
- **Published video did not render on WordPress when any element had an empty `style` / `content` / responsive override** (for example a hotspot added without styling). The plugin's REST route decoded the stored config into PHP associative arrays, so `{}` was served back as `[]`, which the runtime's schema rejected — the player went to its error state without a visible message. Plugin **0.5.1** serves the config decoded as objects (`SceneFlow_Config::decode_for_output`, PHP test), and the schema now treats an empty array as an empty object in those positions (**runtime 0.5.1**, `php-roundtrip.test.ts`), so configs from any PHP host keep loading. Found by the full local walkthrough; never showed in earlier tests because every layer there carried styling.
- **Stale published config right after publishing**: `/p/:id.json` and the plugin's config route are cacheable for a minute (by design, for CDNs and busy pages), so the publisher's own browser could show the previous version on "Open live preview" or on a WordPress page reload. The demo page now takes `?v=<version>` (the project page links with it) and the WordPress plugin (**0.5.1**) appends the stored version to the player's config URL, so a fresh publish shows on the next page load while visitors keep the cache.
- **Stale runtime bundle inside the WordPress plugin**: the connector's copy of `sceneflow.runtime.min.js` was 7 minutes older than the core build (same version string). `pnpm build:wp` was re-run and the plugin reinstalled on the test site; the full walkthrough now compares the hashes before it starts.
- **Voice is optional and out of the way**: the AI panel's main tabs are Script · Copy · Captions; voice sits behind a small "🎙 Voice (optional)" link and a collapsed "Spoken line & voice (optional)" section in the scene panel; building a script now continues to Captions, not to the voice tab; the tour no longer leads with voice. Nothing was removed — customers who upload their own footage and sound never meet it.
- `scripts/e2e/full-local.mjs`: one fresh account walks the whole product in a real Chrome — sign-up, tour, editor, Upload box with a generated clip, image / music / GIF processing, starter AI + built-in voice, brand kit, presets, 3-scene project with every element type, publish, the live player (captions, timed motion, hotspot, new-tab button, coupon, add-to-cart, analytics), scroll-scrub as a new visitor, analytics dashboard, diagnostics, client review link, invite + comments + mention + gated publish, WordPress pairing + WooCommerce product + a dummy landing page with shortcode and element placement + add-to-cart into the real cart, plain HTML embed, MP4 export, version checks. `--headed --keep-open` leaves the browser on the result pages; nothing is deleted.

### Decisions
- **Render with the real runtime, not a re-implementation.** Anything that renders in the player renders in the file (fonts, product cards, captions, motion) and the two can never drift. Remotion would have meant a second rendering model; FFmpeg `drawtext` a third. The price is a Chrome on the worker host — documented for the VPS.
- **Frozen config per export.** Autosave rewrites the draft row in place, so an export stores the exact JSON it was asked for; the file always matches what the person saw when they pressed the button.
- **Audio from the sources, not from Chrome.** Headless capture has no audio path; mixing with FFmpeg from the files gives exact timing and lets audio uploads come from the original (voice quality) while videos use their rendition (a 1080p original can be a gigabyte).
- **Download through the API.** A cross-origin `download` attribute is ignored by browsers, so the authenticated route sets the attachment header (local) or the object carries it (R2 / S3), and the file gets the project's name.

### Deferred
- Rendering video layers from the original upload; WebM / GIF / audio-only outputs; social presets (Reels / TikTok safe-area guides, square crop of a landscape project); burned-in vs. none captions switch; e-mail when a render finishes; a render-cluster (several workers) when exports queue up.

## Phase 10 — Agency: clients, team roles, comments, approval, dashboard (2026-11-09)

### Added
- **Clients** (doc §23 "client/site/project grouping"): `clients` table (name, contact, notes, optional brand kit). A project belongs to one client (`projects.client_id`); the Projects page filters by client and files new videos under the selected one; the editor uses the client's brand kit when it has one. `GET/POST /api/v1/clients`, `PATCH/DELETE /api/v1/clients/:id`.
- **Team roles + invitation links**: `GET /api/v1/workspaces/:id` (members + your role), `PATCH` (rename), `PATCH/DELETE …/members/:userId` (admins set viewer / editor / admin; the owner is fixed; anyone but the owner can leave), `POST/GET/DELETE …/invites` (admin creates a one-time 7-day link, optionally bound to one e-mail — no mail server needed), public `GET /api/v1/invites/:token` + `POST …/accept`. A workspace with invites becomes a `team`. The web app now handles several workspaces per user (switcher in the header, remembered per browser). New pages **/team** (Team & clients) and **/join/:token**.
- **Comments** (doc §23 "frame/scene/time anchored comments, mentions, resolve/reopen"): `comments` table with `t`, `scene_id`, `layer_id`, `x`/`y` (percent on the stage), replies (`parent_id`), `@Name` mentions parsed against workspace members (full name beats first name, longest first, each `@` claimed once), resolve / reopen, `source` team | client. `GET/POST /projects/:id/comments`, `PATCH/DELETE …/:cid` (edit = author or admin). Editor: 💬 button with the open count, a right-hand comments panel (Open / Resolved, replies, resolve, delete, mention chips, Ctrl+Enter), anchors default to the current scene / playhead / selected element, **Pin on canvas** places a numbered pin; clicking a comment jumps to its scene, moment and element. Pins render on the canvas while the panel is open.
- **Approval workflow** (doc §23 Draft → Internal Review → Client Review → Approved → Published): `projects.review_status` (`none | internal | client | changes | approved`), `approval_required`, `approved_version / checksum / by / at`. `POST /projects/:id/review` with `request_internal`, `request_client`, `approve`, `request_changes`, `reset` (approve / request changes need an admin). **Role-based publish**: with approval required, editors can only publish the approved and *unchanged* draft (`409 APPROVAL_REQUIRED`); admins and the owner always can. Because autosave edits a draft version in place, "approved" is tied to the draft checksum, so "edited since approval" is detected and shown. Diagnostics gain an approval line. Project page: **Review & approval** card (switch, status, next step for *your* role, buttons, link box, history).
- **Client review link** (doc §23 "client-only approval access"): per project, 30 days, stored as sha256 for lookup + encrypted so it can be shown again; "New link" invalidates the old one, "Revoke" kills it. Public routes `GET /api/v1/review/:token` (draft without storyboard notes, comments, status, `canApprove`), `POST …/comments`, `PATCH …/comments/:cid` (mark as done), `POST …/approve`, `POST …/request-changes`; all rate-limited, 404 for unknown / revoked, 410 for expired. New page **/review/:token**: the real runtime, "Add a note on the video" → click a spot → pinned note at that moment, notes list, name remembered, **Approve** / **Request changes**.
- **Agency dashboard** (doc §23 "portfolio dashboard, connection/performance alerts"): `GET /api/v1/workspaces/:id/dashboard` — projects with client, site health, review state, open comments, 7-day loads / plays / clicks / errors; **alerts** (site in error, waiting for the client ≥ 3 days, approved but not published, changes requested, player errors in 7 days, unpublished changes for over a week) sorted by severity; **mentions of you**; **activity feed** (`project_activity`: review requested / sent to client / approved / changes requested / reset / published / comment / client comment). New page **/dashboard**; header navigation Projects · Dashboard · Team & clients.
- Migration `0005` (`clients`, `workspace_invites`, `comments`, `project_activity`, new `projects` columns).
- Tests: `apps/api/test/agency.test.ts` (invites + roles, clients, comments + mentions, the whole review flow incl. 409 / 410 / revoke, dashboard alerts + mentions) — 167 Node tests in total (schema 34, editor 47, server 14, core 39, api 28, worker 5), typecheck 10/10.
- `scripts/e2e/agency.mjs`: real Chrome, three browser contexts — owner adds a client + invite, project for the client, requires approval, sends to the client; the client (no account) pins a note and approves; the owner publishes, the dashboard shows the client group and feed; a colleague joins through the invite, comments with an @mention and a canvas pin, resolves the client's note; editor-role publish is blocked after edits; the owner's dashboard lists the mention. `pages.mjs` now also walks /dashboard, /team and the invalid review / join links.

### Decisions
- Clients do not get accounts. A review link is the whole client experience: open, watch, point, approve. It is revocable and expires; the agency never has to onboard a customer.
- Invitations are links, not e-mails: the product has no mail server yet (same reason password reset is still open), and an admin pasting a link into their own chat / mail is one step, not a setup.
- Approval binds to the draft's checksum, not to the version number, because autosave keeps writing the same draft version until it is published.
- Admins can always publish: the workflow protects against an editor shipping an unapproved draft, not against the agency owner making a call.
- Comments are not part of the project document (no undo, no publish, live immediately); they live in their own table and store, and are never sent to visitors.

### Deferred
- E-mail notifications for mentions / approvals (needs SMTP) — the dashboard is the inbox for now; comment attachments / screenshots; per-client portals with several projects on one link; agency-scope preset sharing across workspaces; timeline markers for comments in Advanced mode.

## Phase 9 — AI: script, storyboard, copy, voiceover, captions (2026-11-09)

### Fixed
- **Editor crashed after the goal picker** (React #185 "Maximum update depth"): `useSelectedLayers` returned a fresh array on every store read; under a React transition (client-side `router.push`) zustand 5 re-rendered until React gave up. The selector is now shallow-compared (`useShallow`). New `scripts/e2e/pages.mjs` walks every page in a real Chrome (sign-up → goal picker → editor + tour → edits → project → analytics → preview → connect → sign-out) and fails on any page error.

### Added
- **Provider-based AI (doc §10.2, "optional and provider-based")** in `packages/server/src/ai`: text (`anthropic` via the official SDK with structured outputs, model `claude-opus-5-5` by default; `starter` rule-based fallback with no key), speech (`elevenlabs`; `system` = Windows SAPI / macOS `say` / `espeak-ng` with no key), transcription (`elevenlabs`). `GET /api/v1/ai/status` tells the editor what is available and what key would add.
- **Schema**: `captions { language, cues[], style { position, size }, source }` on the project, `playback.captions` switch, `scene.script { voiceover, shot }` storyboard notes (stripped at publish), validated `AiScript` shape and request schemas; `cueAt()` / `normalizeCues()` helpers. 34 schema tests.
- **Editor logic** (`packages/editor/src/ai.ts`): `applyScript()` turns a script into scenes (splits a main video proportionally, keeps existing footage, gradient backgrounds otherwise; headline / subline / CTA per scene, brand kit applied, storyboard notes kept), `estimateCues()` + `captionsFromScript()` (speech-paced timing over the scene's voiceover audio or the scene), `addVoiceoverLayer()` (replaces an older take, grows a too-short scene), `videoPromptFor()` (ready prompt for Veo / Sora / Runway / Kling per shot). 47 editor tests.
- **API** `POST /api/v1/ai/script | copy | voiceover | captions` (editor role, rate-limited, provider errors mapped to plain messages). A voiceover becomes a normal audio asset written server-side (`StorageProvider.putOriginal`, local + S3) and queued through the usual media pipeline (m4a + waveform). 18 API tests.
- **Runtime 0.5.0**: caption bar (`.sf-captions`, scales with the player, top/bottom, 3 sizes, follows seeks and scroll-scrub) + CC button remembered per browser (`setCaptionsEnabled()`, `captionsChange` event). 32.7 KB gzip. 39 core tests.
- **Editor UI**: ✨ AI button → one panel with *Script* (brief, length, tone → scene cards with headline, voiceover, shot, "Copy video prompt" → Build / Add after), *Copy* (suggestions for the selected element with tone + instruction chips, one-click apply, "✨" shortcut in the inspector), *Voiceover* (voice picker, per-scene lines, Generate / Generate all, progress until the audio is ready, optional captions), *Captions* (create from script, transcribe when available, position / size, show-on-site switch, editable cue list). Scene panel gets a Voiceover field + shot note; the canvas previews captions (follows the playhead in Advanced mode); tour step for AI.
- `scripts/e2e/ai.mjs`: real Chrome through the UI — script → scenes → voiceovers for every scene via the server voice → captions → publish → published player shows captions in time, loads the m4a voiceovers, CC toggles; `--record` saves `dist/walkthrough/sceneflow-walkthrough.mp4`.
- Tests: 156 Node tests (schema 34, editor 47, server 13, api 18, core 39, worker 5), typecheck 10/10.

### Security (review of this phase + hardening pass)
- **Fixed (high)**: the voiceover `voiceId` reached the Windows speech engine's PowerShell command line; the ASCII-apostrophe escaping could be bypassed with Unicode quotes (U+2018–U+201B), which PowerShell also treats as string delimiters. Now: `voiceId` is validated as an identifier (`[A-Za-z0-9 _.()-]{1,120}`), the system provider only accepts a voice name the machine itself reported, and `psString()` neutralises every quote variant and control character. Tests cover the bypass strings end-to-end (400) and the escaper.
- **Sign-in brute force**: new `LoginGuard` — 5 failures per account or 30 per client address inside 15 minutes block further attempts (15 min, doubling up to 24 h, `429 TOO_MANY_ATTEMPTS` + `Retry-After`); a successful sign-in clears the account. Unknown emails cost the same scrypt work as wrong passwords (no timing enumeration). Per-IP request limits on auth stay in place.
- **Proxy headers**: `trustProxy` was always on, so a direct client could spoof `X-Forwarded-For` and dodge per-IP limits. It is now `TRUST_PROXY=true` only behind Nginx / Cloudflare (default off).
- **Response headers**: API — `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` on HTML, `Cache-Control: no-store` on `/api/*`; web app — `X-Frame-Options: SAMEORIGIN`, nosniff, Referrer-Policy, Permissions-Policy, `X-Powered-By` removed.
- **Dependencies** (`pnpm audit --prod`): `@fastify/static` 8 → 10.1 (path traversal / route-guard bypass advisories), `drizzle-orm` 0.38 → 0.45 (identifier escaping advisory) + `drizzle-kit` 0.31, `postcss` ≥ 8.5.23 via override (Next's pinned 8.4.31). Remaining: a `zod` 3 memory-exhaustion advisory (fix is Zod 4 only) — accepted for now behind the 1 MB body limit and bounded collections; Zod 4 migration noted for later.
- Reviewed and found sound: every new AI route requires a signed-in editor of the project's workspace; storage keys are built from server-side ids (`isSafeKey` enforced); voiceover responses never include storage keys; captions render through `textContent`; provider errors are mapped to plain messages (keys never echoed).

### Decisions
- No key, no dead end: the starter text provider and the OS voice keep the whole flow usable on a laptop; the panel says plainly when text is "starter" and which key upgrades it.
- Captions are timed from the script by default (speech-paced estimate over the real audio length) because it needs no provider and is editable; transcription is the upgrade path when ElevenLabs is configured.
- Storyboard notes never reach visitors (stripped at publish); captions do, as plain project data the runtime renders itself (no `<track>`, so they work for scene-based projects and in scroll mode).
- Claude is called through the official SDK with structured outputs (`messages.parse` + `zodOutputFormat`); the result is re-validated by the project schema, so a provider can never write something the editor cannot load.

### Deferred
- Image generation, background removal, auto B-roll, video generation, translation / dubbing, avatars (doc 10.3 "Later AI"); word-accurate caption timing for system voices; per-scene voice choice; refusal fallbacks on the Claude call.

## Phase 8 — Analytics + smooth scroll-scrub (2026-11-09)

### Added
- **Scroll-scrub smoothness** (measured, not guessed): seek coalescing in the runtime (`nextSeek()` — one in-flight seek, newest target wins, applied on `seeked`), whole-file download of the scrub rendition in scroll mode with a double-buffered `<video>` swap (no black frame; falls back to streaming without CORS or above 40 MB), scrub encoding 30 fps / keyframe every 4 frames / no B-frames / 1 ref, `/files/*` served with CORS. `scripts/e2e/scroll-smoothness.mjs` generates a 10 s dummy clip, runs it through the real pipeline and scrolls the demo page in a real Chrome (`playwright-core`, system Chrome): **95 % of animation frames show a new video frame, seek p95 7 ms** (old 720p 2 s-GOP pipeline: 73 %, 33 ms).
- **Analytics (doc §24)**: runtime event client (player_loaded, play/pause, 25/50/75/complete, scene enter/exit, element impressions + clicks, hotspot clicks, product view, add to cart, checkout started, coupon, player error, watched ranges), batched `text/plain` POSTs + `sendBeacon` on leave, per-tab random session id, no cookies, Do Not Track / GPC respected, `analytics: false` option. Publish stamps `analytics.endpoint` into the config. API: public ingest `POST /api/v1/analytics/events` (CORS `*` only there, rate-limited, ≤ 50 events, duplicate ids ignored, only published projects stored, no IPs) and `GET /projects/:id/analytics?days=7|30|90` (totals, daily series, 50-bucket engagement timeline from watched ranges, scenes, elements with CTR, products, devices, pages). Migration `0004` (`analytics_events`).
- **Dashboard** `/projects/:id/analytics` (Analytics button on the project page): stat tiles, loads vs plays per day, engagement timeline with scene bands, funnel, devices, element / scene / product / page tables; SVG charts with hover, validated two-hue palette with separate dark steps.
- WordPress plugin: *Send anonymous playback analytics* switch (Settings → SceneFlow → Advanced, filter `sceneflow_analytics_enabled`), passed to every player; readme "External services" describes exactly what is sent; uninstall cleans the option.
- `docs/ai-video-prompts.md` + a prompt helper under the upload box: how to make a usable clip with Veo / Sora / Runway / Kling (one slow continuous move, no cuts, no text, subject left) with ready prompts.
- `scripts/e2e/analytics.mjs`: real Chrome plays a published video, clicks, finishes → dashboard summary matches; Do Not Track visitor sends nothing.
- Tests: 129 Node tests (schema 30, editor 38, server 5, api 15, core 36, worker 5), typecheck 10/10, PHP 23 assertions, WPCS + Plugin Check clean.

### Decisions
- Analytics on by default with a one-click site-level off switch and DNT respected, because the doc asks for consent-aware analytics *and* a usable dashboard out of the box; nothing identifying is ever stored, so no consent banner is required for it in most jurisdictions — site owners decide.
- The ingest route is the only CORS-open endpoint and only ever answers 204 / 400; batches are `text/plain` to avoid preflights from every embedding site.
- Engagement is computed from watched ranges, not from heartbeats, so a 10-minute idle tab adds nothing and reverse scrubbing counts correctly.

### Deferred
- Revenue / conversion attribution (needs shop order webhooks), A/B comparison, CSV export, event retention policy.

## Phase 7 — Presets, brand kits, connectors (2026-11-09)

### Added
- **Preset model** (doc §22): one `Preset` shape (`element` | `scene` | `animation` | `template`, scopes `official` | `personal` | `workspace`, `inputs`, `version`, `config`) validated by `presetConfigSchema`; layers and scenes carry `preset: { id, version, part }` so copies remember their origin. Project gains `brand: { kitId, version }` and `fonts.google`. 28 schema tests.
- **Official presets** (`packages/editor/src/presets.ts`): 9 element presets (headline + subtitle, call to action, sale badge, lower third, price callout, hotspot with tip, product spotlight, logo in the corner, caption bar), 5 scene presets (title card, feature callout, product showcase, testimonial quote, end card), 6 motion presets. Pure apply functions: `applyElementPreset` (fresh ids, action remap, nudge on repeat), `applyScenePreset` (inserted after the current scene, timing re-chained, main-video aware), `applyAnimationPreset`, `projectFromTemplateConfig`; `detectInputs` for smart presets; `outdatedPresets` + `refreshFromPreset` for manual version updates (doc 22.3). 38 editor tests.
- **Brand kit** (doc 22.4): `brandKitSchema` (primary/secondary/card colours, heading/body fonts from a curated list or custom, logo, button corners/weight/case, card radius, shadow, opt-in Google Fonts). `applyBrandKit()` is the single transform used for templates, new elements (`createLayer(type, init, kit)`) and "Apply brand kit" in the editor; text colours over video are left alone; readable button text is computed from the colour.
- **Cloud library + brand kits API**: `GET/POST /api/v1/presets`, `PATCH/DELETE /api/v1/presets/:id` (content change = version bump, type cannot change, 256 KB limit, personal presets visible only to their creator), `GET/POST/PATCH/DELETE /api/v1/brand-kits` (first kit is the default, default moves on delete). Migration `0003` (`presets`, `brand_kits`). 14 API tests.
- **Editor**: Presets panel (Starter + Your library, tabs Elements / Scenes / Motion, live thumbnails painted by the real `Stage`, "Needs your product" hints, rename / replace-with-selection / delete), ★ *Save as preset* on elements, groups and scenes, *Save as template* and *Apply brand kit* in the ⋯ menu, "newer version available → Update" on elements copied from a library preset, "your brand kit changed → Apply new look" bar, tour step for presets, Google-font preview in the canvas. Projects page: **Brand kit** card (set up / edit, logo from the media library, live preview) and *Your templates* in the goal picker; new projects are branded automatically.
- **Runtime 0.4.0**: `ensureFonts()` loads opted-in Google Fonts; platform-neutral embed `SceneFlow.mount()` with `<script … data-auto>` for `[data-sceneflow-id]` elements (config URL from the element, `data-api`, or the script origin). 28.7 KB gzip. 30 core tests.
- **Connectors released from this repo**: `connectors/wordpress` (plugin moved here, 0.4.0), `connectors/shopify` (theme app extension: "SceneFlow video" block + Shopify cart adapter, 0.1.0), `connectors/webflow` (plain embed package: script tag + snippet, 0.1.0). `pnpm build:connectors` → `dist/connectors/*.zip` + `manifest.json` (versions, sha256); `pnpm build:wp` builds WordPress only. Each connector has a `connector.json` and a get-started `README.md`.
- Docs: `docs/getting-started.md` (using SceneFlow + running the repo), handoff spec copied to `docs/`, `CLAUDE.md` working notes, `.gitattributes` (LF).
- Verified: 120 Node tests, typecheck 10/10, PHP 23 assertions, WPCS clean, Plugin Check "No errors found" (plugin 0.4.0 on development.local), connector zips built and served at `/downloads/`, end-to-end on the running stack (brand kit → branded template → official preset → library preset v1→v2 → outdated refs refreshed → template preset → second project → publish carries fonts/brand/preset refs → runtime 0.4.0 → zips → pages).

### Decisions
- Presets are copies, never links: a library change only *offers* an update per element; scenes/projects are never rewritten in the background.
- Official presets take the brand kit on apply (they are generic); user presets do not (they already look the way the user saved them).
- Google Fonts on published pages are opt-in per brand kit (privacy); the editor always previews them.
- The plugin fixed a latent gap: the editor canvas now injects the runtime CSS itself (`ensureStyles()`) instead of relying on a Player having mounted first.

### Deferred
- Shopify connector not exercised on a live store (adapter unit-tested, extension hand-built); Shopify App Store listing.
- Scene-level "refresh from preset", preset sharing across workspaces (agency phase), preset thumbnails for motions.

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
