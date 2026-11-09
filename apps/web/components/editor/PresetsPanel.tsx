"use client";

import { useEffect, useState } from "react";
import { INPUT_LABELS, OFFICIAL_PRESETS, presetFromLayers } from "@sceneflow/editor";
import type { Preset, PresetType } from "@sceneflow/schema";
import { api, errorMessage } from "@/lib/api";
import { useEditor, useSelectedLayers } from "@/lib/editorStore";
import type { LibraryPreset } from "@/lib/types";
import { PresetThumb } from "./PresetThumb";

type Tab = Exclude<PresetType, "template">;
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "element", label: "Elements" },
  { id: "scene", label: "Scenes" },
  { id: "animation", label: "Motion" },
];
const MOTION_GLYPH: Record<string, string> = { "official:soft-fade": "◌", "official:rise-up": "↑", "official:pop-in": "✦", "official:from-left": "→", "official:fade-in-out": "◐", "official:none": "∅" };

/**
 * Presets (doc §22): ready-made pieces ("Starter") plus the user's own library. One click applies a copy
 * to the current scene / selection; nothing is linked, so later edits never touch other videos.
 */
export function PresetsPanel({ workspaceId }: { workspaceId: string }) {
  const { library, setLibrary, upsertLibrary, removeFromLibrary, applyPreset } = useEditor();
  const selected = useSelectedLayers();
  const [tab, setTab] = useState<Tab>("element");
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ presets: LibraryPreset[] }>(`/api/v1/presets?workspaceId=${workspaceId}`)
      .then((r) => setLibrary(r.presets))
      .catch((e) => setMsg(errorMessage(e)))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const use = (p: Preset) => {
    const r = applyPreset(p);
    setMsg(r.ok ? null : r.message);
  };

  async function rename(p: LibraryPreset) {
    const name = prompt("Preset name", p.name)?.trim();
    if (!name || name === p.name) return;
    try {
      const { preset } = await api<{ preset: LibraryPreset }>(`/api/v1/presets/${p.id}`, { method: "PATCH", json: { name } });
      upsertLibrary(preset);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function replaceWithSelection(p: LibraryPreset) {
    if (!selected.length) return setMsg("Select the element(s) that should become the new version first.");
    if (!confirm(`Replace “${p.name}” with the selected element${selected.length > 1 ? "s" : ""}? Videos that use it keep their copy and get an “update available” note.`)) return;
    try {
      const { preset } = await api<{ preset: LibraryPreset }>(`/api/v1/presets/${p.id}`, { method: "PATCH", json: { config: presetFromLayers(selected) } });
      upsertLibrary(preset);
      setMsg(`“${preset.name}” is now v${preset.version}.`);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function remove(p: LibraryPreset) {
    if (!confirm(`Delete “${p.name}” from the library? Videos that already use it are not affected.`)) return;
    try {
      await api(`/api/v1/presets/${p.id}`, { method: "DELETE" });
      removeFromLibrary(p.id);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const official = OFFICIAL_PRESETS.filter((p) => p.type === tab);
  const mine = library.filter((p) => p.type === tab);

  return (
    <div data-tour="presets">
      <h3 className="small muted" style={{ marginBottom: 8 }}>
        PRESETS
      </h3>
      <div className="tabs ed-presets-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} type="button">
            {t.label}
          </button>
        ))}
      </div>
      {tab === "animation" && <p className="muted small">Select an element, then click a motion.</p>}
      {msg && (
        <div className="alert small" onClick={() => setMsg(null)} style={{ margin: "8px 0", cursor: "pointer" }}>
          {msg}
        </div>
      )}

      <h4 className="small muted" style={{ margin: "10px 0 6px" }}>
        Starter
      </h4>
      <div className="preset-grid">
        {official.map((p) => (
          <PresetCard key={p.id} preset={p} onUse={() => use(p)} />
        ))}
      </div>

      <h4 className="small muted" style={{ margin: "12px 0 6px" }}>
        Your library
      </h4>
      {!loaded ? (
        <p className="muted small">Loading…</p>
      ) : mine.length === 0 ? (
        <p className="muted small">{tab === "element" ? "Select an element and press ★ (Save as preset) in the panel on the right. It shows up here for every video." : tab === "scene" ? "Click an empty spot on the canvas, then “Save scene as preset” on the right." : "Saved motions appear here."}</p>
      ) : (
        <div className="preset-grid">
          {mine.map((p) => (
            <PresetCard key={p.id} preset={p} onUse={() => use(p)} onRename={() => void rename(p)} onReplace={p.type === "element" ? () => void replaceWithSelection(p) : undefined} onDelete={() => void remove(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetCard({ preset, onUse, onRename, onReplace, onDelete }: { preset: Preset; onUse: () => void; onRename?: () => void; onReplace?: () => void; onDelete?: () => void }) {
  const c = preset.config;
  const needs = preset.inputs.length ? `Needs ${preset.inputs.map((i) => INPUT_LABELS[i]).join(", ")}` : null;
  return (
    <div className="preset-card" role="button" tabIndex={0} onClick={onUse} onKeyDown={(e) => e.key === "Enter" && onUse()} title={preset.description ? `${preset.description}${needs ? ` · ${needs}` : ""}` : (needs ?? preset.name)}>
      {c.type === "element" ? <PresetThumb layers={c.layers} /> : c.type === "scene" ? <PresetThumb layers={c.scene.layers} background={c.scene.background} /> : <div className="preset-glyph">{MOTION_GLYPH[preset.id] ?? "✦"}</div>}
      <span className="preset-name">
        {preset.name}
        {preset.scope !== "official" && preset.version > 1 ? <span className="muted"> v{preset.version}</span> : null}
      </span>
      {needs && <span className="muted" style={{ fontSize: 11 }}>{needs}</span>}
      {(onRename || onReplace || onDelete) && (
        <span className="preset-tools" onClick={(e) => e.stopPropagation()}>
          {onReplace && (
            <button className="btn sm" title="Replace with the selected element(s) — becomes a new version" onClick={onReplace}>
              ⟳
            </button>
          )}
          {onRename && (
            <button className="btn sm" title="Rename" onClick={onRename}>
              ✎
            </button>
          )}
          {onDelete && (
            <button className="btn sm" title="Delete from library" onClick={onDelete}>
              ✕
            </button>
          )}
        </span>
      )}
    </div>
  );
}
