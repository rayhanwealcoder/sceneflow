=== SceneFlow ===
Contributors: sceneflow
Tags: video, interactive video, shoppable video, woocommerce, gutenberg
Requires at least: 6.2
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Interactive and shoppable video from SceneFlow on your WordPress site.

== Description ==

SceneFlow lets you build interactive, shoppable videos in the SceneFlow editor and publish them to WordPress with one click.

* `[sceneflow id="..."]` shortcode and a "SceneFlow Video" block
* Place a player on any existing element of a page straight from SceneFlow (no page editing)
* WooCommerce: pick products in the editor, show live price and stock in the video, add to cart / buy now / apply coupons from the player (WooCommerce is optional)
* Published videos are stored on your site, so they keep working even if SceneFlow is unreachable
* Lightweight runtime (about 28 KB gzipped), no jQuery
* Secure pairing: one-time code, HMAC-signed publish requests

== External services ==

This plugin connects your site to the SceneFlow service (https://sceneflow.app), which hosts the video editor and media processing.

* When you connect the site, a one-time pairing code and your site URL are sent to SceneFlow so it can publish to this site. In return the site stores a shared secret used to verify publish requests.
* When you publish, preview or place a video from the SceneFlow editor, SceneFlow sends the project configuration to this site; the plugin also answers signed requests for your pages, media library items and (if WooCommerce is active) product data so you can pick them in the editor.
* Video files are served from SceneFlow's media storage to your visitors' browsers when a video plays.
* Nothing is sent to SceneFlow from your visitors' browsers apart from loading media; cart actions stay on your own site (WooCommerce Store API).

Terms of service: https://sceneflow.app/terms — Privacy policy: https://sceneflow.app/privacy

== Source code ==

The runtime `assets/sceneflow.runtime.min.js` is built from the TypeScript sources in `packages/core` of the SceneFlow repository (https://github.com/sceneflow/sceneflow); a readable build `assets/sceneflow.runtime.js` ships next to it. Build with `pnpm build && pnpm build:wp`.

== Installation ==

1. Upload and activate the plugin.
2. Go to Settings → SceneFlow and click "Connect with SceneFlow" (or generate a pairing code and enter it in SceneFlow).
3. Publish a project — paste the shortcode, use the block, or place it on an element from SceneFlow.

== Frequently Asked Questions ==

= Do I need WooCommerce? =

No. Without WooCommerce, product cards and buttons open the product link you set in the editor. With WooCommerce active, products come from your store and the player adds them to the real cart.

= Does the video keep working if SceneFlow is down? =

Yes. Published configurations are stored in your database and served from your site; only the media files load from SceneFlow's storage.

== Changelog ==

= 0.3.0 =
* Runtime picks the right video rendition per device, screen density and connection (data saver gets the small file); scroll-scrub videos use a dedicated seek-friendly MP4.
* Scripts load deferred; the next scene's media is prefetched.
* Runtime 0.3.0.

= 0.2.0 =
* WooCommerce adapter: product picker data, live price/stock/variations, add to cart, buy now, coupons through the Store API.
* One-click "Connect with SceneFlow" (pairing code remains as fallback).
* Hardening: CSS length validation for max_width, lowercase tokens, uninstall cleanup of transients, readable runtime build.

= 0.1.0 =
* First release: pairing, publish, shortcode, block, element placements, draft preview, media listing.
