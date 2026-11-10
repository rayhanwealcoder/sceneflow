"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ensureStyles, Stage } from "@sceneflow/core";
import { HANDLES, angleFromCenter, moveFrame, pxToPct, resizeFrame, rotateFrame, snapFrame, type Guide, type Handle } from "@sceneflow/editor";
import { aspectRatioValue, cueAt, resolveLayer, type Frame, type Layer, type Project, type Scene } from "@sceneflow/schema";
import { pinsForScene, useComments } from "@/lib/commentsStore";
import { useEditor, useScene } from "@/lib/editorStore";
import { usePlayhead } from "@/lib/playhead";

/** Preview widths per device, as a fraction of the fitted desktop stage. */
const DEVICE_SCALE = { desktop: 1, tablet: 0.68, mobile: 0.42 } as const;

type Drag =
  | { kind: "move"; startX: number; startY: number; frames: Record<string, Frame> }
  | { kind: "resize"; handle: Handle; startX: number; startY: number; id: string; frame: Frame }
  | { kind: "rotate"; id: string; frame: Frame };

export function Canvas() {
  const { project, device, mode, selection, select, beginGesture, endGesture, updateLayerForDevice, showSafeArea } = useEditor();
  const scene = useScene();
  // Review comments pinned on this scene (doc §23); "placing" = the next click on the stage sets a new pin.
  const { open: commentsOpen, placing, draftAnchor, comments, activeId, setDraftAnchor, setActive, setOpen: setCommentsOpen } = useComments();
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [fit, setFit] = useState({ w: 960, h: 540 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const dragRef = useRef<Drag | null>(null);

  const ratio = aspectRatioValue(project.canvas.aspectRatio);

  // Fit the stage inside the canvas area, then shrink for tablet/mobile previews.
  useEffect(() => {
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const pad = 48;
      const maxW = el.clientWidth - pad;
      const maxH = el.clientHeight - pad;
      let w = Math.min(maxW, maxH * ratio) * DEVICE_SCALE[device];
      if (device !== "desktop" && ratio < 1) w = Math.min(maxW, maxH * ratio) * 0.9;
      setFit({ w: Math.max(200, w), h: Math.max(200, w) / ratio });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio, device]);

  // Shared runtime renderer in editing mode: what you see is what gets published.
  useEffect(() => {
    if (!hostRef.current) return;
    ensureStyles();
    const stage = new Stage(hostRef.current, { device, editing: true });
    stageRef.current = stage;
    return () => {
      stage.destroy();
      stageRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    stageRef.current?.setDevice(device);
  }, [device]);
  useEffect(() => {
    stageRef.current?.render(project, scene.id, null);
  }, [project, scene.id, device, fit]);

  // Timeline preview: in Advanced mode the canvas follows the playhead (visibility + motion + video frame).
  const bg = scene.background;
  const baseSrc = project.video?.src;
  const clipSrc = bg.type === "video" && !baseSrc ? bg.src : undefined;
  useEffect(() => {
    const applyTime = (t: number, playing: boolean) => {
      stageRef.current?.setPreviewTime(mode === "advanced" ? t : null);
      const v = videoRef.current;
      if (!v) return;
      const want = baseSrc ? t : bg.type === "video" ? bg.sourceStart + (t - scene.start) : 0;
      if (mode !== "advanced") {
        if (!v.paused) v.pause();
        return;
      }
      if (playing) {
        const rate = project.playback.mode === "scroll" ? 1 : project.playback.speed ?? 1;
        if (v.playbackRate !== rate) v.playbackRate = rate;
        if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want;
        if (v.paused) void v.play().catch(() => {});
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > 0.02) v.currentTime = want;
      }
    };
    const s = usePlayhead.getState();
    applyTime(s.time, s.playing);
    return usePlayhead.subscribe((st, prev) => {
      if (st.time !== prev.time || st.playing !== prev.playing) applyTime(st.time, st.playing);
    });
  }, [mode, baseSrc, bg, scene.start, scene.id]);

  const resolved = useMemo(() => new Map(scene.layers.map((l) => [l.id, resolveLayer(l, device)])), [scene.layers, device]);

  const pctFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: pxToPct(e.clientX - r.left, r.width), y: pxToPct(e.clientY - r.top, r.height) };
  }, []);

  const onLayerPointerDown = (e: ReactPointerEvent, layer: Layer) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey;
    const already = selection.includes(layer.id);
    let ids = selection;
    if (additive) {
      select([layer.id], true);
      ids = already ? selection.filter((id) => id !== layer.id) : [...selection, layer.id];
    } else if (!already) {
      select([layer.id]);
      ids = [layer.id];
    }
    if (layer.locked) return;
    const movable = ids.filter((id) => !scene.layers.find((l) => l.id === id)?.locked);
    if (!movable.length) return;
    const frames: Record<string, Frame> = {};
    for (const id of movable) frames[id] = resolved.get(id)!.frame;
    const p = pctFromEvent(e);
    dragRef.current = { kind: "move", startX: p.x, startY: p.y, frames };
    beginGesture();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerDown = (e: ReactPointerEvent, id: string, handle: Handle) => {
    e.stopPropagation();
    const p = pctFromEvent(e);
    dragRef.current = { kind: "resize", handle, startX: p.x, startY: p.y, id, frame: resolved.get(id)!.frame };
    beginGesture();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onRotatePointerDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    dragRef.current = { kind: "rotate", id, frame: resolved.get(id)!.frame };
    beginGesture();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = pctFromEvent(e);
    if (d.kind === "move") {
      const dx = p.x - d.startX;
      const dy = p.y - d.startY;
      const ids = Object.keys(d.frames);
      let newGuides: Guide[] = [];
      let adjust = { dx: 0, dy: 0 };
      if (ids.length === 1 && !e.altKey) {
        const id = ids[0]!;
        const moved = moveFrame(d.frames[id]!, dx, dy);
        const targets = scene.layers.filter((l) => l.id !== id && !resolved.get(l.id)!.hidden).map((l) => resolved.get(l.id)!.frame);
        const snapped = snapFrame(moved, targets, { threshold: 1, safeArea: showSafeArea ? 5 : 0 });
        adjust = { dx: snapped.frame.x - moved.x, dy: snapped.frame.y - moved.y };
        newGuides = snapped.guides;
      }
      for (const id of ids) {
        const f = moveFrame(d.frames[id]!, dx + adjust.dx, dy + adjust.dy);
        updateLayerForDevice(id, { frame: { x: f.x, y: f.y } });
      }
      setGuides(newGuides);
    } else if (d.kind === "resize") {
      const layer = scene.layers.find((l) => l.id === d.id);
      const keepAspect = e.shiftKey || layer?.type === "image" || layer?.type === "hotspot";
      const f = resizeFrame(d.frame, d.handle, p.x - d.startX, p.y - d.startY, { keepAspect, stageRatio: ratio });
      updateLayerForDevice(d.id, { frame: { x: f.x, y: f.y, w: f.w, h: f.h } });
    } else {
      let deg = angleFromCenter(d.frame, p.x, p.y, ratio);
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      updateLayerForDevice(d.id, { frame: { rotation: rotateFrame(d.frame, deg).rotation } });
    }
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    endGesture();
    setGuides([]);
  };

  /** "Pin on canvas": one click places the comment's point (elements ignore the pointer while placing, see CSS). */
  const onOverlayPointerDown = (e: ReactPointerEvent) => {
    if (!placing) return;
    e.stopPropagation();
    const p = pctFromEvent(e);
    const t = mode === "advanced" ? usePlayhead.getState().time : scene.start;
    setDraftAnchor({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, sceneId: scene.id, t, layerId: null });
  };
  const pins = commentsOpen ? pinsForScene(comments, scene.id) : [];

  const bgStyle = backgroundStyle(project, scene);
  const videoSrc = baseSrc ?? clipSrc;
  const poster = bg.type === "video" ? (bg.poster ?? project.video?.poster) : undefined;

  return (
    <div className={`ed-canvas ${placing ? "placing" : ""}`} onPointerDown={() => select([])} data-tour="canvas">
      <div ref={wrapRef} className="ed-stage-wrap" style={{ width: fit.w, height: fit.h }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="ed-bg" style={bgStyle.style}>
          {bgStyle.image && <img src={bgStyle.image} alt="" draggable={false} />}
          {videoSrc && <video key={videoSrc} ref={videoRef} src={videoSrc} poster={poster} muted playsInline preload="auto" />}
        </div>
        <div ref={hostRef} className="ed-stage-host" />
        <div className="ed-overlay" onPointerDown={onOverlayPointerDown}>
          {showSafeArea && <div className="ed-safe" />}
          {pins.map(({ comment, n }) => (
            <button
              key={comment.id}
              type="button"
              className={`cm-pin ${activeId === comment.id ? "on" : ""} ${comment.resolvedAt ? "resolved" : ""}`}
              style={{ left: `${comment.x}%`, top: `${comment.y}%` }}
              title={`${comment.authorName}: ${comment.body}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                setActive(comment.id);
                setCommentsOpen(true);
              }}
              data-testid="comment-pin"
            >
              <span>{n}</span>
            </button>
          ))}
          {commentsOpen && draftAnchor && draftAnchor.sceneId === scene.id && draftAnchor.x !== null && draftAnchor.x !== undefined && (
            <span className="cm-pin draft" style={{ left: `${draftAnchor.x}%`, top: `${draftAnchor.y}%` }} title="New comment goes here">
              <span>+</span>
            </span>
          )}
          {scene.layers.map((layer) => {
            const r = resolved.get(layer.id)!;
            if (r.hidden) return null;
            const selected = selection.includes(layer.id);
            const f = r.frame;
            const style = { left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%`, transform: f.rotation ? `rotate(${f.rotation}deg)` : undefined };
            return (
              <div key={layer.id} className={`ed-hit ${layer.locked ? "locked" : ""} ${selected ? "sel" : ""}`} style={style} onPointerDown={(e) => onLayerPointerDown(e, layer)} title={layer.name ?? layer.type}>
                {selected && !layer.locked && selection.length === 1 && (
                  <>
                    {HANDLES.map((h) => (
                      <span key={h} className={`ed-handle ${h}`} onPointerDown={(e) => onHandlePointerDown(e, layer.id, h)} />
                    ))}
                    <span className="ed-rotate" onPointerDown={(e) => onRotatePointerDown(e, layer.id)} title="Drag to rotate (Shift snaps to 15°)" />
                  </>
                )}
              </div>
            );
          })}
          {guides.map((g, i) => (
            <div key={i} className={`ed-guide ${g.axis}`} style={g.axis === "x" ? { left: `${g.pos}%` } : { top: `${g.pos}%` }} />
          ))}
        </div>
        {project.captions && project.captions.cues.length > 0 && project.playback.captions !== false && <CaptionPreview project={project} scene={scene} advanced={mode === "advanced"} scale={fit.w / 1280} />}
      </div>
      <div className="ed-canvas-hint muted small">
        {device === "desktop" ? "Desktop layout" : `${device[0]!.toUpperCase()}${device.slice(1)} layout — changes here only affect ${device}`} · drag to move, Shift+drag corner keeps ratio, Alt disables snapping
        {mode === "advanced" ? " · canvas follows the timeline playhead" : ""}
        {placing ? " · click where the comment belongs" : ""}
      </div>
    </div>
  );
}

/** Subtitle preview: follows the playhead in Advanced mode, shows the scene's first cue otherwise. */
function CaptionPreview({ project, scene, advanced, scale }: { project: Project; scene: Scene; advanced: boolean; scale: number }) {
  const time = usePlayhead((s) => s.time);
  const caps = project.captions!;
  const cue = cueAt(caps.cues, advanced ? time : scene.start + 0.05) ?? (advanced ? null : caps.cues.find((c) => c.start >= scene.start && c.start < scene.end) ?? null);
  if (!cue) return null;
  const base = caps.style.size === "s" ? 19 : caps.style.size === "l" ? 30 : 24;
  return (
    <div className="ed-caption" data-pos={caps.style.position} style={{ fontSize: Math.max(9, base * scale) }} title="Captions preview — edit them under ✨ AI → Captions">
      {cue.text}
    </div>
  );
}

function backgroundStyle(project: Project, scene: Scene): { style: React.CSSProperties; image?: string } {
  const bg = scene.background;
  if (bg.type === "color") return { style: { background: bg.color } };
  if (bg.type === "gradient") return { style: { background: bg.css } };
  if (bg.type === "image") return { style: { background: "#000" }, image: bg.src };
  // video: the <video> element shows the frame; fall back to a poster when no source is known
  return { style: { background: "#000" }, image: bg.src || project.video?.src ? undefined : (bg.poster ?? project.video?.poster) };
}
