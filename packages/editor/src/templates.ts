import { playbackSchema, type BrandKit, type Project, type Scene } from "@sceneflow/schema";
import { applyBrandKit } from "./brand.js";
import { createLayer } from "./defaults.js";
import { newId } from "./ids.js";

/*
 * Starter templates (doc: "template-first onboarding"). Each one is a finished-looking project built from
 * placeholders, so a first-time user starts from something that already works and only swaps in their
 * own video, product and words. The guided tour in the editor points at the parts to change.
 */

export type TemplateId = "shoppable" | "explainer" | "scroll-story" | "blank";

export interface Template {
  id: TemplateId;
  title: string;
  /** What the user is trying to achieve, in their words. */
  goal: string;
  description: string;
  /** Short list the onboarding shows as "what you will do". */
  steps: string[];
  build(projectId: string): Project;
}

const scene = (name: string, start: number, duration: number, background: Scene["background"], layers: Scene["layers"]): Scene => ({
  id: newId("s"),
  name,
  start,
  end: start + duration,
  background,
  layers,
  transition: { type: "fade", duration: 0.3 },
});

const base = (projectId: string, mode: Project["playback"]["mode"]): Omit<Project, "scenes"> => ({
  schemaVersion: "1.0",
  projectId,
  version: 1,
  canvas: { aspectRatio: "16:9", background: "#000" },
  playback: playbackSchema.parse({ mode }),
});

export const TEMPLATES: Template[] = [
  {
    id: "shoppable",
    title: "Sell a product from a video",
    goal: "I want visitors to buy while they watch",
    description: "A product card with live price and an Add to cart button sits over your video. Works with WooCommerce, or any product link.",
    steps: ["Replace the background with your video", "Pick your product", "Publish to your site"],
    build: (projectId) => ({
      ...base(projectId, "click"),
      scenes: [
        scene("Showcase", 0, 8, { type: "gradient", css: "linear-gradient(135deg, #0f172a, #4f46e5)" }, [
          createLayer("badge", { content: { text: "NEW" }, frame: { x: 6, y: 8, w: 14, h: 8, rotation: 0 } }),
          createLayer("text", { content: { text: "Meet the product your customers will love" }, frame: { x: 6, y: 20, w: 50, h: 30, rotation: 0 }, style: { color: "#ffffff", fontSize: 48, fontWeight: 800, textAlign: "left", textShadow: "0 2px 12px rgba(0,0,0,.45)" } }),
          createLayer("text", { name: "Subtitle", content: { text: "Swap this background for your video, then pick a product on the right." }, frame: { x: 6, y: 54, w: 48, h: 14, rotation: 0 }, style: { color: "rgba(255,255,255,.85)", fontSize: 20, fontWeight: 500, textAlign: "left" } }),
          createLayer("product", { frame: { x: 62, y: 8, w: 32, h: 84, rotation: 0 } }),
        ]),
      ],
    }),
  },
  {
    id: "explainer",
    title: "Explain something interactively",
    goal: "I want viewers to click around and learn",
    description: "Hotspots with tooltips over your video, a headline, and a button that replays. Great for features, tours and how-tos.",
    steps: ["Replace the background with your video", "Move the hotspots onto what you want to explain", "Publish"],
    build: (projectId) => {
      const intro = scene("Overview", 0, 6, { type: "gradient", css: "linear-gradient(135deg, #111827, #0e7490)" }, [
        createLayer("text", { content: { text: "Three things worth knowing" }, frame: { x: 6, y: 10, w: 60, h: 18, rotation: 0 }, style: { color: "#ffffff", fontSize: 46, fontWeight: 800, textAlign: "left", textShadow: "0 2px 12px rgba(0,0,0,.45)" } }),
        createLayer("hotspot", { content: { tooltip: "Tap a hotspot to see a detail" }, frame: { x: 30, y: 50, w: 4, h: 7, rotation: 0 } }),
        createLayer("hotspot", { content: { tooltip: "Move me onto the thing you want to explain" }, frame: { x: 58, y: 40, w: 4, h: 7, rotation: 0 } }),
        createLayer("hotspot", { content: { tooltip: "Hotspots can also open links or jump to a scene" }, frame: { x: 76, y: 66, w: 4, h: 7, rotation: 0 } }),
      ]);
      const outro = scene("Wrap up", 6, 4, { type: "color", color: "#111827" }, [
        createLayer("text", { content: { text: "That's it. Want to see it again?" }, frame: { x: 10, y: 30, w: 80, h: 20, rotation: 0 }, style: { color: "#ffffff", fontSize: 40, fontWeight: 700, textAlign: "center" } }),
        createLayer("button", { content: { label: "Replay" }, frame: { x: 37, y: 60, w: 26, h: 12, rotation: 0 }, action: { type: "GO_TO_SCENE", sceneId: intro.id } }),
      ]);
      return { ...base(projectId, "click"), scenes: [intro, outro] };
    },
  },
  {
    id: "scroll-story",
    title: "Scroll-driven story",
    goal: "I want the video to move as people scroll",
    description: "Three chapters that play forwards and backwards with the page scroll, text appearing in time. Pinned player, progress bar on.",
    steps: ["Replace the backgrounds with your clip", "Edit the chapter texts", "Publish and scroll"],
    build: (projectId) => ({
      ...base(projectId, "scroll"),
      playback: playbackSchema.parse({ mode: "scroll", pin: true, scrollDistance: "300vh", showProgress: true, smoothness: 0.3 }),
      scenes: [
        scene("Chapter 1", 0, 4, { type: "gradient", css: "linear-gradient(180deg, #1e1b4b, #312e81)" }, [
          createLayer("text", { content: { text: "Scroll to begin" }, frame: { x: 10, y: 38, w: 80, h: 22, rotation: 0 }, style: { color: "#ffffff", fontSize: 56, fontWeight: 800, textAlign: "center" }, animation: { in: { type: "fade", duration: 1, delay: 0 } } }),
        ]),
        scene("Chapter 2", 4, 4, { type: "gradient", css: "linear-gradient(180deg, #312e81, #0e7490)" }, [
          createLayer("text", { content: { text: "Each chapter is a scene — text appears as the visitor scrolls" }, frame: { x: 8, y: 30, w: 60, h: 34, rotation: 0 }, style: { color: "#ffffff", fontSize: 40, fontWeight: 700, textAlign: "left" }, animation: { in: { type: "slide-up", duration: 0.8, delay: 0 } } }),
        ]),
        scene("Chapter 3", 8, 4, { type: "gradient", css: "linear-gradient(180deg, #0e7490, #065f46)" }, [
          createLayer("text", { content: { text: "End with a call to action" }, frame: { x: 10, y: 28, w: 80, h: 22, rotation: 0 }, style: { color: "#ffffff", fontSize: 48, fontWeight: 800, textAlign: "center" }, animation: { in: { type: "zoom", duration: 0.8, delay: 0 } } }),
          createLayer("button", { content: { label: "Learn more" }, frame: { x: 37, y: 62, w: 26, h: 12, rotation: 0 }, action: { type: "OPEN_URL", url: "https://example.com", newTab: true }, animation: { in: { type: "fade", duration: 0.6, delay: 0.5 } } }),
        ]),
      ],
    }),
  },
  {
    id: "blank",
    title: "Start from scratch",
    goal: "I know what I want to build",
    description: "One empty scene. Add your own video, elements and timing.",
    steps: ["Add a video or image background", "Add elements", "Publish"],
    build: (projectId) => ({ ...base(projectId, "click"), scenes: [scene("Scene 1", 0, 5, { type: "color", color: "#111827" }, [])] }),
  },
];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Builds a project document from a template (falls back to blank for unknown ids), branded when a kit is given. */
export function createProjectFromTemplate(id: string, projectId: string, brand?: { kit: BrandKit; ref?: { kitId: string; version: number } } | null): Project {
  const project = (getTemplate(id) ?? TEMPLATES[TEMPLATES.length - 1]!).build(projectId);
  return brand ? applyBrandKit(project, brand.kit, brand.ref) : project;
}
