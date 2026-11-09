import { z } from "zod";
import { productRefSchema } from "./commerce.js";
import { safeUrl } from "./url.js";

const pid = z.string().min(1).max(64);
const qty = z.number().int().min(1).max(999).default(1);

const actionUnion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("VIEW_PRODUCT"), product: productRefSchema }),
  z.object({ type: z.literal("ADD_TO_CART"), product: productRefSchema, quantity: qty }),
  z.object({ type: z.literal("BUY_NOW"), product: productRefSchema, quantity: qty }),
  /** An empty code is allowed while editing; the runtime refuses to apply it. */
  z.object({ type: z.literal("APPLY_COUPON"), code: z.string().max(64) }),
  z.object({ type: z.literal("OPEN_CART") }),
  z.object({ type: z.literal("OPEN_CHECKOUT") }),
  z.object({ type: z.literal("GO_TO_SCENE"), sceneId: pid }),
  z.object({ type: z.literal("OPEN_URL"), url: safeUrl, newTab: z.boolean().default(true) }),
  z.object({ type: z.literal("SEEK"), time: z.number().min(0) }),
  z.object({ type: z.literal("TOGGLE_LAYER"), layerId: pid }),
]);

/** Early configs stored a bare `productId`; lift it into a ProductRef so they keep validating. */
function upgradeLegacy(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>;
  if (typeof o.productId === "string" && !("product" in o)) {
    const { productId, variationId, ...rest } = o;
    return { ...rest, product: { provider: "manual", productId, ...(typeof variationId === "string" ? { variantId: variationId } : {}), title: "" } };
  }
  return value;
}

/** Typed, data-only actions. No executable code ever lives in project config. */
export const actionSchema = z.preprocess(upgradeLegacy, actionUnion);
export type Action = z.infer<typeof actionUnion>;
export const ACTION_TYPES = actionUnion.options.map((o) => o.shape.type.value) as Action["type"][];
