"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@sceneflow/schema";
import { api, errorMessage } from "@/lib/api";
import { useEditor } from "@/lib/editorStore";
import { usePlayhead } from "@/lib/playhead";
import { useSession } from "@/lib/session";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { ScenesPanel } from "./ScenesPanel";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";
import { markTourSeen, Tour, tourSeen, type TourStep } from "./Tour";

const AUTOSAVE_MS = 1200;
/** Doc 11.4: project JSON should normally stay under 100 KB (media excluded). */
const SIZE_WARN_KB = 100;

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

function tourSteps(project: Project): TourStep[] {
  const hasProduct = project.scenes.some((s) => s.layers.some((l) => l.type === "product"));
  const steps: TourStep[] = [
    { target: "canvas", title: "This is what visitors see", body: "Drag anything to move it, pull a corner to resize. Click an empty spot to edit the scene — that is where you swap the background for your own video.", placement: "right" },
    { target: "elements", title: "Add elements", body: "Text, buttons, images, hotspots, a product card… click one and it lands on the canvas with sensible defaults.", placement: "right" },
    { target: "inspector", title: "Everything about the selected element lives here", body: "Content, style, position, motion and what happens on click. Nothing is hidden in menus.", placement: "left" },
  ];
  if (hasProduct) steps.push({ target: "inspector", title: "Pick your product", body: "Select the product card on the canvas, then “Choose a product”. With WooCommerce connected you get live prices and real add-to-cart; otherwise add a product with a link.", placement: "left" });
  steps.push(
    { target: "device", title: "Check phones and tablets", body: "Switch devices here. Changes you make on a device only affect that device; the rest inherits from desktop.", placement: "bottom" },
    { target: "publish", title: "Preview, then publish", body: "Preview shows the real player. Publish pushes it to your site — the shortcode never changes, so you can publish updates any time.", placement: "bottom" },
  );
  return steps;
}

export function Editor({ projectId, projectName, workspaceId, siteId, initialProject, savedVersion }: { projectId: string; projectName: string; workspaceId: string; siteId: string | null; initialProject: Project; savedVersion: number | null }) {
  const store = useEditor();
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useSession();
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const [sizeKb, setSizeKb] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const tourKey = `sf_tour_editor_${user?.id ?? "anon"}`;

  useEffect(() => {
    store.load(initialProject, savedVersion);
    usePlayhead.getState().pause();
    usePlayhead.setState({ time: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // First visit (or ?tour=1): start the guided tour once the editor has painted.
  useEffect(() => {
    if (!user || !store.loaded) return;
    if (params.get("tour") === "1" || !tourSeen(tourKey)) {
      const t = setTimeout(() => setTourIndex(0), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, store.loaded]);

  // Autosave: debounce after the last change; never while a drag is in progress.
  const { project, saveState, gesture, loaded, mode, sceneId } = store;
  useEffect(() => {
    if (!loaded || saveState !== "unsaved" || gesture.active) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, saveState, gesture.active, loaded]);

  // Project JSON size (doc 11.4 budget), measured lazily so typing stays smooth.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => setSizeKb(Math.round(new Blob([JSON.stringify(project)]).size / 1024)), 600);
    return () => clearTimeout(t);
  }, [project, loaded]);

  // Keep the playhead inside the scene the user is looking at; stop playback when leaving Advanced mode.
  useEffect(() => {
    const scene = project.scenes.find((s) => s.id === sceneId);
    const ph = usePlayhead.getState();
    if (scene && (ph.time < scene.start || ph.time >= scene.end)) ph.setTime(scene.start, { follow: false });
  }, [sceneId, project.scenes]);
  useEffect(() => {
    if (mode !== "advanced") usePlayhead.getState().pause();
  }, [mode]);

  async function save(): Promise<void> {
    if (inflight.current) return inflight.current;
    const snapshot = useEditor.getState().project;
    useEditor.getState().setSaveState("saving");
    inflight.current = api<{ version: number }>(`/api/v1/projects/${projectId}/draft`, { method: "PUT", json: { config: snapshot } })
      .then((r) => {
        const s = useEditor.getState();
        s.setSaveState(s.project === snapshot ? "saved" : "unsaved", r.version);
      })
      .catch((err) => {
        useEditor.getState().setSaveState("error");
        setNotice(errorMessage(err));
        setTimeout(() => useEditor.getState().setSaveState("unsaved"), 4000);
      })
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }

  async function publish() {
    setPublishing(true);
    setNotice(null);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (useEditor.getState().saveState !== "saved") await save();
      const r = await api<{ publishedVersion: number; sites: Array<{ siteName: string | null; ok: boolean; error?: string }>; media?: { hdPending: number } }>(`/api/v1/projects/${projectId}/publish`, { method: "POST", json: {} });
      const failed = r.sites.find((s) => !s.ok);
      const hd = r.media?.hdPending ? " HD versions are still being prepared — publish again later to ship them." : "";
      setNotice(failed ? `Published v${r.publishedVersion}, but ${failed.siteName ?? "the site"} could not be updated: ${failed.error}` : `Published v${r.publishedVersion}${r.sites.length ? ` and pushed to ${r.sites[0]!.siteName ?? "your site"}` : ""}.${hd}`);
      router.refresh();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  async function previewOnSite() {
    setNotice(null);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (useEditor.getState().saveState !== "saved") await save();
      const r = await api<{ previewUrl: string }>(`/api/v1/projects/${projectId}/preview-session`, { method: "POST", json: {} });
      window.open(r.previewUrl, "_blank", "noopener");
    } catch (err) {
      setNotice(errorMessage(err));
    }
  }

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || tourIndex !== null) return;
      const s = useEditor.getState();
      const ph = usePlayhead.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) return void (e.preventDefault(), s.undo());
      if ((mod && k === "y") || (mod && e.shiftKey && k === "z")) return void (e.preventDefault(), s.redo());
      if (mod && k === "d") return void (e.preventDefault(), s.duplicateSelected());
      if (mod && k === "c") return void s.copy();
      if (mod && k === "v") return void s.paste();
      if (mod && k === "s") return void (e.preventDefault(), save());
      if (e.key === " " && s.mode === "advanced") return void (e.preventDefault(), ph.toggle());
      if (e.key === "Home" && s.mode === "advanced") return void (e.preventDefault(), ph.setTime(0));
      if (e.key === "Delete" || e.key === "Backspace") return void (e.preventDefault(), s.removeSelected());
      if (e.key === "Escape") return void s.select([]);
      if (e.key.startsWith("Arrow") && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 0.5;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const scene = s.project.scenes.find((sc) => sc.id === s.sceneId);
        for (const id of s.selection) {
          const l = scene?.layers.find((x) => x.id === id);
          if (!l || l.locked) continue;
          const f = l.frame;
          s.updateLayerForDevice(id, { frame: { x: f.x + dx, y: f.y + dy } });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourIndex]);

  // Warn before leaving with unsaved work.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().saveState !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const steps = useMemo(() => tourSteps(project), [project]);
  const closeTour = useCallback(
    (finished: boolean) => {
      setTourIndex(null);
      if (finished) markTourSeen(tourKey);
      else markTourSeen(tourKey); // skipping also counts; "Tour" in the top bar brings it back any time
    },
    [tourKey],
  );

  if (!loaded) return <p className="muted">Loading editor…</p>;

  return (
    <div className="ed">
      <TopBar projectId={projectId} projectName={projectName} onPublish={() => void publish()} publishing={publishing} onPreviewSite={siteId ? () => void previewOnSite() : undefined} sizeKb={sizeKb} sizeWarnKb={SIZE_WARN_KB} onTour={() => setTourIndex(0)} />
      {notice && (
        <div className="ed-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      <div className="ed-body">
        <ScenesPanel />
        <div className="ed-center">
          <Canvas />
          {mode === "advanced" && <Timeline />}
        </div>
        <Inspector workspaceId={workspaceId} projectId={projectId} />
      </div>
      {tourIndex !== null && <Tour steps={steps} index={tourIndex} onIndex={setTourIndex} onClose={closeTour} />}
    </div>
  );
}
