import { describe, expect, it } from "vitest";
import { parseProject } from "./project.js";

/*
 * PHP decodes JSON objects to associative arrays, so a config published as `"style":{}` comes back from a PHP host
 * (the WordPress plugin before 0.5.1, any other PHP connector) as `"style":[]`. The runtime must still load it.
 */
describe("configs after a PHP JSON round trip", () => {
  const base = { schemaVersion: "1.0", projectId: "p", version: 1 };

  it("accepts [] where an empty object was published", () => {
    const r = parseProject({
      ...base,
      scenes: [
        {
          id: "s",
          name: "S",
          start: 0,
          end: 4,
          background: { type: "color", color: "#000" },
          layers: [
            { id: "hs", type: "hotspot", frame: { x: 1, y: 1, w: 4, h: 6 }, style: [], content: [], responsive: [] },
            { id: "t", type: "text", frame: { x: 1, y: 1, w: 40, h: 10 }, content: { text: "Hi" }, style: { color: "#fff" }, responsive: { tablet: [], mobile: { hidden: true } } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [hs, t] = r.project.scenes[0]!.layers;
    expect(hs!.style).toEqual({});
    expect(hs!.content).toEqual({});
    expect(hs!.responsive).toEqual({});
    expect(t!.responsive).toEqual({ tablet: {}, mobile: { hidden: true } });
    expect(t!.style).toEqual({ color: "#fff" });
  });

  it("still rejects non-empty arrays in object positions", () => {
    const r = parseProject({ ...base, scenes: [{ id: "s", name: "S", start: 0, end: 4, background: { type: "color", color: "#000" }, layers: [{ id: "l", type: "text", frame: { x: 1, y: 1, w: 4, h: 6 }, style: ["red"] }] }] });
    expect(r.ok).toBe(false);
  });
});
