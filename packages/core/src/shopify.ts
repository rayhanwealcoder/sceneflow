import type { ProductRef } from "@sceneflow/schema";
import type { CartLine, CommerceAdapter, CommerceResult } from "./commerce.js";

/*
 * Shopify adapter — an optional module, not part of the core runtime (core carries zero platform code).
 * Ships as `sceneflow.shopify.min.js` (auto-registers on a Shopify storefront) and as `@sceneflow/core/shopify` for bundlers.
 * `productId` is the product handle; `variantId` the numeric variant id. Unit-tested; not yet verified against a live store.
 */

interface ShopifyVariant {
  id: number;
  title: string;
  price: number;
  available: boolean;
  featured_image?: { src?: string } | null;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  price: number;
  compare_at_price?: number | null;
  featured_image?: string | null;
  available: boolean;
  variants: ShopifyVariant[];
}

const go = (url: string, message: string): CommerceResult => {
  window.location.assign(url);
  return { ok: true, message };
};

export function createShopifyAdapter(options: { root?: string; currency?: string; locale?: string; fetch?: typeof fetch } = {}): CommerceAdapter {
  const root = (options.root ?? "").replace(/\/$/, "");
  const f = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const currency = () => options.currency ?? (window as unknown as { Shopify?: { currency?: { active?: string } } }).Shopify?.currency?.active ?? "USD";
  const money = (cents: number) => {
    try {
      return new Intl.NumberFormat(options.locale ?? "en", { style: "currency", currency: currency() }).format(cents / 100);
    } catch {
      return (cents / 100).toFixed(2);
    }
  };
  const fetchProduct = async (handle: string): Promise<ShopifyProduct | null> => {
    const res = await f(`${root}/products/${encodeURIComponent(handle)}.js`, { headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as ShopifyProduct) : null;
  };
  const variantFor = async (line: CartLine): Promise<number | null> => {
    if (line.product.variantId && /^\d+$/.test(line.product.variantId)) return Number(line.product.variantId);
    const p = await fetchProduct(line.product.productId);
    const v = p?.variants.find((x) => x.available) ?? p?.variants[0];
    return v ? v.id : null;
  };
  return {
    id: "shopify",
    async getProduct(ref: ProductRef) {
      const p = await fetchProduct(ref.productId);
      if (!p) return null;
      return {
        id: p.handle,
        source: "shopify",
        type: p.variants.length > 1 ? "variable" : "simple",
        name: p.title,
        image: p.featured_image ?? undefined,
        price: money(p.price),
        priceAmount: p.price / 100,
        regularPrice: p.compare_at_price && p.compare_at_price > p.price ? money(p.compare_at_price) : undefined,
        currency: currency(),
        stockStatus: p.available ? "instock" : "outofstock",
        purchasable: p.available,
        productUrl: `${root}/products/${p.handle}`,
        variations: p.variants.map((v) => ({ id: String(v.id), title: v.title, price: money(v.price), priceAmount: v.price / 100, inStock: v.available, image: v.featured_image?.src })),
      };
    },
    async addToCart(line) {
      const id = await variantFor(line);
      if (!id) return { ok: false, message: "This product is not available" };
      const res = await f(`${root}/cart/add.js`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ items: [{ id, quantity: line.quantity }] }) });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { description?: string; message?: string };
        return { ok: false, message: err.description ?? err.message ?? "Could not add to cart" };
      }
      return { ok: true, message: "Added to cart", cartUrl: `${root}/cart`, checkoutUrl: `${root}/checkout` };
    },
    async buyNow(line) {
      const id = await variantFor(line);
      if (!id) return { ok: false, message: "This product is not available" };
      return go(`${root}/cart/${id}:${line.quantity}`, "Going to checkout");
    },
    openCart: () => go(`${root}/cart`, "Opening cart"),
    openCheckout: () => go(`${root}/checkout`, "Opening checkout"),
    applyCoupon: async (code) => go(`${root}/discount/${encodeURIComponent(code)}?redirect=/cart`, "Applying discount"),
  };
}
