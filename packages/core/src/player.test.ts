import { beforeEach, describe, expect, it, vi } from "vitest";
import { Player } from "./index.js";

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

const config = {
  schemaVersion: "1.0",
  projectId: "p1",
  version: 1,
  video: { provider: "r2", assetId: "a", src: "https://cdn.test/v.mp4", poster: "https://cdn.test/p.jpg", duration: 10 },
  scenes: [
    { id: "s1", name: "One", start: 0, end: 5, background: { type: "color", color: "#000" }, layers: [{ id: "cta", type: "button", frame: { x: 10, y: 80, w: 30, h: 10 }, content: { label: "Buy" }, action: { type: "ADD_TO_CART", productId: "182" } }] },
    { id: "s2", name: "Two", start: 5, end: 10, background: { type: "color", color: "#111" } },
  ],
};

const scenesConfig = {
  schemaVersion: "1.0",
  projectId: "p2",
  version: 1,
  playback: { mode: "click" },
  scenes: [
    { id: "a", name: "A", start: 0, end: 2, background: { type: "color", color: "#f00" }, layers: [{ id: "go", type: "button", frame: { x: 0, y: 0, w: 10, h: 10 }, content: { label: "Next" }, action: { type: "GO_TO_SCENE", sceneId: "b" } }] },
    { id: "b", name: "B", start: 2, end: 4, background: { type: "gradient", css: "linear-gradient(red, blue)" } },
  ],
};

beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div>';
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

describe("Player (base video mode)", () => {
  it("renders the poster + first scene layers and defers the video when lazy", async () => {
    const p = new Player({ target: "#p", config });
    const ready = vi.fn();
    p.on("ready", ready);
    await p.init();
    expect(ready).toHaveBeenCalledOnce();
    expect(document.querySelector("#p .sceneflow-media img")).not.toBeNull();
    expect(document.querySelector("#p video")).toBeNull();
    expect(document.querySelector("#p .sceneflow-stage [data-sceneflow-layer=cta]")).not.toBeNull();
    expect(document.querySelector("style[data-sceneflow]")).not.toBeNull();
    expect(p.getState()).toBe("ready");
  });

  it("shows a custom thumbnail before play and applies the playback speed to video and audio", async () => {
    const custom = { ...config, poster: "https://cdn.test/custom-frame.jpg", playback: { mode: "click", speed: 1.5 }, scenes: [{ ...config.scenes[0], layers: [{ id: "vo", type: "audio", frame: { x: 0, y: 0, w: 1, h: 1 }, src: "https://cdn.test/vo.m4a", content: { volume: 1 } }] }, config.scenes[1]] };
    const p = new Player({ target: "#p", config: custom, lazy: false });
    await p.init();
    const video = document.querySelector("#p video") as HTMLVideoElement;
    expect(video.poster).toBe("https://cdn.test/custom-frame.jpg");
    expect(video.playbackRate).toBe(1.5);
    p.play();
    const audio = document.querySelector("#p audio") as HTMLAudioElement | null;
    expect(audio?.playbackRate ?? video.playbackRate).toBe(1.5);
    p.destroy();
    // Lazy: the custom thumbnail is the first paint.
    const lazy = new Player({ target: "#p", config: { ...custom, canvas: { aspectRatio: "16:9", background: "transparent" } } });
    await lazy.init();
    expect((document.querySelector("#p .sceneflow-media img") as HTMLImageElement).src).toBe("https://cdn.test/custom-frame.jpg");
    expect((document.querySelector("#p .sceneflow-root") as HTMLElement).style.background).toBe("transparent");
    lazy.destroy();
  });

  it("mounts the video on play and supports seek, scenes and events", async () => {
    const p = new Player({ target: "#p", config, lazy: false });
    await p.init();
    const changed = vi.fn();
    p.on("sceneChange", changed);
    p.play();
    expect(document.querySelector("#p video")).not.toBeNull();
    expect(p.getState()).toBe("playing");
    p.seek(6);
    expect(changed).toHaveBeenCalledWith({ sceneId: "s2" });
    expect(p.getCurrentScene()).toBe("s2");
    expect(document.querySelector("#p [data-sceneflow-layer=cta]")).toBeNull(); // scene 2 has no layers
    p.goToScene("s1");
    expect(p.getCurrentScene()).toBe("s1");
    p.pause();
    expect(p.getState()).toBe("paused");
  });

  it("routes commerce actions to the adapter and emits events (legacy productId configs included)", async () => {
    const addToCart = vi.fn().mockResolvedValue({ ok: true, message: "Added to cart", cartUrl: "/cart" });
    const p = new Player({ target: "#p", config, lazy: false, commerce: { id: "test", addToCart } });
    await p.init();
    const ev = vi.fn();
    p.on("addToCart", ev);
    (document.querySelector("#p [data-sceneflow-layer=cta]") as HTMLElement).click();
    await waitFor(() => expect(ev).toHaveBeenCalled());
    expect(addToCart).toHaveBeenCalledWith({ product: { provider: "manual", productId: "182", title: "" }, quantity: 1 });
    expect(ev.mock.calls[0]![0]).toMatchObject({ productId: "182", quantity: 1, result: { ok: true } });
    const toast = document.querySelector("#p .sceneflow-toast")!;
    expect(toast.textContent).toContain("Added to cart");
    expect(toast.querySelector("a")?.getAttribute("href")).toBe("/cart");

    // Without an adapter the link fallback has no URL for this product → error toast + event.
    const q = new Player({ target: "#p", config, lazy: false });
    await q.init();
    const ev2 = vi.fn();
    q.on("addToCart", ev2);
    (document.querySelector("#p [data-sceneflow-layer=cta]") as HTMLElement).click();
    await waitFor(() => expect(ev2).toHaveBeenCalled());
    expect(ev2.mock.calls[0]![0].result.ok).toBe(false);
    expect(document.querySelector("#p .sceneflow-toast[data-kind=error]")).not.toBeNull();
  });

  it("emits error for invalid config and missing target", async () => {
    const p = new Player({ target: "#p", config: { schemaVersion: "9.0" } });
    const err = vi.fn();
    p.on("error", err);
    await p.init();
    expect(err).toHaveBeenCalledWith(expect.objectContaining({ code: "UNSUPPORTED_VERSION" }));
    expect(p.getState()).toBe("error");

    const q = new Player({ target: "#nope", config });
    const err2 = vi.fn();
    q.on("error", err2);
    await q.init();
    expect(err2).toHaveBeenCalledWith(expect.objectContaining({ code: "TARGET_NOT_FOUND" }));
  });

  it("loads config from configUrl", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(config) }));
    const p = new Player({ target: "#p", configUrl: "/project.json" });
    await p.init();
    expect(p.getState()).toBe("ready");
    vi.unstubAllGlobals();
  });

  it("destroy cleans up the DOM and state", async () => {
    const p = new Player({ target: "#p", config, lazy: false });
    await p.init();
    p.play();
    p.destroy();
    expect(document.querySelector("#p")!.children.length).toBe(0);
    expect(p.getState()).toBe("destroyed");
  });
});

describe("Player (scroll scrub)", () => {
  const scrollConfig = { ...config, playback: { mode: "scroll", pin: true, scrollDistance: "400vh", controls: true, showProgress: true, smoothness: 0 } };

  it("builds a pinned scroll container, hides controls and maps scroll to time both ways", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    const p = new Player({ target: "#p", config: scrollConfig, lazy: false });
    await p.init();
    expect(p.getEffectiveMode()).toBe("scroll");
    const scroll = document.querySelector("#p .sceneflow-scroll") as HTMLElement;
    const player = document.querySelector("#p .sceneflow-root") as HTMLElement;
    // jsdom has no layout: the player length falls back to 56.25 % of the viewport (562.5 px) + 4000 px travel.
    expect(scroll.style.height).toBe("4563px");
    expect(player.dataset.sceneflowPin).toBe("sticky"); // plain ancestors → CSS sticky does the pinning
    expect(player.style.top).toBe("0px");
    expect(document.querySelector("#p .sceneflow-play")).toBeNull();
    const video = document.querySelector("#p video") as HTMLVideoElement;
    expect(video.controls).toBe(false);
    expect(video.muted).toBe(true);

    // The page scrolled half way through the travel: the container's top is 2000 px above the viewport.
    scroll.getBoundingClientRect = () => ({ top: -2000, left: 0, width: 1400, height: 4563, bottom: 2563, right: 1400, x: 0, y: -2000, toJSON: () => ({}) }) as DOMRect;
    const times: number[] = [];
    p.on("timeupdate", (e) => times.push(e.time));
    window.dispatchEvent(new Event("scroll"));
    expect(times[times.length - 1]).toBeCloseTo(5, 5); // 50% of a 10s video
    expect(player.dataset.sceneflowPinPhase).toBe("pinned");
    expect(parseFloat((document.querySelector("#p .sceneflow-progress > i") as HTMLElement).style.width)).toBeCloseTo(50, 1);

    // scrolling back up moves time backwards
    scroll.getBoundingClientRect = () => ({ top: -1000, left: 0, width: 1400, height: 4563, bottom: 3563, right: 1400, x: 0, y: -1000, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(times[times.length - 1]).toBeCloseTo(2.5, 5);
    expect(p.getCurrentScene()).toBe("s1");
    // past the travel the player rides out with its container
    scroll.getBoundingClientRect = () => ({ top: -4500, left: 0, width: 1400, height: 4563, bottom: 63, right: 1400, x: 0, y: -4500, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(times[times.length - 1]).toBeCloseTo(10, 5);
    expect(player.dataset.sceneflowPinPhase).toBe("after");
    expect(p.getCurrentScene()).toBe("s2");
    p.play(); // no-op in scroll mode
    expect(p.getState()).toBe("ready");
    p.destroy();
    vi.unstubAllGlobals();
  });

  it("pins with position:fixed through overflow-clipping wrappers and with a transform inside smooth-scroll wrappers", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    // A theme wrapper that clips overflow (very common): sticky would never stick, fixed does.
    document.body.innerHTML = '<div style="overflow:hidden"><div id="p"></div></div>';
    const fixed = new Player({ target: "#p", config: { ...scrollConfig, playback: { ...scrollConfig.playback, pinPosition: "center", pinOffset: 40 } }, lazy: false });
    await fixed.init();
    const scroll = document.querySelector("#p .sceneflow-scroll") as HTMLElement;
    const player = document.querySelector("#p .sceneflow-root") as HTMLElement;
    expect(player.dataset.sceneflowPin).toBe("fixed");
    // Centre anchor for a 562.5 px player in a 1000 px viewport = 218.75, plus the 40 px offset.
    scroll.getBoundingClientRect = () => ({ top: -1000, left: 100, width: 1200, height: 4563, bottom: 3563, right: 1300, x: 100, y: -1000, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(player.dataset.sceneflowPinPhase).toBe("pinned");
    expect(player.style.position).toBe("fixed");
    expect(player.style.top).toBe("258.75px");
    expect(player.style.left).toBe("100px");
    expect(player.style.width).toBe("1200px");
    expect(fixed.getCurrentTime()).toBeCloseTo((1258.75 / 4000) * 10, 3);
    scroll.getBoundingClientRect = () => ({ top: 900, left: 100, width: 1200, height: 4563, bottom: 5463, right: 1300, x: 100, y: 900, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(player.dataset.sceneflowPinPhase).toBe("before");
    expect(player.style.position).toBe("");
    fixed.destroy();

    // GSAP ScrollSmoother / Lenis style page: a transformed wrapper moves the content; the player rides along by transform.
    document.body.innerHTML = '<div style="position:fixed;overflow:hidden"><div style="transform:translateY(-120px)"><div id="p"></div></div></div>';
    const smooth = new Player({ target: "#p", config: scrollConfig, lazy: false });
    await smooth.init();
    const scroll2 = document.querySelector("#p .sceneflow-scroll") as HTMLElement;
    const player2 = document.querySelector("#p .sceneflow-root") as HTMLElement;
    expect(player2.dataset.sceneflowPin).toBe("transform");
    scroll2.getBoundingClientRect = () => ({ top: -1000, left: 0, width: 1400, height: 4563, bottom: 3563, right: 1400, x: 0, y: -1000, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(player2.style.transform).toBe("translate3d(0,1000px,0)");
    expect(player2.style.position).toBe("");
    expect(smooth.getCurrentTime()).toBeCloseTo(2.5, 5);
    smooth.destroy();
    vi.unstubAllGlobals();
  });

  it("scrubs unpinned players between trigger points and draws markers when asked", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    const p = new Player({ target: "#p", config: { ...scrollConfig, playback: { ...scrollConfig.playback, pin: false, triggerStart: "top center", triggerEnd: "bottom center", markers: true } }, lazy: false });
    await p.init();
    const scroll = document.querySelector("#p .sceneflow-scroll") as HTMLElement;
    const player = document.querySelector("#p .sceneflow-root") as HTMLElement;
    expect(scroll.style.height).toBe("");
    expect(player.dataset.sceneflowPin).toBeUndefined();
    expect(document.querySelectorAll(".sceneflow-marker")).toHaveLength(2);
    // 500 px player: top at the viewport centre = 0, bottom at the centre = 1, halfway in between = 0.5.
    scroll.getBoundingClientRect = () => ({ top: 250, left: 0, width: 1400, height: 500, bottom: 750, right: 1400, x: 0, y: 250, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(p.getCurrentTime()).toBeCloseTo(5, 5);
    p.destroy();
    expect(document.querySelectorAll(".sceneflow-marker")).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("falls back on small screens and with reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    const mobile = new Player({ target: "#p", config: { ...scrollConfig, playback: { ...scrollConfig.playback, mobileFallback: "normal" } }, lazy: false });
    await mobile.init();
    expect(mobile.getEffectiveMode()).toBe("normal");
    expect(document.querySelector("#p .sceneflow-scroll")).toBeNull();
    mobile.destroy();

    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    const reduced = new Player({ target: "#p", config: { ...scrollConfig, playback: { ...scrollConfig.playback, reducedMotion: "poster" } }, lazy: false });
    await reduced.init();
    expect(reduced.getEffectiveMode()).toBe("poster");
    expect(document.querySelector("#p video")).toBeNull();
    expect(document.querySelector("#p .sceneflow-media img")).not.toBeNull();
    reduced.destroy();
    vi.unstubAllGlobals();
  });
});

describe("Player (scenes mode)", () => {
  it("paints scene backgrounds, shows a play button and navigates scenes via actions", async () => {
    const p = new Player({ target: "#p", config: scenesConfig, lazy: false });
    await p.init();
    const media = document.querySelector("#p .sceneflow-media") as HTMLElement;
    expect(media.style.background).toBe("rgb(255, 0, 0)");
    expect(document.querySelector("#p .sceneflow-play")).not.toBeNull();
    const changed = vi.fn();
    p.on("sceneChange", changed);
    (document.querySelector("#p [data-sceneflow-layer=go]") as HTMLElement).click();
    expect(changed).toHaveBeenCalledWith({ sceneId: "b" });
    expect(p.getCurrentTime()).toBe(2);
    expect(media.style.background).toContain("linear-gradient");
    p.seek(0.5);
    expect(p.getCurrentScene()).toBe("a");
  });
});
