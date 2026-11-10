"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { ACTION_LABEL, detailText, fmtDate, Pager } from "./shared";

interface Entry {
  id: string;
  actorEmail: string;
  action: string;
  targetType: "user" | "workspace" | "job" | "site" | "system";
  targetId: string;
  targetLabel: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

/** Every change a super admin made, newest first. Read-only. */
export function AdminAudit() {
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; entries: Entry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (type) p.set("targetType", type);
    api<{ total: number; pageSize: number; entries: Entry[] }>(`/api/v1/admin/audit?${p}`).then(setData, (e) => setError(errorMessage(e)));
  }, [type, page]);

  return (
    <div className="stack" data-testid="admin-audit">
      <div className="admin-filters">
        <select
          className="input"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          aria-label="What changed"
        >
          <option value="">Everything</option>
          <option value="user">Accounts</option>
          <option value="workspace">Workspaces</option>
          <option value="job">Jobs</option>
          <option value="site">Sites</option>
          <option value="system">Exports</option>
        </select>
        <span className="muted small">Every change made in this console or with the server CLI. Entries cannot be edited.</span>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card table-wrap">
        <table className="data-table small" data-testid="audit-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>On</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.createdAt)}</td>
                <td>{e.actorEmail}</td>
                <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                <td>{e.targetLabel ?? e.targetId}</td>
                <td className="muted">
                  {detailText(e.detail)}
                  {e.ip ? ` · ${e.ip}` : ""}
                </td>
              </tr>
            ))}
            {data && data.entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
