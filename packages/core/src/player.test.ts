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
    expect(document.querySelector("#p .sf-media img")).not.toBeNull();
    expect(document.querySelector("#p video")).toBeNull();
    expect(document.querySelector("#p .sf-stage [data-sf-layer=cta]")).not.toBeNull();
    expect(document.querySelector("style[data-sceneflow]")).not.toBeNull();
    expect(p.getState()).toBe("ready");
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
    expect(document.querySelector("#p [data-sf-layer=cta]")).toBeNull(); // scene 2 has no layers
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
    (document.querySelector("#p [data-sf-layer=cta]") as HTMLElement).click();
    await waitFor(() => expect(ev).toHaveBeenCalled());
    expect(addToCart).toHaveBeenCalledWith({ product: { provider: "manual", productId: "182", title: "" }, quantity: 1 });
    expect(ev.mock.calls[0]![0]).toMatchObject({ productId: "182", quantity: 1, result: { ok: true } });
    const toast = document.querySelector("#p .sf-toast")!;
    expect(toast.textContent).toContain("Added to cart");
    expect(toast.querySelector("a")?.getAttribute("href")).toBe("/cart");

    // Without an adapter the link fallback has no URL for this product → error toast + event.
    const q = new Player({ target: "#p", config, lazy: false });
    await q.init();
    const ev2 = vi.fn();
    q.on("addToCart", ev2);
    (document.querySelector("#p [data-sf-layer=cta]") as HTMLElement).click();
    await waitFor(() => expect(ev2).toHaveBeenCalled());
    expect(ev2.mock.calls[0]![0].result.ok).toBe(false);
    expect(document.querySelector("#p .sf-toast[data-kind=error]")).not.toBeNull();
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
    const scroll = document.querySelector("#p .sf-scroll") as HTMLElement;
    expect(scroll.style.height).toBe("4000px");
    expect(document.querySelector("#p .sf-player.sf-pinned")).not.toBeNull();
    expect(document.querySelector("#p .sf-play")).toBeNull();
    const video = document.querySelector("#p video") as HTMLVideoElement;
    expect(video.controls).toBe(false);
    expect(video.muted).toBe(true);

    // Simulate the container starting at document top and the page scrolled half way through the usable range.
    scroll.getBoundingClientRect = () => ({ top: -1500, left: 0, width: 1400, height: 4000, bottom: 2500, right: 1400, x: 0, y: -1500, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, "scrollY", { value: 1500, configurable: true });
    const times: number[] = [];
    p.on("timeupdate", (e) => times.push(e.time));
    window.dispatchEvent(new Event("scroll"));
    expect(times[times.length - 1]).toBeCloseTo(5, 5); // 50% of a 10s video
    expect(parseFloat((document.querySelector("#p .sf-progress > i") as HTMLElement).style.width)).toBeCloseTo(50, 1);

    // scrolling back up moves time backwards
    scroll.getBoundingClientRect = () => ({ top: -750, left: 0, width: 1400, height: 4000, bottom: 3250, right: 1400, x: 0, y: -750, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, "scrollY", { value: 750, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(times[times.length - 1]).toBeCloseTo(2.5, 5);
    expect(p.getCurrentScene()).toBe("s1");
    p.play(); // no-op in scroll mode
    expect(p.getState()).toBe("ready");
    p.destroy();
    vi.unstubAllGlobals();
  });

  it("falls back on small screens and with reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    const mobile = new Player({ target: "#p", config: { ...scrollConfig, playback: { ...scrollConfig.playback, mobileFallback: "normal" } }, lazy: false });
    await mobile.init();
    expect(mobile.getEffectiveMode()).toBe("normal");
    expect(document.querySelector("#p .sf-scroll")).toBeNull();
    mobile.destroy();

    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    const reduced = new Player({ target: "#p", config: { ...scrollConfig, playback: { ...scrollConfig.playback, reducedMotion: "poster" } }, lazy: false });
    await reduced.init();
    expect(reduced.getEffectiveMode()).toBe("poster");
    expect(document.querySelector("#p video")).toBeNull();
    expect(document.querySelector("#p .sf-media img")).not.toBeNull();
    reduced.destroy();
    vi.unstubAllGlobals();
  });
});

describe("Player (scenes mode)", () => {
  it("paints scene backgrounds, shows a play button and navigates scenes via actions", async () => {
    const p = new Player({ target: "#p", config: scenesConfig, lazy: false });
    await p.init();
    const media = document.querySelector("#p .sf-media") as HTMLElement;
    expect(media.style.background).toBe("rgb(255, 0, 0)");
    expect(document.querySelector("#p .sf-play")).not.toBeNull();
    const changed = vi.fn();
    p.on("sceneChange", changed);
    (document.querySelector("#p [data-sf-layer=go]") as HTMLElement).click();
    expect(changed).toHaveBeenCalledWith({ sceneId: "b" });
    expect(p.getCurrentTime()).toBe(2);
    expect(media.style.background).toContain("linear-gradient");
    p.seek(0.5);
    expect(p.getCurrentScene()).toBe("a");
  });
});
