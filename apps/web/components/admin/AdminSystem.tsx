"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtBytes, timeAgo } from "@/lib/format";

interface System {
  workers: Array<{ id: string; host: string; pid: number; startedAt: string; lastSeenAt: string; online: boolean; info: Record<string, unknown> }>;
  queues: Array<{ name: string; counts: Record<string, number> }>;
  queueAvailable: boolean;
  canRetry: boolean;
  failedExports: Array<{ id: string; error: string | null; failedAt: string | null; requestedBy: string; project: { id: string; name: string }; workspaceName: string }>;
  failedJobs: Array<{ id: string; queue: string; data: unknown; error: string | null; retries: number; createdAt: string; failedAt: string | null }>;
  stuck: { exportsRendering: number; exportsWaiting: number; media: number; mediaFailed: number };
  mail: { provider: string; label: string; delivers: boolean; from: string; hint: string | null };
  ai: { text: { label: string; real: boolean }; speech: { label: string } | null; transcription: { label: string } | null; hints: string[] } | null;
  storage: { provider: string };
  analytics?: { retentionDays: number; eventsApprox: number; orderLines: number };
  server: { node: string; uptimeSec: number; dbBytes: number; publicUrl: string; webOrigin: string };
}

const QUEUE_LABEL: Record<string, string> = {
  "media.process": "Uploads (poster + preview)",
  "media.renditions": "Device renditions",
  "media.frame": "Custom thumbnails",
  "export.render": "MP4 exports",
};
const STATES = ["created", "retry", "active", "completed", "failed"] as const;
const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);

/** The machine room: are workers alive, are queues moving, which providers are configured, is anything stuck. */
export function AdminSystem() {
  const [s, setS] = useState<System | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api<System>("/api/v1/admin/system").then(setS, (e) => setMsg({ ok: false, text: errorMessage(e) })), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function retry(job: System["failedJobs"][number]) {
    if (!window.confirm(`Run this ${QUEUE_LABEL[job.queue] ?? job.queue} job again?`)) return;
    try {
      await api(`/api/v1/admin/jobs/${job.id}/retry`, { method: "POST", json: { queue: job.queue } });
      setMsg({ ok: true, text: "Job is back in the queue." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }

  if (!s) return msg ? <div className="alert error">{msg.text}</div> : <p className="muted">Loading…</p>;
  const online = s.workers.filter((w) => w.online);
  const stuckTotal = s.stuck.exportsRendering + s.stuck.exportsWaiting + s.stuck.media;
  return (
    <div className="stack" data-testid="admin-system">
      {msg && <div className={`alert ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
      <div className="two-col">
        <section className="card stack">
          <h2 style={{ margin: 0 }}>
            <span className={`dot ${online.length ? "ok" : "bad"}`} />
            Workers
          </h2>
          {online.length === 0 && (
            <div className="alert error" data-testid="no-worker">
              No worker is running. Uploads stay at &quot;processing&quot; and MP4 exports wait until one starts (<code>pnpm --filter @sceneflow/worker start</code>).
            </div>
          )}
          <table className="data-table small" data-testid="workers">
            <tbody>
              {s.workers.map((w) => (
                <tr key={w.id}>
                  <td>
                    <span className={`dot ${w.online ? "ok" : "bad"}`} />
                    {w.host} · pid {w.pid}
                  </td>
                  <td>{w.online ? `up ${timeAgo(w.startedAt).replace(" ago", "")}` : `last seen ${timeAgo(w.lastSeenAt)}`}</td>
                  <td className="muted">{String(w.info.platform ?? "")}</td>
                </tr>
              ))}
              {s.workers.length === 0 && (
                <tr>
                  <td className="muted">No worker has reported in yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Services</h2>
          <dl className="kv" data-testid="services">
            <dt>E-mail</dt>
            <dd>
              <span className={`dot ${s.mail.delivers ? "ok" : "warn"}`} />
              {s.mail.label}
              {s.mail.delivers ? ` · from ${s.mail.from}` : ""}
            </dd>
            <dt>AI text</dt>
            <dd>
              <span className={`dot ${s.ai?.text.real ? "ok" : "warn"}`} />
              {s.ai?.text.label ?? "unknown"}
            </dd>
            <dt>Voice</dt>
            <dd>
              <span className={`dot ${s.ai?.speech ? "ok" : "warn"}`} />
              {s.ai?.speech?.label ?? "none"}
            </dd>
            <dt>Storage</dt>
            <dd>{s.storage.provider === "s3" ? "S3-compatible bucket" : "Local disk"}</dd>
            <dt>Analytics</dt>
            <dd data-testid="analytics-retention">
              {s.analytics ? `${s.analytics.retentionDays ? `kept ${s.analytics.retentionDays} days` : "kept forever"} · about ${s.analytics.eventsApprox.toLocaleString()} events · ${s.analytics.orderLines.toLocaleString()} sold order lines` : "unknown"}
            </dd>
            <dt>Database</dt>
            <dd>{fmtBytes(s.server.dbBytes)}</dd>
            <dt>API</dt>
            <dd>
              {s.server.publicUrl} · Node {s.server.node} · up {uptime(s.server.uptimeSec)}
            </dd>
          </dl>
          {s.mail.hint && <p className="muted small" style={{ margin: 0 }}>{s.mail.hint}</p>}
        </section>
      </div>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>
          <span className={`dot ${stuckTotal ? "warn" : "ok"}`} />
          Queues
        </h2>
        {!s.queueAvailable && <p className="muted small">The job queue has not been created on this database yet (it appears when the API or worker starts).</p>}
        <div className="table-wrap">
          <table className="data-table small" data-testid="queues">
            <thead>
              <tr>
                <th>Queue</th>
                {STATES.map((st) => (
                  <th key={st}>{st === "created" ? "waiting" : st}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.queues.map((q) => (
                <tr key={q.name}>
                  <td>{QUEUE_LABEL[q.name] ?? q.name}</td>
                  {STATES.map((st) => (
                    <td key={st} style={st === "failed" && q.counts[st] ? { color: "var(--danger)" } : undefined}>
                      {q.counts[st] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Stuck right now: {s.stuck.exportsRendering} export(s) rendering for over 15 min, {s.stuck.exportsWaiting} waiting over 15 min, {s.stuck.media} upload(s) processing for over 30 min. {s.stuck.mediaFailed} upload(s) failed in total.
        </p>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Failed MP4 exports ({s.failedExports.length})</h2>
        {s.failedExports.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            None.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table small" data-testid="failed-exports">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Workspace</th>
                  <th>Asked by</th>
                  <th>Error</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {s.failedExports.map((e) => (
                  <tr key={e.id}>
                    <td>{e.project.name}</td>
                    <td>{e.workspaceName}</td>
                    <td>{e.requestedBy}</td>
                    <td style={{ maxWidth: 380, overflowWrap: "anywhere" }}>{e.error ?? "unknown"}</td>
                    <td>{e.failedAt ? timeAgo(e.failedAt) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Failed jobs ({s.failedJobs.length})</h2>
        {s.failedJobs.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Nothing failed.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table small" data-testid="failed-jobs">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Error</th>
                  <th>Tries</th>
                  <th>Failed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.failedJobs.map((j) => (
                  <tr key={j.id}>
                    <td>{QUEUE_LABEL[j.queue] ?? j.queue}</td>
                    <td style={{ maxWidth: 420, overflowWrap: "anywhere" }}>{j.error ?? "unknown"}</td>
                    <td>{j.retries}</td>
                    <td>{j.failedAt ? timeAgo(j.failedAt) : ""}</td>
                    <td>
                      <button className="btn sm" disabled={!s.canRetry} onClick={() => void retry(j)}>
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
