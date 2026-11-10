"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { MediaAsset } from "@/lib/types";

/**
 * "Pick a frame": the asset's thumbnail strip (10 moments) plus an exact second. The chosen moment is extracted at
 * full size by the worker (one round trip) and comes back as a URL for `project.poster`.
 */
export function FramePicker({ assetId, onPick, onClose }: { assetId: string; onPick: (url: string, time: number) => void; onClose: () => void }) {
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ asset: MediaAsset }>(`/api/v1/media/${assetId}`)
      .then((r) => setAsset(r.asset))
      .catch((e) => setError(errorMessage(e)));
  }, [assetId]);

  const duration = asset?.metadataJson.duration ?? 0;
  const thumbs = asset?.metadataJson.thumbnails ?? [];
  // The worker samples one thumbnail every duration/10 seconds, starting half a step in.
  const stepSec = thumbs.length ? duration / thumbs.length : 0;

  async function pick(t: number) {
    setError(null);
    setBusy(t);
    try {
      const r = await api<{ frame: { time: number; url: string } }>(`/api/v1/media/${assetId}/frame`, { method: "POST", json: { time: Math.round(t * 1000) / 1000 } });
      onPick(r.frame.url, r.frame.time);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const exact = Number(time);
  const exactOk = time.trim() !== "" && Number.isFinite(exact) && exact >= 0 && exact <= duration;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal stack" data-testid="frame-picker" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Choose a frame for the thumbnail</h2>
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          This picture shows before the video starts (and wherever the video is listed). Click a moment, or type an exact second.
        </p>
        {error && <div className="alert error small">{error}</div>}
        {!asset ? (
          <p className="muted">Loading…</p>
        ) : thumbs.length === 0 ? (
          <p className="muted">This video has no preview strip yet — type a second below.</p>
        ) : (
          <div className="media-grid">
            {thumbs.map((url, i) => {
              const t = Math.min(duration, (i + 0.5) * stepSec);
              return (
                <button key={url} className="media-tile" disabled={busy !== null} onClick={() => void pick(t)} title={`${t.toFixed(1)} s`} data-testid="frame-thumb">
                  <img src={url} alt="" />
                  <div className="cap">{busy === t ? "Taking the frame…" : `${t.toFixed(1)} s`}</div>
                </button>
              );
            })}
          </div>
        )}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ maxWidth: 200 }}>
            Exact second (0–{duration.toFixed(1)})
            <input className="input sm" inputMode="decimal" placeholder="e.g. 3.2" value={time} onChange={(e) => setTime(e.target.value)} data-testid="frame-time" />
          </label>
          <button className="btn sm primary" disabled={!exactOk || busy !== null} onClick={() => void pick(exact)} data-testid="frame-take">
            {busy !== null && busy === exact ? "Taking the frame…" : "Use this moment"}
          </button>
        </div>
      </div>
    </div>
  );
}
