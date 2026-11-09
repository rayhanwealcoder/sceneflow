"use client";

import Link from "next/link";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Diagnostic } from "@/lib/types";

const ICON: Record<Diagnostic["status"], string> = { ok: "✓", info: "i", warn: "!", fail: "✕" };

/** "Something not working?" — runs the server-side chain check and shows what to do, in order. */
export function Troubleshoot({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Diagnostic[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ checks: Diagnostic[] }>(`/api/v1/projects/${projectId}/diagnostics`);
      setChecks(r.checks);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const problems = checks?.filter((c) => c.status === "fail" || c.status === "warn") ?? [];

  return (
    <>
      <button className="btn sm" onClick={() => void run()} title="Checks the whole chain: media, publish, site connection, what the site serves, placements">
        Something not working?
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <div className="modal stack" style={{ width: "min(640px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>Checking your video</h2>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => void run()} disabled={busy}>
                  {busy ? "Checking…" : "Run again"}
                </button>
                <button className="btn sm" onClick={() => setOpen(false)}>
                  Close
                </button>
              </span>
            </div>
            {error && <div className="alert error small">{error}</div>}
            {checks && (
              <p className="small muted" style={{ margin: 0 }}>
                {problems.length === 0 ? "Everything checks out. If the video still does not show, clear your site's cache and reload the page." : `${problems.length} thing(s) to look at — fixes are in order from top to bottom.`}
              </p>
            )}
            <div className="list small">
              {(checks ?? []).map((c) => (
                <div key={c.id} className={`list-item diag ${c.status}`}>
                  <span className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "nowrap" }}>
                    <span className={`diag-icon ${c.status}`} aria-hidden="true">
                      {ICON[c.status]}
                    </span>
                    <span>
                      <strong>{c.title}</strong>
                      {c.detail && <div className="muted">{c.detail}</div>}
                    </span>
                  </span>
                  {c.fix && c.status !== "ok" ? (
                    c.fix.href.startsWith("http") ? (
                      <a className="btn sm" href={c.fix.href} target="_blank" rel="noreferrer">
                        {c.fix.label} ↗
                      </a>
                    ) : (
                      <Link className="btn sm" href={c.fix.href} onClick={() => setOpen(false)}>
                        {c.fix.label}
                      </Link>
                    )
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
