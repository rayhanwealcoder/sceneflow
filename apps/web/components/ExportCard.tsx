"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { ExportFormat, ExportRequest, Project, VideoExport, WorkspaceRole } from "@/lib/types";

/*
 * "Download as a video file" on the project page (doc §31: MP4 export; Phase 16: WebM with alpha, GIF, 4K). The render happens on the worker (headless
 * Chrome + FFmpeg, same runtime visitors see); this card asks for it, shows progress while it runs and offers the
 * file. Interactive pieces (buttons, hotspots, product cards) are drawn as they look at that moment — a video
 * file cannot be clicked, which the card says plainly.
 */

const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const DEVICE_LABEL = { auto: "Automatic (phone layout for portrait videos)", desktop: "Desktop layout", tablet: "Tablet layout", mobile: "Phone layout" } as const;
const FORMAT_LABEL: Record<ExportFormat, string> = { mp4: "MP4 — plays everywhere", webm: "WebM — smaller, for websites", gif: "GIF — short silent loop" };
const FORMAT_HINT: Record<ExportFormat, string> = {
  mp4: "H.264 + AAC: social posts, ads, e-mail, presentations.",
  webm: "VP9 + Opus: smaller files for your own website. A transparent player background stays transparent, so the video can sit on top of a page.",
  gif: "Silent loop at 15 frames a second, up to 30 seconds and 720p: e-mails, chat, product pages.",
};

export function ExportCard({ project, draftVersion, role, portrait }: { project: Project; draftVersion: number | null; role: WorkspaceRole; portrait: boolean }) {
  const [exports, setExports] = useState<VideoExport[] | null>(null);
  const [req, setReq] = useState<ExportRequest>({ source: "draft", quality: "1080p", format: "mp4", fps: 30, device: "auto" });
  const gif = req.format === "gif";
  const setFormat = (format: ExportFormat) => setReq((r) => ({ ...r, format, quality: format === "gif" && (r.quality === "2160p" || r.quality === "1080p") ? "720p" : r.quality }));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = role !== "viewer";

  const load = useCallback(async () => {
    const r = await api<{ exports: VideoExport[] }>(`/api/v1/projects/${project.id}/exports`);
    setExports(r.exports);
    return r.exports;
  }, [project.id]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
  }, [load]);

  // Poll while something renders (the worker reports its progress every second or two).
  const active = exports?.some((e) => e.status === "queued" || e.status === "rendering") ?? false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [active, load]);

  async function start() {
    setBusy("start");
    setError(null);
    try {
      await api(`/api/v1/projects/${project.id}/exports`, { method: "POST", json: req });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/v1/exports/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const sourceVersion = req.source === "published" ? project.publishedVersion : draftVersion;
  const nothingToExport = !draftVersion;

  return (
    <section className="card stack" id="export" data-testid="export-card">
      <h2>Download as a video file</h2>
      <p className="muted small" style={{ margin: 0 }}>
        A plain video file of this project for social posts, ads, e-mail or a client preview — rendered with the same player your visitors see, text, motion, captions and voiceover included. Buttons, hotspots and product cards appear as they look at that moment; a video file cannot be clicked.
        {project.publishedVersion ? "" : " Publishing is not needed for this."}
      </p>

      {canEdit && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ minWidth: 150 }}>
            What
            <select className="input sm" value={req.source} onChange={(e) => setReq({ ...req, source: e.target.value as ExportRequest["source"] })} data-testid="export-source">
              <option value="draft">Current draft{draftVersion ? ` (v${draftVersion})` : ""}</option>
              <option value="published" disabled={!project.publishedVersion}>
                Published version{project.publishedVersion ? ` (v${project.publishedVersion})` : " — not published"}
              </option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 190 }}>
            File type
            <select className="input sm" value={req.format} onChange={(e) => setFormat(e.target.value as ExportFormat)} data-testid="export-format">
              {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ minWidth: 120 }}>
            Quality
            <select className="input sm" value={req.quality} onChange={(e) => setReq({ ...req, quality: e.target.value as ExportRequest["quality"] })} data-testid="export-quality">
              <option value="2160p" disabled={gif}>
                4K (sharpest, up to 3 min)
              </option>
              <option value="1080p" disabled={gif}>
                1080p (Full HD)
              </option>
              <option value="720p">720p (smaller file, faster)</option>
              <option value="480p">480p (smallest)</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 110 }}>
            Frame rate
            <select className="input sm" value={gif ? 15 : req.fps} disabled={gif} title={gif ? "GIFs always use 15 frames a second" : undefined} onChange={(e) => setReq({ ...req, fps: Number(e.target.value) as ExportRequest["fps"] })} data-testid="export-fps">
              {gif && <option value={15}>15 fps</option>}
              <option value={30}>30 fps</option>
              <option value={24}>24 fps (film look)</option>
              <option value={25}>25 fps (PAL / TV)</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 220 }}>
            Layout
            <select className="input sm" value={req.device} onChange={(e) => setReq({ ...req, device: e.target.value as ExportRequest["device"] })} title="Which responsive layout of your elements is rendered" data-testid="export-device">
              {(Object.keys(DEVICE_LABEL) as Array<keyof typeof DEVICE_LABEL>).map((d) => (
                <option key={d} value={d}>
                  {DEVICE_LABEL[d]}
                  {d === "auto" && portrait ? " → phone" : d === "auto" ? " → desktop" : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" disabled={busy !== null || nothingToExport || !sourceVersion} onClick={() => void start()} title={nothingToExport ? "Save something in the editor first" : "Render the file on the server; this takes about as long as the video, often less"} data-testid="export-start">
            {busy === "start" ? "Starting…" : `Render ${req.format.toUpperCase()}`}
          </button>
        </div>
      )}
      {canEdit && (
        <p className="muted small" style={{ margin: 0 }} data-testid="export-format-hint">
          {FORMAT_HINT[req.format]} {req.quality === "2160p" ? "4K is only sharper than 1080p when your uploaded video is 4K. " : ""}Videos are rendered from your original upload when possible.
        </p>
      )}

      {error && <div className="alert error">{error}</div>}

      {exports === null ? (
        <p className="muted small">Loading…</p>
      ) : exports.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          {canEdit ? "No files yet. Pick the file type and quality, then press Render — the file appears here when it is done." : "No files yet. An editor can render one from this page."}
        </p>
      ) : (
        <div className="list small" data-testid="export-list">
          {exports.map((e) => (
            <div key={e.id} className="list-item" data-testid="export-item" data-status={e.status} style={{ alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{e.fileName ?? "video.mp4"}</strong>
                <span className="muted">
                  {" "}
                  · {(e.options.format ?? "mp4").toUpperCase()}
                  {e.options.transparent ? " (transparent)" : ""} · {e.source === "published" ? "published" : "draft"} v{e.version} · {e.options.width}×{e.options.height} · {e.options.fps} fps · {e.options.device} layout
                  {e.sizeBytes ? ` · ${fmtBytes(e.sizeBytes)}` : ""}
                  {e.durationSec ? ` · ${fmtDur(e.durationSec)}` : ""}
                </span>
                <div className="muted">
                  {e.status === "ready" && `Ready · ${e.requestedByName} · ${timeAgo(e.finishedAt ?? e.updatedAt)}`}
                  {e.status === "failed" && (
                    <span className="badge bad" title={e.error ?? undefined}>
                      Failed: {e.error ?? "unknown error"}
                    </span>
                  )}
                  {e.status === "queued" && "Waiting for the render worker…"}
                  {e.status === "rendering" && (e.progress?.stage ?? "Rendering…")}
                </div>
                {(e.status === "queued" || e.status === "rendering") && (
                  <div className="progress" style={{ marginTop: 6, maxWidth: 420 }} aria-label="Render progress">
                    <div style={{ width: `${Math.max(2, e.progress?.percent ?? 0)}%` }} />
                  </div>
                )}
              </span>
              <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                {e.status === "ready" && e.fileUrl && (
                  <a className="btn sm primary" href={e.fileUrl} download={e.fileName ?? "video.mp4"} data-testid="export-download">
                    Download
                  </a>
                )}
                {e.status === "failed" && canEdit && (
                  <button className="btn sm" disabled={busy !== null} onClick={() => void start()} title="Render again with the options above">
                    Try again
                  </button>
                )}
                {canEdit && e.status !== "rendering" && (
                  <button className="btn sm" disabled={busy !== null} onClick={() => void remove(e.id)} title="Delete this file" aria-label="Delete export" data-testid="export-delete">
                    ✕
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
