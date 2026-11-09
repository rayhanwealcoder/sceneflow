import { describe, expect, it } from "vitest";
import { actionSchema, formatMoney, parseProject, productRefSchema, productToRef, type Product } from "./index.js";

const scene = { id: "s1", name: "A", start: 0, end: 5, background: { type: "color", color: "#000" } };
const base = { schemaVersion: "1.0", projectId: "p1", version: 1, scenes: [scene] };
const frame = { x: 0, y: 0, w: 10, h: 10 };
const ref = { provider: "woocommerce", productId: "182", title: "Runner Pro", price: "$129.00", priceAmount: 129, image: "https://shop.test/shoe.webp", url: "https://shop.test/product/runner-pro/" };

const live: Product = {
  id: "182",
  source: "woocommerce",
  type: "variable",
  name: "Runner Pro",
  image: "https://shop.test/shoe.webp",
  price: "$129.00 – $149.00",
  priceAmount: 129,
  regularPrice: "$149.00",
  currency: "USD",
  stockStatus: "instock",
  purchasable: true,
  productUrl: "https://shop.test/product/runner-pro/",
  variations: [
    { id: "190", title: "M", price: "$129.00", priceAmount: 129, inStock: true },
    { id: "191", title: "L", price: "$149.00", priceAmount: 149, inStock: false },
  ],
};

describe("commerce schema", () => {
  it("accepts product layers and commerce actions with a product reference", () => {
    const r = parseProject({
      ...base,
      scenes: [
        {
          ...scene,
          layers: [
            { id: "card", type: "product", frame, product: ref, content: { buttonAction: "add_to_cart", quantity: true } },
            { id: "cta", type: "button", frame, content: { label: "Buy" }, action: { type: "BUY_NOW", product: { ...ref, variantId: "190" }, quantity: 2 } },
          ],
        },
      ],
    });
    expect(r.ok, JSON.stringify(!r.ok && r.issues)).toBe(true);
    if (!r.ok) return;
    const [card, cta] = r.project.scenes[0]!.layers;
    expect(card!.product?.provider).toBe("woocommerce");
    expect(cta!.action).toMatchObject({ type: "BUY_NOW", quantity: 2, product: { variantId: "190" } });
  });

  it("upgrades legacy productId actions into manual product references", () => {
    const a = actionSchema.parse({ type: "ADD_TO_CART", productId: "7", variationId: "9" });
    expect(a).toEqual({ type: "ADD_TO_CART", quantity: 1, product: { provider: "manual", productId: "7", variantId: "9", title: "" } });
  });

  it("rejects unsafe product URLs and bad provider ids", () => {
    expect(productRefSchema.safeParse({ ...ref, image: "javascript:alert(1)" }).success).toBe(false);
    expect(productRefSchema.safeParse({ ...ref, provider: "Woo Commerce" }).success).toBe(false);
    expect(productRefSchema.safeParse({ provider: "manual", productId: "x" }).success).toBe(true);
  });

  it("snapshots a live product (optionally one variant) into a reference", () => {
    const whole = productToRef(live);
    expect(whole).toMatchObject({ provider: "woocommerce", productId: "182", title: "Runner Pro", price: "$129.00 – $149.00", regularPrice: "$149.00", inStock: true, url: live.productUrl });
    const variant = productToRef(live, "191");
    expect(variant).toMatchObject({ variantId: "191", price: "$149.00", priceAmount: 149, inStock: false });
    expect(variant.regularPrice).toBeUndefined();
  });

  it("formats money", () => {
    expect(formatMoney(129, "USD")).toBe("$129.00");
    expect(formatMoney(12.5, "EUR", "de")).toMatch(/12,50/);
  });
});
