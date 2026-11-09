import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics, analyticsAllowed, Player } from "./index.js";

const config = {
  schemaVersion: "1.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  version: 3,
  analytics: { endpoint: "https://api.test/api/v1/analytics/events" },
  playback: { mode: "click" },
  scenes: [
    { id: "a", name: "A", start: 0, end: 2, background: { type: "color", color: "#000" }, layers: [{ id: "btn", type: "button", frame: { x: 0, y: 0, w: 20, h: 10 }, content: { label: "Go" }, action: { type: "GO_TO_SCENE", sceneId: "b" } }] },
    { id: "b", name: "B", start: 2, end: 4, background: { type: "color", color: "#111" }, layers: [{ id: "hs", type: "hotspot", frame: { x: 10, y: 10, w: 4, h: 7 }, content: { tooltip: "Tip" }, action: { type: "OPEN_URL", url: "https://example.com", newTab: true } }] },
  ],
};

const sent: Array<{ url: string; body: unknown }> = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return new Response(null, { status: 204 });
});

beforeEach(() => {
  sent.length = 0;
  document.body.innerHTML = '<div id="p"></div>';
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); disconnect = vi.fn(); });
  vi.stubGlobal("open", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("analytics client", () => {
  it("batches events into one text/plain POST and keeps a per-tab session id", async () => {
    const a = new Analytics({ endpoint: "https://api.test/e", projectId: "p", flushMs: 10, fetch: fetchMock as unknown as typeof fetch });
    a.track("player_loaded");
    a.track("video_play", { t: 1.234, sceneId: "a" });
    expect(sent).toHaveLength(0);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0]!.body as { sessionId: string; events: Array<{ type: string; t?: number; id: string }> };
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(body.events.map((e) => e.type)).toEqual(["player_loaded", "video_play"]);
    expect(body.events[1]!.t).toBe(1.23);
    expect(new Set(body.events.map((e) => e.id)).size).toBe(2);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ "content-type": "text/plain;charset=UTF-8" });
    const b = new Analytics({ endpoint: "https://api.test/e", projectId: "p", fetch: fetchMock as unknown as typeof fetch });
    expect(b.sessionId).toBe(a.sessionId); // same tab → same session
  });

  it("turns watched time into ranges, splitting on jumps", async () => {
    const a = new Analytics({ endpoint: "https://api.test/e", projectId: "p", flushMs: 10, fetch: fetchMock as unknown as typeof fetch });
    a.startWatch(0);
    for (let i = 1; i <= 15; i++) a.tickWatch(i * 0.2);
    a.tickWatch(8); // seek: closes [0,3], opens at 8
    a.tickWatch(8.5);
    a.endWatch();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const ranges = (sent[0]!.body as { events: Array<{ type: string; payload: { from: number; to: number } }> }).events.filter((e) => e.type === "watch").map((e) => [e.payload.from, e.payload.to]);
    expect(ranges).toEqual([
      [0, 3],
      [8, 8.5],
    ]);
  });

  it("respects Do Not Track", () => {
    expect(analyticsAllowed({ doNotTrack: "1" })).toBe(false);
    expect(analyticsAllowed({ globalPrivacyControl: true })).toBe(false);
    expect(analyticsAllowed({ doNotTrack: null } as unknown as Navigator)).toBe(true);
  });
});

describe("player events", () => {
  it("reports load, play, scene changes, impressions, clicks and completion to the configured endpoint", async () => {
    const p = new Player({ target: "#p", config, lazy: false });
    await p.init();
    p.play();
    // Click the button on scene A → GO_TO_SCENE b (element_click + scene_exit/enter + impression of the hotspot).
    (document.querySelector("#p [data-sf-layer=btn]") as HTMLElement).click();
    p.pause();
    p.destroy(); // flushes
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const events = sent.flatMap((s) => (s.body as { events: Array<{ type: string; layerId?: string; sceneId?: string }> }).events);
    const types = events.map((e) => e.type);
    expect(sent[0]!.url).toBe("https://api.test/api/v1/analytics/events");
    expect((sent[0]!.body as { projectId: string; version: number }).projectId).toBe(config.projectId);
    expect((sent[0]!.body as { version: number }).version).toBe(3);
    expect(types[0]).toBe("player_loaded");
    expect(types).toContain("video_play");
    expect(types).toContain("element_click");
    expect(types).toContain("scene_exit");
    expect(types.filter((t) => t === "scene_enter").length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === "element_impression" && e.layerId === "hs")).toBe(true);
    expect(types).toContain("video_pause");
  });

  it("stays silent when disabled, when no endpoint is published, or under Do Not Track", async () => {
    const off = new Player({ target: "#p", config, lazy: false, analytics: false });
    await off.init();
    off.destroy();
    const none = new Player({ target: "#p", config: { ...config, analytics: undefined }, lazy: false });
    await none.init();
    none.destroy();
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    const dnt = new Player({ target: "#p", config, lazy: false });
    await dnt.init();
    dnt.destroy();
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
  });
});
