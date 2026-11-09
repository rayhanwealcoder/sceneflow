"use client";

import Link from "next/link";
import { canRedo, canUndo } from "@sceneflow/editor";
import { DEVICES, type Device } from "@sceneflow/schema";
import { useEditor } from "@/lib/editorStore";

const DEVICE_LABEL: Record<Device, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

export function TopBar({ projectId, projectName, onPublish, publishing, onPreviewSite, sizeKb, sizeWarnKb, onTour }: { projectId: string; projectName: string; onPublish: () => void; publishing: boolean; onPreviewSite?: () => void; sizeKb?: number; sizeWarnKb?: number; onTour?: () => void }) {
  const { history, undo, redo, device, setDevice, mode, setMode, saveState, savedVersion, showSafeArea, toggleSafeArea } = useEditor();
  const heavy = sizeKb !== undefined && sizeWarnKb !== undefined && sizeKb > sizeWarnKb;
  return (
    <div className="ed-top">
      <Link href={`/projects/${projectId}`} className="btn sm" title="Back to project">
        ←
      </Link>
      <strong className="ed-title">{projectName}</strong>

      <div className="tabs ed-mode" role="tablist" aria-label="Editor mode">
        <button className={mode === "simple" ? "on" : ""} onClick={() => setMode("simple")} type="button">
          Simple
        </button>
        <button className={mode === "advanced" ? "on" : ""} onClick={() => setMode("advanced")} type="button">
          Advanced
        </button>
      </div>

      <div className="tabs ed-devices" role="tablist" aria-label="Device" data-tour="device">
        {DEVICES.map((d) => (
          <button key={d} className={device === d ? "on" : ""} onClick={() => setDevice(d)} type="button" title={DEVICE_LABEL[d]}>
            {DEVICE_LABEL[d]}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 4 }}>
        <button className="btn sm" onClick={undo} disabled={!canUndo(history)} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="btn sm" onClick={redo} disabled={!canRedo(history)} title="Redo (Ctrl+Y)">
          ↷
        </button>
        <button className={`btn sm ${showSafeArea ? "on" : ""}`} onClick={toggleSafeArea} title="Toggle safe area">
          ▣
        </button>
      </div>

      <span className={`small ed-save ${saveState}`}>
        {saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved changes" : saveState === "error" ? "Save failed — retrying" : savedVersion ? `Saved · draft v${savedVersion}` : "Saved"}
      </span>
      {sizeKb !== undefined && sizeKb > 0 && (
        <span className={`small ed-size ${heavy ? "warn" : ""}`} title={heavy ? `Project data is over ${sizeWarnKb} KB; long texts and many layers slow the first paint on your site.` : "Size of the project data visitors download (media not included)"}>
          {sizeKb} KB
        </span>
      )}

      <div className="row" style={{ marginLeft: "auto", gap: 8 }}>
        {onTour && (
          <button className="btn sm" onClick={onTour} title="Show the guided tour again">
            Tour
          </button>
        )}
        <Link href={`/projects/${projectId}/preview`} target="_blank" className="btn sm">
          Preview ↗
        </Link>
        {onPreviewSite && (
          <button className="btn sm" onClick={onPreviewSite} title="Open the current draft inside your WordPress theme">
            Preview on site ↗
          </button>
        )}
        <button className="btn sm primary" onClick={onPublish} disabled={publishing} data-tour="publish">
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}
