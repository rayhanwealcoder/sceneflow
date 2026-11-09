export const VERSION = "0.3.0";
export { Player, type PlayerOptions, type PlayerState, type EffectiveMode } from "./player.js";
export { Stage, type StageOptions, type ProductButtonAction, createLayerElement, applyStyle, placeLayer, transformFor, productButtonAction, REF_WIDTH } from "./stage.js";
export { commerce, linkAdapter, type CommerceAdapter, type CommerceResult, type CartLine } from "./commerce.js";
export { pickSource, detectProfile, browserProfile, type DeviceProfile, type PickOptions } from "./sources.js";
export { parseDistance, scrollProgress, applyOffsets, smoothStep } from "./scroll.js";
export { ensureStyles, RUNTIME_CSS } from "./styles.js";
export type { EventMap } from "./emitter.js";
export type { Product, ProductRef, ProductVariant, VideoSource } from "@sceneflow/schema";
