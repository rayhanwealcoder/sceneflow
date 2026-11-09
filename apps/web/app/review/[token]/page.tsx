"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@sceneflow/core";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fmtTime, timeAgo } from "@/lib/format";
import type { Comment, ReviewView } from "@/lib/types";

/*
 * Client review page (doc §23 "client-only approval access"). Opened from a review link — no account.
 * The client watches the real player, clicks on the video to leave a note at that moment and spot,
 * and presses Approve (or Request changes). Everything lands in the agency's editor and dashboard.
 */

const NAME_KEY = "sf_reviewer_name";

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<ReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [noting, setNoting] = useState(false);
  const [compose, setCompose] = useState<{ x: number; y: number; t: number; sceneId: string | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [decision, setDecision] = useState<"approve" | "changes" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const timeRef = useRef(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const configRef = useRef<unknown>(null);

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      /* ignore */
    }
  }, []);
  const rememberName = (n: string) => {
    setName(n);
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* ignore */
    }
  };

  const load = useCallback(async () => {
    const v = await api<ReviewView>(`/api/v1/review/${token}`);
    setView(v);
    return v;
  }, [token]);
  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : errorMessage(e)));
  }, [load]);

  // The real runtime, re-created only when the draft version changes (not on every comment refresh).
  const version = view?.version ?? null;
  if (view?.config && version !== null) configRef.current = view.config;
  useEffect(() => {
    if (!hostRef.current || !configRef.current || version === null) return;
    const player = new Player({ target: hostRef.current, config: configRef.current, lazy: false, analytics: false });
    playerRef.current = player;
    player.on("timeupdate", ({ time }) => {
      timeRef.current = time;
      setTime(time);
    });
    player.on("sceneChange", ({ sceneId }) => setSceneId(sceneId));
    void player.init();
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, [version]);

  const roots = useMemo(() => (view?.comments ?? []).filter((c) => !c.parentId), [view]);
  const numbered = useMemo(() => new Map(roots.map((c, i) => [c.id, i + 1])), [roots]);
  const pins = roots.filter((c) => c.x !== null && c.y !== null && (c.sceneId && sceneId ? c.sceneId === sceneId : c.t === null || Math.abs(c.t - time) < 2.5));
  const open = roots.filter((c) => !c.resolvedAt);
  const resolved = roots.filter((c) => c.resolvedAt);

  function onStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!noting) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    playerRef.current?.pause();
    setCompose({ x, y, t: Math.round(timeRef.current * 10) / 10, sceneId });
    setNoting(false);
  }

  async function post() {
    if (!compose || !draft.trim() || !name.trim()) return;
    setBusy("post");
    setError(null);
    try {
      await api(`/api/v1/review/${token}/comments`, { method: "POST", json: { name: name.trim(), body: draft.trim(), t: compose.t, sceneId: compose.sceneId, x: compose.x, y: compose.y } });
      setDraft("");
      setCompose(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide(kind: "approve" | "changes") {
    if (!name.trim()) return setError("Please enter your name first.");
    if (kind === "changes" && !note.trim()) return setError("Say what should change.");
    setBusy(kind);
    setError(null);
    try {
      if (kind === "approve") await api(`/api/v1/review/${token}/approve`, { method: "POST", json: { name: name.trim(), note: note.trim() || undefined } });
      else await api(`/api/v1/review/${token}/request-changes`, { method: "POST", json: { name: name.trim(), note: note.trim() } });
      setDone(kind === "approve" ? "Thank you — your approval has been recorded." : "Thank you — your change request has been sent.");
      setDecision(null);
      setNote("");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleResolved(c: Comment) {
    if (!name.trim()) return setError("Please enter your name first.");
    try {
      await api(`/api/v1/review/${token}/comments/${c.id}`, { method: "PATCH", json: { resolved: !c.resolvedAt, name: name.trim() } });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const jump = (c: Comment) => {
    setActiveId(c.id);
    if (c.t !== null) playerRef.current?.seek(c.t);
  };

  if (error && !view) {
    return (
      <div className="card stack connect-card" data-testid="review-error">
        <h1 style={{ margin: 0 }}>Review link</h1>
        <div className="alert error">{error}</div>
        <p className="muted small" style={{ margin: 0 }}>
          Ask the person who sent you the link for a new one.
        </p>
      </div>
    );
  }
  if (!view) return <p className="muted">Loading…</p>;
  const approvedCurrent = view.status === "approved" && !view.canApprove;

  return (
    <div className="stack review" data-testid="review-page">
      <div className="row between">
        <div>
          <p className="muted small" style={{ margin: 0 }}>
            {view.project.from} asks you to review
          </p>
          <h1 style={{ margin: "2px 0" }}>{view.project.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {view.project.clientName ? `For ${view.project.clientName} · ` : ""}Draft v{view.version}
          </p>
        </div>
        <span className={`badge ${view.status === "approved" ? "ok" : view.status === "changes" ? "bad" : "warn"}`} data-testid="review-status">
          {view.status === "approved" ? `Approved by ${view.approvedBy}${view.canApprove ? " (edited since)" : ""}` : view.status === "changes" ? "Changes requested" : "Waiting for your review"}
        </span>
      </div>

      {!view.config && <div className="alert">Nothing to review yet — the video has not been saved.</div>}
      {error && <div className="alert error">{error}</div>}
      {done && <div className="alert ok">{done}</div>}

      <div className="rv-cols">
        <div className="stack">
          <div className="row between">
            <span className="small muted">Watch it like a visitor would. To leave a note on a spot, press the button, then click the video.</span>
            <button className={`btn sm ${noting ? "on" : "primary"}`} onClick={() => setNoting((v) => !v)} data-testid="note-mode">
              {noting ? "Click the video… (cancel)" : "💬 Add a note on the video"}
            </button>
          </div>
          <div className="rv-stage">
            <div ref={hostRef} />
            <div className={`rv-overlay ${noting ? "noting" : ""}`} onClick={onStageClick} data-testid="review-overlay">
              {pins.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cm-pin ${activeId === c.id ? "on" : ""} ${c.resolvedAt ? "resolved" : ""}`}
                  style={{ left: `${c.x}%`, top: `${c.y}%` }}
                  title={`${c.authorName}: ${c.body}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    jump(c);
                  }}
                >
                  <span>{numbered.get(c.id)}</span>
                </button>
              ))}
              {compose && (
                <>
                  <span className="cm-pin draft" style={{ left: `${compose.x}%`, top: `${compose.y}%` }}>
                    <span>+</span>
                  </span>
                  <div className="rv-compose" style={{ left: `${compose.x}%`, top: `${compose.y}%`, transform: compose.x > 55 ? "translate(-100%, 8px)" : "translate(12px, 8px)" }} onClick={(e) => e.stopPropagation()}>
                    <div className="small muted">At {fmtTime(compose.t)}</div>
                    {!name && <input className="input sm" placeholder="Your name" value={name} onChange={(e) => rememberName(e.target.value)} maxLength={80} data-testid="reviewer-name-inline" />}
                    <textarea className="input sm" rows={3} placeholder="What should change here?" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} autoFocus data-testid="review-note" />
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm primary" onClick={() => void post()} disabled={busy !== null || !draft.trim() || !name.trim()} data-testid="review-note-post">
                        {busy === "post" ? "Posting…" : "Post note"}
                      </button>
                      <button className="btn sm" onClick={() => setCompose(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="small muted">
            {fmtTime(time)} · {pins.length ? `${pins.length} note${pins.length === 1 ? "" : "s"} at this moment` : "no notes at this moment"}
          </div>
        </div>

        <aside className="stack">
          <section className="card stack" style={{ gap: 10 }}>
            <label className="field small">
              Your name
              <input className="input sm" value={name} onChange={(e) => rememberName(e.target.value)} placeholder="So the team knows who wrote what" maxLength={80} data-testid="reviewer-name" />
            </label>
            {approvedCurrent ? (
              <div className="alert ok small">
                You approved this version{view.approvedAt ? ` on ${new Date(view.approvedAt).toLocaleString()}` : ""}. {view.project.from} will publish it.
              </div>
            ) : (
              <>
                {decision === null && (
                  <div className="row">
                    <button className="btn primary" onClick={() => setDecision("approve")} disabled={!view.config} data-testid="review-approve">
                      ✓ Approve
                    </button>
                    <button className="btn" onClick={() => setDecision("changes")} disabled={!view.config} data-testid="review-changes">
                      Request changes
                    </button>
                  </div>
                )}
                {decision && (
                  <div className="stack" style={{ gap: 6 }}>
                    <textarea className="input sm" rows={3} placeholder={decision === "approve" ? "Anything to add? (optional)" : "What should change?"} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="decision-note" />
                    <div className="row">
                      <button className="btn sm primary" onClick={() => void decide(decision)} disabled={busy !== null} data-testid="decision-confirm">
                        {busy ? "Sending…" : decision === "approve" ? "Confirm approval" : "Send request"}
                      </button>
                      <button className="btn sm" onClick={() => setDecision(null)}>
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card stack" style={{ gap: 8 }} data-testid="review-comments">
            <h2 style={{ margin: 0, fontSize: 16 }}>Notes ({open.length} open)</h2>
            {roots.length === 0 && <p className="muted small" style={{ margin: 0 }}>No notes yet. Click “Add a note on the video” to point at something.</p>}
            {[...open, ...resolved].map((c) => (
              <div key={c.id} className={`cm-item ${activeId === c.id ? "on" : ""} ${c.resolvedAt ? "resolved" : ""}`} onClick={() => jump(c)}>
                <div className="cm-meta">
                  {c.x !== null && <span className="cm-num">{numbered.get(c.id)}</span>}
                  <strong style={{ color: "var(--text)" }}>{c.authorName}</strong>
                  {c.source === "team" && <span className="badge">team</span>}
                  <span>{timeAgo(c.createdAt)}</span>
                  {c.t !== null && <span>📍 {fmtTime(c.t)}</span>}
                </div>
                <div>{c.body}</div>
                {(view.comments ?? [])
                  .filter((r) => r.parentId === c.id)
                  .map((r) => (
                    <div key={r.id} className="cm-reply">
                      <div className="cm-meta">
                        <strong style={{ color: "var(--text)" }}>{r.authorName}</strong>
                        <span>{timeAgo(r.createdAt)}</span>
                      </div>
                      <div>{r.body}</div>
                    </div>
                  ))}
                <div onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" onClick={() => void toggleResolved(c)}>
                    {c.resolvedAt ? "Reopen" : "Mark as done"}
                  </button>
                </div>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
