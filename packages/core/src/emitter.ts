import type { Action, ProductRef } from "@sceneflow/schema";
import type { CommerceResult } from "./commerce.js";

export type EventMap = {
  ready: undefined;
  play: undefined;
  pause: undefined;
  timeupdate: { time: number };
  sceneChange: { sceneId: string };
  actionTriggered: { action: Action; layerId: string };
  productClick: { productId: string; product: ProductRef };
  addToCart: { productId: string; variantId?: string; quantity: number; product: ProductRef; result: CommerceResult };
  buyNow: { productId: string; variantId?: string; quantity: number; product: ProductRef; result: CommerceResult };
  couponApplied: { code: string; result: CommerceResult };
  captionsChange: { enabled: boolean };
  complete: undefined;
  error: { code: string; message: string };
};

type Handler<T> = (payload: T) => void;

export class Emitter {
  private handlers = new Map<keyof EventMap, Set<Handler<never>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        (h as Handler<EventMap[K]>)(payload);
      } catch {
        // A listener error must never break the player.
      }
    });
  }

  clear(): void {
    this.handlers.clear();
  }
}
