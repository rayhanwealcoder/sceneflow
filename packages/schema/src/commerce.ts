import { z } from "zod";
import { safeUrl } from "./url.js";

/*
 * Commerce is adapter-based (doc §14): the project format never knows which shop system a site runs.
 * A layer or action carries a ProductRef — the provider id, the product id in that provider and a
 * display snapshot — so a published config renders without the store, and a commerce adapter on
 * the host page (WooCommerce plugin, Shopify theme, custom) hydrates live price/stock and performs cart actions.
 */

/** Built-in provider ids. Custom adapters may register any other lowercase id. */
export const PRODUCT_PROVIDERS = ["manual", "woocommerce", "shopify"] as const;
export type KnownProvider = (typeof PRODUCT_PROVIDERS)[number];

const providerId = z.string().min(1).max(32).regex(/^[a-z0-9_-]+$/, "Provider id must be lowercase letters, digits, _ or -");

/** Reference to a product plus a snapshot of what to show when the store is not reachable. */
export const productRefSchema = z.object({
  provider: providerId,
  productId: z.string().min(1).max(64),
  variantId: z.string().max(64).optional(),
  title: z.string().max(200).default(""),
  /** Formatted display price, e.g. "$129.00". */
  price: z.string().max(64).optional(),
  priceAmount: z.number().min(0).optional(),
  /** Formatted regular price when on sale. */
  regularPrice: z.string().max(64).optional(),
  currency: z.string().max(8).optional(),
  image: safeUrl.optional(),
  url: safeUrl.optional(),
  inStock: z.boolean().optional(),
});
export type ProductRef = z.infer<typeof productRefSchema>;

/** One purchasable variation of a product (size, colour...). */
export interface ProductVariant {
  id: string;
  title: string;
  price?: string;
  priceAmount?: number;
  inStock?: boolean;
  image?: string;
  options?: Record<string, string>;
}

/** Normalized live product (doc §14.1). Returned by catalogs and adapters; never stored in a config. */
export interface Product {
  id: string;
  source: string;
  type: "simple" | "variable" | "other";
  name: string;
  image?: string;
  price?: string;
  priceAmount?: number;
  regularPrice?: string;
  salePrice?: string;
  currency?: string;
  stockStatus: "instock" | "outofstock" | "onbackorder" | "unknown";
  purchasable: boolean;
  productUrl?: string;
  variations: ProductVariant[];
}

/** Snapshot a live product into the reference stored in a project. */
export function productToRef(p: Product, variantId?: string): ProductRef {
  const variant = variantId ? p.variations.find((v) => v.id === variantId) : undefined;
  const ref: ProductRef = {
    provider: p.source,
    productId: p.id,
    title: p.name,
    inStock: variant ? (variant.inStock ?? p.stockStatus !== "outofstock") : p.stockStatus !== "outofstock",
  };
  if (variantId) ref.variantId = variantId;
  const price = variant?.price ?? p.price;
  if (price) ref.price = price;
  const amount = variant?.priceAmount ?? p.priceAmount;
  if (amount !== undefined) ref.priceAmount = amount;
  if (p.regularPrice && !variant) ref.regularPrice = p.regularPrice;
  if (p.currency) ref.currency = p.currency;
  const image = variant?.image ?? p.image;
  if (image && /^https?:\/\//i.test(image)) ref.image = image;
  if (p.productUrl && /^https?:\/\//i.test(p.productUrl)) ref.url = p.productUrl;
  return ref;
}

/** Formats an amount for display; adapters that know the store's own format should prefer it. */
export function formatMoney(amount: number, currency = "USD", locale = "en"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
