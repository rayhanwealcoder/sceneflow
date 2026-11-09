import { Player } from "./player.js";

/*
 * Plain embed (Webflow, Squarespace, static HTML, any CMS without a connector): one script tag and one
 * element per video.
 *
 *   <script src="https://api.example.com/runtime/sceneflow.runtime.min.js" data-auto defer></script>
 *   <div data-sceneflow-id="PROJECT_ID"></div>
 *
 * `data-auto` mounts every `[data-sceneflow-id]` once the DOM is ready; the config URL comes from
 * `data-sceneflow-config`, else from `data-api` on the script / `data-sceneflow-api` on the element, else from
 * the origin the runtime was loaded from. Platforms with their own bootstrap (the WordPress plugin) do not set
 * `data-auto` and keep calling `new SceneFlow.Player()` themselves.
 */

export interface MountOptions {
  /** API origin that serves `/p/<id>.json`; default: where the runtime script was loaded from. */
  api?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function scriptEl(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current) return current;
  return document.querySelector<HTMLScriptElement>('script[src*="sceneflow.runtime"]');
}

const runtimeScript = typeof document !== "undefined" ? scriptEl() : null;

function apiOrigin(explicit?: string): string {
  const fromScript = runtimeScript?.dataset.api;
  if (explicit) return explicit.replace(/\/$/, "");
  if (fromScript) return fromScript.replace(/\/$/, "");
  try {
    return new URL(runtimeScript?.src ?? "", location.href).origin;
  } catch {
    return "";
  }
}

/** Mounts a player into every `[data-sceneflow-id]` element under `root` that has none yet. Returns the new players. */
export function mount(root: ParentNode = document, options: MountOptions = {}): Player[] {
  const players: Player[] = [];
  const nodes = root.querySelectorAll<HTMLElement>("[data-sceneflow-id]:not([data-sceneflow-ready])");
  nodes.forEach((node) => {
    const id = node.dataset.sceneflowId ?? "";
    if (!ID_RE.test(id)) return;
    node.setAttribute("data-sceneflow-ready", "1");
    const configUrl = node.dataset.sceneflowConfig || `${apiOrigin(node.dataset.sceneflowApi || options.api)}/p/${id}.json`;
    const player = new Player({ target: node, configUrl });
    void player.init();
    (node as HTMLElement & { sceneflowPlayer?: Player }).sceneflowPlayer = player;
    players.push(player);
  });
  return players;
}

/**
 * `<script … data-auto>`: mount when the DOM is ready. When the script runs deferred (readyState is
 * already "interactive"), wait one tick so sibling deferred scripts (e.g. the Shopify adapter) register first.
 */
if (runtimeScript && runtimeScript.dataset.auto !== undefined) {
  const run = () => void mount();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else setTimeout(run, 0);
}
