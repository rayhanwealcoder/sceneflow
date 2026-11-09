/*
 * Brute-force guard for sign-in, in addition to the per-IP request rate limit.
 * Two keys are tracked for every attempt: the account (email) and the client address. After `max` failures
 * inside the window the key is blocked for 15 minutes, doubling on every further failure (up to 24 h), so a
 * password-spraying botnet gets five tries per account per quarter hour at best, and a single machine is cut
 * off regardless of which accounts it tries. A successful sign-in clears the account's record.
 * In-memory on purpose: one API process per deployment today; swap the Map for a table when scaling out.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;

interface Entry {
  fails: number;
  last: number;
  blockedUntil: number;
  blockMs: number;
}

export class LoginGuard {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly opts: { max?: number; windowMs?: number } = {},
    private readonly now: () => number = Date.now,
  ) {}

  private get max(): number {
    return this.opts.max ?? 5;
  }
  private get window(): number {
    return this.opts.windowMs ?? WINDOW_MS;
  }

  /** Milliseconds the caller still has to wait, or 0 when an attempt is allowed. */
  retryAfter(key: string): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    const t = this.now();
    if (e.blockedUntil > t) return e.blockedUntil - t;
    if (t - e.last > this.window + e.blockMs) this.entries.delete(key);
    return 0;
  }

  fail(key: string): void {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || (e.blockedUntil <= t && t - e.last > this.window + e.blockMs)) {
      e = { fails: 0, last: t, blockedUntil: 0, blockMs: 0 };
      this.entries.set(key, e);
    }
    e.fails++;
    e.last = t;
    if (e.fails >= this.max) {
      e.blockMs = Math.min(MAX_BLOCK_MS, this.window * 2 ** Math.min(10, e.fails - this.max));
      e.blockedUntil = t + e.blockMs;
    }
    if (this.entries.size > 20000) this.sweep(t);
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  private sweep(t: number): void {
    for (const [k, e] of this.entries) if (e.blockedUntil <= t && t - e.last > this.window + e.blockMs) this.entries.delete(k);
  }
}

export const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60000));
