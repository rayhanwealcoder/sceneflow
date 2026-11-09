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

  /** No footage yet? A 6–10 s AI clip is enough; these prompts are tuned for overlays and scroll-scrub. */
  const aiHelp = (
    <details className="ai-help small">
      <summary className="muted">No video yet? Make one with AI (Veo, Sora, Runway, Kling…) — prompt help</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <p style={{ margin: 0 }}>
          Ask for <strong>one slow continuous camera move, no cuts, no text, 6–10 seconds, 16:9</strong>, with the subject on the left so the product card and text fit on the right. Image-to-video from a clean product photo keeps the product accurate.
        </p>
        <pre className="ai-prompt">Cinematic product video of [your product] on [a surface], soft studio light, shallow depth of field. Slow 8-second camera push-in, product centred-left with empty space on the right. Photorealistic, no text, no logos, no people, no cuts, smooth steady motion.</pre>
        <pre className="ai-prompt">Clean 3D animation of [your product] rotating slowly on a neutral grey background, soft shadows, 10 seconds, one continuous rotation, no text, no cuts, loopable.</pre>
        <p className="muted" style={{ margin: 0 }}>
          Export MP4 at the highest quality and upload it here — SceneFlow makes the web and scroll versions. More templates: docs/ai-video-prompts.md in the repository.
        </p>
      </div>
    </details>
  );

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
      {aiHelp}
    </div>
  );
}
