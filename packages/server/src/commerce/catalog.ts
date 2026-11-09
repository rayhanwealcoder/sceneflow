import { and, desc, eq, ilike } from "drizzle-orm";
import { formatMoney, type Product } from "@sceneflow/schema";
import type { Db } from "../db/client.js";
import { catalogProducts } from "../db/schema.js";
import { WordPressConnector, type ConnectorSite } from "../connector.js";

/*
 * Catalog providers feed the editor's product picker. They are the server-side half of the
 * commerce adapter pattern: WooCommerce comes through the signed WordPress connector, "manual"
 * products live in our own database (for sites without a shop system, or payment links), and
 * other platforms can be added without touching the editor.
 */

export interface CatalogQuery {
  search?: string;
  page?: number;
}

export interface CatalogPage {
  items: Product[];
  total?: number;
}

export interface CatalogProvider {
  readonly id: string;
  readonly label: string;
  search(query: CatalogQuery): Promise<CatalogPage>;
  get(productId: string): Promise<Product | null>;
}

export interface CatalogProviderInfo {
  id: string;
  label: string;
  /** Products can be created from the picker (manual catalog). */
  editable: boolean;
}

/** WooCommerce products of a connected WordPress site (signed REST calls through the plugin). */
export class WooCommerceCatalog implements CatalogProvider {
  readonly id = "woocommerce";
  readonly label: string;

  constructor(
    private readonly connector: WordPressConnector,
    private readonly site: ConnectorSite,
    siteName?: string | null,
  ) {
    this.label = siteName ? `WooCommerce · ${siteName}` : "WooCommerce";
  }

  async search(query: CatalogQuery): Promise<CatalogPage> {
    const r = await this.connector.listProducts(this.site, { search: query.search, page: query.page });
    return { items: r.items.map(normalizeRemote), total: r.total };
  }

  async get(productId: string): Promise<Product | null> {
    if (!/^\d{1,12}$/.test(productId)) return null;
    const r = await this.connector.getProduct(this.site, productId);
    return r.product ? normalizeRemote(r.product) : null;
  }
}

/** Defensive normalization of what the plugin sends (it is another codebase, keep the contract loose). */
export function normalizeRemote(p: Partial<Product> & { id: string | number; name?: string }): Product {
  const stock = p.stockStatus;
  return {
    id: String(p.id),
    source: p.source ?? "woocommerce",
    type: p.type === "variable" ? "variable" : p.type === "other" ? "other" : "simple",
    name: String(p.name ?? ""),
    image: httpOnly(p.image),
    price: p.price ?? undefined,
    priceAmount: typeof p.priceAmount === "number" ? p.priceAmount : undefined,
    regularPrice: p.regularPrice ?? undefined,
    salePrice: p.salePrice ?? undefined,
    currency: p.currency ?? undefined,
    stockStatus: stock === "instock" || stock === "outofstock" || stock === "onbackorder" ? stock : "unknown",
    purchasable: Boolean(p.purchasable),
    productUrl: httpOnly(p.productUrl),
    variations: Array.isArray(p.variations)
      ? p.variations.map((v) => ({ id: String(v.id), title: String(v.title ?? ""), price: v.price, priceAmount: typeof v.priceAmount === "number" ? v.priceAmount : undefined, inStock: typeof v.inStock === "boolean" ? v.inStock : undefined, image: httpOnly(v.image), options: v.options }))
      : [],
  };
}

const httpOnly = (u: unknown): string | undefined => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : undefined);

/** Products entered by hand in SceneFlow: name, price, image, link. Works with any (or no) shop. */
export class ManualCatalog implements CatalogProvider {
  readonly id = "manual";
  readonly label = "My products";

  constructor(
    private readonly db: Db,
    private readonly workspaceId: string,
  ) {}

  async search(query: CatalogQuery): Promise<CatalogPage> {
    const where = query.search ? and(eq(catalogProducts.workspaceId, this.workspaceId), ilike(catalogProducts.name, `%${query.search.replace(/[%_]/g, "")}%`)) : eq(catalogProducts.workspaceId, this.workspaceId);
    const rows = await this.db.select().from(catalogProducts).where(where).orderBy(desc(catalogProducts.updatedAt)).limit(100);
    return { items: rows.map(manualToProduct), total: rows.length };
  }

  async get(productId: string): Promise<Product | null> {
    if (!/^[0-9a-f-]{36}$/i.test(productId)) return null;
    const row = await this.db.query.catalogProducts.findFirst({ where: and(eq(catalogProducts.id, productId), eq(catalogProducts.workspaceId, this.workspaceId)) });
    return row ? manualToProduct(row) : null;
  }
}

export function manualToProduct(row: typeof catalogProducts.$inferSelect): Product {
  const onSale = row.regularPriceAmount !== null && row.regularPriceAmount > row.priceAmount;
  return {
    id: row.id,
    source: "manual",
    type: "simple",
    name: row.name,
    image: row.imageUrl ?? undefined,
    price: formatMoney(row.priceAmount, row.currency),
    priceAmount: row.priceAmount,
    regularPrice: onSale ? formatMoney(row.regularPriceAmount!, row.currency) : undefined,
    salePrice: onSale ? formatMoney(row.priceAmount, row.currency) : undefined,
    currency: row.currency,
    stockStatus: row.inStock ? "instock" : "outofstock",
    purchasable: row.inStock,
    productUrl: row.productUrl ?? undefined,
    variations: [],
  };
}
