import { describe, expect, it } from "vitest";
import { parseProject } from "./index.js";

const scene = { id: "s1", name: "A", start: 0, end: 5, background: { type: "color", color: "#000" } };
const base = { schemaVersion: "1.0", projectId: "p1", version: 1, scenes: [scene] };
const withLayer = (layer: unknown, bg: unknown = scene.background) => ({
  ...base,
  scenes: [{ ...scene, background: bg, layers: [layer] }],
});
const frame = { x: 0, y: 0, w: 10, h: 10 };

describe("parseProject", () => {
  it("accepts a minimal valid project and applies defaults", () => {
    const r = parseProject(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.playback.mode).toBe("normal");
  });

  it("rejects unsupported major version", () => {
    const r = parseProject({ ...base, schemaVersion: "2.0" });
    expect(!r.ok && r.code).toBe("UNSUPPORTED_VERSION");
  });

  it("rejects javascript: URLs", () => {
    const r = parseProject({ ...base, video: { provider: "x", assetId: "a", src: "javascript:alert(1)", duration: 1 } });
    expect(r.ok).toBe(false);
  });

  it("rejects data: URLs on layers", () => {
    expect(parseProject(withLayer({ id: "l1", type: "image", frame, src: "data:text/html,x" })).ok).toBe(false);
  });

  it("rejects unknown action types (no custom code)", () => {
    expect(parseProject(withLayer({ id: "l1", type: "button", frame, action: { type: "EVAL", code: "alert(1)" } })).ok).toBe(false);
  });

  it("accepts ADD_TO_CART and defaults quantity to 1", () => {
    const r = parseProject(withLayer({ id: "l1", type: "commerce-button", frame, action: { type: "ADD_TO_CART", productId: "182" } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.project.scenes[0]!.layers[0]!.action;
      expect(a && a.type === "ADD_TO_CART" && a.quantity).toBe(1);
    }
  });

  it("rejects duplicate scene ids and bad scene timing", () => {
    expect(parseProject({ ...base, scenes: [scene, scene] }).ok).toBe(false);
    expect(parseProject({ ...base, scenes: [{ ...scene, end: 0 }] }).ok).toBe(false);
  });

  it("rejects invalid and oversize JSON strings", () => {
    const bad = parseProject("{nope");
    expect(!bad.ok && bad.code).toBe("INVALID_JSON");
    const big = parseProject(JSON.stringify({ ...base, pad: "x".repeat(600_000) }));
    expect(!big.ok && big.code).toBe("TOO_LARGE");
  });

  it("strips unknown fields", () => {
    const r = parseProject({ ...base, futureThing: 1 });
    expect(r.ok && "futureThing" in r.project).toBe(false);
  });

  it("rejects CSS injection in gradients", () => {
    const r = parseProject(withLayer({ id: "l1", type: "text", frame }, { type: "gradient", css: "linear-gradient(red,blue);} body{display:none" }));
    expect(r.ok).toBe(false);
  });
});
