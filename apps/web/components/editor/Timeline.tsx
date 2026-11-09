"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatTime, layerEnd, layerStart, moveSceneBoundary, projectDuration, rulerStep, setLayerTiming, snapTime, splitLayer, splitScene } from "@sceneflow/editor";
import type { Layer, Scene } from "@sceneflow/schema";
import { useWaveform } from "@/lib/assetCache";
import { useEditor } from "@/lib/editorStore";
import { usePlayhead } from "@/lib/playhead";

const LABEL_W = 170;
const RULER_H = 26;
const SCENE_H = 34;
const ROW_H = 30;
const VIEW_H = 150;
const PAD_END = 80;

const CLIP_COLOR: Record<string, string> = { text: "#6366f1", image: "#0ea5e9", button: "#f59e0b", shape: "#10b981", badge: "#ef4444", hotspot: "#ec4899", audio: "#8b5cf6" };

type Drag =
  | { kind: "scrub" }
  | { kind: "clip"; id: string; edge: "body" | "l" | "r"; startX: number; start: number; end: number }
  | { kind: "boundary"; index: number };

export function Timeline() {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.sceneId);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const apply = useEditor((s) => s.apply);
  const beginGesture = useEditor((s) => s.beginGesture);
  const endGesture = useEditor((s) => s.endGesture);
  const zoom = usePlayhead((s) => s.zoom);
  const playing = usePlayhead((s) => s.playing);
  const { setZoom, toggle, pause, setTime } = usePlayhead.getState();

  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0]!;
  const total = projectDuration(project);
  const contentW = Math.max(total * zoom + PAD_END, 400);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);

  // Playhead position is updated imperatively so playback does not re-render the timeline.
  useEffect(() => {
    const paint = (t: number) => {
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${LABEL_W + t * zoom}px)`;
    };
    paint(usePlayhead.getState().time);
    return usePlayhead.subscribe((s, prev) => {
      if (s.time !== prev.time) {
        paint(s.time);
        // keep the playhead in view while playing
        const el = scrollRef.current;
        if (el && s.playing) {
          const x = LABEL_W + s.time * zoom;
          if (x < el.scrollLeft + LABEL_W || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
        }
      }
    });
  }, [zoom]);

  const layers = useMemo(() => scene.layers.slice().reverse(), [scene.layers]);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
  const lastRow = Math.min(layers.length, Math.ceil((scrollTop + VIEW_H) / ROW_H) + 2);

  const timeFromEvent = (e: { clientX: number }) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return (e.clientX - rect.left + el.scrollLeft - LABEL_W) / zoom;
  };

  const onRulerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    pause();
    dragRef.current = { kind: "scrub" };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setTime(timeFromEvent(e));
  };

  const onClipDown = (e: ReactPointerEvent, layer: Layer, edge: "body" | "l" | "r") => {
    e.stopPropagation();
    e.preventDefault();
    if (!selection.includes(layer.id)) select([layer.id], e.shiftKey);
    if (layer.locked) return;
    dragRef.current = { kind: "clip", id: layer.id, edge, startX: e.clientX, start: layerStart(layer), end: layerEnd(layer, scene) };
    beginGesture();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onBoundaryDown = (e: ReactPointerEvent, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { kind: "boundary", index };
    beginGesture();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "scrub") return setTime(timeFromEvent(e));
    if (d.kind === "boundary") {
      const t = Math.round(timeFromEvent(e) * 10) / 10;
      apply((p) => moveSceneBoundary(p, d.index, t));
      return;
    }
    const delta = (e.clientX - d.startX) / zoom;
    const dur = scene.end - scene.start;
    const threshold = 8 / zoom;
    const candidates = [0, dur, usePlayhead.getState().time - scene.start, ...scene.layers.filter((l) => l.id !== d.id).flatMap((l) => [layerStart(l), layerEnd(l, scene)])];
    let start = d.start;
    let end = d.end;
    let snapped: number | null = null;
    if (d.edge === "body") {
      const len = d.end - d.start;
      let s = d.start + delta;
      const a = snapTime(s, candidates, threshold);
      const b = snapTime(s + len, candidates, threshold);
      if (a.snapped) {
        s = a.time;
        snapped = a.time;
      } else if (b.snapped) {
        s = b.time - len;
        snapped = b.time;
      }
      start = s;
      end = s + len;
    } else if (d.edge === "l") {
      const r = snapTime(d.start + delta, candidates, threshold);
      start = r.time;
      snapped = r.snapped ? r.time : null;
    } else {
      const r = snapTime(d.end + delta, candidates, threshold);
      end = r.time;
      snapped = r.snapped ? r.time : null;
    }
    setSnapLine(snapped === null ? null : scene.start + snapped);
    apply((p) => setLayerTiming(p, scene.id, d.id, { start, end }));
  };

  const onUp = () => {
    if (!dragRef.current) return;
    if (dragRef.current.kind !== "scrub") endGesture();
    dragRef.current = null;
    setSnapLine(null);
  };

  const splitAtPlayhead = () => {
    const t = usePlayhead.getState().time;
    const sel = selection[0];
    if (sel) {
      const r = splitLayer(useEditor.getState().project, scene.id, sel, t - scene.start);
      apply(() => r.project);
    } else {
      const r = splitScene(useEditor.getState().project, scene.id, t);
      apply(() => r.project);
    }
  };

  const fit = () => {
    const el = scrollRef.current;
    if (el && total > 0) setZoom((el.clientWidth - LABEL_W - PAD_END) / total);
  };

  const step = rulerStep(zoom);
  const ticks: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000);

  return (
    <div className="tl">
      <div className="tl-bar">
        <button className="btn sm" onClick={() => setTime(0)} title="Go to start (Home)">
          ⏮
        </button>
        <button className="btn sm primary" onClick={toggle} title="Play / pause (Space)">
          {playing ? "⏸" : "▶"}
        </button>
        <TimeLabel total={total} />
        <span className="tl-sep" />
        <button className="btn sm" onClick={splitAtPlayhead} title={selection.length ? "Split selected element at playhead" : "Split scene at playhead"}>
          ✂ Split {selection.length ? "element" : "scene"}
        </button>
        <span style={{ marginLeft: "auto" }} className="row small muted">
          Zoom
          <input type="range" min={8} max={320} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Timeline zoom" />
          <button className="btn sm" onClick={fit}>
            Fit
          </button>
        </span>
      </div>

      <div ref={scrollRef} className="tl-scroll" style={{ height: RULER_H + SCENE_H + VIEW_H }} onScroll={(e) => setScrollTop(Math.max(0, e.currentTarget.scrollTop))} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="tl-content" style={{ width: LABEL_W + contentW, height: RULER_H + SCENE_H + Math.max(VIEW_H, layers.length * ROW_H) }}>
          {/* ruler */}
          <div className="tl-ruler" style={{ height: RULER_H }} onPointerDown={onRulerDown}>
            <div className="tl-label tl-label-head" style={{ width: LABEL_W }}>
              {formatTime(total)} total
            </div>
            {ticks.map((t) => (
              <div key={t} className={`tl-tick ${Number.isInteger(t) ? "major" : ""}`} style={{ left: LABEL_W + t * zoom }}>
                {Number.isInteger(t) || step >= 1 ? <span>{formatTime(t)}</span> : null}
              </div>
            ))}
          </div>

          {/* scenes */}
          <div className="tl-scenes" style={{ height: SCENE_H }}>
            <div className="tl-label" style={{ width: LABEL_W }}>
              Scenes
            </div>
            {project.scenes.map((s, i) => (
              <div key={s.id} className={`tl-scene ${s.id === sceneId ? "on" : ""}`} style={{ left: LABEL_W + s.start * zoom, width: Math.max(2, (s.end - s.start) * zoom) }} onPointerDown={(e) => { e.stopPropagation(); setTime(Math.max(s.start, Math.min(timeFromEvent(e), s.end - 0.01))); }} title={`${s.name} · ${(s.end - s.start).toFixed(1)}s`}>
                <span className="tl-scene-name">{s.name}</span>
                {i < project.scenes.length - 1 && <span className="tl-boundary" onPointerDown={(e) => onBoundaryDown(e, i)} title="Drag to move the scene boundary" />}
              </div>
            ))}
          </div>

          {/* layer tracks (virtualized) */}
          <div className="tl-rows" style={{ height: Math.max(VIEW_H, layers.length * ROW_H) }}>
            {layers.length === 0 && <div className="tl-empty muted small">Add elements to this scene to see their timing here.</div>}
            {layers.slice(firstRow, lastRow).map((layer, i) => (
              <Row key={layer.id} layer={layer} scene={scene} top={(firstRow + i) * ROW_H} zoom={zoom} selected={selection.includes(layer.id)} onDown={onClipDown} onSelect={(e) => { select([layer.id], e.shiftKey); const t = usePlayhead.getState().time - scene.start; if (t < layerStart(layer) || t >= layerEnd(layer, scene)) setTime(scene.start + layerStart(layer), { follow: false }); }} />
            ))}
          </div>

          {snapLine !== null && <div className="tl-snap" style={{ left: LABEL_W + snapLine * zoom }} />}
          <div ref={playheadRef} className="tl-playhead" />
        </div>
      </div>
    </div>
  );
}

function Row({ layer, scene, top, zoom, selected, onDown, onSelect }: { layer: Layer; scene: Scene; top: number; zoom: number; selected: boolean; onDown: (e: ReactPointerEvent, l: Layer, edge: "body" | "l" | "r") => void; onSelect: (e: ReactPointerEvent) => void }) {
  const start = layerStart(layer);
  const end = layerEnd(layer, scene);
  const left = LABEL_W + (scene.start + start) * zoom;
  const width = Math.max(4, (end - start) * zoom);
  const color = CLIP_COLOR[layer.type] ?? "#64748b";
  return (
    <div className={`tl-row ${selected ? "on" : ""}`} style={{ top, height: ROW_H }}>
      <div className="tl-label" style={{ width: LABEL_W }} onPointerDown={onSelect} title={layer.name ?? layer.type}>
        <span className="tl-dot" style={{ background: color }} />
        <span className="tl-label-text">{layer.name ?? layer.type}</span>
        {layer.locked && <span title="Locked">🔒</span>}
      </div>
      <div className={`tl-clip ${selected ? "on" : ""} ${layer.locked ? "locked" : ""}`} style={{ left, width, background: color }} onPointerDown={(e) => onDown(e, layer, "body")} title={`${start.toFixed(1)}s – ${end.toFixed(1)}s`}>
        {layer.type === "audio" ? <Waveform assetId={layer.assetId} width={width} /> : <span className="tl-clip-text">{layer.animation?.in ? "↘ " : ""}{layer.name ?? layer.type}{layer.animation?.out ? " ↗" : ""}</span>}
        <span className="tl-edge l" onPointerDown={(e) => onDown(e, layer, "l")} />
        <span className="tl-edge r" onPointerDown={(e) => onDown(e, layer, "r")} />
      </div>
    </div>
  );
}

function Waveform({ assetId, width }: { assetId: string | undefined; width: number }) {
  const peaks = useWaveform(assetId);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = Math.max(1, Math.floor(width));
    const h = ROW_H - 8;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    if (!peaks.length) {
      ctx.fillRect(0, h / 2 - 1, w, 2);
      return;
    }
    for (let x = 0; x < w; x++) {
      const p = peaks[Math.floor((x / w) * peaks.length)] ?? 0;
      const bar = Math.max(1, p * (h - 2));
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [peaks, width]);
  return <canvas ref={ref} className="tl-wave" />;
}

function TimeLabel({ total }: { total: number }) {
  const time = usePlayhead((s) => s.time);
  return (
    <span className="tl-time">
      {formatTime(time)} <span className="muted">/ {formatTime(total)}</span>
    </span>
  );
}
