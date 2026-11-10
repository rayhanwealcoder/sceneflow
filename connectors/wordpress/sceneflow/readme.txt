=== SceneFlow ===
Contributors: sceneflow
Tags: video, interactive video, shoppable video, woocommerce, gutenberg
Requires at least: 6.3
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.8.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Interactive and shoppable video from SceneFlow on your WordPress site.

== Description ==

SceneFlow lets you build interactive, shoppable videos in the SceneFlow editor and publish them to WordPress with one click.

* `[sceneflow id="..."]` shortcode, a "SceneFlow Video" block, and native "SceneFlow Video" elements for Elementor and Bricks (any other builder: the shortcode)
* Place a player on any existing element of a page straight from SceneFlow (no page editing)
* WooCommerce: pick products in the editor, show live price and stock in the video, add to cart / buy now / apply coupons from the player (WooCommerce is optional)
* Sales from a video: with playback analytics on, orders that contain products added from a video show up as orders and revenue on the video's Analytics page in SceneFlow
* Published videos are stored on your site, so they keep working even if SceneFlow is unreachable
* Lightweight runtime (about 35 KB gzipped), no jQuery
* Secure pairing: one-time code, HMAC-signed publish requests

== External services ==

This plugin connects your site to the SceneFlow service (https://sceneflow.app), which hosts the video editor and media processing.

* When you connect the site, a one-time pairing code and your site URL are sent to SceneFlow so it can publish to this site. In return the site stores a shared secret used to verify publish requests.
* When you publish, preview or place a video from the SceneFlow editor, SceneFlow sends the project configuration to this site; the plugin also answers signed requests for your pages, media library items and (if WooCommerce is active) product data so you can pick them in the editor.
* Video files are served from SceneFlow's media storage to your visitors' browsers when a video plays.
* Playback analytics (off until you turn it on: the settings page asks once after connecting, and the switch is under Settings → SceneFlow → Advanced): when on, the player sends anonymous events — player loaded, play/pause, how far the video was watched, scene changes, clicks on buttons/hotspots/product cards, add-to-cart — together with the page URL, a device class (desktop/tablet/mobile) and a random per-tab session id. No cookies are set, no IP address or personal data is stored, and visitors with "Do Not Track" or Global Privacy Control are not counted. Cart actions stay on your own site (WooCommerce Store API).
* Sales from a video (WooCommerce, only while playback analytics is on): when a visitor adds a product to the cart from a video, the order line notes which video it came from (and the same random per-tab id). SceneFlow reads those orders with a signed request when you open a video's Analytics page: order number, status, currency, paid/modified dates and, for the lines that came from a video, product id, quantity and amount after refunds. No names, addresses, e-mail addresses or payment details are shared, and nothing is sent while analytics is off.

Terms of service: https://sceneflow.app/terms — Privacy policy: https://sceneflow.app/privacy

== Source code ==

The runtime `assets/sceneflow.runtime.min.js` is built from the TypeScript sources in `packages/core` of the SceneFlow repository (https://github.com/rayhanwealcoder/sceneflow); a readable build `assets/sceneflow.runtime.js` ships next to it. Build with `pnpm build && pnpm build:wp`.

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

= 0.8.0 =
* New: "SceneFlow Video" widget for Elementor and element for Bricks: pick a published video from a list and set an optional maximum width. They render exactly like the shortcode and the block, also inside the builder's preview.
* New: sales from a video. With playback analytics on, a product added to the cart from a video is noted on the order line, and SceneFlow shows the orders and revenue the video brought in (signed request from SceneFlow; no customer data; see "External services").
* Suggested privacy policy text updated for the above.
* Fixed: "Place on your site" could miss the newest of many pages with the same title (the list now shows the newest of those first).
* Fixed: a product added from a video could land in a separate cart session instead of the site's own cart, so the cart and checkout pages looked empty.

= 0.7.0 =
* Playback analytics is now opt-in: nothing is sent until the site owner turns it on (Settings → SceneFlow asks once after connecting). Sites that never changed the switch stop sending events with this update.
* Suggested privacy policy text under Settings → Privacy.
* Security hardening: every printed player passes through `wp_kses()` with an explicit allow-list, extra shortcode classes go through `sanitize_html_class()`, REST parameters are declared with sanitizers, one-click connect uses `wp_safe_redirect()` limited to the SceneFlow app host, the element picker only talks to the connected SceneFlow app, and the public health check no longer reveals exact WordPress / PHP versions.
* The draft preview page loads its CSS through the WordPress style API.
* Runtime 0.7.0: the player's CSS classes, data attributes and browser-storage keys now use the full `sceneflow-` / `sceneflow_` prefix (was `sf-`), so they cannot clash with other plugins or themes. Custom CSS that targeted `.sf-*` needs the new names (for example `.sceneflow-root`, `.sceneflow-layer`, `.sceneflow-product`).
* Element-picker texts are translatable; translation template in `languages/sceneflow.pot`.

= 0.6.0 =
* Scroll-scrub videos now pin reliably on every theme: the player picks the pinning technique the page allows (CSS sticky, position fixed through overflow-clipping wrappers, or a per-frame transform inside smooth-scroll themes such as GSAP ScrollSmoother / Lenis, where sticky and fixed cannot work) and reads its position from the page itself, so the picture and the scroll never disagree.
* New scroll options from the editor: pin position (top / centre / bottom) with an offset for fixed headers, GSAP-style start / end triggers for unpinned videos, test markers, and a smoother catch-up curve.
* Page speed: the plugin prints resource hints for each player — preconnect to the media host, preload of the thumbnail and of the config JSON — so the first picture appears before the deferred runtime has even run.
* Runtime 0.6.0: custom thumbnail (`poster`), playback speed, player background (blend into the page), the new scroll engine.

= 0.5.1 =
* Fixed: a published video did not render on the site when one of its elements had no styling or content of its own (the config was re-encoded with empty PHP arrays where the player expects objects). The stored config is now served exactly as published.
* A freshly published version shows on the next page load even when the browser or a page cache kept the previous config for a minute: the player's config URL now carries the published version number.
* Runtime 0.5.1: tolerates configs that passed through a PHP JSON round trip.

= 0.5.0 =
* Runtime 0.5.0: captions (subtitles) on published videos with a CC button for visitors; the choice is remembered in the visitor's browser only. Nothing new is sent anywhere.

= 0.4.0 =
* Runtime 0.4.0: brand-kit web fonts (only when the project opts in to Google Fonts), preset-based elements render exactly as designed, generic `data-sceneflow-id` embed support.
* Smoother scroll-scrub: seeks are coalesced and the small scroll-optimised file is downloaded once, so scrubbing paints a new frame on nearly every animation frame.
* Anonymous playback analytics for the SceneFlow Analytics page (see "External services"); switch under Settings → SceneFlow → Advanced.
* Published videos may now carry `fonts`, `brand`, `preset` and `analytics` metadata from the SceneFlow editor; the plugin stores them as before.

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

== Upgrade Notice ==

= 0.8.0 =
Elementor and Bricks elements, and sales from a video on the Analytics page (when playback analytics is on).

= 0.7.0 =
Playback analytics becomes opt-in: turn it on under Settings → SceneFlow if you use the Analytics page in SceneFlow. Security hardening.
