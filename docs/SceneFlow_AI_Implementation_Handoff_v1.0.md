SceneFlow AI Implementation Handoff
Product, Architecture, UX, APIs, Data Models, Security, Performance, and Delivery Plan
Working name: SceneFlow
Version 1.0
9 November 2026
Implementation-ready specification for Claude, Cursor, Codex, or another coding model

# Document Control

# How to Use This Document
- Use this document as the source of truth for implementation sequencing and architectural boundaries.
- An AI coding model should not redesign the product architecture unless a section explicitly marks an open decision.
- Build vertical slices end to end. Do not create all UI first and defer runtime or publishing.
- Maintain one platform-agnostic project schema and one shared runtime core. Platform integrations are adapters only.
- Prefer simple, testable modules. Avoid premature abstraction outside the documented extension points.
- Every milestone must satisfy its acceptance criteria before starting the next milestone.
# 1. Product Summary
SceneFlow is an AI-assisted interactive and shoppable video creation and publishing platform for web professionals. It lets freelancers, agencies, and startup/in-house teams create videos from images, clips, GIFs, audio, products, text, and AI-assisted content, then add interactive website elements such as product cards, Add to Cart, Buy Now, hotspots, forms, coupons, and scroll-controlled playback without custom JavaScript.
SceneFlow is not a CapCut or Premiere replacement. The product is optimized for creating conversion-focused web video experiences and publishing them to WordPress first, then HTML/JavaScript and React/Next.js, with additional adapters later.
```text
Assets
  -> Scene-based Editor
  -> Timeline + Animation
  -> Interactions + Commerce
  -> Preview
  -> Publish
      -> WordPress
      -> HTML/JS
      -> React/Next.js
      -> MP4/WebM export
```
# 2. Product Goals and Non-Goals
## 2.1 Goals
- Enable a new user to publish a template-based interactive video in 10-15 minutes.
- Reduce custom JavaScript and frontend developer dependency for interactive video work.
- Allow agencies to create once and reuse across many client projects using templates, presets, and brand kits.
- Keep published website runtime lightweight and independent from editor code.
- Keep commerce data live by integrating with the underlying store instead of duplicating product, cart, tax, checkout, or order logic.
- Expose a public JavaScript API and React wrapper for developer-controlled integrations.
- Support a platform-agnostic project format so future adapters do not require core rewrites.
## 2.2 Non-Goals for MVP
- Full professional NLE replacement for Premiere/CapCut.
- Advanced masking/compositing suite.
- Live-stream shopping.
- AI avatar studio.
- Native support for many commerce plugins at launch.
- Complex multi-branch logic engine in MVP.
- Full motion-graphics or After Effects replacement.
# 3. Target Customers

## 3.1 Primary ICP
WordPress freelancers and agencies building client websites with Gutenberg, Elementor, Bricks, Divi, Breakdance, WooCommerce, and similar stacks.
## 3.2 Buyer vs User

# 4. Pain-Free UX Principles
- Scene first, timeline second. Beginners should not face a professional timeline by default.
- Progressive disclosure. Show only the controls needed for the selected task or element.
- Every screen should make the next action obvious.
- Template-first onboarding. Blank projects remain available, but are not the recommended first path.
- Use strong defaults. The product should produce a good result before the user understands every setting.
- Preview in context. Users must see desktop, tablet, mobile, and connected WordPress-page behavior before publishing.
- Design and functionality are separate. A commerce button can be styled freely without changing its action contract.
- Never make users manually manage runtime files on WordPress for standard usage.
- Advanced settings should remain discoverable, not visible by default.
- Failures should explain the problem and offer the next action, especially connection, media, publish, and commerce errors.
## 4.1 Recommended New Project Flow
```text
Create Project
  -> Upload Existing Video
  -> Build Scene by Scene
  -> Choose Template
  -> Generate with AI (beta/later)
  -> Start Blank
```
## 4.2 Editor Modes

# 5. Core Product Modules

# 6. Scene and Project Model
SceneFlow must be scene-based, not video-file-based. A project contains scenes, and each scene can use video, image, color, gradient, or generated media as its background/source.
```text
Project
  -> Scenes
      -> Background / media source
      -> Duration / timing
      -> Layers
      -> Animations
      -> Interactions
      -> Transition
      -> Responsive overrides
```
## 6.1 Example Scene
```text
{
  "id": "scene_02",
  "name": "Product Focus",
  "start": 4,
  "end": 10,
  "background": {
    "type": "video",
    "assetId": "asset_123",
    "sourceStart": 12,
    "sourceEnd": 18
  },
  "layers": [],
  "transition": { "type": "fade", "duration": 0.3 }
}
```
# 7. Editor Requirements
## 7.1 Canvas
- Drag, resize, rotate, duplicate, delete, copy/paste.
- Smart guides, snapping, alignment, distribution, safe areas.
- Multi-select, group/ungroup, lock/hide.
- Z-order, opacity, border, radius, shadow, background, gradient, typography.
- Desktop/tablet/mobile overrides.
- Canvas coordinates stored as normalized percentages relative to frame.
## 7.2 Elements

## 7.3 Commerce Element Customization
Commerce functionality must be independent from visual design. A user can completely restyle an Add to Cart button while the action remains ADD_TO_CART.
```text
{
  "type": "commerce-button",
  "content": { "label": "Get Mine", "icon": "cart" },
  "style": {
    "background": "#111111",
    "color": "#ffffff",
    "fontSize": 16,
    "fontWeight": 700,
    "borderRadius": 12
  },
  "action": {
    "type": "ADD_TO_CART",
    "productId": "182"
  }
}
```
# 8. Timeline Requirements
- Video, image, text, product, button, hotspot, audio, and animation tracks.
- Drag clips to move start/end together.
- Drag edges to change duration.
- Split, trim, duplicate, hide, lock, reorder.
- Playhead and scrub.
- Zoom, markers, scene boundaries, magnetic snapping.
- Audio waveform.
- Animation in/out sections.
- Virtualized rendering so only visible tracks are mounted.
- Playback time must not trigger full React tree rerenders.
# 9. Playback Modes

## 9.1 Scroll Scrub Settings
- Pin on/off
- Scroll distance
- Vertical/horizontal mapping
- Smoothness
- Start/end offsets
- Forward and reverse scrub
- Controls show/hide
- Progress show/hide
- Mobile fallback
- Reduced-motion fallback
# 10. Video Creation and AI Assistance
## 10.1 Supported Inputs
- Video clips
- Images
- GIF
- Audio/music
- Voiceover
- Logos/brand assets
- Products
- Text
- AI-assisted assets
## 10.2 AI MVP
- AI script
- AI storyboard
- AI scene suggestions
- AI CTA/product copy
- AI voiceover
- AI captions/transcript
## 10.3 Later AI
- Image generation
- Background removal
- Auto B-roll
- AI product video
- Video generation
- Translation/dubbing
- Object tracking
- AI avatar
AI media generation must be provider-based and optional. Core project creation must not depend on a generative video provider.
# 11. Media and Performance Architecture
## 11.1 Upload Flow
```text
Browser
  -> Request signed upload URL
  -> Direct resumable upload to object storage / video provider
  -> Processing job queued
  -> Generate editor proxy, poster, thumbnails, waveform, metadata
  -> Generate scroll-optimized MP4 when required
```
Never proxy large uploads through the SaaS application server.
## 11.2 Editor Media Rules
- Do not edit original high-resolution video directly. Use 540p/720p proxies.
- Final export uses original/high-quality source where possible.
- Images use optimized editor variants.
- GIF uploads are normalized to video for scroll-scrub playback.
- Only active scene and adjacent scenes should be loaded/prepared.
## 11.3 Rendering Split

## 11.4 Frontend Performance Rules
- Editor bundle never ships to published site.
- Published core runtime target: 30-80 KB gzipped before optional modules.
- Project JSON target: normally under 100 KB excluding media.
- Poster-first rendering.
- Lazy player initialization near viewport.
- Normal/long video uses adaptive HLS where appropriate.
- Short scroll-scrub video uses optimized progressive MP4 with seek-friendly encoding.
- Interactive text/buttons/products remain HTML, not baked into video.
# 12. WordPress Architecture
WordPress is the initial distribution platform, but the core must remain platform agnostic. The plugin is an integration and delivery layer, not the full cloud editor.
```text
SceneFlow Cloud
  -> Publish project JSON
  -> WordPress Connector
      -> Validate signed request
      -> Store active published config locally
      -> Load packaged runtime
      -> Expose shortcode/block/builder adapters
      -> Bridge WooCommerce
  -> Visitor website
```
## 12.1 WordPress Responsibilities
- Site connection
- Media access
- Commerce integration
- Published project storage
- Shortcode
- Gutenberg block
- Builder adapters
- Frontend runtime
- Preview bridge
- Connection health
## 12.2 Stable Embed Contract
```text
[sceneflow id="project_abc123"]
```
The project ID remains stable across updates. Republishing must not require reopening the page builder or changing the shortcode.
# 13. Page Builder Support

```text
SceneFlow Core Runtime
  -> Gutenberg adapter
  -> Elementor widget
  -> Bricks element
  -> Divi module
  -> Breakdance element
  -> Shortcode adapter
```
All adapters must output the same mount contract and must not create separate player engines.
# 14. Commerce Compatibility Architecture
SceneFlow controls the experience. The commerce plugin controls product truth, stock, cart, tax, checkout, payment, and orders.
```text
SceneFlow Player
  -> Commerce Core
  -> Commerce Adapter
      -> WooCommerce (launch)
      -> Easy Digital Downloads (later)
      -> SureCart (later)
      -> Custom adapter
      -> External URL fallback
```
## 14.1 Normalized Product Schema
```text
{
  "id": "182",
  "source": "woocommerce",
  "type": "variable",
  "name": "Runner Pro",
  "image": "https://.../shoe.webp",
  "price": 129,
  "regularPrice": 149,
  "salePrice": 129,
  "currency": "USD",
  "stockStatus": "instock",
  "purchasable": true,
  "productUrl": "https://...",
  "variations": []
}
```
## 14.2 Required Commerce Actions
- VIEW_PRODUCT
- ADD_TO_CART
- BUY_NOW
- SELECT_VARIATION
- CHANGE_QUANTITY
- REMOVE_FROM_CART
- APPLY_COUPON
- OPEN_CART
- OPEN_CHECKOUT
## 14.3 Adapter Interface
```text
interface SceneFlowCommerceAdapter {
  getId(): string;
  isAvailable(): Promise<boolean>;
  getCapabilities(): Promise<CommerceCapabilities>;
  searchProducts(args): Promise<Product[]>;
  getProduct(id): Promise<Product>;
  getVariations(productId): Promise<Variation[]>;
  getCart(): Promise<Cart>;
  addToCart(item): Promise<Cart>;
  removeFromCart(itemId): Promise<Cart>;
  updateQuantity(itemId, quantity): Promise<Cart>;
  applyCoupon(code): Promise<Cart>;
  getCheckoutUrl(): Promise<string>;
}
```
# 15. Platform-Agnostic Runtime
Use one core runtime and one project format. WordPress, HTML/JS, and React are adapters/wrappers.
```text
Project JSON
  -> @sceneflow/core
      -> video engine
      -> scene engine
      -> interaction engine
      -> scroll engine
      -> commerce bridge
  -> adapters
      -> WordPress
      -> JS embed
      -> React
      -> future platforms
```
# 16. Public JavaScript API
The public JS API is mandatory for custom integrations and developer adoption.
## 16.1 Initialization
```text
const player = new SceneFlow.Player({
  target: '#player',
  projectId: 'abc123'
});
await player.init();
```
## 16.2 Core Methods
```text
player.play();
player.pause();
player.seek(5.2);
player.goToScene('scene_3');
player.getCurrentScene();
player.getState();
player.destroy();
```
## 16.3 Events
```text
player.on('ready', handler);
player.on('sceneChange', handler);
player.on('productClick', handler);
player.on('addToCart', handler);
player.on('complete', handler);
player.on('error', handler);
```
## 16.4 Custom Commerce Handler
```text
const player = new SceneFlow.Player({
  target: '#player',
  configUrl: '/project.json',
  commerce: {
    async addToCart(item) {
      return myStore.cart.add(item);
    }
  }
});
```
## 16.5 API Requirements
- Semantic versioning
- Typed TypeScript definitions
- Stable event names
- No breaking changes in minor versions
- Documented error codes
- Custom action hooks
- Lifecycle events
- Promise-based async methods
- Destroy/cleanup method
- Headless config mode
# 17. React / Next.js SDK
```text
npm install @sceneflow/react

import { SceneFlowPlayer } from '@sceneflow/react';

export default function ProductPage() {
  return <SceneFlowPlayer projectId="abc123" />;
}
```
The React package must be a thin wrapper around @sceneflow/core, not a second runtime implementation.
# 18. HTML / Self-Hosted Export
## 18.1 Export Modes
- Cloud embed
- Static HTML ZIP
- JavaScript SDK
- Project JSON
- React/Next.js SDK
## 18.2 Static ZIP Structure
```text
project/
  index.html
  project.json
  manifest.json
  README.md
  assets/
    js/sceneflow.runtime.min.js
    css/sceneflow.min.css
    video/
    images/
    audio/
```
Never include editor code, AI libraries, timeline code, Remotion, FFmpeg, or admin UI in a static runtime export.
# 19. Data Model

# 20. Project JSON Contract
```text
{
  "schemaVersion": "1.0",
  "projectId": "project_abc123",
  "version": 18,
  "video": {
    "provider": "cloudflare",
    "assetId": "video_x",
    "src": "https://.../manifest.m3u8",
    "poster": "https://.../poster.jpg",
    "duration": 12
  },
  "playback": {
    "mode": "scroll",
    "controls": false,
    "muted": true,
    "pin": true,
    "scrollDistance": "400vh",
    "mobileFallback": "normal"
  },
  "scenes": []
}
```
## 20.1 Schema Rules
- schemaVersion required
- No executable JavaScript in config
- Sanitize/allowlist URLs
- Ignore unknown forward-compatible fields unless security-sensitive
- Runtime validates supported major schema version
- Actions must be typed objects
# 21. API Surface
## 21.1 SaaS API

## 21.2 WordPress REST Routes

# 22. Presets and Brand Kits
## 22.1 Preset Types
- Full experience template
- Scene preset
- Element preset
- Animation preset
## 22.2 Scopes
- Official
- Personal
- Team
- Agency
- Client
## 22.3 Preset Behavior
- Applying a preset creates an independent copy in the project.
- No forced auto-update of existing projects.
- Preset version updates can be compared and applied manually.
- Smart presets can declare required inputs such as video, product, logo, CTA, and brand kit.
## 22.4 Brand Kit
- Logo
- Primary/secondary colors
- Heading/body fonts
- Button style
- Product card style
- Border radius
- Shadow
- Spacing defaults
# 23. Collaboration and Agency Workflow
```text
Draft
  -> Internal Review
  -> Client Review
  -> Approved
  -> Published
```
- Frame/scene/time anchored comments
- Mentions
- Resolve/reopen
- Role-based publish permission
- Client-only approval access
- Client/site/project grouping
- Portfolio dashboard
- Connection/performance alerts
# 24. Analytics
## 24.1 MVP Events
- player_loaded
- video_play
- video_pause
- video_25
- video_50
- video_75
- video_complete
- scene_enter
- scene_exit
- element_impression
- element_click
- hotspot_click
- product_view
- add_to_cart
- checkout_started
- player_error
## 24.2 Advanced Commerce Analytics
- Purchases
- Conversion rate
- Revenue
- Influenced revenue
- Revenue per session
- Product performance
- Drop-off timeline
- Replay hotspots
- A/B test comparison later
# 25. Security Requirements
- HTTPS everywhere.
- Signed upload URLs.
- HMAC-signed SaaS to WordPress publish requests with timestamp anti-replay.
- Role-based authorization on workspace/project/site APIs.
- Rate limiting on auth, connect, publish, analytics, and product search.
- Validate schema and payload size before storage.
- No arbitrary JS execution from project config.
- Sanitize text and URLs and escape WordPress output.
- Secret encryption/hashing as appropriate.
- Audit log for publish, rollback, site connection, and role changes.
- Webhook signatures.
- Consent-aware analytics and ability to disable analytics.
# 26. Recommended Technology Stack

# 27. Monorepo Structure
```text
apps/
  web/                 # SaaS editor/dashboard
  api/                 # Backend API
  worker/              # Media/render jobs

packages/
  core/                # SceneFlow runtime core
  schema/              # Shared project schema/types
  player/              # Player UI/runtime helpers
  editor/              # Editor domain modules
  timeline/            # Timeline engine
  commerce/            # Commerce contracts/adapters
  react/               # React wrapper
  embed/               # Generic JS embed
  analytics/           # Event contracts/client
  ui/                  # Shared SaaS UI

wordpress/
  sceneflow/           # WordPress connector plugin
```
# 28. Coding Standards
- TypeScript strict mode.
- No any except isolated, documented boundary cases.
- Shared schemas validated at runtime using Zod or equivalent.
- Domain logic separated from framework/UI components.
- No platform-specific logic in @sceneflow/core.
- All public APIs typed and versioned.
- Prefer pure functions for timing, geometry, and schema transforms.
- Use dependency injection/interfaces for video provider, storage, commerce, and analytics providers.
- Never mutate published project versions.
- Use feature flags for unfinished advanced modules.
- Use WordPress coding standards in plugin PHP.
- Prefix WordPress globals/functions/classes/routes/tables with sceneflow conventions.
- Write unit tests for timing, geometry, schema validation, signatures, and adapter normalization.
- Write integration tests for publish -> WordPress store -> runtime render.
# 29. Testing Strategy

# 30. Implementation Roadmap
## Phase 1 - Foundation
- Monorepo
- Auth/workspaces
- Project schema
- Database
- Media assets
- Direct upload
- Processing queue
- Core runtime skeleton
## Phase 2 - Editor
- Scenes
- Canvas
- Layers
- Inspector
- Responsive overrides
- Basic elements
- Autosave/version snapshots
## Phase 3 - Timeline and Playback
- Timeline
- Playhead/scrub
- Element timing
- Audio waveform
- Normal playback
- Scroll Scrub
## Phase 4 - WordPress
- Connector
- Site pairing
- Publish endpoint
- Local config
- Shortcode
- Gutenberg block
- Preview
## Phase 5 - Commerce
- Commerce core
- WooCommerce adapter
- Product picker
- Live product hydration
- Add to cart
- Variations
- Quantity
- Coupon basics
## Phase 6 - Performance
- Proxy generation
- Poster/thumbnails
- Lazy loading
- Scroll optimized MP4
- Runtime split
- Worker offloading
- Device profiles
## Phase 7 - Presets
- Full templates
- Scene presets
- Element presets
- Cloud library
- Brand kit
## Phase 8 - Analytics
- Event client
- Batch ingest
- Basic dashboard
- Engagement timeline
## Phase 9 - AI
- Script
- Storyboard
- Copy
- Voiceover
- Captions
## Phase 10 - Agency
- Clients
- Team roles
- Comments
- Approval
- Agency dashboard
# 31. MVP Definition
- Accounts/workspaces/projects.
- WordPress site connection.
- Image/video/audio upload.
- Scene editor and basic timeline.
- Text, image, button, product, hotspot.
- Basic animations.
- Normal + Scroll Scrub playback.
- WooCommerce product selection and add to cart.
- Templates + personal presets.
- Desktop/tablet/mobile preview.
- Shortcode + Gutenberg block.
- Basic analytics.
- MP4 export.
# 32. MVP Acceptance Criteria

# 33. AI Coding Model Execution Instructions
When handing this document to a coding model, use the following execution protocol:
1. Read the full document before coding.
1. Create a repository plan mapping packages, apps, and dependencies to this architecture.
1. Implement Phase 1 as a working vertical slice before starting later phases.
1. For each phase, produce database migrations, types/schemas, API endpoints, UI, tests, and developer documentation together.
1. Do not invent alternative project schemas, commerce contracts, or runtime architectures unless a blocking technical issue is demonstrated.
1. Keep WordPress and non-WordPress platforms behind adapters.
1. Keep editor and published runtime bundles separate.
1. Use explicit TODOs for post-MVP scope rather than partially implementing hidden behavior.
1. Before merging a milestone, run unit, integration, E2E, lint, typecheck, and performance checks relevant to that milestone.
1. After each phase, update architecture docs and changelog.
## 33.1 Suggested Prompt to Another AI Model
```text
You are implementing SceneFlow. Treat the attached SceneFlow AI Implementation Handoff as the source of truth.

First:
1. Read the entire document.
2. Produce a repository/module plan for Phase 1 only.
3. Identify open decisions that block Phase 1.
4. Do not change the documented core architecture.
5. Then implement Phase 1 as a tested vertical slice.

Rules:
- One platform-agnostic project schema.
- One shared runtime core.
- WordPress/React/HTML are adapters.
- Editor code must never ship to the published runtime.
- Commerce uses normalized adapters; do not hardcode WooCommerce into the core.
- Use direct signed uploads and proxy media for editing.
- No arbitrary JavaScript in project JSON.
- Keep all public APIs typed and versioned.

For every milestone, provide:
- files changed
- migrations
- tests
- API contracts
- security considerations
- performance impact
- manual QA steps
- remaining TODOs
```
# 34. Open Decisions Before Production
- Final product name/domain.
- Primary video provider at MVP launch.
- Minimum supported WordPress/PHP versions.
- Whether MP4 export is included in MVP or immediately after MVP.
- Exact pricing and quotas for storage, bandwidth, rendering, AI credits, sites, and team members.
- Analytics storage scaling strategy.
- Exact attribution model for influenced revenue.
- Initial native builder widgets beyond Gutenberg/shortcode.
- Preview implementation details for connected WordPress pages.
- Authentication choice for site pairing beyond HMAC publish signing.
# 35. Final Architecture Rules
• One editor, one project schema, one shared runtime core.
• Platform integrations are adapters.
• Commerce integrations are adapters.
• Design is separate from action/business logic.
• Original media is not the editor proxy.
• Heavy rendering runs server-side.
• Interactive UI remains HTML/CSS on the website.
• Published WordPress projects run from locally stored config.
• Public JS API is a first-class product surface.
• Simple mode must remain usable without advanced timeline knowledge.

| Field | Value |
| --- | --- |
| Document | AI Implementation Handoff |
| Product | SceneFlow |
| Version | 1.0 |
| Date | 9 November 2026 |
| Primary audience | AI coding models + engineering team |
| Primary platform | SaaS + WordPress-first runtime |
| Secondary platforms | HTML/JS, React/Next.js, later Shopify/Webflow/Framer |


| Priority | Segment | Primary Pain | Core Outcome |
| --- | --- | --- | --- |
| P1 | WordPress Freelancer | Custom JS and developer dependency for premium interactive sections | Deliver premium interactive video sections faster |
| P1 | Web/WordPress Agency | Repeated builds, revisions, multi-client management, margin pressure | Reuse work across clients and centralize delivery |
| P2 | Startup / In-house Web Team | Slow product demo and campaign iteration due to engineering dependency | Launch and update interactive product experiences quickly |


| Context | Buyer | Daily User |
| --- | --- | --- |
| Freelancer | Freelancer | Freelancer |
| Agency | Owner / Head of Web / Creative Director | Designer / Developer / Marketer / Video Editor |
| Startup | Founder / Head of Marketing / Growth Lead | Designer / Marketer / Web Team |


| Mode | Visible UI |
| --- | --- |
| Simple | Scenes, Canvas, Basic Properties, Templates, Preview, Publish |
| Advanced | Scenes, Canvas, Layers, Timeline, Animations, Logic, Markers, Advanced Properties |


| Module | Responsibility |
| --- | --- |
| Project/Workspace | Users, workspaces, clients, sites, projects, versions |
| Media | Uploads, processing, proxies, posters, thumbnails, waveforms, metadata |
| Scene Editor | Scene structure, canvas, layers, inspector, responsive overrides |
| Timeline | Element timing, video/audio tracks, playhead, trim, split, snap |
| Interaction Engine | Buttons, hotspots, forms, scene jumps, show/hide, custom actions |
| Commerce Core | Normalized product/cart interface + adapters |
| Presets/Brand Kits | Reusable scenes, elements, animations, full experiences, client styles |
| Publishing | WordPress local config, HTML embed/export, React SDK, JSON export |
| Analytics | Views, engagement, interactions, commerce conversion metrics |
| AI Assistance | Script, storyboard, copy, captions, voice; generative media later |


| Type | Examples |
| --- | --- |
| Design | Text, Image, Video, Shape, Icon, Badge, Button, Audio |
| Smart / Interactive | Product, Product Card, Price, Add to Cart, Buy Now, Variation, Quantity, Coupon, Hotspot, Tooltip, Popup, Form, Lead Capture |


| Mode | Behavior |
| --- | --- |
| Normal | Viewer-controlled video playback |
| Autoplay | Muted autoplay when browser allows |
| Click to Play | Starts via click |
| Hover Play | Play while hovered where applicable |
| Loop | Loop full project or configured segment |
| Scroll Scrub | Scroll progress controls video time; can pin and hide controls |


| Workload | Engine |
| --- | --- |
| Trim, concat, resize, transcode, GIF conversion, audio mix | Native FFmpeg |
| Complex React motion composition | Remotion + FFmpeg |
| Interactive website runtime | No video render; HTML/CSS/JS + project JSON |
| Editor preview | Native video + DOM/CSS + GSAP; Workers for heavy tasks |


| Tier | Builders |
| --- | --- |
| Launch | Gutenberg, Elementor, Bricks, Divi, Breakdance |
| Fallback | Any builder capable of rendering a shortcode |
| Later | WPBakery, Beaver Builder, Oxygen, Avada, GenerateBlocks, Greenshift |


| Entity | Key fields |
| --- | --- |
| users | id, email, name, status |
| workspaces | id, owner_id, type, plan_id |
| workspace_members | workspace_id, user_id, role |
| clients | id, workspace_id, brand_kit_id |
| sites | id, workspace_id, url, platform, connection_status |
| projects | id, workspace_id, site_id, name, status, current_draft_version |
| project_versions | id, project_id, version, config_json, checksum, state |
| media_assets | id, workspace_id, provider, provider_asset_id, type, metadata_json |
| presets | id, workspace_id, scope, type, version, config_json |
| brand_kits | id, workspace_id, client_id, config_json |
| comments | id, project_id, version_id, timecode, x, y, body |
| analytics_events | event_uuid, project_id, session_id, event_type, payload_json, occurred_at |


| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/v1/projects | Create project |
| GET | /api/v1/projects/:id | Get draft |
| PATCH | /api/v1/projects/:id | Update project metadata |
| POST | /api/v1/projects/:id/versions | Create version |
| POST | /api/v1/projects/:id/publish | Publish to target |
| GET | /api/v1/sites/:id/products | Search connected products |
| POST | /api/v1/presets | Save preset |
| GET | /api/v1/presets | List presets |
| POST | /api/v1/analytics/events | Ingest batched analytics |


| Method | Route | Purpose |
| --- | --- | --- |
| GET | /wp-json/sceneflow/v1/health | Connector version/capabilities |
| POST | /wp-json/sceneflow/v1/connect | Pair site |
| GET | /wp-json/sceneflow/v1/products | Authorized product search |
| GET | /wp-json/sceneflow/v1/media | Authorized media listing |
| POST | /wp-json/sceneflow/v1/publish | Receive signed published project |
| GET | /wp-json/sceneflow/v1/project/:id | Same-origin public config |
| POST | /wp-json/sceneflow/v1/preview-session | Signed preview session |


| Layer | Recommendation |
| --- | --- |
| Editor frontend | Next.js + React + TypeScript |
| State/data | TanStack Query + Zustand |
| Animation | GSAP |
| Backend | Node.js + NestJS or Fastify-based modular API |
| Database | PostgreSQL + Prisma |
| Queue/cache | Redis + BullMQ |
| Storage | S3-compatible / Cloudflare R2 |
| Video delivery | Cloudflare Stream or provider abstraction |
| Processing | Native FFmpeg workers |
| Complex export | Remotion + FFmpeg |
| Analytics | PostgreSQL first, ClickHouse later if needed |
| WordPress | PHP connector + packaged vanilla/TS runtime |


| Type | Coverage |
| --- | --- |
| Unit | Timing, geometry, reducers, schema, signatures, adapter normalization |
| Component | Canvas inspector, scene list, timeline clips, product picker |
| Integration | SaaS publish -> WordPress -> runtime |
| Commerce | Products, variable products, cart, coupons, out-of-stock |
| E2E | Create -> edit -> preview -> publish -> interact |
| Performance | Payload size, lazy load, scroll scrub smoothness, memory |
| Security | Authz, replay, injection, URL sanitization, rate limit |
| Compatibility | Browsers, page builders, WooCommerce setups |
| Failure | SaaS outage after publish, media CDN error, product API error, rollback |


| ID | Acceptance Criterion |
| --- | --- |
| AC-001 | A new user can connect a WordPress site and publish a sample project without writing code. |
| AC-002 | A template-based first project can be published in under 15 minutes in usability testing. |
| AC-003 | Publishing a new version does not require changing the shortcode/project ID. |
| AC-004 | Published WordPress experience still renders if the SaaS dashboard is temporarily unavailable. |
| AC-005 | User can drag/resize an element and change timing in the editor. |
| AC-006 | Scroll Scrub maps page scroll forward/backward to video time and can hide native controls. |
| AC-007 | A WooCommerce product can be selected and added to the current cart session from the player. |
| AC-008 | User can save and reuse an element or scene preset. |
| AC-009 | Responsive overrides can differ across desktop/tablet/mobile. |
| AC-010 | Player lazy-loads media near viewport and does not load the original upload at initial page load. |
| AC-011 | Public JS API can initialize, play, pause, seek, listen to events, and destroy a player instance. |
| AC-012 | Static HTML export contains only runtime, JSON, and required assets, not editor dependencies. |
