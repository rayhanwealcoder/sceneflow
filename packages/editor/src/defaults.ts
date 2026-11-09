import type { BrandKit, Layer, Scene } from "@sceneflow/schema";
import { brandLayer } from "./brand.js";
import { newId } from "./ids.js";

/** Elements a user can add. "product" is a shoppable card driven by the commerce adapter of the host site. */
export const ELEMENT_TYPES = ["text", "image", "button", "product", "shape", "badge", "hotspot", "audio"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const ELEMENT_LABELS: Record<ElementType, string> = {
  text: "Text",
  image: "Image",
  button: "Button",
  product: "Product",
  shape: "Shape",
  badge: "Badge",
  hotspot: "Hotspot",
  audio: "Audio",
};

const base = (type: Layer["type"], name: string): Pick<Layer, "id" | "type" | "name" | "locked" | "hidden" | "content" | "style"> => ({
  id: newId("l"),
  type,
  name,
  locked: false,
  hidden: false,
  content: {},
  style: {},
});

/** Strong defaults so a freshly added element already looks intentional; with a brand kit it already matches the brand. */
export function createLayer(type: ElementType, init: Partial<Layer> = {}, kit?: BrandKit | null): Layer {
  let layer: Layer;
  switch (type) {
    case "text":
      layer = { ...base("text", "Text"), frame: { x: 8, y: 12, w: 56, h: 14, rotation: 0 }, content: { text: "Your headline here" }, style: { color: "#ffffff", fontSize: 44, fontWeight: 700, textAlign: "left", textShadow: "0 2px 12px rgba(0,0,0,.45)" } };
      break;
    case "image":
      layer = { ...base("image", "Image"), frame: { x: 30, y: 20, w: 40, h: 50, rotation: 0 }, style: { fit: "cover", borderRadius: 12 } };
      break;
    case "button":
      layer = {
        ...base("button", "Button"),
        frame: { x: 8, y: 80, w: 26, h: 11, rotation: 0 },
        content: { label: "Shop now" },
        style: { background: "#4f46e5", color: "#ffffff", fontSize: 18, fontWeight: 700, borderRadius: 10 },
        action: { type: "OPEN_CART" },
      };
      break;
    case "product":
      // The product itself is picked in the inspector; until then the card shows a placeholder snapshot.
      layer = {
        ...base("product", "Product"),
        frame: { x: 62, y: 8, w: 32, h: 84, rotation: 0 },
        content: { showImage: true, showTitle: true, showPrice: true, showButton: true, variants: true, quantity: false, buttonAction: "add_to_cart", layout: "vertical" },
        style: { background: "#ffffff", color: "#111111", accent: "#4f46e5", borderRadius: 14, fontSize: 16 },
      };
      break;
    case "shape":
      layer = { ...base("shape", "Shape"), frame: { x: 35, y: 30, w: 30, h: 40, rotation: 0 }, style: { background: "rgba(79,70,229,0.85)", borderRadius: 16 } };
      break;
    case "badge":
      layer = { ...base("badge", "Badge"), frame: { x: 8, y: 6, w: 16, h: 7, rotation: 0 }, content: { text: "NEW" }, style: { background: "#ef4444", color: "#ffffff", fontSize: 15, fontWeight: 800, borderRadius: 999, letterSpacing: 1 } };
      break;
    case "hotspot":
      layer = { ...base("hotspot", "Hotspot"), frame: { x: 48, y: 46, w: 4, h: 7, rotation: 0 }, content: { tooltip: "Tap to learn more" }, style: { color: "#ffffff" } };
      break;
    case "audio":
      // Not visible on the published page; the small box only marks it on the editor canvas.
      layer = { ...base("audio", "Audio"), frame: { x: 2, y: 2, w: 12, h: 6, rotation: 0 }, content: { volume: 1 }, style: {} };
      break;
  }
  if (kit) layer = brandLayer(layer, kit);
  return { ...layer, ...init, id: init.id ?? layer.id };
}

export function createScene(index: number, start = 0, duration = 5): Scene {
  return {
    id: newId("s"),
    name: `Scene ${index}`,
    start,
    end: start + duration,
    background: { type: "color", color: "#111827" },
    layers: [],
    transition: { type: "fade", duration: 0.3 },
  };
}
