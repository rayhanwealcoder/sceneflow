# SceneFlow for Webflow (and any site that takes a script tag)

Webflow, Squarespace, Framer, Wix (custom code), static HTML — anything that lets you add a script and an HTML embed. No plugin: the runtime fetches the published project JSON from the SceneFlow API (`/p/<id>.json`, CORS-enabled) and mounts a player wherever it finds `data-sceneflow-id`.

## Get started

1. **Site settings → Custom code → Footer code**, add once:
   ```html
   <script src="https://api.sceneflow.app/runtime/sceneflow.runtime.min.js" data-auto defer></script>
   ```
2. Where the video goes, add an **Embed** element:
   ```html
   <div data-sceneflow-id="PROJECT_ID"></div>
   ```
   The project ID is on the project page in SceneFlow (Embed section).
3. Publish the Webflow site. Publishing a new version in SceneFlow updates the video; the embed never changes.

`snippet.html` in this folder has both pieces ready to paste.

## Options

- `data-api="https://your-api"` on the script tag when the runtime is self-hosted (otherwise the API is the origin the script came from).
- `data-sceneflow-config="https://…/p/ID.json"` on an element to point one embed somewhere else.
- The player is responsive; wrap the div in a container to limit its width.
- Product cards: without a shop adapter the button opens the product link set in SceneFlow (*My products*). Shopify storefronts should use the Shopify connector instead.

Self-hosting the runtime: upload `runtime/sceneflow.runtime.min.js` from this zip to your assets and use the second script tag in `snippet.html`.

Build from the repo root: `pnpm build && pnpm build:connectors` → `dist/connectors/sceneflow-webflow.zip`.
