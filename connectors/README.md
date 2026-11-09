# Connectors

Everything that puts a published SceneFlow video on a site lives here and is released from this repo as a zip:

| Connector | Folder | Zip (`dist/connectors/`) | What it is |
| --- | --- | --- | --- |
| WordPress | `wordpress/` | `sceneflow-wordpress.zip` | Full plugin: pairing, signed publish, shortcode/block/placements, preview, WooCommerce adapter |
| Shopify | `shopify/` | `sceneflow-shopify.zip` | Theme app extension with a "SceneFlow video" block + Shopify cart adapter |
| Webflow / plain embed | `webflow/` | `sceneflow-webflow.zip` | Script tag + `data-sceneflow-id` element (works on any site that accepts custom code) |

```bash
pnpm build                 # builds the runtime the connectors ship
pnpm build:connectors      # all zips + manifest.json (versions, sizes, sha256)
pnpm build:wp              # WordPress only
```

Each folder has a `connector.json` (zip name, root folder, runtime files to copy in, where the version lives) and a `README.md` with the get-started steps for that platform. Adding a platform = a new folder with those two files; the release script picks it up.

All connectors are delivery layers over `@sceneflow/core`: they never contain editor code, and commerce goes through the runtime's adapter registry (`SceneFlow.commerce`).
