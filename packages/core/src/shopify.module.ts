/*
 * Browser entry of the optional Shopify module (`sceneflow.shopify.min.js`).
 * Load it after the core runtime on a Shopify storefront: it registers the adapter as the page default
 * and exposes `SceneFlow.createShopifyAdapter` for custom setups (another root, currency...).
 */
import type { CommerceAdapter } from "./commerce.js";
import { createShopifyAdapter } from "./shopify.js";

interface SceneFlowGlobal {
  commerce?: { register(adapter: CommerceAdapter, options?: { default?: boolean }): void };
  createShopifyAdapter?: typeof createShopifyAdapter;
}

const sf = (window as unknown as { SceneFlow?: SceneFlowGlobal }).SceneFlow;
if (sf?.commerce) {
  sf.createShopifyAdapter = createShopifyAdapter;
  sf.commerce.register(createShopifyAdapter(), { default: true });
} else if (typeof console !== "undefined") {
  console.warn("[SceneFlow] load sceneflow.runtime.min.js before sceneflow.shopify.min.js");
}
