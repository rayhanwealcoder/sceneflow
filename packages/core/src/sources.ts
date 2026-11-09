import type { VideoSource } from "@sceneflow/schema";

/*
 * Device profiles (doc 11.4): the published config carries several renditions of a video; the runtime
 * picks one for the player's rendered width, the screen's pixel density and the visitor's connection.
 * Pure functions, unit-tested; the Player only supplies the inputs.
 */

export type DeviceProfile = "low" | "standard" | "high";

interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** Caps per profile in source pixels (height). */
const PROFILE_MAX_HEIGHT: Record<DeviceProfile, number> = { low: 540, standard: 1080, high: 2160 };

/** Data saver / slow connections get the low profile; dense screens on fast connections may go above 1080p. */
export function detectProfile(connection: ConnectionLike | undefined, dpr: number): DeviceProfile {
  if (connection?.saveData) return "low";
  const type = connection?.effectiveType ?? "";
  if (type === "slow-2g" || type === "2g" || type === "3g") return "low";
  return dpr >= 2 && type !== "4g" ? "high" : dpr >= 2 ? "standard" : "standard";
}

export interface PickOptions {
  /** Rendered width of the player in CSS px. */
  width: number;
  dpr: number;
  profile: DeviceProfile;
  /** Scroll-scrub playback prefers "scrub" renditions (dense keyframes, muted). */
  scrub: boolean;
  /** Universal fallback (`video.src`). */
  fallback: string;
}

/**
 * Smallest rendition that still covers the needed pixels, bounded by the profile; otherwise the largest
 * available. Width is compared because players are width-driven; height is used when width is unknown.
 */
export function pickSource(sources: VideoSource[], opts: PickOptions): string {
  if (!sources.length) return opts.fallback;
  const pool = opts.scrub && sources.some((s) => s.kind === "scrub") ? sources.filter((s) => s.kind === "scrub") : sources.filter((s) => s.kind !== "scrub");
  if (!pool.length) return opts.fallback;
  const maxHeight = PROFILE_MAX_HEIGHT[opts.profile];
  const density = opts.profile === "low" ? 1 : Math.min(opts.dpr, opts.profile === "high" ? 2 : 1.5);
  const need = Math.max(1, Math.round(opts.width * density));
  const sized = pool
    .map((s) => ({ s, w: s.width ?? (s.height ? Math.round((s.height * 16) / 9) : 0), h: s.height ?? 0 }))
    .filter((x) => x.h === 0 || x.h <= maxHeight)
    .sort((a, b) => a.w - b.w);
  const candidates = sized.length ? sized : pool.map((s) => ({ s, w: s.width ?? 0, h: s.height ?? 0 })).sort((a, b) => a.w - b.w);
  const fit = candidates.find((x) => x.w >= need) ?? candidates[candidates.length - 1];
  return fit?.s.src ?? opts.fallback;
}

/** Reads the browser inputs for `pickSource`. Safe in non-browser environments. */
export function browserProfile(): { profile: DeviceProfile; dpr: number } {
  if (typeof navigator === "undefined") return { profile: "standard", dpr: 1 };
  const nav = navigator as Navigator & { connection?: ConnectionLike; mozConnection?: ConnectionLike; webkitConnection?: ConnectionLike };
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return { profile: detectProfile(connection, dpr), dpr };
}
