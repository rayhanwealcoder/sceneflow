import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureFonts, mount, Player } from "./index.js";

const config = {
  schemaVersion: "1.0",
  projectId: "p1",
  version: 1,
  fonts: { google: ["Poppins", "Playfair Display"] },
  scenes: [{ id: "s1", name: "A", start: 0, end: 3, background: { type: "color", color: "#000" }, layers: [{ id: "t", type: "text", frame: { x: 0, y: 0, w: 50, h: 20 }, content: { text: "Hi" }, style: { fontFamily: '"Poppins", sans-serif' } }] }],
};

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

describe("web fonts (brand kit opt-in)", () => {
  it("adds one Google Fonts stylesheet per family, once, and ignores unsafe names", () => {
    ensureFonts(["Poppins", "Playfair Display", "Poppins", "Bad&name=1"]);
    const links = Array.from(document.head.querySelectorAll("link[rel=stylesheet]")).map((l) => l.getAttribute("href"));
    expect(links).toEqual(["https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap", "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800;900&display=swap"]);
    ensureFonts(["Poppins"]);
    expect(document.head.querySelectorAll("link[rel=stylesheet]")).toHaveLength(2);
  });

  it("the player loads the project's fonts when it mounts", async () => {
    document.body.innerHTML = '<div id="p"></div>';
    const p = new Player({ target: "#p", config });
    await p.init();
    expect(document.getElementById("sceneflow-font-poppins")).not.toBeNull();
    expect(document.getElementById("sceneflow-font-playfair-display")).not.toBeNull();
    expect((document.querySelector("#p [data-sceneflow-layer=t]") as HTMLElement).style.fontFamily).toContain("Poppins");
  });
});

describe("plain embed", () => {
  it("mounts every [data-sceneflow-id] once, building the config URL from the element or the api option", async () => {
    document.body.innerHTML = '<div data-sceneflow-id="11111111-1111-4111-8111-111111111111"></div><div data-sceneflow-id="abc" data-sceneflow-config="https://cdn.test/custom.json"></div><div data-sceneflow-id="bad id!"></div>';
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ ...config, fonts: undefined }), { status: 200, headers: { "content-type": "application/json" } }) as Response & { url: string });
    vi.stubGlobal("fetch", fetchMock);
    const players = mount(document, { api: "https://api.test/" });
    expect(players).toHaveLength(2);
    expect(mount(document, { api: "https://api.test" })).toHaveLength(0); // already mounted
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).sort();
    expect(urls).toEqual(["https://api.test/p/11111111-1111-4111-8111-111111111111.json", "https://cdn.test/custom.json"]);
    expect(document.querySelectorAll("[data-sceneflow-ready]")).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
