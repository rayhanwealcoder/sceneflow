# SceneFlow for WordPress

The WordPress connector: pairing, signed publishing, `[sceneflow id="…"]` shortcode, "SceneFlow Video" block, element placements, draft preview inside the theme and the WooCommerce adapter (live products, add to cart, buy now, coupons through the Store API).

## Get started (site owner)

1. Download `sceneflow-wordpress.zip` (Projects → WordPress sites → *Download plugin*, or `dist/connectors/` after a build).
2. WordPress → Plugins → Add New → Upload → activate.
3. Settings → SceneFlow → **Connect with SceneFlow**. You are sent to the app, approve once, and come back connected. (Fallback: *Generate pairing code* and paste it under Projects → WordPress sites.)
4. Publish a video in SceneFlow and pick this site. Paste the shortcode, add the block, or use *Place on your site* to mount the player on any existing element — no page editing.

Self-hosted / local app: tell the plugin where the app runs with `wp option update sceneflow_app_url http://localhost:3000` or `define( 'SCENEFLOW_APP_URL', '…' )` in `wp-config.php`.

WP-CLI: `wp sceneflow pairing-code`, `wp sceneflow status`, `wp sceneflow disconnect`.

## Develop

```bash
pnpm build && pnpm build:wp        # runtime → sceneflow/assets, zip → dist/connectors/sceneflow-wordpress.zip
pnpm test:wp                        # plain-PHP tests (run `pnpm --filter @sceneflow/server test` first for the signature fixture)
phpcs --standard=WordPress --extensions=php --ignore="*/tests/*" connectors/wordpress/sceneflow
wp plugin check sceneflow           # WordPress.org Plugin Check
```

The plugin folder `sceneflow/` is what ships; `tests/` stays out of the zip. Keep the version in `sceneflow.php` (header + `SCENEFLOW_VERSION`) and `readme.txt` (`Stable tag`) in step; the release script reads the header.
