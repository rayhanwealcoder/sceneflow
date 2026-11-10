"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtBytes, timeAgo } from "@/lib/format";
import { ACTION_LABEL, detailText, Pager } from "./shared";

interface Row {
  id: string;
  name: string;
  type: string;
  planId: string;
  createdAt: string;
  owner: { id: string; email: string; name: string };
  members: number;
  projects: number;
  published: number;
  sites: number;
  storageBytes: number;
}
interface Detail {
  workspace: { id: string; name: string; type: string; planId: string; createdAt: string };
  plans: string[];
  members: Array<{ id: string; email: string; name: string; status: string; role: string }>;
  projects: Array<{ id: string; name: string; status: string; publishedVersion: number | null; updatedAt: string }>;
  sites: Array<{ id: string; url: string; name: string | null; platform: string; status: string; connectorVersion: string | null; lastSeenAt: string | null }>;
  usage: { files: number; bytes: number; exports: number; events7d: number };
  audit: Array<{ action: string; actorEmail: string; detail: unknown; createdAt: string }>;
}

/** Workspaces: search by name or owner, filter by plan, open one (members, sites, projects, usage), change its plan. */
export function AdminWorkspaces({ openId, onOpenUser }: { openId: string | null; onOpenUser: (email: string) => void }) {
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ total: number; pageSize: number; plans: string[]; workspaces: Row[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(openId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setSelected(openId), [openId]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page) });
    if (q.trim()) p.set("q", q.trim());
    if (plan) p.set("plan", plan);
    try {
      setList(await api(`/api/v1/admin/workspaces?${p}`));
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }, [q, plan, page]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const loadDetail = useCallback(async (id: string) => setDetail(await api<Detail>(`/api/v1/admin/workspaces/${id}`)), []);
  useEffect(() => {
    if (selected) void loadDetail(selected).catch((e) => setMsg({ ok: false, text: errorMessage(e) }));
    else setDetail(null);
  }, [selected, loadDetail]);

  async function changePlan(planId: string) {
    if (!detail || planId === detail.workspace.planId) return;
    if (!window.confirm(`Change "${detail.workspace.name}" from ${detail.workspace.planId} to ${planId}?`)) return;
    try {
      await api(`/api/v1/admin/workspaces/${detail.workspace.id}`, { method: "PATCH", json: { planId } });
      setMsg({ ok: true, text: `Plan changed to ${planId}.` });
      await Promise.all([load(), loadDetail(detail.workspace.id)]);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }

  const d = detail;
  return (
    <div className="stack" data-testid="admin-workspaces">
      <div className="admin-filters">
        <input
          className="input"
          placeholder="Search workspace or owner e-mail"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          data-testid="workspace-search"
        />
        <select
          className="input"
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
            setPage(1);
          }}
          aria-label="Plan"
        >
          <option value="">Any plan</option>
          {(list?.plans ?? []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {msg && (
        <div className={`alert ${msg.ok ? "ok" : "error"}`} data-testid="admin-msg">
          {msg.text}
        </div>
      )}

      {d && (
        <section className="card stack" data-testid="workspace-detail">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{d.workspace.name}</h2>
            <button className="btn sm" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="row">
            <span className="small muted">Plan</span>
            <select className="input sm" style={{ width: "auto" }} value={d.workspace.planId} onChange={(e) => void changePlan(e.target.value)} data-testid="plan-select" aria-label="Plan">
              {d.plans.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="muted small">
              {d.workspace.type} · created {timeAgo(d.workspace.createdAt)} · {d.usage.files} files, {fmtBytes(d.usage.bytes)} · {d.usage.exports} exports · {d.usage.events7d} player events in 7 days
            </span>
          </div>
          <div className="two-col">
            <div className="table-wrap">
              <table className="data-table small">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.members.map((m) => (
                    <tr key={m.id} className="clickable" onClick={() => onOpenUser(m.email)} title="Open this account">
                      <td>
                        {m.name}
                        <br />
                        <span className="muted">{m.email}</span>
                      </td>
                      <td>{m.role}</td>
                      <td>{m.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="data-table small">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Status</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {d.sites.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.name ?? s.url}
                        <br />
                        <span className="muted">{s.url}</span>
                      </td>
                      <td>{s.status}</td>
                      <td>{s.lastSeenAt ? timeAgo(s.lastSeenAt) : "never"}</td>
                    </tr>
                  ))}
                  {d.sites.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No sites connected.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table small">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Published</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {d.projects.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.status}</td>
                    <td>{p.publishedVersion ? `v${p.publishedVersion}` : "no"}</td>
                    <td>{timeAgo(p.updatedAt)}</td>
                  </tr>
                ))}
                {d.projects.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No projects yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {d.audit.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="workspace-history">
              {d.audit.map((a, i) => (
                <li key={i}>
                  {ACTION_LABEL[a.action] ?? a.action} by {a.actorEmail} · {timeAgo(a.createdAt)}
                  {detailText(a.detail) ? ` · ${detailText(a.detail)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="card table-wrap">
        <table className="data-table small" data-testid="workspaces-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Owner</th>
              <th>Plan</th>
              <th>Members</th>
              <th>Published / projects</th>
              <th>Sites</th>
              <th>Storage</th>
            </tr>
          </thead>
          <tbody>
            {list?.workspaces.map((w) => (
              <tr key={w.id} className={`clickable${w.id === selected ? " selected" : ""}`} onClick={() => setSelected(w.id)} data-owner={w.owner.email}>
                <td>{w.name}</td>
                <td>{w.owner.email}</td>
                <td>{w.planId}</td>
                <td>{w.members}</td>
                <td>
                  {w.published} / {w.projects}
                </td>
                <td>{w.sites}</td>
                <td>{fmtBytes(w.storageBytes)}</td>
              </tr>
            ))}
            {list && list.workspaces.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No workspaces match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list && <Pager page={page} pageSize={list.pageSize} total={list.total} onPage={setPage} />}
    </div>
  );
}
