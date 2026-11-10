"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ReviewChip } from "@/components/ReviewStatus";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Activity, Dashboard, DashboardProject } from "@/lib/types";

/*
 * Agency dashboard (doc §23 "portfolio dashboard, connection / performance alerts"): one page that answers
 * "what needs my attention, and how is every client's video doing?" — alerts first, then mentions of you,
 * then projects grouped by client with site health and 7-day numbers, then what happened recently.
 */

const ACTIVITY_TEXT: Record<Activity["type"], (a: Activity) => string> = {
  review_requested: (a) => `${a.actorName} sent “${a.projectName}” for internal review`,
  client_review_requested: (a) => `${a.actorName} sent “${a.projectName}” to the client`,
  approved: (a) => `${a.actorName} approved “${a.projectName}”${a.detail?.startsWith("v") ? ` (${a.detail})` : ""}`,
  changes_requested: (a) => `${a.actorName} requested changes on “${a.projectName}”`,
  review_reset: (a) => `${a.actorName} moved “${a.projectName}” back to draft`,
  published: (a) => `${a.actorName} published “${a.projectName}” ${a.detail ?? ""}`,
  comment: (a) => `${a.actorName} commented on “${a.projectName}”`,
  client_comment: (a) => `${a.actorName} (client) commented on “${a.projectName}”`,
  exported: (a) => `${a.actorName} downloaded “${a.projectName}” as MP4${a.detail ? ` (${a.detail})` : ""}`,
};
const ICON: Record<Dashboard["alerts"][number]["severity"], string> = { fail: "✕", warn: "!", info: "i" };

export default function DashboardPage() {
  const { user, workspace } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);
  useEffect(() => {
    if (!user || !workspace) return;
    setData(null);
    api<Dashboard>(`/api/v1/workspaces/${workspace.id}/dashboard`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [user, workspace]);

  const groups = useMemo(() => {
    if (!data) return [];
    const out: Array<{ id: string | null; name: string; projects: DashboardProject[] }> = data.clients.map((c) => ({ id: c.id, name: c.name, projects: data.projects.filter((p) => p.clientId === c.id) }));
    const none = data.projects.filter((p) => !p.clientId);
    if (none.length) out.push({ id: null, name: data.clients.length ? "No client" : "Projects", projects: none });
    return out.filter((g) => g.projects.length > 0);
  }, [data]);

  if (!user || !workspace) return <p className="muted">Loading…</p>;
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading dashboard…</p>;
  const t = data.totals;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {workspace.name} · {t.projects} project{t.projects === 1 ? "" : "s"}
            {data.clients.length ? ` · ${data.clients.length} client${data.clients.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="row">
          <Link className="btn" href="/team">
            Team &amp; clients
          </Link>
          <Link className="btn primary" href="/projects">
            New video
          </Link>
        </div>
      </div>

      <div className="stat-grid" data-testid="dash-totals">
        <Stat label="Published" value={`${t.published} / ${t.projects}`} />
        <Stat label="In review" value={t.inReview} />
        <Stat label="Open comments" value={t.openComments} />
        <Stat label="Loads · 7 days" value={t.loads7d} />
        <Stat label="Plays · 7 days" value={t.plays7d} />
        <Stat label="Clicks · 7 days" value={t.clicks7d} />
      </div>

      {data.alerts.length > 0 && (
        <section className="card stack" data-testid="dash-alerts">
          <h2 style={{ margin: 0 }}>Needs attention ({data.alerts.length})</h2>
          <div className="list small">
            {data.alerts.map((a, i) => (
              <div key={i} className={`list-item diag ${a.severity}`}>
                <span className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <span className={`diag-icon ${a.severity}`} aria-hidden="true">
                    {ICON[a.severity]}
                  </span>
                  <span>
                    <strong>{a.title}</strong>
                    {a.detail && <div className="muted">{a.detail}</div>}
                  </span>
                </span>
                <Link className="btn sm" href={a.href}>
                  Open
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.mentions.length > 0 && (
        <section className="card stack" data-testid="dash-mentions">
          <h2 style={{ margin: 0 }}>Mentions of you ({data.mentions.length})</h2>
          <div className="list small">
            {data.mentions.map((m) => (
              <Link key={m.id} className="list-item" href={`/projects/${m.projectId}/editor?comments=1`}>
                <span>
                  <strong>{m.authorName}</strong> in “{m.projectName}” · <span className="muted">{timeAgo(m.createdAt)}</span>
                  <div>{m.body}</div>
                </span>
                <span className="btn sm">Open</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <section className="card" data-testid="dash-empty">
          <p className="muted" style={{ margin: 0 }}>
            No projects yet. <Link href="/projects">Make your first video</Link> — it shows up here with its client, site and numbers.
          </p>
        </section>
      ) : (
        groups.map((g) => (
          <section key={g.id ?? "none"} className="card stack" data-testid="dash-group">
            <div className="row between">
              <h2 style={{ margin: 0 }}>{g.name}</h2>
              <span className="muted small">
                {g.projects.length} project{g.projects.length === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Live</th>
                    <th>Review</th>
                    <th>Site</th>
                    <th>Comments</th>
                    <th title="Last 7 days">Loads</th>
                    <th title="Last 7 days">Plays</th>
                    <th title="Last 7 days">Clicks</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {g.projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/projects/${p.id}`}>
                          <strong>{p.name}</strong>
                        </Link>
                      </td>
                      <td>
                        {p.publishedVersion ? (
                          <span className={`badge ${p.draftNewer ? "warn" : "ok"}`} title={p.draftNewer ? `Draft v${p.currentDraftVersion} is newer than the live version` : "The latest draft is live"}>
                            v{p.publishedVersion}
                            {p.draftNewer ? " · newer draft" : ""}
                          </span>
                        ) : (
                          <span className="badge">not published</span>
                        )}
                      </td>
                      <td>
                        <ReviewChip project={p} />
                      </td>
                      <td>
                        {p.site ? (
                          <span title={p.site.lastError ?? p.site.url}>
                            <span className={`dot ${p.site.connectionStatus === "connected" ? "ok" : p.site.connectionStatus === "error" ? "bad" : "warn"}`} /> {p.site.name ?? p.site.url}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {p.openComments > 0 ? (
                          <Link href={`/projects/${p.id}/editor?comments=1`}>{p.openComments} open</Link>
                        ) : (
                          <span className="muted">{p.totalComments ? "all resolved" : "—"}</span>
                        )}
                      </td>
                      <td>{p.stats7d.loads}</td>
                      <td>{p.stats7d.plays}</td>
                      <td>{p.stats7d.clicks}</td>
                      <td className="muted">{timeAgo(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <section className="card stack" data-testid="dash-activity">
        <h2 style={{ margin: 0 }}>Recent activity</h2>
        {data.activity.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Reviews, approvals, comments and publishes show up here.
          </p>
        ) : (
          <div className="list small">
            {data.activity.map((a) => (
              <Link key={a.id} className="list-item" href={a.type === "comment" || a.type === "client_comment" ? `/projects/${a.projectId}/editor?comments=1` : `/projects/${a.projectId}`}>
                <span>
                  {ACTIVITY_TEXT[a.type](a)}
                  {a.detail && !a.detail.startsWith("v") && <div className="muted">“{a.detail}”</div>}
                </span>
                <span className="muted">{timeAgo(a.createdAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
