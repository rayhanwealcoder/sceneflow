"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Pager } from "./shared";

interface Site {
  id: string;
  url: string;
  name: string | null;
  platform: string;
  status: "pending" | "connected" | "error";
  connectorVersion: string | null;
  platformVersion: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  createdAt: string;
  published: number;
  outdated: boolean;
  workspace: { id: string; name: string; ownerEmail: string };
}

const DOT: Record<Site["status"], string> = { connected: "ok", pending: "warn", error: "bad" };

/** Every website connected to this server: is it reachable, which plugin version, when did it last answer. */
export function AdminSites({ onOpenWorkspace }: { onOpenWorkspace: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; latest: Record<string, string>; sites: Site[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState<string | null>(null);

  /** Asks the site's plugin again (the stored version is otherwise from pairing time). */
  async function check(id: string) {
    setChecking(id);
    setError(null);
    try {
      await api(`/api/v1/admin/sites/${id}/check`, { method: "POST" });
      setReload((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(null);
    }
  }

  useEffect(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    const t = setTimeout(() => {
      api<{ total: number; pageSize: number; latest: Record<string, string>; sites: Site[] }>(`/api/v1/admin/sites?${p}`).then(setData, (e) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, status, page, reload]);

  const outdated = data?.sites.filter((s) => s.outdated).length ?? 0;
  return (
    <div className="stack" data-testid="admin-sites">
      <div className="admin-filters">
        <input
          className="input"
          placeholder="Search site address, name or workspace"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          data-testid="site-search"
        />
        <select
          className="input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Status"
        >
          <option value="">Any status</option>
          <option value="connected">Connected</option>
          <option value="error">Error</option>
          <option value="pending">Pending</option>
        </select>
        {data?.latest.wordpress && <span className="muted small">Latest WordPress plugin: {data.latest.wordpress}</span>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {outdated > 0 && (
        <div className="alert" data-testid="outdated-note">
          {outdated} site{outdated === 1 ? " runs" : "s run"} an older plugin on this page. New features (and fixes) arrive when the site owner updates it.
        </div>
      )}
      <div className="card table-wrap">
        <table className="data-table small" data-testid="sites-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Workspace</th>
              <th>Status</th>
              <th>Plugin</th>
              <th>Platform</th>
              <th>Published</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.sites.map((s) => (
              <tr key={s.id} data-url={s.url}>
                <td>
                  {s.name ?? s.url}
                  <br />
                  <a className="muted" href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.url}
                  </a>
                </td>
                <td className="clickable" onClick={() => onOpenWorkspace(s.workspace.id)} style={{ cursor: "pointer" }}>
                  {s.workspace.name}
                  <br />
                  <span className="muted">{s.workspace.ownerEmail}</span>
                </td>
                <td title={s.lastError ?? undefined}>
                  <span className={`dot ${DOT[s.status]}`} />
                  {s.status}
                  {s.lastError && (
                    <>
                      <br />
                      <span className="muted" style={{ overflowWrap: "anywhere" }}>
                        {s.lastError.slice(0, 120)}
                      </span>
                    </>
                  )}
                </td>
                <td>
                  {s.connectorVersion ?? "?"}
                  {s.outdated && (
                    <span className="badge warn" style={{ marginLeft: 6 }}>
                      update
                    </span>
                  )}
                </td>
                <td>
                  {s.platform}
                  {s.platformVersion ? ` ${s.platformVersion}` : ""}
                </td>
                <td>{s.published}</td>
                <td>{s.lastSeenAt ? timeAgo(s.lastSeenAt) : "never"}</td>
                <td>
                  <button className="btn sm" disabled={checking !== null} onClick={() => void check(s.id)} data-testid="site-check">
                    {checking === s.id ? "Checking…" : "Check now"}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.sites.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No sites match.
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
