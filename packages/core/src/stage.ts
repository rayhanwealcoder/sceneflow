import { deviceFromWidth, isLayerVisibleAt, layerMotion, resolveLayer, type Action, type Device, type Layer, type MotionState, type Product, type ProductRef, type ProductVariant, type Project, type ResolvedLayer, type Scene } from "@sceneflow/schema";

export const REF_WIDTH = 1280;

/** Numeric style keys that are authored in px at a 1280-wide reference and scale with the stage. */
const SCALED_PX = new Set(["fontSize", "borderRadius", "padding", "letterSpacing", "borderWidth", "gap"]);
/** Keys passed through to CSS unchanged (values are plain CSS strings/numbers, never executable). */
const PASSTHROUGH = new Set(["background", "color", "fontWeight", "fontFamily", "textAlign", "opacity", "boxShadow", "textShadow", "lineHeight", "border", "borderColor", "borderStyle", "backdropFilter", "fontStyle", "textTransform", "justifyContent", "alignItems"]);

export function applyStyle(el: HTMLElement, style: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(style)) {
    if (SCALED_PX.has(key)) {
      const n = typeof value === "number" ? value : parseFloat(value);
      if (Number.isFinite(n)) el.style.setProperty(cssName(key), `calc(${n}px * var(--sceneflow-scale))`);
    } else if (PASSTHROUGH.has(key)) {
      el.style.setProperty(cssName(key), String(value));
    } else if (key === "accent") {
      // Button / highlight colour of composite elements (product card).
      el.style.setProperty("--sceneflow-accent", String(value));
    } else if (key === "fit" && el instanceof HTMLImageElement) {
      el.style.objectFit = String(value);
    }
  }
}

const cssName = (camel: string) => camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

export function placeLayer(el: HTMLElement, r: ResolvedLayer, zIndex: number): void {
  el.style.left = `${r.frame.x}%`;
  el.style.top = `${r.frame.y}%`;
  el.style.width = `${r.frame.w}%`;
  el.style.height = `${r.frame.h}%`;
  el.style.transform = transformFor(r.frame.rotation, null);
  el.style.zIndex = String(zIndex + 1);
}

/** Rotation plus (optional) enter/exit motion, composed into one transform. */
export function transformFor(rotation: number, m: MotionState | null): string {
  const parts: string[] = [];
  if (m && (m.translateX || m.translateY)) parts.push(`translate(calc(${m.translateX}px * var(--sceneflow-scale)), calc(${m.translateY}px * var(--sceneflow-scale)))`);
  if (rotation) parts.push(`rotate(${rotation}deg)`);
  if (m && m.scale !== 1) parts.push(`scale(${m.scale})`);
  return parts.join(" ");
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

export type ProductButtonAction = "add_to_cart" | "buy_now" | "view";

export function productButtonAction(layer: Layer): ProductButtonAction {
  const a = layer.content.buttonAction;
  return a === "buy_now" || a === "view" ? a : "add_to_cart";
}

const BUTTON_LABEL: Record<ProductButtonAction, string> = { add_to_cart: "Add to cart", buy_now: "Buy now", view: "View product" };

/** Product card: image, title, price, optional variant + quantity controls and one button. */
function createProductCard(layer: Layer): HTMLElement {
  const c = layer.content;
  const ref = layer.product;
  const el = document.createElement("div");
  el.dataset.layout = str(c.layout) === "horizontal" ? "horizontal" : "vertical";
  if (bool(c.showImage, true)) {
    const img = document.createElement("img");
    img.className = "sceneflow-product-img";
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.draggable = false;
    if (ref?.image) img.src = ref.image;
    else img.hidden = true;
    el.appendChild(img);
  }
  const body = document.createElement("div");
  body.className = "sceneflow-product-body";
  if (bool(c.showTitle, true)) {
    const title = document.createElement("div");
    title.className = "sceneflow-product-title";
    title.textContent = ref?.title || "Product";
    body.appendChild(title);
  }
  if (bool(c.showPrice, true)) {
    const price = document.createElement("div");
    price.className = "sceneflow-product-price";
    const now = document.createElement("span");
    now.className = "sceneflow-price";
    now.textContent = ref?.price ?? "";
    const old = document.createElement("s");
    old.className = "sceneflow-price-old";
    old.textContent = ref?.regularPrice ?? "";
    old.hidden = !ref?.regularPrice;
    price.append(now, old);
    body.appendChild(price);
  }
  if (bool(c.variants, true)) {
    const select = document.createElement("select");
    select.className = "sceneflow-product-variant";
    select.setAttribute("aria-label", "Choose an option");
    select.hidden = true; // shown once live variants arrive
    body.appendChild(select);
  }
  if (bool(c.showButton, true)) {
    const actions = document.createElement("div");
    actions.className = "sceneflow-product-actions";
    if (bool(c.quantity, false)) {
      const qty = document.createElement("input");
      qty.className = "sceneflow-product-qty";
      qty.type = "number";
      qty.min = "1";
      qty.max = "99";
      qty.value = "1";
      qty.setAttribute("aria-label", "Quantity");
      actions.appendChild(qty);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sceneflow-product-btn";
    const action = productButtonAction(layer);
    btn.textContent = str(c.buttonLabel) || BUTTON_LABEL[action];
    if (ref?.inStock === false && action !== "view") btn.disabled = true;
    actions.appendChild(btn);
    body.appendChild(actions);
  }
  if (ref?.inStock === false) el.dataset.sceneflowStock = "out";
  el.appendChild(body);
  return el;
}

/** Builds the DOM for one layer. Text is always set via textContent, never innerHTML. */
export function createLayerElement(layer: Layer, r: ResolvedLayer, zIndex: number): HTMLElement {
  let el: HTMLElement;
  switch (layer.type) {
    case "text": {
      el = document.createElement("div");
      el.textContent = str(layer.content.text, "Text");
      el.dataset.align = str(r.style.textAlign, "left");
      break;
    }
    case "badge": {
      el = document.createElement("div");
      el.textContent = str(layer.content.text, "Badge");
      break;
    }
    case "button":
    case "commerce-button": {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = str(layer.content.label, "Button");
      el = b;
      break;
    }
    case "image": {
      const img = document.createElement("img");
      if (layer.src) img.src = layer.src;
      img.alt = str(layer.content.alt);
      img.decoding = "async";
      img.loading = "lazy";
      img.draggable = false;
      el = img;
      break;
    }
    case "hotspot": {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", str(layer.content.tooltip, "Hotspot"));
      const dot = document.createElement("span");
      dot.className = "sceneflow-dot";
      b.appendChild(dot);
      const tip = str(layer.content.tooltip);
      if (tip) {
        const t = document.createElement("span");
        t.className = "sceneflow-tip";
        t.textContent = tip;
        b.appendChild(t);
      }
      el = b;
      break;
    }
    case "shape": {
      el = document.createElement("div");
      break;
    }
    case "product": {
      el = createProductCard(layer);
      break;
    }
    default: {
      // audio is handled by the Player; video / form arrive in later phases. Shown only while editing.
      el = document.createElement("div");
      el.className = "sceneflow-placeholder";
      el.textContent = layer.name ?? layer.type;
    }
  }
  el.classList.add("sceneflow-layer", `sceneflow-${layer.type}`);
  el.dataset.sceneflowLayer = layer.id;
  if (layer.action) el.dataset.sceneflowAction = layer.action.type;
  else if (layer.type === "product" && layer.product) el.dataset.sceneflowAction = "PRODUCT";
  applyStyle(el, r.style);
  placeLayer(el, r, zIndex);
  return el;
}

export interface StageOptions {
  /** Fixed device or "auto" (from stage width). Default "auto". */
  device?: Device | "auto";
  /** Editing mode: shows placeholders, uses `setPreviewTime` instead of playback time and does not dispatch actions. */
  editing?: boolean;
  onAction?: (action: Action, layer: Layer) => void;
}

interface Entry {
  el: HTMLElement;
  layer: Layer;
  rotation: number;
  baseOpacity: number;
}

/**
 * Renders the layers of one scene as positioned HTML on top of the media.
 * Shared by the published runtime and the editor canvas so both show the same result.
 */
export class Stage {
  readonly el: HTMLElement;
  private device: Device = "desktop";
  private ro: ResizeObserver | null = null;
  private project: Project | null = null;
  private scene: Scene | null = null;
  private renderedKey = "";
  private lastTime: number | null = null;
  /** Editing only: time to preview (null = show everything in its resting state). */
  private previewTime: number | null = null;
  private layers = new Map<string, Entry>();
  private runtimeHidden = new Set<string>();
  /** Live product data by layer id (survives rebuilds on device change). */
  private live = new Map<string, Product>();

  constructor(
    parent: HTMLElement,
    private readonly opts: StageOptions = {},
  ) {
    this.el = document.createElement("div");
    this.el.className = "sceneflow-stage" + (opts.editing ? " sceneflow-editing" : "");
    parent.appendChild(this.el);
    if (opts.device && opts.device !== "auto") this.device = opts.device;
    this.updateScale(parent.clientWidth || REF_WIDTH);
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        if (w) this.updateScale(w);
      });
      this.ro.observe(parent);
    }
    if (!opts.editing) {
      this.el.addEventListener("click", this.onClick);
      this.el.addEventListener("change", this.onChange);
    }
  }

  getDevice(): Device {
    return this.device;
  }

  setDevice(device: Device | "auto"): void {
    this.opts.device = device;
    if (device !== "auto") this.device = device;
    this.rerender();
  }

  /** Editing: scrub the canvas to a project time (null = resting state, timing ignored). */
  setPreviewTime(time: number | null): void {
    this.previewTime = time;
    this.tick(this.lastTime);
  }

  private updateScale(width: number): void {
    this.el.style.setProperty("--sceneflow-scale", String(width / REF_WIDTH));
    if ((this.opts.device ?? "auto") === "auto") {
      const d = deviceFromWidth(width);
      if (d !== this.device) {
        this.device = d;
        this.rerender();
      }
    }
  }

  private rerender(): void {
    this.renderedKey = "";
    if (this.project && this.scene) this.render(this.project, this.scene.id, this.lastTime);
  }

  /** Rebuilds the layer DOM when project/scene/device changed, then applies time-based visibility + motion. */
  render(project: Project, sceneId: string, time: number | null): void {
    const key = `${sceneId}|${this.device}`;
    if (project !== this.project || key !== this.renderedKey) {
      this.project = project;
      this.scene = project.scenes.find((s) => s.id === sceneId) ?? null;
      this.renderedKey = key;
      this.build();
    }
    this.tick(time);
  }

  private build(): void {
    this.el.replaceChildren();
    this.layers.clear();
    if (!this.scene) return;
    this.scene.layers.forEach((layer, i) => {
      const r = resolveLayer(layer, this.device);
      if (r.hidden) return;
      const el = createLayerElement(layer, r, i);
      this.el.appendChild(el);
      const op = Number(r.style.opacity);
      const entry: Entry = { el, layer, rotation: r.frame.rotation, baseOpacity: Number.isFinite(op) && r.style.opacity !== undefined ? op : 1 };
      this.layers.set(layer.id, entry);
      const live = this.live.get(layer.id);
      if (live && layer.type === "product") this.applyProduct(entry, live);
    });
  }

  /** Shows/hides layers for the given project time and applies enter/exit motion. `null` shows everything. */
  tick(time: number | null): void {
    this.lastTime = time;
    if (!this.scene) return;
    const t = this.opts.editing ? this.previewTime : time;
    for (const entry of this.layers.values()) {
      const { el, layer } = entry;
      const visible = isLayerVisibleAt(layer, this.scene, t) && !this.runtimeHidden.has(layer.id);
      el.style.visibility = visible ? "" : "hidden";
      const m = visible && t !== null ? layerMotion(layer, this.scene, t) : null;
      el.style.transform = transformFor(entry.rotation, m);
      el.style.opacity = m ? String(entry.baseOpacity * m.opacity) : entry.baseOpacity === 1 ? "" : String(entry.baseOpacity);
    }
  }

  toggleLayer(layerId: string): void {
    if (this.runtimeHidden.has(layerId)) this.runtimeHidden.delete(layerId);
    else this.runtimeHidden.add(layerId);
    this.tick(this.lastTime);
  }

  /** The DOM element for a layer, so an editor can hit-test and overlay handles. */
  layerElement(layerId: string): HTMLElement | undefined {
    return this.layers.get(layerId)?.el;
  }

  // ---------- products ----------

  /** Applies live store data (price, stock, variants) to a product card; kept across rebuilds. */
  setLiveProduct(layerId: string, product: Product): void {
    this.live.set(layerId, product);
    const entry = this.layers.get(layerId);
    if (entry && entry.layer.type === "product") this.applyProduct(entry, product);
  }

  /** Marks a product card as busy (button disabled) while a cart request runs. */
  setBusy(layerId: string, busy: boolean): void {
    const el = this.layers.get(layerId)?.el;
    if (!el) return;
    if (busy) el.dataset.sceneflowBusy = "1";
    else delete el.dataset.sceneflowBusy;
    const btn = el.querySelector<HTMLButtonElement>(".sceneflow-product-btn");
    if (btn) btn.disabled = busy || el.dataset.sceneflowStock === "out";
  }

  private applyProduct(entry: Entry, p: Product): void {
    const { el, layer } = entry;
    const ref = layer.product;
    const title = el.querySelector<HTMLElement>(".sceneflow-product-title");
    if (title) title.textContent = p.name || ref?.title || "Product";
    const img = el.querySelector<HTMLImageElement>(".sceneflow-product-img");
    if (img && p.image) {
      img.src = p.image;
      img.hidden = false;
    }
    const select = el.querySelector<HTMLSelectElement>(".sceneflow-product-variant");
    if (select) {
      select.replaceChildren();
      const variants = p.variations ?? [];
      for (const v of variants) {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = v.title + (v.price ? ` — ${v.price}` : "") + (v.inStock === false ? " (sold out)" : "");
        if (v.inStock === false) o.disabled = true;
        select.appendChild(o);
      }
      const preferred = variants.find((v) => v.id === ref?.variantId) ?? variants.find((v) => v.inStock !== false) ?? variants[0];
      if (preferred) select.value = preferred.id;
      select.hidden = variants.length === 0;
    }
    this.refreshPrice(entry, p);
  }

  private refreshPrice(entry: Entry, p: Product): void {
    const { el } = entry;
    const select = el.querySelector<HTMLSelectElement>(".sceneflow-product-variant");
    const variant = select && !select.hidden ? p.variations.find((v) => v.id === select.value) : undefined;
    const now = el.querySelector<HTMLElement>(".sceneflow-price");
    const old = el.querySelector<HTMLElement>(".sceneflow-price-old");
    if (now) now.textContent = variant?.price ?? p.price ?? entry.layer.product?.price ?? "";
    if (old) {
      const reg = variant ? "" : (p.regularPrice ?? "");
      old.textContent = reg;
      old.hidden = !reg;
    }
    const out = variant ? variant.inStock === false : p.stockStatus === "outofstock";
    if (out) el.dataset.sceneflowStock = "out";
    else delete el.dataset.sceneflowStock;
    const btn = el.querySelector<HTMLButtonElement>(".sceneflow-product-btn");
    if (btn) btn.disabled = (out && productButtonAction(entry.layer) !== "view") || Boolean(el.dataset.sceneflowBusy);
  }

  /** Variant and quantity currently chosen on a product card. */
  productSelection(layerId: string): { variantId?: string; quantity: number } {
    const entry = this.layers.get(layerId);
    const ref = entry?.layer.product;
    const select = entry?.el.querySelector<HTMLSelectElement>(".sceneflow-product-variant");
    const qty = entry?.el.querySelector<HTMLInputElement>(".sceneflow-product-qty");
    const quantity = Math.min(999, Math.max(1, Math.round(Number(qty?.value)) || 1));
    const variantId = select && !select.hidden && select.value ? select.value : ref?.variantId;
    return variantId ? { variantId, quantity } : { quantity };
  }

  private onChange = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains("sceneflow-product-variant")) return;
    const host = target.closest<HTMLElement>("[data-sceneflow-layer]");
    const entry = host ? this.layers.get(host.dataset.sceneflowLayer ?? "") : undefined;
    const live = entry ? this.live.get(entry.layer.id) : undefined;
    if (entry && live) this.refreshPrice(entry, live);
  };

  private onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    const host = target?.closest<HTMLElement>("[data-sceneflow-layer]");
    if (!host || !this.el.contains(host)) return;
    const entry = this.layers.get(host.dataset.sceneflowLayer ?? "");
    if (!entry) return;
    // Native controls inside a card (variant select, quantity) keep their own behaviour.
    if (target?.closest("select, input, option")) return;
    const action = this.actionForClick(entry, target);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    this.opts.onAction?.(action, entry.layer);
  };

  /** Product cards derive their action from the button + current selection; other layers use `layer.action`. */
  private actionForClick(entry: Entry, target: HTMLElement | null): Action | undefined {
    const { layer } = entry;
    const onButton = Boolean(target?.closest(".sceneflow-product-btn"));
    if (layer.type === "product" && layer.product && (onButton || !layer.action)) {
      const sel = this.productSelection(layer.id);
      const product: ProductRef = { ...layer.product };
      if (sel.variantId) product.variantId = sel.variantId;
      else delete product.variantId;
      const mode = onButton ? productButtonAction(layer) : "view";
      if (mode === "view") return { type: "VIEW_PRODUCT", product };
      return { type: mode === "buy_now" ? "BUY_NOW" : "ADD_TO_CART", product, quantity: sel.quantity };
    }
    return layer.action;
  }

  destroy(): void {
    this.ro?.disconnect();
    this.el.removeEventListener("click", this.onClick);
    this.el.removeEventListener("change", this.onChange);
    this.el.remove();
    this.layers.clear();
    this.live.clear();
  }
}

export type { ProductVariant };
