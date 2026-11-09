"use client";

import { useState, type FormEvent } from "react";
import { detectInputs, INPUT_LABELS } from "@sceneflow/editor";
import type { PresetConfig } from "@sceneflow/schema";
import { api, errorMessage } from "@/lib/api";
import type { LibraryPreset } from "@/lib/types";
import { TextField, Toggle } from "./fields";
import { PresetThumb } from "./PresetThumb";

const TITLE: Record<PresetConfig["type"], string> = { element: "Save as preset", scene: "Save scene as preset", animation: "Save motion", template: "Save as template" };
const HINT: Record<PresetConfig["type"], string> = {
  element: "The element (look, text, action and motion) goes into your library. Drop it into any scene of any video from Presets → Your library.",
  scene: "The whole scene — background, elements and timing — becomes a preset you can add to any video.",
  animation: "The enter/exit motion becomes a preset you can apply to any element.",
  template: "The whole video becomes a starting point: it appears under “Your templates” when you make a new video.",
};

/** AC-008: save an element, scene, motion or whole project into the cloud library. */
export function SavePresetDialog({ workspaceId, config, defaultName, onSaved, onClose }: { workspaceId: string; config: PresetConfig; defaultName: string; onSaved: (preset: LibraryPreset) => void; onClose: () => void }) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = detectInputs(config);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { preset } = await api<{ preset: LibraryPreset }>("/api/v1/presets", { method: "POST", json: { workspaceId, name: name.trim() || defaultName, description: description.trim() || undefined, scope: personal ? "personal" : "workspace", inputs, config } });
      onSaved(preset);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const layers = config.type === "element" ? config.layers : config.type === "scene" ? config.scene.layers : config.type === "template" ? config.project.scenes[0]?.layers ?? [] : [];
  const background = config.type === "scene" ? config.scene.background : config.type === "template" ? config.project.scenes[0]?.background : undefined;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <form className="modal stack" style={{ width: "min(520px, 92vw)" }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>{TITLE[config.type]}</h2>
          <button className="btn sm" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {HINT[config.type]}
        </p>
        {config.type !== "animation" && (
          <div style={{ maxWidth: 260 }}>
            <PresetThumb layers={layers} background={background} />
          </div>
        )}
        <TextField label="Name" value={name} onChange={setName} placeholder={defaultName} />
        <TextField label="Description (optional)" value={description} onChange={setDescription} placeholder="When to use it" />
        {inputs.length > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Whoever uses it will still add: {inputs.map((i) => INPUT_LABELS[i]).join(", ")}.
          </p>
        )}
        <Toggle label="Only visible to me (otherwise everyone in this workspace can use it)" checked={personal} onChange={setPersonal} />
        {error && <div className="alert error small">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save to library"}
          </button>
        </div>
      </form>
    </div>
  );
}
