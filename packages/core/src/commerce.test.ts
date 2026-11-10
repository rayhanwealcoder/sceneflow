import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@sceneflow/schema";
import { commerce, linkAdapter, type CommerceAdapter } from "./commerce.js";
import { Player } from "./player.js";
import { createShopifyAdapter } from "./shopify.js";

/** Generous timeout: the whole monorepo test run starts many jsdom environments in parallel. */
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

const ref = { provider: "woocommerce", productId: "182", title: "Runner Pro", price: "$149.00", image: "https://shop.test/shoe.webp", url: "https://shop.test/product/runner-pro/" };

const live: Product = {
  id: "182",
  source: "woocommerce",
  type: "variable",
  name: "Runner Pro (live)",
  price: "$129.00 – $149.00",
  regularPrice: "$149.00",
  currency: "USD",
  stockStatus: "instock",
  purchasable: true,
  productUrl: ref.url,
  variations: [
    { id: "190", title: "M", price: "$129.00", inStock: true },
    { id: "191", title: "L", price: "$149.00", inStock: false },
  ],
};

const config = {
  schemaVersion: "1.0",
  projectId: "p1",
  version: 1,
  playback: { mode: "click" },
  scenes: [
    {
      id: "s1",
      name: "Shop",
      start: 0,
      end: 5,
      background: { type: "color", color: "#000" },
      layers: [
        { id: "card", type: "product", frame: { x: 60, y: 10, w: 35, h: 80 }, product: ref, content: { quantity: true, buttonAction: "add_to_cart" } },
        { id: "buy", type: "button", frame: { x: 5, y: 80, w: 30, h: 10 }, content: { label: "Buy now" }, action: { type: "BUY_NOW", product: { ...ref, variantId: "190" }, quantity: 1 } },
        { id: "coupon", type: "button", frame: { x: 5, y: 60, w: 30, h: 10 }, content: { label: "10% off" }, action: { type: "APPLY_COUPON", code: "SCENE10" } },
      ],
    },
  ],
};

function fakeAdapter(): CommerceAdapter & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    id: "woocommerce",
    calls,
    getProduct: vi.fn(async () => live),
    addToCart: vi.fn(async (line) => {
      calls.push(line);
      return { ok: true, message: "Added to cart", cartUrl: "https://shop.test/cart/", itemCount: 1 };
    }),
    applyCoupon: vi.fn(async (code) => ({ ok: code === "SCENE10", message: code === "SCENE10" ? "Coupon applied" : "Unknown coupon" })),
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div>';
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});
afterEach(() => {
  for (const id of commerce.list()) commerce.unregister(id);
  vi.unstubAllGlobals();
});

describe("commerce registry", () => {
  it("resolves by provider, then default, then the link fallback", () => {
    expect(commerce.resolve("woocommerce")).toBe(linkAdapter);
    const woo = fakeAdapter();
    const other: CommerceAdapter = { id: "custom", addToCart: async () => ({ ok: true }) };
    commerce.register(woo);
    commerce.register(other);
    expect(commerce.resolve("woocommerce")).toBe(woo);
    expect(commerce.resolve("custom")).toBe(other);
    expect(commerce.resolve("shopify")).toBe(woo); // first registered = site default
    commerce.setDefault("custom");
    expect(commerce.resolve()).toBe(other);
    commerce.unregister("custom");
    expect(commerce.resolve()).toBe(woo);
  });
});

describe("product card", () => {
  it("renders the snapshot, hydrates from the adapter and adds the chosen variant/quantity to the cart", async () => {
    const woo = fakeAdapter();
    commerce.register(woo);
    const p = new Player({ target: "#p", config, lazy: false });
    await p.init();
    const card = document.querySelector("#p [data-sceneflow-layer=card]") as HTMLElement;
    expect(card.querySelector(".sceneflow-product-title")!.textContent).toBe("Runner Pro");
    expect((card.querySelector(".sceneflow-product-img") as HTMLImageElement).src).toBe(ref.image);
    await waitFor(() => expect(card.querySelector(".sceneflow-product-title")!.textContent).toBe("Runner Pro (live)"));
    expect(woo.getProduct).toHaveBeenCalledTimes(1);
    const select = card.querySelector(".sceneflow-product-variant") as HTMLSelectElement;
    expect(select.hidden).toBe(false);
    expect(select.options.length).toBe(2);
    expect(select.value).toBe("190");
    expect(select.options[1]!.disabled).toBe(true); // sold out variant
    expect(card.querySelector(".sceneflow-price")!.textContent).toBe("$129.00");

    const qty = card.querySelector(".sceneflow-product-qty") as HTMLInputElement;
    qty.value = "3";
    const added = vi.fn();
    p.on("addToCart", added);
    (card.querySelector(".sceneflow-product-btn") as HTMLButtonElement).click();
    await waitFor(() => expect(added).toHaveBeenCalled());
    expect(woo.calls[0]).toEqual({ product: { ...ref, variantId: "190" }, quantity: 3 });
    expect(document.querySelector("#p .sceneflow-toast")!.textContent).toContain("Added to cart");

    // Selecting the sold-out variant disables the button and shows its price.
    select.value = "191";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(card.dataset.sceneflowStock).toBe("out");
    expect((card.querySelector(".sceneflow-product-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(card.querySelector(".sceneflow-price")!.textContent).toBe("$149.00");

    // Clicking the card itself views the product.
    const clicked = vi.fn();
    p.on("productClick", clicked);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    (card.querySelector(".sceneflow-product-title") as HTMLElement).click();
    expect(clicked).toHaveBeenCalledWith(expect.objectContaining({ productId: "182" }));
    expect(open).toHaveBeenCalledWith(ref.url, "_blank", "noopener");
  });

  it("with playback analytics on, the cart line names the video and session (revenue attribution); without it, nothing", async () => {
    const woo = fakeAdapter();
    commerce.register(woo);
    const fetchStub = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const p = new Player({ target: "#p", config, lazy: false, analytics: { endpoint: "https://api.test/api/v1/analytics/events", sessionId: "sess-abcdef12" } });
    await p.init();
    const added = vi.fn();
    p.on("addToCart", added);
    (document.querySelector("#p [data-sceneflow-layer=card] .sceneflow-product-btn") as HTMLButtonElement).click();
    await waitFor(() => expect(added).toHaveBeenCalled());
    expect((woo.calls[0] as { source?: unknown }).source).toEqual({ projectId: config.projectId, sessionId: "sess-abcdef12" });
    p.destroy();
    fetchStub.mockRestore();
  });

  it("buy now falls back to addToCart + checkoutUrl, coupons go through the adapter", async () => {
    const woo = fakeAdapter();
    (woo.addToCart as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, checkoutUrl: "https://shop.test/checkout/" });
    commerce.register(woo);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const p = new Player({ target: "#p", config, lazy: false });
    await p.init();
    const bought = vi.fn();
    p.on("buyNow", bought);
    (document.querySelector("#p [data-sceneflow-layer=buy]") as HTMLElement).click();
    await waitFor(() => expect(bought).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith("https://shop.test/checkout/");

    const coupon = vi.fn();
    p.on("couponApplied", coupon);
    (document.querySelector("#p [data-sceneflow-layer=coupon]") as HTMLElement).click();
    await waitFor(() => expect(coupon).toHaveBeenCalledWith({ code: "SCENE10", result: { ok: true, message: "Coupon applied" } }));
  });

  it("works without any adapter: the card shows the snapshot and opens the product page", async () => {
    const p = new Player({ target: "#p", config, lazy: false });
    await p.init();
    const card = document.querySelector("#p [data-sceneflow-layer=card]") as HTMLElement;
    expect((card.querySelector(".sceneflow-product-variant") as HTMLSelectElement).hidden).toBe(true);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const added = vi.fn();
    p.on("addToCart", added);
    (card.querySelector(".sceneflow-product-btn") as HTMLButtonElement).click();
    await waitFor(() => expect(added).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith(ref.url);
  });
});

describe("Shopify adapter", () => {
  const product = { id: 1, title: "Tee", handle: "tee", price: 2500, compare_at_price: 3000, featured_image: "https://cdn.shopify.test/tee.jpg", available: true, variants: [{ id: 11, title: "S", price: 2500, available: false }, { id: 12, title: "M", price: 2500, available: true }] };
  it("normalizes products and adds the first available variant", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).endsWith("/products/tee.js")) return new Response(JSON.stringify(product), { status: 200 });
      if (String(url).endsWith("/cart/add.js")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    const shopify = createShopifyAdapter({ root: "https://store.test", currency: "USD", fetch: f as unknown as typeof fetch });
    const p = await shopify.getProduct!({ provider: "shopify", productId: "tee", title: "" });
    expect(p).toMatchObject({ id: "tee", type: "variable", name: "Tee", price: "$25.00", regularPrice: "$30.00", stockStatus: "instock" });
    expect(p!.variations[0]).toMatchObject({ id: "11", inStock: false });
    const r = await shopify.addToCart({ product: { provider: "shopify", productId: "tee", title: "" }, quantity: 2 });
    expect(r).toMatchObject({ ok: true, cartUrl: "https://store.test/cart" });
    const add = calls.find(([u]) => u.endsWith("/cart/add.js"))!;
    expect(JSON.parse(String(add[1]!.body))).toEqual({ items: [{ id: 12, quantity: 2 }] });
  });
});
