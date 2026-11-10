import { aspectRatioValue, cueAt, deviceFromWidth, isLayerVisibleAt, parseProject, sceneAt, type Action, type CaptionCue, type Device, type Layer, type Product, type ProductRef, type Project, type Scene, type VideoSource } from "@sceneflow/schema";
import { commerce, linkAdapter, type CartLine, type CommerceAdapter, type CommerceResult } from "./commerce.js";
import { Emitter, type EventMap } from "./emitter.js";
import { Analytics, analyticsAllowed } from "./analytics.js";
import { applyOffsets, nextSeek, parseDistance, pinAnchor, pinState, pinTypeFor, smoothStep, triggerPoint, triggerProgress, type AncestorStyle, type PinPhase, type PinState, type PinType } from "./scroll.js";
import { browserProfile, pickSource } from "./sources.js";
import { REF_WIDTH, Stage } from "./stage.js";
import { ensureFonts, ensureStyles } from "./styles.js";

export interface PlayerOptions {
  target: string | HTMLElement;
  /** URL of a published project JSON (same-origin on WordPress). */
  configUrl?: string;
  /** Headless / already-loaded config. */
  config?: unknown;
  /** Defer media loading until the player is near the viewport. Default true. */
  lazy?: boolean;
  /** Force a device layout; default "auto" (by player width). */
  device?: Device | "auto";
  /** Commerce adapter for this player. Default: the global registry (`SceneFlow.commerce`) by product provider. */
  commerce?: CommerceAdapter;
  /** Intercept any action. Return true to mark it handled (built-in behaviour is skipped). */
  onAction?: (action: Action, layer: Layer) => boolean | void;
  /**
   * Anonymous playback analytics (doc §24). Default: on when the published config names an endpoint and the
   * visitor has not set Do Not Track. `false` turns it off; an object overrides the endpoint / session id.
   */
  analytics?: boolean | { endpoint?: string; sessionId?: string };
}

export type PlayerState = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "destroyed" | "error";
/** What the player actually does after device / motion fallbacks are applied. */
export type EffectiveMode = Project["playback"]["mode"] | "poster";

/**
 * Two playback models share one engine:
 *  - "base": project.video is one continuous video; scenes are time ranges on it.
 *  - "scenes": no base video; each scene brings its own background (color/gradient/image/video clip).
 * Scroll Scrub drives the same clock from page scroll instead of play().
 */
export class Player {
  private readonly emitter = new Emitter();
  private root: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private playerEl: HTMLElement | null = null;
  private mediaEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private video: HTMLVideoElement | null = null;
  private stage: Stage | null = null;
  private observer: IntersectionObserver | null = null;
  private project: Project | null = null;
  private state: PlayerState = "idle";
  private mode: "base" | "scenes" = "base";
  private effective: EffectiveMode = "normal";
  private currentScene: Scene | null = null;
  private time = 0;
  private raf = 0;
  private lastTs = 0;
  private mediaMounted = false;
  private sceneMediaId = "";
  private audio = new Map<string, HTMLAudioElement>();
  // scroll scrub
  private scrollTarget = 0;
  private scrollRaf = 0;
  private scrollLastTs = 0;
  private pinType: PinType = "sticky";
  private pinPhase: PinPhase | null = null;
  /** Scrub travel in px (pinned) and the player's length along the scroll axis, measured in `layoutScroll`. */
  private travel = 0;
  private playerLength = 0;
  private lastRectStart = NaN;
  private quietFrames = 0;
  private markerEls: HTMLElement[] = [];
  /** Latest media time a scrub asked for; applied when the in-flight seek lands (see `nextSeek`). */
  private seekWanted = NaN;
  private seekBound = new WeakSet<HTMLVideoElement>();
  /** Object URL of a fully downloaded scrub file (scroll mode), revoked on destroy. */
  private blobUrl: string | null = null;
  // commerce
  private products = new Map<string, Promise<Product | null>>();
  private hydratedScenes = new Set<string>();
  private toastEl: HTMLElement | null = null;
  private toastTimer = 0;
  // media
  private prefetched = new Set<string>();
  // analytics
  private analytics: Analytics | null = null;
  private quartilesSeen = new Set<number>();
  private impressed = new Set<string>();
  // captions
  private captionsEl: HTMLElement | null = null;
  private captionsRo: ResizeObserver | null = null;
  private cueShown: CaptionCue | null = null;
  private captionsOn = true;

  constructor(private readonly options: PlayerOptions) {}

  // ---------- lifecycle ----------

  async init(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "loading";
    const target = typeof this.options.target === "string" ? document.querySelector<HTMLElement>(this.options.target) : this.options.target;
    if (!target) return this.fail("TARGET_NOT_FOUND", "Player target element not found");
    this.root = target;

    let raw: unknown = this.options.config;
    if (raw === undefined) {
      if (!this.options.configUrl) return this.fail("NO_CONFIG", "Provide config or configUrl");
      try {
        const res = await fetch(this.options.configUrl, { credentials: "same-origin" });
        if (!res.ok) return this.fail("CONFIG_FETCH_FAILED", `Config request failed (${res.status})`);
        raw = await res.text();
      } catch {
        return this.fail("CONFIG_FETCH_FAILED", "Could not load project config");
      }
    }

    const parsed = parseProject(raw);
    if (!parsed.ok) return this.fail(parsed.code, parsed.message);
    this.project = parsed.project;
    this.mode = this.project.video ? "base" : "scenes";
    this.effective = this.resolveMode(this.project);
    this.startAnalytics(this.project, target);
    this.analytics?.track("player_loaded", { payload: { mode: this.effective } });
    this.mount();
    this.state = "ready";
    this.emitter.emit("ready", undefined);

    if (this.effective === "poster") return;
    // Scroll scrub: the pin engine runs from the start (the page must have its final height before the visitor
    // gets there); the media itself still loads lazily, one screen ahead.
    if (this.effective === "scroll") this.startScroll();
    if (this.options.lazy === false || typeof IntersectionObserver === "undefined") this.mountMedia();
    else this.observeViewport();
  }

  /** Doc §24 + §25: consent-aware, off by option, off without an endpoint, off under Do Not Track. */
  private startAnalytics(p: Project, target: HTMLElement): void {
    const opt = this.options.analytics;
    if (opt === false || !analyticsAllowed()) return;
    const endpoint = (typeof opt === "object" ? opt.endpoint : undefined) ?? (p.analytics?.enabled === false ? undefined : p.analytics?.endpoint);
    if (!endpoint) return;
    // Visitor's device class (viewport), not the player's responsive layout — a 900 px player on a desktop is still "desktop".
    const device = this.options.device && this.options.device !== "auto" ? this.options.device : deviceFromWidth((typeof window !== "undefined" && window.innerWidth) || target.clientWidth || REF_WIDTH);
    this.analytics = new Analytics({ endpoint, projectId: p.projectId, version: p.version, device, sessionId: typeof opt === "object" ? opt.sessionId : undefined });
  }

  /** Applies mobile + reduced-motion fallbacks (doc 9.1). */
  private resolveMode(p: Project): EffectiveMode {
    const pb = p.playback;
    if (pb.mode !== "scroll") return pb.mode;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return pb.reducedMotion;
    const mobile = typeof window !== "undefined" && window.innerWidth < 640;
    if (mobile && pb.mobileFallback !== "scroll") return pb.mobileFallback;
    return "scroll";
  }

  getEffectiveMode(): EffectiveMode {
    return this.effective;
  }

  private mount(): void {
    const project = this.project;
    const root = this.root;
    if (!project || !root) return;
    ensureStyles();
    ensureFonts(project.fonts?.google);
    root.replaceChildren();
    root.dataset.sceneflow = "ready";

    const playerEl = document.createElement("div");
    playerEl.className = "sceneflow-root";
    playerEl.style.aspectRatio = String(aspectRatioValue(project.canvas.aspectRatio));
    // "transparent" (or the page colour) lets the video sit in the page like a picture — no black box, no visible player.
    if (project.canvas.background !== "#000") playerEl.style.background = project.canvas.background;
    playerEl.dataset.sceneflowState = "ready";
    playerEl.dataset.sceneflowMode = this.effective;
    const mediaEl = document.createElement("div");
    mediaEl.className = "sceneflow-media";
    playerEl.appendChild(mediaEl);

    if (this.effective === "scroll") {
      const scrollEl = document.createElement("div");
      scrollEl.className = "sceneflow-scroll";
      if (project.playback.pin) playerEl.classList.add("sceneflow-pinned");
      scrollEl.appendChild(playerEl);
      root.appendChild(scrollEl);
      this.scrollEl = scrollEl;
      if (project.playback.showProgress) {
        const bar = document.createElement("div");
        bar.className = "sceneflow-progress";
        const fill = document.createElement("i");
        bar.appendChild(fill);
        playerEl.appendChild(bar);
        this.progressEl = fill;
      }
    } else root.appendChild(playerEl);
    this.playerEl = playerEl;
    this.mediaEl = mediaEl;

    this.stage = new Stage(playerEl, { device: this.options.device ?? "auto", onAction: (a, l) => void this.handleAction(a, l) });
    this.mountCaptions(project, playerEl);

    // Poster first: cheap paint before any media loads. A custom thumbnail (project.poster) wins over the video's own.
    const first = project.scenes[0] ?? null;
    this.currentScene = first;
    if (this.mode === "base" || project.poster) this.showPoster(project.poster ?? project.video?.poster);
    else if (first) this.renderSceneBackground(first, false);
    if (first) {
      this.stage.render(project, first.id, 0);
      this.renderCaption(0);
      this.hydrateScene(first);
      this.prefetchAdjacent(first);
      this.sceneAnalytics(null, first, 0);
    }

    const m = this.effective;
    if (m !== "autoplay" && m !== "scroll" && m !== "poster" && (this.mode === "scenes" || !project.playback.controls)) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "sceneflow-play";
      play.setAttribute("aria-label", "Play");
      play.textContent = "▶";
      play.addEventListener("click", () => (this.state === "playing" ? this.pause() : this.play()));
      playerEl.appendChild(play);
    }
    if (m === "hover") {
      playerEl.addEventListener("mouseenter", () => this.play());
      playerEl.addEventListener("mouseleave", () => this.pause());
    }
  }

  // ---------- captions ----------

  private static readonly CC_KEY = "sceneflow_cc";

  /** Subtitle bar + CC toggle, only when the project has cues and does not turn them off. */
  private mountCaptions(project: Project, playerEl: HTMLElement): void {
    const caps = project.captions;
    if (!caps?.cues.length || project.playback.captions === false) return;
    let pref: string | null = null;
    try {
      pref = localStorage.getItem(Player.CC_KEY);
    } catch {
      /* storage blocked */
    }
    this.captionsOn = pref !== "off";
    const el = document.createElement("div");
    el.className = "sceneflow-captions";
    el.setAttribute("aria-live", "polite");
    el.dataset.sceneflowPos = caps.style.position;
    el.dataset.sceneflowSize = caps.style.size;
    if (this.mode === "base" && project.playback.controls && this.effective !== "scroll") el.dataset.sceneflowControls = "1";
    el.lang = caps.language;
    playerEl.appendChild(el);
    this.captionsEl = el;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sceneflow-cc";
    btn.textContent = "CC";
    btn.setAttribute("aria-label", "Toggle captions");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setCaptionsEnabled(!this.captionsOn);
    });
    playerEl.appendChild(btn);
    playerEl.dataset.sceneflowCc = this.captionsOn ? "on" : "off";
    btn.setAttribute("aria-pressed", String(this.captionsOn));
    // Captions scale with the player like layers do (same reference width as the stage).
    const scale = (w: number) => el.style.setProperty("--sceneflow-scale", String(Math.max(0.35, w / REF_WIDTH)));
    scale(playerEl.clientWidth || REF_WIDTH);
    if (typeof ResizeObserver !== "undefined") {
      this.captionsRo = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        if (w) scale(w);
      });
      this.captionsRo.observe(playerEl);
    }
  }

  private renderCaption(t: number): void {
    const el = this.captionsEl;
    const cues = this.project?.captions?.cues;
    if (!el || !cues) return;
    const cue = cueAt(cues, t);
    if (cue === this.cueShown) return;
    this.cueShown = cue;
    el.textContent = cue ? cue.text : "";
  }

  /** Visitor preference for subtitles; remembered per browser. */
  setCaptionsEnabled(on: boolean): void {
    this.captionsOn = on;
    if (this.playerEl) {
      this.playerEl.dataset.sceneflowCc = on ? "on" : "off";
      this.playerEl.querySelector(".sceneflow-cc")?.setAttribute("aria-pressed", String(on));
    }
    try {
      localStorage.setItem(Player.CC_KEY, on ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    this.emitter.emit("captionsChange", { enabled: on });
  }

  getCaptionsEnabled(): boolean {
    return this.captionsOn;
  }

  private showPoster(src: string | undefined): void {
    if (!this.mediaEl) return;
    this.mediaEl.replaceChildren();
    if (!src) return;
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.decoding = "async";
    this.mediaEl.appendChild(img);
  }

  private observeViewport(): void {
    if (!this.playerEl) return;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.mountMedia();
          this.observer?.disconnect();
          this.observer = null;
        }
      },
      // Scroll players start downloading a screen earlier: the scrub file should be whole before the first wheel tick.
      { rootMargin: this.effective === "scroll" ? "150%" : "200px" },
    );
    this.observer.observe(this.scrollEl ?? this.playerEl);
  }

  /** Creates media elements once. Never loads the original upload; src comes from the published config. */
  private mountMedia(): void {
    if (this.mediaMounted || !this.project || !this.mediaEl) return;
    this.mediaMounted = true;
    const p = this.project;
    const scroll = this.effective === "scroll";
    if (this.mode === "base" && p.video) {
      const src = this.pickFor(p.video.sources, p.video.src);
      const v = this.createVideo(src, p.poster ?? p.video.poster);
      v.controls = scroll ? false : p.playback.controls;
      v.loop = this.effective === "loop";
      if (scroll) {
        v.preload = "auto";
        v.muted = true;
        void this.upgradeToBlob(v, src, p.video.sources?.find((s) => s.src === src)?.sizeBytes);
      }
      v.addEventListener("timeupdate", () => !scroll && this.onTime(v.currentTime));
      v.addEventListener("play", () => !scroll && this.setState("playing"));
      v.addEventListener("pause", () => !scroll && this.state === "playing" && this.setState("paused"));
      v.addEventListener("ended", () => !scroll && this.finish());
      this.mediaEl.replaceChildren(v);
      this.video = v;
      // The visitor may already be part-way through the scroll range when the file arrives.
      if (scroll && this.time > 0) this.requestSeek(v, this.time);
    } else if (this.currentScene) {
      this.renderSceneBackground(this.currentScene, true);
    }
    if (scroll) return;
    if (this.effective === "autoplay") {
      if (this.video) this.video.muted = true;
      this.play();
    }
  }

  private createVideo(src: string, poster?: string): HTMLVideoElement {
    const v = document.createElement("video");
    v.src = src;
    if (poster) v.poster = poster;
    v.preload = "metadata";
    v.playsInline = true;
    v.muted = this.project?.playback.muted ?? false;
    const speed = this.speed();
    if (speed !== 1) v.defaultPlaybackRate = v.playbackRate = speed;
    return v;
  }

  /** Playback rate (never in scroll mode, where the page is the clock). */
  private speed(): number {
    return this.effective === "scroll" ? 1 : this.project?.playback.speed ?? 1;
  }

  /** Device profile (doc 11.4): rendition for the player's rendered width, pixel density and connection. */
  private pickFor(sources: VideoSource[] | undefined, fallback: string): string {
    if (!sources?.length) return fallback;
    const { profile, dpr } = browserProfile();
    const width = this.playerEl?.clientWidth || this.root?.clientWidth || 1280;
    return pickSource(sources, { width, dpr, profile, scrub: this.effective === "scroll", fallback });
  }

  /** Doc 11.2: only the active and adjacent scenes are prepared — warm the next scene's poster/video via the cache. */
  private prefetchAdjacent(scene: Scene): void {
    if (!this.project || this.mode !== "scenes" || typeof document === "undefined") return;
    const idx = this.project.scenes.indexOf(scene);
    for (const next of [this.project.scenes[idx + 1], this.project.scenes[idx - 1]]) {
      const bg = next?.background;
      if (!bg || (bg.type !== "video" && bg.type !== "image")) continue;
      const urls = bg.type === "image" ? [bg.src] : [bg.poster, this.mediaMounted ? this.pickFor(bg.sources, bg.src ?? "") : undefined];
      for (const url of urls) {
        if (!url || this.prefetched.has(url)) continue;
        this.prefetched.add(url);
        if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
          const link = document.createElement("link");
          link.rel = "prefetch";
          link.as = "video";
          link.href = url;
          document.head.appendChild(link);
        } else new Image().src = url;
      }
    }
  }

  /** Scenes mode: paints the scene background. With `withMedia` false only posters/colours are used (lazy). */
  private renderSceneBackground(scene: Scene, withMedia: boolean): void {
    if (!this.mediaEl) return;
    const bg = scene.background;
    const id = `${scene.id}|${withMedia}`;
    if (id === this.sceneMediaId) return;
    this.sceneMediaId = id;
    this.video = null;
    this.mediaEl.replaceChildren();
    this.mediaEl.style.background = bg.type === "color" ? bg.color : bg.type === "gradient" ? bg.css : "";
    if (bg.type === "image" && bg.src) {
      const img = document.createElement("img");
      img.src = bg.src;
      img.alt = "";
      this.mediaEl.appendChild(img);
    } else if (bg.type === "video") {
      if (withMedia && bg.src) {
        const src = this.pickFor(bg.sources, bg.src);
        const v = this.createVideo(src, (scene === this.project?.scenes[0] ? this.project.poster : undefined) ?? bg.poster);
        if (this.effective === "scroll") {
          v.preload = "auto";
          v.muted = true;
          void this.upgradeToBlob(v, src, bg.sources?.find((s) => s.src === src)?.sizeBytes);
        }
        v.addEventListener("loadedmetadata", () => {
          this.requestSeek(v, bg.sourceStart + Math.max(0, this.time - scene.start));
        });
        this.mediaEl.appendChild(v);
        this.video = v;
        if (this.state === "playing") void v.play().catch(() => this.emitter.emit("error", { code: "PLAY_BLOCKED", message: "Browser blocked playback" }));
      } else this.showPoster(bg.poster);
    }
  }

  // ---------- transport ----------

  play(): void {
    if (!this.project || this.state === "destroyed" || this.state === "error" || this.effective === "scroll" || this.effective === "poster") return;
    this.mountMedia();
    if (this.state === "ended") this.seek(0);
    if (this.mode === "base") {
      void this.video?.play().catch(() => this.emitter.emit("error", { code: "PLAY_BLOCKED", message: "Browser blocked playback" }));
      if (this.video) this.setState("playing");
      this.syncAudio(this.time);
      return;
    }
    this.setState("playing");
    void this.video?.play().catch(() => {});
    this.lastTs = 0;
    this.loop();
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.video?.pause();
    this.stopLoop();
    this.setState("paused");
    this.syncAudio(this.time);
  }

  seek(time: number): void {
    if (!this.project || !Number.isFinite(time)) return;
    const t = Math.max(0, time);
    if (this.mode === "base") {
      if (this.video) this.requestSeek(this.video, t);
      this.onTime(t);
      return;
    }
    this.time = t;
    const scene = sceneAt(this.project.scenes, t) ?? this.project.scenes[0] ?? null;
    if (scene) {
      this.enterScene(scene);
      if (this.video && scene.background.type === "video") this.requestSeek(this.video, scene.background.sourceStart + (t - scene.start));
    }
    this.renderTime(t);
  }

  /**
   * Coalesced seek (see `nextSeek` in scroll.ts): one in-flight seek at a time, the newest wanted time wins.
   * This is what makes scrubbing paint a frame on (almost) every animation frame instead of cancelling itself.
   */
  private requestSeek(v: HTMLVideoElement, t: number): void {
    this.seekWanted = t;
    if (!this.seekBound.has(v)) {
      this.seekBound.add(v);
      const flush = () => {
        if (this.video !== v) return;
        const next = nextSeek(v, this.seekWanted);
        if (next !== null) v.currentTime = next;
      };
      v.addEventListener("seeked", flush);
      v.addEventListener("loadedmetadata", flush);
    }
    const next = nextSeek(v, t);
    if (next !== null) v.currentTime = next;
  }

  /** Files above this are streamed as usual (range requests) instead of being downloaded whole. */
  private static readonly BLOB_MAX = 40 * 1024 * 1024;

  /** Read through a method so TypeScript does not narrow `state` across the awaits above. */
  private isDestroyed(): boolean {
    return (this.state as PlayerState) === "destroyed";
  }

  /**
   * Scroll mode: once the (small, seek-optimized) scrub file is fully downloaded, swap the video to an
   * object URL so every seek is decode-only — no range request can stall a scroll. Double-buffered: the
   * blob loads in a second element that is seeked to the current time before it replaces the first one, so
   * there is no black frame. Any failure (CORS, size, offline) keeps the streaming element.
   */
  private async upgradeToBlob(v: HTMLVideoElement, src: string, sizeBytes?: number): Promise<void> {
    if (typeof fetch !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
    if (sizeBytes && sizeBytes > Player.BLOB_MAX) return;
    let url: string | null = null;
    try {
      const res = await fetch(src, { mode: "cors", credentials: "omit" });
      const len = Number(res.headers.get("content-length") ?? 0);
      if (!res.ok || (len && len > Player.BLOB_MAX)) return;
      const blob = await res.blob();
      if (blob.size === 0 || blob.size > Player.BLOB_MAX || this.video !== v || this.isDestroyed()) return;
      url = URL.createObjectURL(blob);
      const v2 = document.createElement("video");
      v2.preload = "auto";
      v2.muted = true;
      v2.playsInline = true;
      if (v.poster) v2.poster = v.poster;
      v2.src = url;
      const ready = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 8000);
        v2.addEventListener("loadeddata", () => (clearTimeout(timer), resolve(true)), { once: true });
        v2.addEventListener("error", () => (clearTimeout(timer), resolve(false)), { once: true });
        v2.load();
      });
      if (!ready || this.video !== v) return;
      // Land on the frame the visitor is looking at before the swap.
      v2.currentTime = v.currentTime;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        v2.addEventListener("seeked", () => (clearTimeout(timer), resolve()), { once: true });
      });
      if (this.video !== v || this.isDestroyed()) return;
      v.replaceWith(v2);
      this.video = v2;
      this.blobUrl = url;
      url = null;
      v.removeAttribute("src");
      v.load();
      this.requestSeek(v2, Number.isNaN(this.seekWanted) ? v2.currentTime : this.seekWanted);
    } catch {
      /* keep streaming */
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  goToScene(sceneId: string): void {
    const scene = this.project?.scenes.find((s) => s.id === sceneId);
    if (!scene) return this.emitter.emit("error", { code: "SCENE_NOT_FOUND", message: `Unknown scene ${sceneId}` });
    this.seek(scene.start);
  }

  getCurrentScene(): string | null {
    return this.currentScene?.id ?? null;
  }

  getCurrentTime(): number {
    return this.time;
  }

  getState(): PlayerState {
    return this.state;
  }

  getDevice(): Device | null {
    return this.stage?.getDevice() ?? null;
  }

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): () => void {
    return this.emitter.on(event, handler);
  }

  destroy(): void {
    this.stopLoop();
    this.stopScroll();
    this.observer?.disconnect();
    this.video?.pause();
    this.video?.removeAttribute("src");
    this.video?.load();
    for (const a of this.audio.values()) {
      a.pause();
      a.removeAttribute("src");
    }
    this.audio.clear();
    clearTimeout(this.toastTimer);
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    this.analytics?.destroy();
    this.analytics = null;
    this.captionsRo?.disconnect();
    this.captionsRo = this.captionsEl = this.cueShown = null;
    this.stage?.destroy();
    this.root?.replaceChildren();
    this.emitter.clear();
    this.observer = this.video = this.stage = this.toastEl = null;
    this.root = this.scrollEl = this.playerEl = this.mediaEl = this.progressEl = this.project = null;
    this.state = "destroyed";
  }

  // ---------- engine ----------

  private setState(s: PlayerState): void {
    if (this.state === s) return;
    this.state = s;
    if (this.playerEl) this.playerEl.dataset.sceneflowState = s;
    if (s === "playing") {
      this.emitter.emit("play", undefined);
      this.analytics?.track("video_play", { t: this.time, sceneId: this.currentScene?.id });
      this.analytics?.startWatch(this.time);
    }
    if (s === "paused") {
      this.emitter.emit("pause", undefined);
      this.analytics?.endWatch();
      this.analytics?.track("video_pause", { t: this.time, sceneId: this.currentScene?.id });
    }
  }

  /** Base mode: the video clock drives scenes and layers. */
  private onTime(t: number): void {
    if (!this.project) return;
    this.time = t;
    const scene = sceneAt(this.project.scenes, t);
    if (scene && scene !== this.currentScene) {
      this.sceneAnalytics(this.currentScene, scene, t);
      this.currentScene = scene;
      this.emitter.emit("sceneChange", { sceneId: scene.id });
      this.hydrateScene(scene);
    }
    this.renderTime(t);
  }

  private renderTime(t: number): void {
    if (this.project && this.currentScene && this.stage) this.stage.render(this.project, this.currentScene.id, t);
    this.renderCaption(t);
    this.syncAudio(t);
    if (this.progressEl && this.project) this.progressEl.style.width = `${(Math.min(1, t / Math.max(0.01, this.duration())) * 100).toFixed(2)}%`;
    this.emitter.emit("timeupdate", { time: t });
    if (this.analytics && (this.state === "playing" || this.effective === "scroll")) {
      this.analytics.tickWatch(t);
      const d = this.duration();
      if (d > 0) {
        const pctDone = t / d;
        for (const q of [25, 50, 75]) {
          if (pctDone >= q / 100 && !this.quartilesSeen.has(q)) {
            this.quartilesSeen.add(q);
            this.analytics.track(q === 25 ? "video_25" : q === 50 ? "video_50" : "video_75", { t, sceneId: this.currentScene?.id });
          }
        }
      }
    }
  }

  /** scene_exit / scene_enter plus one impression per actionable element the first time its scene shows. */
  private sceneAnalytics(prev: Scene | null, next: Scene, t: number): void {
    if (!this.analytics) return;
    this.analytics.endWatch();
    if (prev) this.analytics.track("scene_exit", { t, sceneId: prev.id });
    this.analytics.track("scene_enter", { t, sceneId: next.id });
    for (const layer of next.layers) {
      if (!(layer.action || layer.type === "product") || this.impressed.has(layer.id)) continue;
      this.impressed.add(layer.id);
      this.analytics.track("element_impression", { t, sceneId: next.id, layerId: layer.id, payload: { type: layer.type } });
    }
  }

  private duration(): number {
    const p = this.project;
    if (!p) return 0;
    return p.video?.duration ?? p.scenes[p.scenes.length - 1]?.end ?? 0;
  }

  private enterScene(scene: Scene): void {
    const changed = scene !== this.currentScene;
    if (changed) this.sceneAnalytics(this.currentScene, scene, this.time);
    this.currentScene = scene;
    if (this.mode === "scenes") this.renderSceneBackground(scene, this.mediaMounted);
    if (changed) {
      this.emitter.emit("sceneChange", { sceneId: scene.id });
      this.hydrateScene(scene);
      this.prefetchAdjacent(scene);
    }
  }

  /** Scenes mode clock: a video background drives time while it plays; otherwise wall-clock advances it. */
  private loop = (ts?: number): void => {
    if (this.state !== "playing" || !this.project || !this.currentScene) return;
    const now = ts ?? performance.now();
    const dt = this.lastTs ? Math.min(0.25, (now - this.lastTs) / 1000) : 0;
    this.lastTs = now;
    const scene = this.currentScene;
    const bg = scene.background;
    let t = this.time;
    if (bg.type === "video" && this.video && this.video.readyState >= 2 && !this.video.paused) t = scene.start + (this.video.currentTime - bg.sourceStart);
    else t += dt * this.speed();

    if (t >= scene.end) {
      const idx = this.project.scenes.indexOf(scene);
      const next = this.project.scenes[idx + 1];
      if (next) {
        this.time = next.start;
        this.enterScene(next);
        this.renderTime(this.time);
      } else if (this.effective === "loop") {
        this.seek(0);
      } else {
        this.time = scene.end;
        this.renderTime(this.time);
        return this.finish();
      }
    } else {
      this.time = t;
      this.renderTime(t);
    }
    this.raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(this.loop) : (setTimeout(() => this.loop(), 16) as unknown as number);
  };

  private stopLoop(): void {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.raf);
    clearTimeout(this.raf);
    this.raf = 0;
  }

  private finish(): void {
    this.stopLoop();
    this.video?.pause();
    this.setState("ended");
    this.syncAudio(this.time);
    this.emitter.emit("complete", undefined);
    this.analytics?.endWatch();
    this.analytics?.track("video_complete", { t: this.time, sceneId: this.currentScene?.id });
  }

  private fail(code: string, message: string): void {
    this.state = "error";
    this.emitter.emit("error", { code, message });
    this.analytics?.track("player_error", { payload: { code } });
  }

  // ---------- audio layers ----------

  /** Keeps <audio> elements of the active scene in step with the clock. Silent in scroll mode. */
  private syncAudio(t: number): void {
    const scene = this.currentScene;
    if (!scene || !this.project) return;
    const playing = this.state === "playing" && this.effective !== "scroll";
    const active = new Set<string>();
    for (const layer of scene.layers) {
      if (layer.type !== "audio" || !layer.src) continue;
      active.add(layer.id);
      let a = this.audio.get(layer.id);
      if (!a) {
        a = document.createElement("audio");
        a.src = layer.src;
        a.preload = "auto";
        const vol = Number(layer.content.volume);
        a.volume = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
        const speed = this.speed();
        if (speed !== 1) a.defaultPlaybackRate = a.playbackRate = speed;
        this.audio.set(layer.id, a);
      }
      const want = t - scene.start - (layer.start ?? 0);
      const should = playing && isLayerVisibleAt(layer, scene, t) && !this.project.playback.muted;
      if (should) {
        if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = Math.max(0, want);
        if (a.paused) void a.play().catch(() => {});
      } else if (!a.paused) a.pause();
    }
    for (const [id, a] of this.audio) if (!active.has(id) && !a.paused) a.pause();
  }

  // ---------- scroll scrub ----------
  //
  // A ScrollTrigger-like engine without the library: the container (`.sceneflow-scroll`) is as long as the player plus the
  // scrub travel; the player is pinned at its anchor while the page scrolls through the travel. The technique is
  // chosen per page — CSS sticky where the theme allows it, `position: fixed` through overflow-clipping wrappers,
  // and a per-frame transform inside smooth-scroll wrappers (GSAP ScrollSmoother / Lenis, where the page itself is
  // a transformed element and neither sticky nor fixed can work). Progress always comes from the container's
  // on-screen rectangle, so the picture and the scrub agree even while such a wrapper is still gliding.

  private startScroll(): void {
    if (!this.scrollEl || !this.playerEl || !this.project) return;
    this.layoutScroll();
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);
    this.onScroll();
  }

  private stopScroll(): void {
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = 0;
    for (const m of this.markerEls) m.remove();
    this.markerEls = [];
  }

  private horizontal(): boolean {
    return this.project?.playback.scrollAxis === "horizontal";
  }

  /** Sizes the container (player + travel), measures the player and picks the pin technique this page allows. */
  private layoutScroll(): void {
    const scrollEl = this.scrollEl;
    const playerEl = this.playerEl;
    const p = this.project;
    if (!scrollEl || !playerEl || !p) return;
    const pb = p.playback;
    const h = this.horizontal();
    const viewport = h ? window.innerWidth : window.innerHeight;
    if (h) playerEl.style.width = `${scrollEl.parentElement?.clientWidth || viewport}px`;
    this.playerLength = (h ? playerEl.offsetWidth : playerEl.offsetHeight) || (h ? viewport : viewport * 0.5625);
    this.travel = pb.pin ? parseDistance(pb.scrollDistance, viewport) : 0;
    // Any earlier pin geometry goes before measuring again.
    playerEl.style.position = playerEl.style.top = playerEl.style.left = playerEl.style.bottom = playerEl.style.right = playerEl.style.transform = "";
    if (!h) playerEl.style.width = "";
    playerEl.style.height = "";
    this.pinPhase = null;
    if (pb.pin) {
      this.pinType = pinTypeFor(ancestorStyles(scrollEl));
      playerEl.dataset.sceneflowPin = this.pinType;
      scrollEl.style[h ? "width" : "height"] = `${Math.round(this.playerLength + this.travel)}px`;
      scrollEl.style[h ? "height" : "width"] = "";
      if (this.pinType === "sticky") playerEl.style[h ? "left" : "top"] = `${Math.round(pinAnchor({ viewport, playerLength: this.playerLength, pinPosition: pb.pinPosition, pinOffset: pb.pinOffset }))}px`;
    } else {
      delete playerEl.dataset.sceneflowPin;
      scrollEl.style.height = scrollEl.style.width = "";
    }
    this.renderMarkers(viewport);
  }

  private onResize = (): void => {
    this.layoutScroll();
    this.onScroll();
  };

  /** Scroll events are answered in the same task (no frame of lag); the loop then carries on from there. */
  private onScroll = (): void => {
    this.quietFrames = 0;
    if (this.scrollRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = 0;
    this.scrollTick();
  };

  /**
   * One frame: read the container's on-screen position, place the pin, smooth the clock toward the target and
   * seek. Keeps running while the page is still moving (smooth-scroll themes glide after the last scroll event)
   * or the clock is still catching up, then goes idle until the next scroll event.
   */
  private scrollTick = (ts?: number): void => {
    const scrollEl = this.scrollEl;
    const playerEl = this.playerEl;
    const p = this.project;
    if (!scrollEl || !playerEl || !p) {
      this.scrollRaf = 0;
      return;
    }
    const now = ts ?? performance.now();
    const dt = this.scrollLastTs ? now - this.scrollLastTs : 16.67;
    this.scrollLastTs = now;
    const pb = p.playback;
    const h = this.horizontal();
    const rect = scrollEl.getBoundingClientRect();
    const start = h ? rect.left : rect.top;
    const viewport = h ? window.innerWidth : window.innerHeight;
    let raw: number;
    if (pb.pin) {
      const st = pinState({ containerStart: start, travel: this.travel, playerLength: this.playerLength, viewport, pinPosition: pb.pinPosition, pinOffset: pb.pinOffset });
      this.applyPin(st, rect);
      raw = st.progress;
    } else raw = triggerProgress({ containerStart: start, playerLength: h ? rect.width : rect.height, viewport, start: pb.triggerStart, end: pb.triggerEnd });
    this.scrollTarget = applyOffsets(raw, pb.startOffset, pb.endOffset) * this.duration();
    const next = smoothStep(this.time, this.scrollTarget, pb.smoothness, dt);
    if (next !== this.time) this.applyScrubTime(next);
    const moving = start !== this.lastRectStart;
    this.lastRectStart = start;
    this.quietFrames = moving || next !== this.scrollTarget ? 0 : this.quietFrames + 1;
    if (this.quietFrames < 6 && typeof requestAnimationFrame === "function") this.scrollRaf = requestAnimationFrame(this.scrollTick);
    else this.scrollRaf = 0;
  };

  /** Puts the player where the pin wants it, with as few style writes as the technique needs. */
  private applyPin(st: PinState, rect: DOMRect): void {
    const el = this.playerEl!;
    const h = this.horizontal();
    const s = el.style;
    if (this.pinType === "transform") {
      // Rides inside its (moving) container: one compositor-only write per frame.
      const shift = Math.round(st.shift * 100) / 100;
      s.transform = shift ? (h ? `translate3d(${shift}px,0,0)` : `translate3d(0,${shift}px,0)`) : "";
    } else if (this.pinType === "fixed") {
      if (st.phase === "pinned") {
        // Fixed loses the container's geometry, so it is handed over explicitly (and refreshed while pinned).
        s.position = "fixed";
        s.bottom = s.right = "";
        if (h) {
          s.left = `${st.anchor}px`;
          s.top = `${rect.top}px`;
          s.width = `${this.playerLength}px`;
          s.height = `${rect.height}px`;
        } else {
          s.top = `${st.anchor}px`;
          s.left = `${rect.left}px`;
          s.width = `${rect.width}px`;
        }
      } else if (st.phase !== this.pinPhase) {
        s.top = s.left = s.height = "";
        if (!h) s.width = "";
        s.position = st.phase === "after" ? "absolute" : "";
        s.bottom = st.phase === "after" && !h ? "0" : "";
        s.right = st.phase === "after" && h ? "0" : "";
      }
    }
    if (st.phase !== this.pinPhase) {
      this.pinPhase = st.phase;
      el.dataset.sceneflowPinPhase = st.phase;
    }
  }

  /** ScrollTrigger-style markers for testing a page: start / end of the scrub range and the pin line. */
  private renderMarkers(viewport: number): void {
    for (const m of this.markerEls) m.remove();
    this.markerEls = [];
    const p = this.project;
    const scrollEl = this.scrollEl;
    if (!p?.playback.markers || !scrollEl) return;
    const pb = p.playback;
    const h = this.horizontal();
    const mk = (text: string, color: string, fixed: boolean, pos: number): HTMLElement => {
      const el = document.createElement("div");
      el.className = "sceneflow-marker";
      el.textContent = text;
      el.style.cssText = `position:${fixed ? "fixed" : "absolute"};z-index:2147483000;pointer-events:none;font:11px/1.2 ui-monospace,Menlo,monospace;color:${color};border-${h ? "left" : "top"}:1px dashed ${color};padding:2px 4px;white-space:nowrap;` + (h ? `top:${fixed ? 8 : 0}px;left:${pos}px;height:${fixed ? viewport : "100%"}` : `left:${fixed ? 8 : 0}px;top:${pos}px;width:${fixed ? "100%" : "auto"};right:${fixed ? "auto" : "0"}`);
      (fixed ? document.body : scrollEl).appendChild(el);
      this.markerEls.push(el);
      return el;
    };
    if (pb.pin) {
      mk("scrub start", "#16a34a", false, 0);
      mk("scrub end", "#dc2626", false, this.travel);
      mk(`pin · ${pb.pinPosition}${pb.pinOffset ? ` ${pb.pinOffset > 0 ? "+" : ""}${pb.pinOffset}px` : ""} · ${this.pinType}`, "#2563eb", true, pinAnchor({ viewport, playerLength: this.playerLength, pinPosition: pb.pinPosition, pinOffset: pb.pinOffset }));
    } else {
      const len = this.playerLength;
      mk(`start · ${pb.triggerStart}`, "#16a34a", true, triggerPoint(pb.triggerStart, len, viewport) + (pb.triggerStart.split(" ")[0] === "center" ? len / 2 : pb.triggerStart.split(" ")[0] === "bottom" ? len : 0));
      mk(`end · ${pb.triggerEnd}`, "#dc2626", true, triggerPoint(pb.triggerEnd, len, viewport) + (pb.triggerEnd.split(" ")[0] === "center" ? len / 2 : pb.triggerEnd.split(" ")[0] === "bottom" ? len : 0));
    }
  }

  /** Seeks media to `t` without playing, then renders layers. Works forwards and backwards. */
  private applyScrubTime(t: number): void {
    if (!this.project) return;
    if (this.mode === "base") {
      if (this.video) this.requestSeek(this.video, t);
      this.onTime(t);
      return;
    }
    this.time = t;
    const scene = sceneAt(this.project.scenes, t) ?? this.project.scenes[0] ?? null;
    if (scene) {
      this.enterScene(scene);
      if (this.video && scene.background.type === "video") this.requestSeek(this.video, scene.background.sourceStart + (t - scene.start));
    }
    this.renderTime(t);
  }

  // ---------- commerce ----------

  /** Adapter for a product: explicit option → registry by provider → site default → link fallback. */
  private adapterFor(provider?: string): CommerceAdapter {
    return this.options.commerce ?? commerce.resolve(provider);
  }

  /** Fetches live product data for the product cards of a scene (once per product) and applies it. */
  private hydrateScene(scene: Scene): void {
    if (this.hydratedScenes.has(scene.id)) return;
    this.hydratedScenes.add(scene.id);
    for (const layer of scene.layers) {
      const ref = layer.product;
      if (layer.type !== "product" || !ref) continue;
      const adapter = this.adapterFor(ref.provider);
      if (!adapter.getProduct) continue;
      const key = `${adapter.id}:${ref.productId}`;
      let pending = this.products.get(key);
      if (!pending) {
        pending = adapter.getProduct(ref).catch(() => null);
        this.products.set(key, pending);
      }
      void pending.then((p) => {
        if (p && this.stage && this.state !== "destroyed") this.stage.setLiveProduct(layer.id, p);
      });
    }
  }

  /** Small in-player notice ("Added to cart" + "View cart"). */
  private toast(message: string, kind: "info" | "error" = "info", link?: { href: string; label: string }): void {
    if (!this.playerEl) return;
    clearTimeout(this.toastTimer);
    this.toastEl?.remove();
    const el = document.createElement("div");
    el.className = "sceneflow-toast";
    el.dataset.kind = kind;
    el.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    if (link) {
      const a = document.createElement("a");
      a.href = link.href;
      a.textContent = link.label;
      el.appendChild(a);
    }
    this.playerEl.appendChild(el);
    this.toastEl = el;
    this.toastTimer = setTimeout(() => el.remove(), kind === "error" ? 5000 : 3500) as unknown as number;
  }

  private report(result: CommerceResult, fallback: string): void {
    if (!result.ok) this.toast(result.message ?? fallback, "error");
    else if (result.message) this.toast(result.message, "info", result.cartUrl ? { href: result.cartUrl, label: "View cart" } : undefined);
  }

  // ---------- actions ----------

  private async handleAction(action: Action, layer: Layer): Promise<void> {
    this.emitter.emit("actionTriggered", { action, layerId: layer.id });
    if (this.analytics) {
      const base = { t: this.time, sceneId: this.currentScene?.id, layerId: layer.id };
      const productId = "product" in action ? action.product.productId : undefined;
      this.analytics.track(layer.type === "hotspot" ? "hotspot_click" : "element_click", { ...base, productId, payload: { action: action.type, type: layer.type } });
      if (action.type === "VIEW_PRODUCT") this.analytics.track("product_view", { ...base, productId });
      else if (action.type === "ADD_TO_CART") this.analytics.track("add_to_cart", { ...base, productId, payload: { quantity: action.quantity } });
      else if (action.type === "BUY_NOW" || action.type === "OPEN_CHECKOUT") this.analytics.track("checkout_started", { ...base, productId });
      else if (action.type === "APPLY_COUPON") this.analytics.track("coupon_applied", { ...base, payload: { code: action.code } });
    }
    if (this.options.onAction?.(action, layer) === true) return;
    const unavailable = (what: string) => {
      this.emitter.emit("error", { code: "COMMERCE_UNAVAILABLE", message: `No commerce adapter can ${what} on this page` });
      this.toast("Not available on this page", "error");
    };
    try {
      switch (action.type) {
        case "OPEN_URL":
          window.open(action.url, action.newTab ? "_blank" : "_self", "noopener");
          return;
        case "GO_TO_SCENE":
          return this.goToScene(action.sceneId);
        case "SEEK":
          return this.seek(action.time);
        case "TOGGLE_LAYER":
          return this.stage?.toggleLayer(action.layerId);
        case "VIEW_PRODUCT": {
          const ref: ProductRef = action.product;
          this.emitter.emit("productClick", { productId: ref.productId, product: ref });
          const adapter = this.adapterFor(ref.provider);
          const r = await (adapter.viewProduct ?? linkAdapter.viewProduct!)(ref);
          if (!r.ok) this.toast(r.message ?? "Product page not available", "error");
          return;
        }
        case "ADD_TO_CART":
        case "BUY_NOW": {
          const line: CartLine = { product: action.product, quantity: action.quantity };
          const adapter = this.adapterFor(line.product.provider);
          this.stage?.setBusy(layer.id, true);
          let r: CommerceResult;
          try {
            if (action.type === "BUY_NOW") {
              if (adapter.buyNow) r = await adapter.buyNow(line);
              else {
                r = await adapter.addToCart(line);
                if (r.ok && r.checkoutUrl) window.location.assign(r.checkoutUrl);
              }
            } else r = await adapter.addToCart(line);
          } finally {
            this.stage?.setBusy(layer.id, false);
          }
          const payload = { productId: line.product.productId, variantId: line.product.variantId, quantity: line.quantity, product: line.product, result: r };
          this.emitter.emit(action.type === "BUY_NOW" ? "buyNow" : "addToCart", payload);
          this.report(r, action.type === "BUY_NOW" ? "Could not start checkout" : "Could not add to cart");
          return;
        }
        case "OPEN_CART": {
          const adapter = this.adapterFor();
          return adapter.openCart ? this.report(await adapter.openCart(), "Cart not available") : unavailable("open the cart");
        }
        case "OPEN_CHECKOUT": {
          const adapter = this.adapterFor();
          return adapter.openCheckout ? this.report(await adapter.openCheckout(), "Checkout not available") : unavailable("open the checkout");
        }
        case "APPLY_COUPON": {
          const adapter = this.adapterFor();
          if (!adapter.applyCoupon) return unavailable("apply a coupon");
          if (!action.code.trim()) return this.toast("No coupon code set", "error");
          const r = await adapter.applyCoupon(action.code.trim());
          this.emitter.emit("couponApplied", { code: action.code, result: r });
          return this.report(r, "Coupon could not be applied");
        }
        default:
          this.emitter.emit("error", { code: "UNSUPPORTED_ACTION", message: `Action ${(action as Action).type} is not available yet` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      this.emitter.emit("error", { code: "ACTION_FAILED", message });
      this.toast(message, "error");
    }
  }
}

/** Computed styles of every ancestor below <body> — what decides whether sticky or fixed can work on this page. */
function ancestorStyles(el: HTMLElement): AncestorStyle[] {
  const out: AncestorStyle[] = [];
  if (typeof getComputedStyle !== "function") return out;
  for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    out.push({ overflow: cs.overflow, overflowX: cs.overflowX, overflowY: cs.overflowY, transform: cs.transform || "none", perspective: cs.perspective || "none", filter: cs.filter || "none", willChange: cs.willChange || "auto", contain: cs.contain || "none" });
  }
  return out;
}
