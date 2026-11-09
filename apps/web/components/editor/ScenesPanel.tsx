"use client";

import { ELEMENT_LABELS, ELEMENT_TYPES } from "@sceneflow/editor";
import { useEditor } from "@/lib/editorStore";
import { PresetsPanel } from "./PresetsPanel";

const ICON: Record<string, string> = { text: "T", image: "🖼", button: "▭", product: "🛍", shape: "◆", badge: "●", hotspot: "◎", audio: "♪" };

export function ScenesPanel({ workspaceId }: { workspaceId: string }) {
  const { project, sceneId, selectScene, addScene, duplicateScene, removeScene, moveScene, addLayer } = useEditor();
  return (
    <aside className="ed-side">
      <div>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3 className="small muted" style={{ margin: 0 }}>
            SCENES
          </h3>
          <button className="btn sm" onClick={addScene} title="Add scene after the current one">
            + Add
          </button>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {project.scenes.map((s, i) => (
            <div key={s.id} className={`ed-scene ${s.id === sceneId ? "on" : ""}`} onClick={() => selectScene(s.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && selectScene(s.id)}>
              <span className="ed-scene-num">{i + 1}</span>
              <span className="ed-scene-name">
                <strong>{s.name}</strong>
                <span className="muted small">
                  {" "}
                  {(s.end - s.start).toFixed(1)}s · {s.layers.length} {s.layers.length === 1 ? "element" : "elements"}
                </span>
              </span>
              <span className="ed-scene-tools" onClick={(e) => e.stopPropagation()}>
                <button className="btn sm" title="Move up" disabled={i === 0} onClick={() => moveScene(s.id, -1)}>
                  ↑
                </button>
                <button className="btn sm" title="Move down" disabled={i === project.scenes.length - 1} onClick={() => moveScene(s.id, 1)}>
                  ↓
                </button>
                <button className="btn sm" title="Duplicate" onClick={() => duplicateScene(s.id)}>
                  ⧉
                </button>
                <button className="btn sm" title="Delete" disabled={project.scenes.length === 1} onClick={() => removeScene(s.id)}>
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="small muted" style={{ marginBottom: 8 }}>
          ADD ELEMENT
        </h3>
        <div className="ed-elements" data-tour="elements">
          {ELEMENT_TYPES.map((t) => (
            <button key={t} className="ed-el" onClick={() => addLayer(t)} title={`Add ${ELEMENT_LABELS[t]}`}>
              <span className="ed-el-icon">{ICON[t]}</span>
              {ELEMENT_LABELS[t]}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Product cards show live price and stock from your shop and add to the cart right from the video. Buttons and hotspots can also add to cart, buy now or apply a coupon.
        </p>
      </div>

      <PresetsPanel workspaceId={workspaceId} />
    </aside>
  );
}
