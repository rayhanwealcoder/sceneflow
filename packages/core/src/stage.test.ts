import { beforeEach, describe, expect, it, vi } from "vitest";
import { playbackSchema, type Project } from "@sceneflow/schema";
import { Stage } from "./stage.js";

const project: Project = {
  schemaVersion: "1.0",
  projectId: "p",
  version: 1,
  canvas: { aspectRatio: "16:9", background: "#000" },
  playback: playbackSchema.parse({ mode: "normal" }),
  scenes: [
    {
      id: "s1",
      name: "One",
      start: 0,
      end: 10,
      background: { type: "color", color: "#000" },
      transition: { type: "none", duration: 0 },
      layers: [
        { id: "t", type: "text", frame: { x: 10, y: 20, w: 50, h: 10, rotation: 0 }, locked: false, hidden: false, content: { text: "Hello <b>x</b>" }, style: { fontSize: 40, color: "#fff" }, responsive: { mobile: { frame: { x: 0, w: 100 }, style: { fontSize: 24 } } } },
        { id: "b", type: "button", frame: { x: 10, y: 80, w: 30, h: 10, rotation: 5 }, locked: false, hidden: false, content: { label: "Buy" }, style: { background: "#f00" }, action: { type: "OPEN_CART" }, start: 2, end: 6 },
        { id: "h", type: "shape", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, locked: false, hidden: true, content: {}, style: {} },
      ],
    },
  ],
};

beforeEach(() => {
  document.body.innerHTML = '<div id="p" style="width:640px"></div>';
  vi.stubGlobal("ResizeObserver", undefined);
});

describe("Stage", () => {
  it("renders layers with percent geometry, scaled styles and safe text", () => {
    const stage = new Stage(document.getElementById("p")!, { device: "desktop" });
    stage.render(project, "s1", null);
    const text = stage.layerElement("t")!;
    expect(text.style.left).toBe("10%");
    expect(text.style.width).toBe("50%");
    expect(text.style.fontSize).toBe("calc(40px * var(--sceneflow-scale))");
    expect(text.textContent).toBe("Hello <b>x</b>");
    expect(text.querySelector("b")).toBeNull();
    const btn = stage.layerElement("b")!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.style.transform).toBe("rotate(5deg)");
    expect(btn.dataset.sceneflowAction).toBe("OPEN_CART");
    expect(stage.layerElement("h")).toBeUndefined(); // hidden layers are not rendered
  });

  it("applies responsive overrides per device", () => {
    const stage = new Stage(document.getElementById("p")!, { device: "mobile" });
    stage.render(project, "s1", null);
    const text = stage.layerElement("t")!;
    expect(text.style.left).toBe("0%");
    expect(text.style.width).toBe("100%");
    expect(text.style.fontSize).toBe("calc(24px * var(--sceneflow-scale))");
    stage.setDevice("desktop");
    expect(stage.layerElement("t")!.style.width).toBe("50%");
  });

  it("toggles visibility by time and runtime toggles", () => {
    const stage = new Stage(document.getElementById("p")!, { device: "desktop" });
    stage.render(project, "s1", 0);
    expect(stage.layerElement("b")!.style.visibility).toBe("hidden");
    stage.tick(3);
    expect(stage.layerElement("b")!.style.visibility).toBe("");
    stage.tick(7);
    expect(stage.layerElement("b")!.style.visibility).toBe("hidden");
    stage.tick(3);
    stage.toggleLayer("b");
    expect(stage.layerElement("b")!.style.visibility).toBe("hidden");
  });

  it("applies enter/exit motion as a function of time and previews it while editing", () => {
    const animated: Project = {
      ...project,
      scenes: [{ ...project.scenes[0]!, layers: [{ ...project.scenes[0]!.layers[0]!, animation: { in: { type: "slide-up", duration: 1, delay: 0 } } }] }],
    };
    const stage = new Stage(document.getElementById("p")!, { device: "desktop" });
    stage.render(animated, "s1", 0);
    const el = stage.layerElement("t")!;
    expect(el.style.opacity).toBe("0");
    expect(el.style.transform).toContain("translate(");
    stage.tick(0.5);
    expect(Number(el.style.opacity)).toBeGreaterThan(0.5);
    stage.tick(5);
    expect(el.style.opacity).toBe("");
    expect(el.style.transform).toBe("");
    stage.tick(0); // scrubbing backwards restores the start state
    expect(el.style.opacity).toBe("0");

    const es = new Stage(document.getElementById("p")!, { device: "desktop", editing: true });
    es.render(animated, "s1", 0);
    expect(es.layerElement("t")!.style.opacity).toBe(""); // resting state without a preview time
    es.setPreviewTime(0);
    expect(es.layerElement("t")!.style.opacity).toBe("0");
    es.setPreviewTime(null);
    expect(es.layerElement("t")!.style.opacity).toBe("");
  });

  it("dispatches actions on click unless editing", () => {
    const onAction = vi.fn();
    const stage = new Stage(document.getElementById("p")!, { device: "desktop", onAction });
    stage.render(project, "s1", 3);
    stage.layerElement("b")!.click();
    expect(onAction).toHaveBeenCalledWith({ type: "OPEN_CART" }, expect.objectContaining({ id: "b" }));

    const editing = vi.fn();
    const es = new Stage(document.getElementById("p")!, { device: "desktop", editing: true, onAction: editing });
    es.render(project, "s1", 7);
    expect(es.layerElement("b")!.style.visibility).toBe(""); // editing ignores timing
    es.layerElement("b")!.click();
    expect(editing).not.toHaveBeenCalled();
  });
});
