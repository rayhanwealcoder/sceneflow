import type { AnalyticsEvent, AnalyticsEventType, Device } from "@sceneflow/schema";

/*
 * Event client (doc §24): tiny, anonymous, batched. Events queue up and leave every few seconds (or at
 * 20), as a text/plain POST so no CORS preflight is needed; on page hide the rest goes out with
 * `sendBeacon`. Respects Do Not Track / Global Privacy Control. No cookies: the session id lives in
 * sessionStorage for this tab only.
 */

export interface AnalyticsOptions {
  endpoint: string;
  projectId: string;
  version?: number;
  device?: Device;
  sessionId?: string;
  /** Default 4000 ms. */
  flushMs?: number;
  /** Default 20 events. */
  maxBatch?: number;
  fetch?: typeof fetch;
}

export interface TrackData {
  t?: number;
  sceneId?: string;
  layerId?: string;
  productId?: string;
  payload?: Record<string, string | number | boolean>;
}

const SID_KEY = "sceneflow_sid";

function randomId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  let s = "";
  while (s.length < 24) s += Math.random().toString(36).slice(2);
  return s.slice(0, 24);
}

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SID_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = randomId();
    sessionStorage.setItem(SID_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

/** True when the visitor asked not to be tracked (Do Not Track or Global Privacy Control). */
export function analyticsAllowed(nav: Partial<Navigator> & { globalPrivacyControl?: boolean } = typeof navigator !== "undefined" ? navigator : {}): boolean {
  if (nav.doNotTrack === "1" || (nav as { msDoNotTrack?: string }).msDoNotTrack === "1") return false;
  if (nav.globalPrivacyControl === true) return false;
  return true;
}

export class Analytics {
  private queue: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly sid: string;
  private readonly flushMs: number;
  private readonly maxBatch: number;
  private readonly fetchFn: typeof fetch | undefined;
  private watchFrom: number | null = null;
  private watchTo: number | null = null;
  private disposed = false;
  private readonly onHide = () => {
    this.endWatch();
    this.flush(true);
  };

  constructor(private readonly opts: AnalyticsOptions) {
    this.sid = opts.sessionId ?? sessionId();
    this.flushMs = opts.flushMs ?? 4000;
    this.maxBatch = opts.maxBatch ?? 20;
    this.fetchFn = opts.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && this.onHide());
      window.addEventListener("pagehide", this.onHide);
    }
  }

  get sessionId(): string {
    return this.sid;
  }

  track(type: AnalyticsEventType, data: TrackData = {}): void {
    if (this.disposed) return;
    const ev: AnalyticsEvent = { id: randomId(), type, at: Date.now() };
    if (data.t !== undefined && Number.isFinite(data.t)) ev.t = Math.max(0, Math.round(data.t * 100) / 100);
    if (data.sceneId) ev.sceneId = data.sceneId;
    if (data.layerId) ev.layerId = data.layerId;
    if (data.productId) ev.productId = data.productId;
    if (data.payload) ev.payload = data.payload;
    this.queue.push(ev);
    if (this.queue.length >= this.maxBatch) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  /* ---- watched ranges (engagement timeline) ---- */

  /** The visitor is watching from `t` (play, seek landing, scroll scrub). */
  startWatch(t: number): void {
    if (this.watchFrom === null) this.watchFrom = this.watchTo = t;
  }

  /** Time advanced while watching; a jump larger than 1.5 s closes the range and starts a new one. */
  tickWatch(t: number): void {
    if (this.watchFrom === null || this.watchTo === null) return this.startWatch(t);
    if (Math.abs(t - this.watchTo) > 1.5) {
      this.endWatch();
      this.startWatch(t);
      return;
    }
    if (t < this.watchFrom) this.watchFrom = t;
    if (t > this.watchTo) this.watchTo = t;
    // Long sessions report every ~5 s so a closed tab loses little.
    if (this.watchTo - this.watchFrom >= 5) {
      this.endWatch();
      this.startWatch(t);
    }
  }

  /** Pause, end, scene change or page hide: emit the range watched so far. */
  endWatch(): void {
    if (this.watchFrom === null || this.watchTo === null) return;
    if (this.watchTo - this.watchFrom >= 0.05) this.track("watch", { t: this.watchFrom, payload: { from: Math.round(this.watchFrom * 100) / 100, to: Math.round(this.watchTo * 100) / 100 } });
    this.watchFrom = this.watchTo = null;
  }

  /* ---- transport ---- */

  flush(useBeacon = false): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queue.length) return;
    const events = this.queue.splice(0, this.maxBatch);
    const body = JSON.stringify({
      projectId: this.opts.projectId,
      version: this.opts.version,
      sessionId: this.sid,
      host: typeof location !== "undefined" ? location.hostname.slice(0, 200) : undefined,
      path: typeof location !== "undefined" ? location.pathname.slice(0, 500) : undefined,
      device: this.opts.device,
      events,
    });
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(this.opts.endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
    }
    if (!this.fetchFn) return;
    void this.fetchFn(this.opts.endpoint, { method: "POST", body, keepalive: true, mode: "cors", credentials: "omit", headers: { "content-type": "text/plain;charset=UTF-8" } }).catch(() => {
      /* analytics never breaks playback */
    });
    if (this.queue.length) this.flush(useBeacon);
  }

  destroy(): void {
    this.endWatch();
    this.flush(true);
    this.disposed = true;
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onHide);
  }
}
