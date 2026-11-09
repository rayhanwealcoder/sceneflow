"use client";

import { resolveLayer } from "@sceneflow/schema";
import { useEditor, useScene } from "@/lib/editorStore";

export function LayersPanel() {
  const { selection, select, device, updateLayerForDevice, updateLayer, reorder } = useEditor();
  const scene = useScene();
  const layers = scene.layers.slice().reverse(); // top-most first
  return (
    <div>
      <h3 className="small muted" style={{ marginBottom: 8 }}>
        LAYERS
      </h3>
      {layers.length === 0 ? (
        <p className="muted small">No elements in this scene yet.</p>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {layers.map((l, i) => {
            const r = resolveLayer(l, device);
            const on = selection.includes(l.id);
            return (
              <div key={l.id} className={`ed-layer ${on ? "on" : ""}`} onClick={(e) => select([l.id], e.shiftKey)}>
                <span className="ed-layer-name">
                  {l.name ?? l.type}
                  {r.overridden.frame || r.overridden.style || r.overridden.hidden ? <span className="badge" title={`Has ${device} overrides`}>{device[0]!.toUpperCase()}</span> : null}
                </span>
                <span className="ed-layer-tools" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" title={r.hidden ? "Show" : "Hide"} onClick={() => updateLayerForDevice(l.id, { hidden: !r.hidden })}>
                    {r.hidden ? "◌" : "◉"}
                  </button>
                  <button className="btn sm" title={l.locked ? "Unlock" : "Lock"} onClick={() => updateLayer(l.id, { locked: !l.locked })}>
                    {l.locked ? "🔒" : "🔓"}
                  </button>
                  <button className="btn sm" title="Bring forward" disabled={i === 0} onClick={() => reorder(l.id, "up")}>
                    ↑
                  </button>
                  <button className="btn sm" title="Send backward" disabled={i === layers.length - 1} onClick={() => reorder(l.id, "down")}>
                    ↓
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
