"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useComments } from "@/lib/commentsStore";
import { useEditor } from "@/lib/editorStore";
import { fmtTime, splitMentions, timeAgo } from "@/lib/format";
import { usePlayhead } from "@/lib/playhead";
import { useSession } from "@/lib/session";
import type { Comment, WorkspaceMember } from "@/lib/types";

/*
 * 💬 Comments in the editor (doc §23): a thread list on the right, each comment anchored to the scene,
 * the moment on the timeline, an element and / or a point on the canvas. Clicking a comment jumps there;
 * "Pin on canvas" lets the next click on the stage place the pin. Client comments (from the review link)
 * show up here too, marked "client".
 */
export function CommentsPanel({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const cm = useComments();
  const { project, sceneId, selection, selectScene, select, mode } = useEditor();
  const { user } = useSession();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useAnchor, setUseAnchor] = useState(true);

  useEffect(() => {
    api<{ members: WorkspaceMember[] }>(`/api/v1/workspaces/${workspaceId}`)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
  }, [workspaceId]);
  useEffect(() => {
    if (cm.projectId !== projectId || !cm.loaded) cm.load(projectId).catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  // Refresh every 20 s while open: colleagues and clients may be commenting right now.
  useEffect(() => {
    const t = setInterval(() => cm.load(projectId).catch(() => {}), 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0]!;
  const roots = useMemo(() => cm.comments.filter((c) => !c.parentId), [cm.comments]);
  const numbered = useMemo(() => new Map(roots.map((c, i) => [c.id, i + 1])), [roots]);
  const shown = roots.filter((c) => (cm.filter === "open" ? !c.resolvedAt : !!c.resolvedAt));
  const replies = (id: string) => cm.comments.filter((c) => c.parentId === id);
  const openCount = roots.filter((c) => !c.resolvedAt).length;
  const names = members.map((m) => m.name);

  /** Where a new comment points: the pinned point, or the current scene / playhead / selected element. */
  const anchor = () => {
    if (!useAnchor) return {};
    if (cm.draftAnchor) return cm.draftAnchor;
    const t = mode === "advanced" ? usePlayhead.getState().time : scene.start;
    return { sceneId: scene.id, t, layerId: selection.length === 1 ? selection[0] : null };
  };
  const anchorLabel = () => {
    const a = anchor();
    if (!("sceneId" in a) || !a.sceneId) return "No anchor";
    const sc = project.scenes.find((s) => s.id === a.sceneId);
    const layer = a.layerId ? sc?.layers.find((l) => l.id === a.layerId) : null;
    return `${sc?.name ?? "Scene"}${a.t !== null && a.t !== undefined ? ` · ${fmtTime(a.t)}` : ""}${layer ? ` · ${layer.name ?? layer.type}` : ""}${a.x !== null && a.x !== undefined ? " · pinned" : ""}`;
  };

  async function post() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await cm.add({ body: text, parentId: replyTo, ...(replyTo ? {} : anchor()) });
      setBody("");
      setReplyTo(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function jump(c: Comment) {
    cm.setActive(c.id);
    if (c.sceneId && c.sceneId !== sceneId) selectScene(c.sceneId);
    if (c.layerId) select([c.layerId]);
    if (c.t !== null && mode === "advanced") usePlayhead.getState().setTime(c.t, { follow: false });
  }

  const mention = (name: string) => setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${name.split(" ")[0]} `);

  return (
    <aside className="cm-panel" data-testid="comments-panel" aria-label="Comments">
      <div className="row between" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <strong>
          Comments <span className="muted small">({openCount} open)</span>
        </strong>
        <span className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={() => cm.load(projectId).catch(() => {})} title="Refresh">
            ⟳
          </button>
          <button className="btn sm" onClick={() => cm.setOpen(false)} data-testid="comments-close">
            Close
          </button>
        </span>
      </div>
      <div className="tabs" style={{ margin: "8px 12px 0" }} role="tablist">
        <button className={cm.filter === "open" ? "on" : ""} onClick={() => cm.setFilter("open")} type="button">
          Open ({openCount})
        </button>
        <button className={cm.filter === "resolved" ? "on" : ""} onClick={() => cm.setFilter("resolved")} type="button">
          Resolved ({roots.length - openCount})
        </button>
      </div>
      <div className="cm-list">
        {error && <div className="alert error small">{error}</div>}
        {!cm.loaded && <p className="muted small">Loading…</p>}
        {cm.loaded && shown.length === 0 && <p className="muted small">{cm.filter === "open" ? "No open comments. Write one below — pin it on the canvas so everyone sees exactly what you mean." : "Nothing resolved yet."}</p>}
        {shown.map((c) => (
          <div key={c.id} className={`cm-item ${cm.activeId === c.id ? "on" : ""} ${c.resolvedAt ? "resolved" : ""}`} onClick={() => jump(c)} data-testid="comment">
            <div className="cm-meta">
              {c.x !== null && <span className="cm-num">{numbered.get(c.id)}</span>}
              <strong style={{ color: "var(--text)" }}>{c.authorName}</strong>
              {c.source === "client" && <span className="badge">client</span>}
              <span>{timeAgo(c.createdAt)}</span>
              {(c.sceneId || c.t !== null) && (
                <span title="Jump there">
                  📍 {project.scenes.find((s) => s.id === c.sceneId)?.name ?? ""}
                  {c.t !== null ? ` ${fmtTime(c.t)}` : ""}
                </span>
              )}
            </div>
            <div>
              {splitMentions(c.body, names).map((part, i) => (
                <span key={i} className={part.mention ? "mention" : undefined}>
                  {part.text}
                </span>
              ))}
            </div>
            {replies(c.id).map((r) => (
              <div key={r.id} className="cm-reply">
                <div className="cm-meta">
                  <strong style={{ color: "var(--text)" }}>{r.authorName}</strong>
                  {r.source === "client" && <span className="badge">client</span>}
                  <span>{timeAgo(r.createdAt)}</span>
                </div>
                <div>
                  {splitMentions(r.body, names).map((part, i) => (
                    <span key={i} className={part.mention ? "mention" : undefined}>
                      {part.text}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <div className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn sm" onClick={() => void cm.patch(c.id, { resolved: !c.resolvedAt }).catch((e) => setError(errorMessage(e)))} data-testid="comment-resolve">
                {c.resolvedAt ? "Reopen" : "Resolve"}
              </button>
              <button className="btn sm" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                {replyTo === c.id ? "Cancel reply" : "Reply"}
              </button>
              <button className="btn sm" onClick={() => confirm("Delete this comment?") && void cm.remove(c.id).catch((e) => setError(errorMessage(e)))} title="Delete (author or admin)">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="cm-compose">
        {replyTo ? (
          <div className="small muted">Replying to {roots.find((c) => c.id === replyTo)?.authorName ?? "comment"}</div>
        ) : (
          <div className="row between small">
            <label className="row" style={{ gap: 6, cursor: "pointer" }} title="Attach the comment to the current scene and moment (and the selected element)">
              <input type="checkbox" checked={useAnchor} onChange={(e) => setUseAnchor(e.target.checked)} />
              <span className="muted">{anchorLabel()}</span>
            </label>
            <button className={`btn sm ${cm.placing ? "on" : ""}`} onClick={() => cm.setPlacing(!cm.placing)} disabled={!useAnchor} title="Then click a spot on the canvas" data-testid="pin-on-canvas">
              {cm.placing ? "Click the canvas…" : cm.draftAnchor ? "Move pin" : "Pin on canvas"}
            </button>
          </div>
        )}
        <textarea className="input" rows={3} placeholder={replyTo ? "Your reply…" : "Write a comment… use @Name to mention a colleague"} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid="comment-body" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void post(); }} />
        {members.length > 1 && (
          <div className="chip-row">
            {members
              .filter((m) => m.userId !== user?.id)
              .slice(0, 6)
              .map((m) => (
                <button key={m.userId} className="chip" onClick={() => mention(m.name)} type="button" title={`Mention ${m.name}`}>
                  @{m.name.split(" ")[0]}
                </button>
              ))}
          </div>
        )}
        <div className="row between">
          <span className="muted small">Ctrl+Enter to post</span>
          <button className="btn sm primary" onClick={() => void post()} disabled={busy || !body.trim()} data-testid="comment-post">
            {busy ? "Posting…" : replyTo ? "Reply" : "Post comment"}
          </button>
        </div>
      </div>
    </aside>
  );
}
