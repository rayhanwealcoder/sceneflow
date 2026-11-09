import { describe, expect, it } from "vitest";
import { parseProject } from "@sceneflow/schema";
import { createProjectFromTemplate, TEMPLATES } from "./templates.js";

describe("templates", () => {
  it("every template builds a valid project with unique ids", () => {
    for (const t of TEMPLATES) {
      const project = t.build("p-test");
      const r = parseProject(project);
      expect(r.ok, `${t.id}: ${JSON.stringify(!r.ok && r.issues)}`).toBe(true);
      const ids = project.scenes.flatMap((s) => [s.id, ...s.layers.map((l) => l.id)]);
      expect(new Set(ids).size).toBe(ids.length);
      // Scenes are contiguous from 0.
      let t0 = 0;
      for (const s of project.scenes) {
        expect(s.start).toBe(t0);
        t0 = s.end;
      }
    }
  });

  it("shoppable has a product card, scroll story uses scroll playback, unknown ids fall back to blank", () => {
    expect(createProjectFromTemplate("shoppable", "p").scenes[0]!.layers.some((l) => l.type === "product")).toBe(true);
    const scroll = createProjectFromTemplate("scroll-story", "p");
    expect(scroll.playback.mode).toBe("scroll");
    expect(scroll.playback.showProgress).toBe(true);
    expect(createProjectFromTemplate("nope", "p").scenes[0]!.layers).toHaveLength(0);
  });
});
