"use client";

import { useEffect, useRef } from "react";
import { ensureStyles, Stage } from "@sceneflow/core";
import { playbackSchema, type Layer, type Project, type Scene } from "@sceneflow/schema";

/**
 * Small live preview of a preset, painted by the same Stage renderer as the canvas and the published
 * player, so the thumbnail is exactly what the user gets.
 */
export function PresetThumb({ layers, background }: { layers: Layer[]; background?: Scene["background"] }) {
  const host = useRef<HTMLDivElement>(null);
  const bg: Scene["background"] = background ?? { type: "color", color: "#1f2937" };

  useEffect(() => {
    if (!host.current) return;
    ensureStyles();
    const stage = new Stage(host.current, { device: "desktop", editing: true });
    const scene: Scene = { id: "thumb", name: "", start: 0, end: 5, background: bg, layers, transition: { type: "none", duration: 0 } };
    const project: Project = { schemaVersion: "1.0", projectId: "thumb", version: 1, canvas: { aspectRatio: "16:9" }, playback: playbackSchema.parse({}), scenes: [scene] };
    stage.render(project, "thumb", null);
    return () => stage.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);

  const style = bg.type === "color" ? { background: bg.color } : bg.type === "gradient" ? { background: bg.css } : { background: "#000" };
  const image = bg.type === "image" ? bg.src : bg.type === "video" ? bg.poster : undefined;
  return (
    <div className="preset-thumb" style={style} aria-hidden="true">
      {image && <img className="bg" src={image} alt="" />}
      <div ref={host} className="preset-thumb-host" />
    </div>
  );
}
