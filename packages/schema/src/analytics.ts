import { z } from "zod";
import { DEVICES } from "./resolve.js";

/*
 * Analytics (doc §24). The runtime batches small, anonymous events; the API stores them per project.
 * No cookies, no personal data: a per-tab random session id, the page host/path, the device class and
 * player times. `watch` events carry a watched range (from → to seconds) and feed the engagement timeline.
 */

export const ANALYTICS_EVENTS = [
  "player_loaded",
  "video_play",
  "video_pause",
  "video_25",
  "video_50",
  "video_75",
  "video_complete",
  "scene_enter",
  "scene_exit",
  "element_impression",
  "element_click",
  "hotspot_click",
  "product_view",
  "add_to_cart",
  "checkout_started",
  "coupon_applied",
  "player_error",
  "watch",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENTS)[number];

const shortId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const payloadValue = z.union([z.string().max(300), z.number(), z.boolean()]);

export const analyticsEventSchema = z.object({
  /** Client-generated unique id (uuid); the server ignores duplicates so retries are safe. */
  id: shortId,
  type: z.enum(ANALYTICS_EVENTS),
  /** Epoch milliseconds on the client. */
  at: z.number().int().nonnegative(),
  /** Player time in seconds, when relevant. */
  t: z.number().min(0).optional(),
  sceneId: z.string().max(64).optional(),
  layerId: z.string().max(64).optional(),
  productId: z.string().max(64).optional(),
  payload: z.record(z.string().max(64), payloadValue).optional(),
});
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

export const MAX_ANALYTICS_BATCH = 50;

export const analyticsBatchSchema = z.object({
  projectId: z.string().uuid(),
  /** Published version the visitor saw. */
  version: z.number().int().min(1).optional(),
  sessionId: shortId,
  host: z.string().max(200).optional(),
  path: z.string().max(500).optional(),
  device: z.enum(DEVICES).optional(),
  events: z.array(analyticsEventSchema).min(1).max(MAX_ANALYTICS_BATCH),
});
export type AnalyticsBatch = z.infer<typeof analyticsBatchSchema>;
