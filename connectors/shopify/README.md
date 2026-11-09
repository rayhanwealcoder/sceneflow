# SceneFlow for Shopify

A theme app extension that adds a **SceneFlow video** app block to any Online Store 2.0 theme. The block loads the published project from the SceneFlow API and renders it with the same runtime WordPress uses; the bundled Shopify module turns product cards and *Add to cart* / *Buy now* into real storefront cart actions (AJAX Cart API). Payments stay in Shopify.

Status: usable, not yet published on the Shopify App Store. Products are picked in SceneFlow as *My products* (name, price, link) or through a custom catalog; the live price/stock on the storefront comes from the Shopify adapter at play time.

## Get started (developer, one-time)

1. Install the Shopify CLI and create an app in your Partner dashboard (`shopify app init`, or use an existing app).
2. Unzip `sceneflow-shopify.zip` and copy `extensions/sceneflow-player` into your app's `extensions/` folder.
3. `shopify app deploy` → install the app on the store.
4. In the theme editor, add the **SceneFlow video** block to any section and paste the project ID from SceneFlow.

Self-hosted SceneFlow: set *SceneFlow API URL* in the block settings to your API origin (the one that serves `/p/<id>.json` and `/runtime/`).

## What is in the zip

```
sceneflow-shopify/
  extensions/sceneflow-player/
    shopify.extension.toml
    blocks/player.liquid            app block (settings: project ID, API URL, max width)
    assets/sceneflow.runtime.min.js runtime (copied from packages/core at build time)
    assets/sceneflow.shopify.min.js Shopify cart adapter (auto-registers)
    locales/en.default.json
```

Build from the repo root: `pnpm build && pnpm build:connectors` → `dist/connectors/sceneflow-shopify.zip`.
