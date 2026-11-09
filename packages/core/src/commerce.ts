import type { Product, ProductRef } from "@sceneflow/schema";

/*
 * Commerce adapters (doc §14). The runtime never talks to a shop directly: the host page registers an
 * adapter for its platform (the WordPress plugin registers "woocommerce", a Shopify theme can use
 * createShopifyAdapter(), anyone can write their own) and the player resolves the adapter from the
 * product's `provider`. Without an adapter the link adapter opens the product/cart URLs from the snapshot,
 * so a published video keeps working on any site.
 */

export interface CartLine {
  product: ProductRef;
  quantity: number;
}

export interface CommerceResult {
  ok: boolean;
  /** Short human message to show in the player ("Added to cart", error text...). */
  message?: string;
  cartUrl?: string;
  checkoutUrl?: string;
  itemCount?: number;
}

export interface CommerceAdapter {
  readonly id: string;
  /** Live product data (price, stock, variants). Optional: the snapshot is shown when absent. */
  getProduct?(ref: ProductRef): Promise<Product | null>;
  addToCart(line: CartLine): Promise<CommerceResult>;
  /** Default: addToCart, then navigate to `checkoutUrl` when the result carries one. */
  buyNow?(line: CartLine): Promise<CommerceResult>;
  /** Default: open `ref.url`. */
  viewProduct?(ref: ProductRef): Promise<CommerceResult> | CommerceResult;
  openCart?(): Promise<CommerceResult> | CommerceResult;
  openCheckout?(): Promise<CommerceResult> | CommerceResult;
  applyCoupon?(code: string): Promise<CommerceResult>;
}

const navigate = (url: string | undefined, message: string, newTab = false): CommerceResult => {
  if (!url) return { ok: false, message: "No link available for this product" };
  if (newTab) window.open(url, "_blank", "noopener");
  else window.location.assign(url);
  return { ok: true, message };
};

/** Fallback for sites without an adapter: every action opens the product page from the snapshot. */
export const linkAdapter: CommerceAdapter = {
  id: "link",
  addToCart: (line) => Promise.resolve(navigate(line.product.url, "Opening the product page")),
  buyNow: (line) => Promise.resolve(navigate(line.product.url, "Opening the product page")),
  viewProduct: (ref) => navigate(ref.url, "Opening the product page", true),
};

class CommerceRegistry {
  private adapters = new Map<string, CommerceAdapter>();
  private defaultId: string | null = null;

  /** Registers an adapter under its id; the first registered adapter becomes the default. */
  register(adapter: CommerceAdapter, options: { default?: boolean } = {}): void {
    this.adapters.set(adapter.id, adapter);
    if (options.default || this.defaultId === null) this.defaultId = adapter.id;
  }

  unregister(id: string): void {
    this.adapters.delete(id);
    if (this.defaultId === id) this.defaultId = this.adapters.keys().next().value ?? null;
  }

  get(id: string): CommerceAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  setDefault(id: string): void {
    if (this.adapters.has(id)) this.defaultId = id;
  }

  /** Adapter for a provider: exact match → site default → link fallback. */
  resolve(provider?: string): CommerceAdapter {
    if (provider) {
      const exact = this.adapters.get(provider);
      if (exact) return exact;
    }
    const def = this.defaultId ? this.adapters.get(this.defaultId) : undefined;
    return def ?? linkAdapter;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}

/** Global registry: `SceneFlow.commerce.register(adapter)` on the host page. */
export const commerce = new CommerceRegistry();

// Platform adapters live outside the core: WooCommerce in the WordPress plugin, Shopify in the optional
// `sceneflow.shopify.min.js` module (src/shopify.ts). Custom sites implement CommerceAdapter themselves.
