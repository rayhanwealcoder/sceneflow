"use client";

import { useRef, useState, type DragEvent } from "react";
import { errorMessage, uploadMedia } from "@/lib/api";

const ACCEPT = "video/mp4,video/webm,video/quicktime,image/gif,image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/mp4,audio/ogg";

export function UploadBox({ workspaceId, onUploaded }: { workspaceId: string; onUploaded: (assetId: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setProgress(0);
    try {
      const assetId = await uploadMedia(workspaceId, file, setProgress);
      setProgress(1);
      onUploaded(assetId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTimeout(() => {
        setProgress(null);
        setFileName(null);
      }, 800);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setActive(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="stack">
      <div
        className={`dropzone ${active ? "active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setActive(true);
        }}
        onDragLeave={() => setActive(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <strong>Drop a video, image or audio file here</strong>
        <div className="muted small">or click to choose · MP4, WebM, MOV, GIF, JPG, PNG, WebP, MP3, WAV</div>
        <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => void handleFiles(e.target.files)} />
      </div>
      {progress !== null && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row between small">
            <span>{fileName}</span>
            <span className="muted">{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Uploaded, processing…"}</span>
          </div>
          <div className="progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
    </div>
  );
}
