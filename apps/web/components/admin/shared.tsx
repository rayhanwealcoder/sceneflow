"use client";

import type { ReactNode } from "react";

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span className="muted small">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager small muted">
      <span>
        {total} total · page {page} of {pages}
      </span>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

/** Human labels for audit actions. */
export const ACTION_LABEL: Record<string, string> = {
  "user.disable": "Disabled account",
  "user.enable": "Enabled account",
  "user.grant_super_admin": "Made super admin",
  "user.revoke_super_admin": "Removed super admin",
  "user.sign_out_everywhere": "Signed out everywhere",
  "workspace.change_plan": "Changed plan",
  "job.retry": "Retried job",
  "user.impersonate_start": "Signed in as",
  "user.impersonate_stop": "Returned from signing in as",
  "user.send_password_reset": "Sent password reset link",
  "users.export_csv": "Downloaded accounts CSV",
  "site.check": "Checked site",
};

export function detailText(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const d = detail as Record<string, unknown>;
  const parts: string[] = [];
  if ("from" in d && "to" in d) parts.push(`${String(d.from)} → ${String(d.to)}`);
  if (typeof d.endedSessions === "number") parts.push(`${d.endedSessions} session${d.endedSessions === 1 ? "" : "s"} ended`);
  if (d.via === "cli") parts.push("from the server CLI");
  if (typeof d.rows === "number") parts.push(`${d.rows} rows`);
  if (typeof d.minutes === "number") parts.push(`${d.minutes} min session`);
  if (d.delivery === "email") parts.push("e-mailed");
  if (d.delivery === "log") parts.push("written to the outbox (no mail service)");
  return parts.join(" · ");
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "never");
