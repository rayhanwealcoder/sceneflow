import { beforeEach, describe, expect, it, vi } from "vitest";
import { Player } from "./index.js";

const config = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  projectId: "cap",
  version: 1,
  playback: { mode: "click" },
  captions: { language: "en", cues: [{ start: 0, end: 2, text: "Hello" }, { start: 2, end: 4, text: "World" }], style: { position: "top", size: "l" } },
  scenes: [
    { id: "a", name: "A", start: 0, end: 3, background: { type: "color", color: "#000" } },
    { id: "b", name: "B", start: 3, end: 6, background: { type: "color", color: "#111" } },
  ],
  ...extra,
});

beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div>';
  localStorage.clear();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); disconnect = vi.fn(); });
});

describe("captions in the runtime", () => {
  it("shows the cue for the current time, follows seeks across scenes and styles from the config", async () => {
    const p = new Player({ target: "#p", config: config(), lazy: false });
    await p.init();
    const el = document.querySelector<HTMLElement>("#p .sceneflow-captions")!;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe("Hello");
    expect(el.dataset.sceneflowPos).toBe("top");
    expect(el.dataset.sceneflowSize).toBe("l");
    expect(el.lang).toBe("en");
    p.seek(2.5);
    expect(el.textContent).toBe("World");
    p.seek(3.5); // scene B, cue still running until 4 s
    expect(el.textContent).toBe("World");
    p.seek(5);
    expect(el.textContent).toBe("");
    expect(document.querySelector("#p .sceneflow-root")!.getAttribute("data-sceneflow-cc")).toBe("on");
  });

  it("CC button toggles captions, remembers the choice and emits an event", async () => {
    const p = new Player({ target: "#p", config: config(), lazy: false });
    await p.init();
    const changed = vi.fn();
    p.on("captionsChange", changed);
    const btn = document.querySelector<HTMLButtonElement>("#p .sceneflow-cc")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    btn.click();
    expect(p.getCaptionsEnabled()).toBe(false);
    expect(document.querySelector("#p .sceneflow-root")!.getAttribute("data-sceneflow-cc")).toBe("off");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(changed).toHaveBeenCalledWith({ enabled: false });
    expect(localStorage.getItem("sceneflow_cc")).toBe("off");
    p.destroy();
    // A later player on the same browser starts with captions hidden.
    document.body.innerHTML = '<div id="p"></div>';
    const p2 = new Player({ target: "#p", config: config(), lazy: false });
    await p2.init();
    expect(p2.getCaptionsEnabled()).toBe(false);
    expect(document.querySelector("#p .sceneflow-root")!.getAttribute("data-sceneflow-cc")).toBe("off");
    p2.setCaptionsEnabled(true);
    expect(localStorage.getItem("sceneflow_cc")).toBe("on");
  });

  it("renders nothing when the project has no cues or turned captions off", async () => {
    const off = new Player({ target: "#p", config: config({ playback: { mode: "click", captions: false } }), lazy: false });
    await off.init();
    expect(document.querySelector("#p .sceneflow-captions")).toBeNull();
    expect(document.querySelector("#p .sceneflow-cc")).toBeNull();
    off.destroy();
    document.body.innerHTML = '<div id="p"></div>';
    const none = new Player({ target: "#p", config: config({ captions: undefined }), lazy: false });
    await none.init();
    expect(document.querySelector("#p .sceneflow-captions")).toBeNull();
  });
});
