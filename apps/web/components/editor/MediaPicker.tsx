"use client";

import { useEffect, useState } from "react";
import { UploadBox } from "@/components/UploadBox";
import { api, errorMessage } from "@/lib/api";
import type { MediaAsset } from "@/lib/types";

export type PickerType = "image" | "video" | "audio";
const TITLE: Record<PickerType, string> = { image: "an image", video: "a video", audio: "an audio file" };

export function MediaPicker({ workspaceId, type, onPick, onClose }: { workspaceId: string; type: PickerType; onPick: (asset: MediaAsset) => void; onClose: () => void }) {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ assets: MediaAsset[] }>(`/api/v1/media?workspaceId=${workspaceId}`)
      .then(({ assets }) => setAssets(assets.filter((a) => a.type === type)))
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, type]);

  const processing = assets?.some((a) => a.status !== "ready" && a.status !== "failed");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Choose {TITLE[type]}</h2>
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>
        <UploadBox workspaceId={workspaceId} onUploaded={() => void load()} />
        {error && <div className="alert error">{error}</div>}
        {assets === null ? (
          <p className="muted">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="muted">Nothing here yet. Upload a file above.</p>
        ) : (
          <div className="media-grid">
            {assets.map((a) => {
              const ready = a.status === "ready";
              const thumb = a.metadataJson.posterUrl ?? a.metadataJson.editorUrl;
              return (
                <button key={a.id} className="media-tile" disabled={!ready} onClick={() => onPick(a)} title={a.originalName}>
                  {thumb ? (
                    <img src={thumb} alt="" />
                  ) : (
                    <div className="ph" style={{ aspectRatio: "16/9", display: "grid", placeItems: "center", fontSize: 22 }}>
                      {a.type === "audio" ? "♪" : a.status}
                    </div>
                  )}
                  <div className="cap">
                    {a.originalName}
                    {a.metadataJson.duration ? ` · ${a.metadataJson.duration.toFixed(1)}s` : ""}
                    {!ready ? ` · ${a.status}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
