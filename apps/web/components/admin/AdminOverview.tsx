"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { Stat } from "./shared";

interface Overview {
  users: { total: number; disabled: number; superAdmins: number; signups7d: number; signups30d: number; active7d: number };
  workspaces: { total: number; team: number; byPlan: Array<{ planId: string; count: number }> };
  projects: { total: number; published: number };
  sites: { total: number; connected: number };
  media: { files: number; bytes: number };
  exports: { last7d: number; failed7d: number };
  analytics: { events7d: number };
  topStorage: Array<{ id: string; name: string; planId: string; bytes: number; files: number }>;
}

export function AdminOverview({ onOpenWorkspace }: { onOpenWorkspace: (id: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Overview>("/api/v1/admin/overview").then(setData, (e) => setError(errorMessage(e)));
  }, []);
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const d = data;
  return (
    <div className="stack" data-testid="admin-overview">
      <div className="stat-grid">
        <Stat label="Accounts" value={d.users.total} hint={`${d.users.disabled} disabled · ${d.users.superAdmins} super admin(s)`} />
        <Stat label="New · 7 days" value={d.users.signups7d} hint={`${d.users.signups30d} in 30 days`} />
        <Stat label="Signed in · 7 days" value={d.users.active7d} />
        <Stat label="Workspaces" value={d.workspaces.total} hint={`${d.workspaces.team} teams`} />
        <Stat label="Published / projects" value={`${d.projects.published} / ${d.projects.total}`} />
        <Stat label="Connected sites" value={`${d.sites.connected} / ${d.sites.total}`} />
        <Stat label="Uploads" value={fmtBytes(d.media.bytes)} hint={`${d.media.files} files (originals)`} />
        <Stat label="MP4 exports · 7 days" value={d.exports.last7d} hint={`${d.exports.failed7d} failed`} />
        <Stat label="Player events · 7 days" value={d.analytics.events7d} />
      </div>
      <div className="two-col">
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Plans</h2>
          <table className="data-table small">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Workspaces</th>
              </tr>
            </thead>
            <tbody>
              {d.workspaces.byPlan.map((p) => (
                <tr key={p.planId}>
                  <td>{p.planId}</td>
                  <td>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ margin: 0 }}>
            Plans carry no prices or limits yet; billing will attach them.
          </p>
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Most storage</h2>
          <table className="data-table small">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Plan</th>
                <th>Files</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {d.topStorage.map((w) => (
                <tr key={w.id} className="clickable" onClick={() => onOpenWorkspace(w.id)}>
                  <td>{w.name}</td>
                  <td>{w.planId}</td>
                  <td>{w.files}</td>
                  <td>{fmtBytes(w.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
