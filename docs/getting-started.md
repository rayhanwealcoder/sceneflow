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
6. The **VIDEO** block in the right panel is where the look of the video itself lives: the **thumbnail** shown before play (*Pick a frame…* from the strip or an exact second, or *Use an image…* for a designed picture), whether **play controls** show, the **playback speed** (0.5×–2×) and what sits **behind the video** — choose *Blend into the page* and a clip shot on your page's colour sits there like a picture, nothing looks like a player.

### Scroll-driven videos

Pick *Scroll scrub* under Advanced → Playback and the video follows the visitor's scrolling, forwards and back — like the product pages of the big brands. The player **pins** itself while the page scrolls the *scroll length* you set (300vh = three screens), at the **top, centre or bottom** of the screen, with an **offset** for a fixed site header. It pins on any theme: the player works out by itself whether the page allows CSS sticky, needs a fixed position, or runs inside a smooth-scroll wrapper (GSAP ScrollSmoother, Lenis) and must move with the page. *Smoothness* turns wheel steps into glides; *Show scroll markers while testing* draws the start, end and pin lines on the page while you tune it. Without pinning, *Start when* / *End when* say where the scrub begins and ends as the player passes through the screen.

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

### 5. See how it performs

Project page → **Analytics**: loads, plays, completion, average watch time, clicks, add-to-carts; loads vs plays per day; an **engagement timeline** that shows where viewers drop off (with your scene names along the bottom); a funnel; per-element, per-scene, per-product and per-page tables. Everything is anonymous (no cookies, no IP addresses) and visitors with Do Not Track are never counted. WordPress site owners can switch it off under Settings → SceneFlow → Advanced.

### 6. No footage? Make a clip with AI

A 6–10 s AI clip is plenty. Ask for one slow continuous camera move, no cuts, no text, subject on the left. Ready prompts for Veo, Sora, Runway and Kling are in [docs/ai-video-prompts.md](ai-video-prompts.md) and under the upload box in the app.

### 7. Let AI write, voice and caption it

In the editor click **✨ AI**:

- **Script** — say what the video is about and for whom, pick a length and tone, and you get scenes with a headline, a supporting line, a spoken line and a shot description (plus a ready prompt for an AI video tool). *Build these scenes* puts them on the canvas; Ctrl+Z undoes it.
- **Copy** — select any text, button, badge or hotspot and get five alternatives (shorter, more urgent, benefit-led…). Click one to use it.
- **Voice (optional)** — most videos keep their own sound, so this sits behind the small *🎙 Voice (optional)* link (and *Spoken line & voice* in the scene panel). Pick a voice, *Generate all scenes*: each line becomes an audio track on its scene; the scene grows if the line is longer.
- **Captions** — made from the lines automatically (timed over the audio), editable word by word, shown on the published video with a CC button for visitors. Switch them off per project if you prefer.

Everything works without any AI account: you get starter text to edit and the computer's built-in voice. Site owners add `ANTHROPIC_API_KEY` (real scripts and copy, written by Claude) and `ELEVENLABS_API_KEY` (natural voices, captions transcribed from audio) in `apps/api/.env`; the panel's *Setup notes* say exactly what each key adds.

### 8. Work with clients and your team

**Clients.** Top bar → **Team & clients** → *Add client*. From then on the Projects page has a filter chip per client, new videos are filed under the selected client, and a client can have its own brand kit (new videos for them start with it). Clients never need an account.

**Review & approval** (project page, step 3):

1. Tick *Require approval before publishing* if you want a gate: editors can then only publish an approved, unchanged draft. Admins and the owner can always publish.
2. **Send to client** creates a review link. Send it however you like. The client opens it, watches the real player, presses *Add a note on the video* and clicks a spot to leave a note at that moment, then **Approve** or **Request changes**. *New link* replaces it, *Revoke* kills it, links expire after 30 days.
3. **Send for internal review** asks an admin of your workspace instead; admins see *Approve* / *Request changes…*.
4. The status chip tells you where things are (Waiting for the client · Changes requested · Approved by … · Approved · edited since). If the draft changes after approval, send it again or let an admin publish.

**Comments.** In the editor press **💬**. Comments from colleagues and from the client's review link are in one list; each one remembers the scene, the moment and the element it is about — click it to jump there. *Pin on canvas* lets you click the exact spot. Use `@Name` to mention a colleague; resolve what is done.

**Team.** Team & clients → *Invite someone*: pick a role, create a link, send it. The link works once, for 7 days, and lands the person in your workspace (they can switch between workspaces in the top bar). Roles: *viewer* sees and comments, *editor* builds and publishes, *admin* also approves, invites and manages clients.

**Dashboard.** Top bar → **Dashboard**: what needs attention (a site that cannot be reached, a client who has not answered for days, something approved but not published, player errors), mentions of you, every project grouped by client with its live version, review state, site health and 7-day loads / plays / clicks, and a feed of who did what.

### 9. Download as MP4

Project page → **Download as MP4** (also in the editor's ⋯ menu). Pick what to render (current draft or the published version), quality (1080p or 720p), frame rate and — for portrait videos — which layout (phone by default), then **Render MP4**. The server renders it with the same player your visitors see, so text, motion, captions and voiceover are all in the file; buttons, hotspots and product cards appear as they look at that moment (a video file cannot be clicked). The row shows progress and turns into a **Download** button when the file is ready; it is named after the project (`spring-launch-1080p.mp4`). Rendering takes about as long as the video, often less. Scroll videos export as a normal play-through. Up to 10 minutes per file.

### 10. When something does not work

Project page → **Something not working?** runs the whole chain for you: draft, media, published version, site reachable, plugin connected, WooCommerce available, pushed version, what the site actually serves, placements. Each line that fails has a button that takes you to the fix.

---

## Part 2 — Running SceneFlow from this repo

Requirements: Node 20.6+, PostgreSQL (native install, no Docker), pnpm (`npm i -g pnpm`). FFmpeg comes from npm. MP4 export needs **Google Chrome** on the machine that runs the worker (found automatically; `EXPORT_BROWSER=/path/to/chrome` in `apps/worker/.env` otherwise) — everything else works without it.

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
| `node scripts/e2e/scroll-smoothness.mjs` | Real-Chrome scroll-scrub measurement with a generated clip (frame update rate, seek latency) |
| `node scripts/e2e/analytics.mjs` | Real-Chrome visit → events → dashboard summary |
| `node scripts/e2e/pages.mjs` | Real Chrome walks every page (sign-up → editor → analytics → …) and fails on any page error |
| `node scripts/e2e/ai.mjs [--record]` | Real Chrome through the UI: AI script → scenes → voiceovers → captions → publish → player; `--record` writes `dist/walkthrough/sceneflow-walkthrough.mp4` |
| `node scripts/e2e/agency.mjs` | Real Chrome, three browsers: owner adds client + invite → client reviews and approves through the link → publish → dashboard → colleague joins, comments with a pin and a mention |
| `node scripts/e2e/export.mjs` | Uploads a clip + voice track, builds text / button / hotspot / captions / voiceover, renders a 720p MP4 through the UI, downloads it and checks it with ffprobe + frame samples (keeps `dist/e2e/export-e2e.mp4`) |
| `node scripts/e2e/full-local.mjs [--headed --keep-open]` | One fresh account through the whole product in a real Chrome, WordPress included (see the Phase 11 changelog) |
| `node scripts/e2e/make-demo-clip.mjs out.mp4 [--still out.png]` | Renders a professional-looking 1080p product clip (and a product still) with Chrome + FFmpeg — no stock footage |
| `node scripts/e2e/wp-landing.mjs [--headed --keep-open]` | On development.local: the rendered clip, an autoplay hero with a WooCommerce card (thumbnail picked in the editor UI), a pinned scroll story, a designed landing page, the element picker UI, the shortcode, the visitor's view (hints, transparent players, add-to-cart), scroll pinning + smoothness on the theme and on the demo page, analytics, diagnostics |

AI keys are optional (`apps/api/.env.example`, section "AI"): without them the API serves starter text and uses the operating system's voice (Windows / macOS built in; `espeak-ng` on Linux).

Security defaults worth knowing: sign-in is rate-limited per IP and locked progressively per account after 5 wrong passwords; set `TRUST_PROXY=true` only when the API runs behind Nginx / Cloudflare (otherwise forwarded-IP headers are ignored on purpose); run `pnpm audit --prod` before a release.

Local WordPress testing uses a LocalWP site; point the plugin at the local app with `wp option update sceneflow_app_url http://localhost:3000`.

Where things are: `packages/schema` (project format), `packages/core` (published runtime), `packages/editor` (editor domain: ops, templates, presets, brand kit), `packages/server` (DB, storage, queue, connector protocol), `apps/api`, `apps/worker`, `apps/web`, `connectors/*`. Decisions and phase notes: `docs/architecture.md`, `CHANGELOG.md`; the product spec: `docs/SceneFlow_AI_Implementation_Handoff_v1.0.md`.

Deploying to a VPS (no Docker): see the README.
