"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { copyText } from "@/lib/format";
import type { Project, WorkspaceRole } from "@/lib/types";
import { ReviewChip } from "./ReviewStatus";

/*
 * "Review & approval" on the project page (doc §23). One card, three jobs:
 *   1. the switch "Require approval before publishing" (editors then need an approved draft; admins never do)
 *   2. the state + the next step for *this* person (send for review / approve / request changes / back to draft)
 *   3. the client review link — the client needs no account; the link shows the draft, takes comments and the Approve button
 */

type Action = "request_internal" | "request_client" | "approve" | "request_changes" | "reset";

export function ReviewCard({ project, draftChecksum, role, openComments, onChange }: { project: Project; draftChecksum: string | null; role: WorkspaceRole; openComments: number; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string | null; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [changesNote, setChangesNote] = useState("");
  const [askChanges, setAskChanges] = useState(false);
  const admin = role === "admin" || role === "owner";
  const editor = admin || role === "editor";
  const stale = project.reviewStatus === "approved" && draftChecksum !== null && project.approvedChecksum !== draftChecksum;

  useEffect(() => {
    if (!editor) return;
    if (!project.hasReviewLink) return void setLink({ url: null, expiresAt: null });
    api<{ url: string | null; expiresAt: string | null }>(`/api/v1/projects/${project.id}/review-link`)
      .then(setLink)
      .catch(() => setLink({ url: null, expiresAt: null }));
  }, [project.id, project.hasReviewLink, editor]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  const act = (action: Action, note?: string) =>
    run(action, async () => {
      const r = await api<{ reviewUrl: string | null }>(`/api/v1/projects/${project.id}/review`, { method: "POST", json: { action, note: note || undefined } });
      if (action === "request_client" && r.reviewUrl) setLink({ url: r.reviewUrl, expiresAt: null });
      setAskChanges(false);
      setChangesNote("");
    });
  const toggleApproval = () => run("toggle", () => api(`/api/v1/projects/${project.id}`, { method: "PATCH", json: { approvalRequired: !project.approvalRequired } }));
  const linkAction = (action: "create" | "revoke") =>
    run(action, async () => {
      const r = await api<{ url: string | null; expiresAt: string | null }>(`/api/v1/projects/${project.id}/review-link`, { method: "POST", json: { action } });
      setLink(r);
    });
  const copy = async () => {
    if (link?.url && (await copyText(link.url))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const nextStep = (() => {
    if (!draftChecksum) return "Save something in the editor first.";
    switch (project.reviewStatus) {
      case "none":
        return editor ? "Send the draft for a look — to a colleague, or straight to the client with a link." : "Nothing is in review right now.";
      case "internal":
        return admin ? "A colleague asked you to look at this draft. Approve it, or ask for changes." : "Waiting for an admin to approve.";
      case "client":
        return "The client has the link. They can comment on the video and approve it there; you will see it here.";
      case "changes":
        return "Open the comments in the editor, make the changes, then send it again.";
      case "approved":
        return stale ? "The draft changed after it was approved. Send it again if the approval matters, or publish (admins) / ask an admin." : project.publishedVersion === project.approvedVersion ? "Approved and live." : "Approved — publish it when you are ready.";
    }
  })();

  return (
    <section className="card stack" id="review">
      <div className="row between">
        <h2 style={{ margin: 0 }}>
          <span className="step">3</span> Review &amp; approval
        </h2>
        <ReviewChip project={project} draftChecksum={draftChecksum} />
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {nextStep}
        {openComments > 0 && (
          <>
            {" "}
            <Link href={`/projects/${project.id}/editor?comments=1`}>
              {openComments} open comment{openComments === 1 ? "" : "s"} →
            </Link>
          </>
        )}
      </p>
      {error && <div className="alert error small">{error}</div>}

      {editor && (
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={project.approvalRequired} onChange={toggleApproval} disabled={busy !== null} />
          <span>
            <strong>Require approval before publishing</strong>
            <span className="muted"> — editors can only publish an approved, unchanged draft. Admins and the owner can always publish.</span>
          </span>
        </label>
      )}

      {draftChecksum && (
        <div className="row" style={{ gap: 8 }}>
          {editor && (project.reviewStatus === "none" || project.reviewStatus === "changes" || stale) && (
            <>
              <button className="btn sm" onClick={() => void act("request_internal")} disabled={busy !== null} title="Ask an admin of your workspace to approve">
                Send for internal review
              </button>
              <button className="btn sm primary" onClick={() => void act("request_client")} disabled={busy !== null} title="Creates a review link the client opens without an account" data-testid="send-to-client">
                {busy === "request_client" ? "Preparing link…" : "Send to client"}
              </button>
            </>
          )}
          {admin && (project.reviewStatus === "internal" || project.reviewStatus === "client" || project.reviewStatus === "changes") && (
            <>
              <button className="btn sm primary" onClick={() => void act("approve")} disabled={busy !== null} data-testid="approve-internal">
                Approve
              </button>
              <button className="btn sm" onClick={() => setAskChanges((v) => !v)} disabled={busy !== null}>
                Request changes…
              </button>
            </>
          )}
          {editor && project.reviewStatus !== "none" && (
            <button className="btn sm" onClick={() => void act("reset")} disabled={busy !== null} title="Clear the review state (comments stay)">
              Back to draft
            </button>
          )}
        </div>
      )}
      {askChanges && (
        <div className="stack" style={{ gap: 6 }}>
          <textarea className="input" rows={2} placeholder="What should change? This becomes a comment the team sees in the editor." value={changesNote} onChange={(e) => setChangesNote(e.target.value)} maxLength={2000} />
          <div className="row">
            <button className="btn sm primary" onClick={() => void act("request_changes", changesNote.trim())} disabled={busy !== null || changesNote.trim().length < 1}>
              Send
            </button>
            <button className="btn sm" onClick={() => setAskChanges(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {editor && link && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="small muted">Client review link — anyone with it sees the current draft, can leave notes on the video and press Approve. No account needed.</div>
          {link.url ? (
            <div className="review-link">
              <code data-testid="review-url">{link.url}</code>
              <button className="btn sm" onClick={() => void copy()} data-testid="copy-review-link">
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <button className="btn sm" onClick={() => void linkAction("create")} disabled={busy !== null} title="Makes a new link; the old one stops working">
                New link
              </button>
              <button className="btn sm" onClick={() => void linkAction("revoke")} disabled={busy !== null} title="The link stops working immediately">
                Revoke
              </button>
            </div>
          ) : (
            <div>
              <button className="btn sm" onClick={() => void linkAction("create")} disabled={busy !== null || !draftChecksum}>
                Create review link
              </button>
            </div>
          )}
          {link.expiresAt && <div className="small muted">Valid until {new Date(link.expiresAt).toLocaleDateString()}.</div>}
        </div>
      )}
      {project.approvedAt && (
        <div className="small muted">
          Last approved by {project.approvedBy} on {new Date(project.approvedAt).toLocaleString()} (v{project.approvedVersion}).
        </div>
      )}
    </section>
  );
}
