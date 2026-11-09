import { aspectRatioValue, isLayerVisibleAt, parseProject, sceneAt, type Action, type Device, type Layer, type Product, type ProductRef, type Project, type Scene, type VideoSource } from "@sceneflow/schema";
import { commerce, linkAdapter, type CartLine, type CommerceAdapter, type CommerceResult } from "./commerce.js";
import { Emitter, type EventMap } from "./emitter.js";
import { parseDistance, scrollProgress, smoothStep } from "./scroll.js";
import { browserProfile, pickSource } from "./sources.js";
import { Stage } from "./stage.js";
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
  // commerce
  private products = new Map<string, Promise<Product | null>>();
  private hydratedScenes = new Set<string>();
  private toastEl: HTMLElement | null = null;
  private toastTimer = 0;
  // media
  private prefetched = new Set<string>();

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
    this.mount();
    this.state = "ready";
    this.emitter.emit("ready", undefined);

    if (this.effective === "poster") return;
    if (this.options.lazy === false || typeof IntersectionObserver === "undefined") this.mountMedia();
    else this.observeViewport();
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
    playerEl.className = "sf-player";
    playerEl.style.aspectRatio = String(aspectRatioValue(project.canvas.aspectRatio));
    playerEl.dataset.sfState = "ready";
    playerEl.dataset.sfMode = this.effective;
    const mediaEl = document.createElement("div");
    mediaEl.className = "sf-media";
    playerEl.appendChild(mediaEl);

    if (this.effective === "scroll") {
      const scrollEl = document.createElement("div");
      scrollEl.className = "sf-scroll";
      if (project.playback.pin) playerEl.classList.add("sf-pinned");
      scrollEl.appendChild(playerEl);
      root.appendChild(scrollEl);
      this.scrollEl = scrollEl;
      if (project.playback.showProgress) {
        const bar = document.createElement("div");
        bar.className = "sf-progress";
        const fill = document.createElement("i");
        bar.appendChild(fill);
        playerEl.appendChild(bar);
        this.progressEl = fill;
      }
    } else root.appendChild(playerEl);
    this.playerEl = playerEl;
    this.mediaEl = mediaEl;

    this.stage = new Stage(playerEl, { device: this.options.device ?? "auto", onAction: (a, l) => void this.handleAction(a, l) });

    // Poster first: cheap paint before any media loads.
    const first = project.scenes[0] ?? null;
    this.currentScene = first;
    if (this.mode === "base") this.showPoster(project.video?.poster);
    else if (first) this.renderSceneBackground(first, false);
    if (first) {
      this.stage.render(project, first.id, 0);
      this.hydrateScene(first);
      this.prefetchAdjacent(first);
    }

    const m = this.effective;
    if (m !== "autoplay" && m !== "scroll" && m !== "poster" && (this.mode === "scenes" || !project.playback.controls)) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "sf-play";
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
      { rootMargin: "200px" },
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
      const v = this.createVideo(this.pickFor(p.video.sources, p.video.src), p.video.poster);
      v.controls = scroll ? false : p.playback.controls;
      v.loop = this.effective === "loop";
      if (scroll) {
        v.preload = "auto";
        v.muted = true;
      }
      v.addEventListener("timeupdate", () => !scroll && this.onTime(v.currentTime));
      v.addEventListener("play", () => !scroll && this.setState("playing"));
      v.addEventListener("pause", () => !scroll && this.state === "playing" && this.setState("paused"));
      v.addEventListener("ended", () => !scroll && this.finish());
      this.mediaEl.replaceChildren(v);
      this.video = v;
    } else if (this.currentScene) {
      this.renderSceneBackground(this.currentScene, true);
    }
    if (scroll) this.startScroll();
    else if (this.effective === "autoplay") {
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
    return v;
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
        const v = this.createVideo(this.pickFor(bg.sources, bg.src), bg.poster);
        if (this.effective === "scroll") {
          v.preload = "auto";
          v.muted = true;
        }
        v.addEventListener("loadedmetadata", () => {
          v.currentTime = bg.sourceStart + Math.max(0, this.time - scene.start);
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
      if (this.video && Math.abs(this.video.currentTime - t) > 0.01) this.video.currentTime = t;
      this.onTime(t);
      return;
    }
    this.time = t;
    const scene = sceneAt(this.project.scenes, t) ?? this.project.scenes[0] ?? null;
    if (scene) {
      this.enterScene(scene);
      if (this.video && scene.background.type === "video") {
        const want = scene.background.sourceStart + (t - scene.start);
        if (Math.abs(this.video.currentTime - want) > 0.01) this.video.currentTime = want;
      }
    }
    this.renderTime(t);
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
    if (this.playerEl) this.playerEl.dataset.sfState = s;
    if (s === "playing") this.emitter.emit("play", undefined);
    if (s === "paused") this.emitter.emit("pause", undefined);
  }

  /** Base mode: the video clock drives scenes and layers. */
  private onTime(t: number): void {
    if (!this.project) return;
    this.time = t;
    const scene = sceneAt(this.project.scenes, t);
    if (scene && scene !== this.currentScene) {
      this.currentScene = scene;
      this.emitter.emit("sceneChange", { sceneId: scene.id });
      this.hydrateScene(scene);
    }
    this.renderTime(t);
  }

  private renderTime(t: number): void {
    if (this.project && this.currentScene && this.stage) this.stage.render(this.project, this.currentScene.id, t);
    this.syncAudio(t);
    if (this.progressEl && this.project) this.progressEl.style.width = `${(Math.min(1, t / Math.max(0.01, this.duration())) * 100).toFixed(2)}%`;
    this.emitter.emit("timeupdate", { time: t });
  }

  private duration(): number {
    const p = this.project;
    if (!p) return 0;
    return p.video?.duration ?? p.scenes[p.scenes.length - 1]?.end ?? 0;
  }

  private enterScene(scene: Scene): void {
    const changed = scene !== this.currentScene;
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
    else t += dt;

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
  }

  private fail(code: string, message: string): void {
    this.state = "error";
    this.emitter.emit("error", { code, message });
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

  private startScroll(): void {
    if (!this.scrollEl || !this.project) return;
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
  }

  private layoutScroll(): void {
    if (!this.scrollEl || !this.project) return;
    const pb = this.project.playback;
    const horizontal = pb.scrollAxis === "horizontal";
    const viewport = horizontal ? window.innerWidth : window.innerHeight;
    const distance = pb.pin ? parseDistance(pb.scrollDistance, viewport) : 0;
    if (horizontal) {
      this.scrollEl.style.width = distance ? `${distance}px` : "";
      this.scrollEl.style.height = "";
    } else {
      this.scrollEl.style.height = distance ? `${distance}px` : "";
      this.scrollEl.style.width = "";
    }
  }

  private onResize = (): void => {
    this.layoutScroll();
    this.onScroll();
  };

  private onScroll = (): void => {
    if (!this.scrollEl || !this.project) return;
    const pb = this.project.playback;
    const horizontal = pb.scrollAxis === "horizontal";
    const rect = this.scrollEl.getBoundingClientRect();
    const scrollPos = horizontal ? window.scrollX : window.scrollY;
    const progress = scrollProgress({
      scrollPos,
      containerStart: (horizontal ? rect.left : rect.top) + scrollPos,
      containerLength: horizontal ? rect.width : rect.height,
      viewport: horizontal ? window.innerWidth : window.innerHeight,
      pin: pb.pin,
      startOffset: pb.startOffset,
      endOffset: pb.endOffset,
    });
    this.scrollTarget = progress * this.duration();
    if (!this.scrollRaf) {
      this.scrollLastTs = 0;
      this.scrollTick();
    }
  };

  private scrollTick = (ts?: number): void => {
    if (!this.project) return;
    const now = ts ?? performance.now();
    const dt = this.scrollLastTs ? now - this.scrollLastTs : 16.67;
    this.scrollLastTs = now;
    const next = smoothStep(this.time, this.scrollTarget, this.project.playback.smoothness, dt);
    this.applyScrubTime(next);
    if (next !== this.scrollTarget && typeof requestAnimationFrame === "function") this.scrollRaf = requestAnimationFrame(this.scrollTick);
    else this.scrollRaf = 0;
  };

  /** Seeks media to `t` without playing, then renders layers. Works forwards and backwards. */
  private applyScrubTime(t: number): void {
    if (!this.project) return;
    if (this.mode === "base") {
      if (this.video && this.video.readyState >= 1 && Math.abs(this.video.currentTime - t) > 0.016) this.video.currentTime = t;
      this.onTime(t);
      return;
    }
    this.time = t;
    const scene = sceneAt(this.project.scenes, t) ?? this.project.scenes[0] ?? null;
    if (scene) {
      this.enterScene(scene);
      if (this.video && scene.background.type === "video" && this.video.readyState >= 1) {
        const want = scene.background.sourceStart + (t - scene.start);
        if (Math.abs(this.video.currentTime - want) > 0.016) this.video.currentTime = want;
      }
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
    el.className = "sf-toast";
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
