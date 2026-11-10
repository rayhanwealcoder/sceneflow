"use client";

import { useCallback, useEffect, useState } from "react";
import { api, API_URL, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ACTION_LABEL, detailText, fmtDate, Pager } from "./shared";

interface Row {
  id: string;
  email: string;
  name: string;
  status: "active" | "disabled";
  platformRole: "user" | "super_admin";
  createdAt: string;
  lastSignInAt: string | null;
  workspaces: number;
  sessions: number;
}
interface Detail {
  user: Row;
  sessions: { active: number; newest: string | null };
  workspaces: Array<{ id: string; name: string; type: string; planId: string; role: string; owner: boolean; projects: number }>;
  audit: Array<{ action: string; actorEmail: string; detail: unknown; createdAt: string }>;
}

/** Accounts: search, filter, open one, then disable / enable, sign out everywhere, grant or remove super admin. */
/** `initialQuery`: opened from a workspace member row; the single match opens by itself. */
export function AdminUsers({ initialQuery, onOpenWorkspace }: { initialQuery?: string | null; onOpenWorkspace: (id: string) => void }) {
  const { user: me } = useSession();
  const [q, setQ] = useState(initialQuery ?? "");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ total: number; pageSize: number; users: Row[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** A temporary password or sign-in link, shown once (it is not stored in readable form anywhere). */
  const [secret, setSecret] = useState<{ kind: "password" | "link"; value: string; email: string; note: string } | null>(null);
  const [linkHours, setLinkHours] = useState(24);
  const [linkSetup, setLinkSetup] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (role) params.set("role", role);
    try {
      setList(await api(`/api/v1/admin/users?${params}`));
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }, [q, status, role, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (initialQuery && list?.users.length === 1 && list.users[0]!.email === initialQuery) setSelected((cur) => cur ?? list.users[0]!.id);
  }, [initialQuery, list]);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await api<Detail>(`/api/v1/admin/users/${id}`));
  }, []);
  useEffect(() => setSecret(null), [selected]);
  useEffect(() => {
    if (selected) void loadDetail(selected).catch((e) => setMsg({ ok: false, text: errorMessage(e) }));
    else setDetail(null);
  }, [selected, loadDetail]);

  async function act(question: string, run: () => Promise<string>) {
    if (!window.confirm(question)) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await run() });
      await Promise.all([load(), selected ? loadDetail(selected) : null]);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  const patch = (body: object) => api<{ endedSessions?: number }>(`/api/v1/admin/users/${detail!.user.id}`, { method: "PATCH", json: body });

  const u = detail?.user;
  const self = Boolean(u && me && u.id === me.id);
  return (
    <div className="stack" data-testid="admin-users">
      <div className="admin-filters">
        <input className="input" placeholder="Search name or e-mail" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="user-search" />
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <select className="input" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role">
          <option value="">Any role</option>
          <option value="super_admin">Super admins</option>
          <option value="user">Users</option>
        </select>
        <a
          className="btn sm"
          href={`${API_URL}/api/v1/admin/users.csv?${new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}), ...(role ? { role } : {}) })}`}
          data-testid="users-csv"
        >
          Download CSV
        </a>
      </div>
      {msg && <div className={`alert ${msg.ok ? "ok" : "error"}`} data-testid="admin-msg">{msg.text}</div>}

      {u && detail && (
        <section className="card stack" data-testid="user-detail">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{u.name}</h2>
            <button className="btn sm" onClick={() => setSelected(null)}>Close</button>
          </div>
          <dl className="kv">
            <dt>E-mail</dt><dd data-testid="user-email">{u.email}</dd>
            <dt>Status</dt>
            <dd>
              <span className={`badge ${u.status === "active" ? "ok" : "bad"}`} data-testid="user-status">{u.status}</span>
              {u.platformRole === "super_admin" && <span className="badge warn" style={{ marginLeft: 6 }}>super admin</span>}
            </dd>
            <dt>Joined</dt><dd>{fmtDate(u.createdAt)}</dd>
            <dt>Last sign-in</dt><dd>{fmtDate(u.lastSignInAt)}</dd>
            <dt>Signed in on</dt><dd>{detail.sessions.active} device{detail.sessions.active === 1 ? "" : "s"}</dd>
          </dl>
          <UserActions u={u} self={self} busy={busy} sessions={detail.sessions.active} act={act} patch={patch} />
          <div className="row">
            <button
              className="btn sm"
              disabled={busy || self || u.platformRole === "super_admin" || u.status !== "active"}
              title={u.platformRole === "super_admin" ? "Not for super admins" : undefined}
              data-testid="impersonate-user"
              onClick={() =>
                void act(`Sign in as ${u.email} for up to an hour to see what they see? This is recorded in the audit log; password and profile changes stay off.`, async () => {
                  await api(`/api/v1/admin/users/${u.id}/impersonate`, { method: "POST" });
                  // Full page load: the admin's workspaces and cached data never leak into the user's view.
                  window.location.assign("/projects");
                  return "Signed in as the user.";
                })
              }
            >
              Sign in as this user
            </button>
            <button
              className="btn sm"
              disabled={busy || u.status !== "active"}
              data-testid="send-reset"
              onClick={() =>
                void act(`Send ${u.email} a link to choose a new password? The link goes only to their mailbox.`, async () => {
                  const r = await api<{ delivery: "email" | "log" }>(`/api/v1/admin/users/${u.id}/send-reset`, { method: "POST" });
                  return r.delivery === "email" ? "Reset link e-mailed." : "No mail service on this server: the link was written to the API log / data/outbox.";
                })
              }
            >
              Send password reset link
            </button>
          </div>
          <div className="stack" style={{ gap: 8 }} data-testid="no-mail-help">
            <span className="muted small">No access to their mailbox? Hand them one of these yourself (chat, phone). Both are shown once and recorded in the audit log.</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                className="btn sm"
                disabled={busy || self || u.platformRole === "super_admin" || u.status !== "active"}
                data-testid="temp-password"
                onClick={() =>
                  void act(`Give ${u.email} a temporary password? Their current password stops working, every device is signed out, and their next sign-in asks for a new password.`, async () => {
                    const r = await api<{ password: string; endedSessions: number }>(`/api/v1/admin/users/${u.id}/temp-password`, { method: "POST" });
                    setSecret({ kind: "password", value: r.password, email: u.email, note: "Works for one sign-in: they must choose their own password right after." });
                    return `Temporary password set; ${r.endedSessions} session${r.endedSessions === 1 ? "" : "s"} ended.`;
                  })
                }
              >
                Set temporary password
              </button>
              <select className="input sm" value={linkHours} onChange={(e) => setLinkHours(Number(e.target.value))} aria-label="Link valid for" data-testid="link-hours" style={{ width: "auto" }}>
                <option value={1}>valid 1 hour</option>
                <option value={24}>valid 1 day</option>
                <option value={72}>valid 3 days</option>
                <option value={168}>valid 7 days</option>
              </select>
              <label className="small row" style={{ gap: 4 }}>
                <input type="checkbox" checked={linkSetup} onChange={(e) => setLinkSetup(e.target.checked)} data-testid="link-setup" />
                ask for a new password
              </label>
              <button
                className="btn sm"
                disabled={busy || self || u.platformRole === "super_admin" || u.status !== "active"}
                data-testid="create-login-link"
                onClick={() =>
                  void act(`Create a one-time sign-in link for ${u.email}? Anyone who opens it can sign in as them, so send it only to them. Earlier unused links stop working.`, async () => {
                    const r = await api<{ link: string; expiresAt: string; passwordSetup: boolean }>(`/api/v1/admin/users/${u.id}/login-link`, { method: "POST", json: { hours: linkHours, passwordSetup: linkSetup } });
                    setSecret({ kind: "link", value: r.link, email: u.email, note: `Works once, until ${fmtDate(r.expiresAt)}.${r.passwordSetup ? " They choose a new password right after signing in." : ""}` });
                    return "Sign-in link created.";
                  })
                }
              >
                Create sign-in link
              </button>
            </div>
            {secret && <SecretBox secret={secret} onClose={() => setSecret(null)} />}
          </div>
          <h3 style={{ margin: 0 }}>Workspaces</h3>
          <div className="table-wrap">
            <table className="data-table small">
              <thead><tr><th>Workspace</th><th>Role</th><th>Plan</th><th>Projects</th></tr></thead>
              <tbody>
                {detail.workspaces.map((w) => (
                  <tr key={w.id} className="clickable" onClick={() => onOpenWorkspace(w.id)}>
                    <td>{w.name}</td><td>{w.owner ? "owner" : w.role}</td><td>{w.planId}</td><td>{w.projects}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.audit.length > 0 && (
            <>
              <h3 style={{ margin: 0 }}>Admin history</h3>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {detail.audit.map((a, i) => (
                  <li key={i}>{ACTION_LABEL[a.action] ?? a.action} by {a.actorEmail} · {timeAgo(a.createdAt)}{detailText(a.detail) ? ` · ${detailText(a.detail)}` : ""}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <div className="card table-wrap">
        <table className="data-table small" data-testid="users-table">
          <thead><tr><th>Name</th><th>E-mail</th><th>Status</th><th>Workspaces</th><th>Last sign-in</th><th>Joined</th></tr></thead>
          <tbody>
            {list?.users.map((r) => (
              <tr key={r.id} className={`clickable${r.id === selected ? " selected" : ""}`} onClick={() => setSelected(r.id)} data-email={r.email}>
                <td>{r.name}{r.platformRole === "super_admin" && <span className="badge warn" style={{ marginLeft: 6 }}>admin</span>}</td>
                <td>{r.email}</td>
                <td><span className={`badge ${r.status === "active" ? "ok" : "bad"}`}>{r.status}</span></td>
                <td>{r.workspaces}</td>
                <td>{r.lastSignInAt ? timeAgo(r.lastSignInAt) : "never"}</td>
                <td>{timeAgo(r.createdAt)}</td>
              </tr>
            ))}
            {list && list.users.length === 0 && <tr><td colSpan={6} className="muted">No accounts match.</td></tr>}
          </tbody>
        </table>
      </div>
      {list && <Pager page={page} pageSize={list.pageSize} total={list.total} onPage={setPage} />}
    </div>
  );
}

type Act = (question: string, run: () => Promise<string>) => Promise<void>;

/** The four account actions; each asks first. Disable / remove super admin are off on your own account. */
function UserActions({ u, self, busy, sessions, act, patch }: { u: Row; self: boolean; busy: boolean; sessions: number; act: Act; patch: (body: object) => Promise<{ endedSessions?: number }> }) {
  const notSelf = self ? "Not on your own account" : undefined;
  return (
    <div className="row">
      {u.status === "active" ? (
        <button
          className="btn sm"
          disabled={busy || self}
          title={notSelf}
          data-testid="disable-user"
          onClick={() =>
            void act(`Disable ${u.email}? They are signed out everywhere and cannot sign in until enabled again. Nothing is deleted.`, async () => {
              const r = await patch({ status: "disabled" });
              return `Disabled. ${r.endedSessions ?? 0} session(s) ended.`;
            })
          }
        >
          Disable account
        </button>
      ) : (
        <button className="btn sm primary" disabled={busy} data-testid="enable-user" onClick={() => void act(`Enable ${u.email} again?`, async () => (await patch({ status: "active" }), "Enabled. They can sign in again."))}>
          Enable account
        </button>
      )}
      <button
        className="btn sm"
        disabled={busy || sessions === 0}
        data-testid="signout-user"
        onClick={() =>
          void act(`Sign ${u.email} out on every device?${self ? " This browser stays signed in." : ""}`, async () => {
            const r = await api<{ endedSessions: number }>(`/api/v1/admin/users/${u.id}/sign-out`, { method: "POST" });
            return `${r.endedSessions} session(s) ended.`;
          })
        }
      >
        Sign out everywhere
      </button>
      {u.platformRole === "super_admin" ? (
        <button className="btn sm" disabled={busy || self} title={notSelf} data-testid="revoke-admin" onClick={() => void act(`Remove super admin from ${u.email}?`, async () => (await patch({ platformRole: "user" }), "Super admin removed."))}>
          Remove super admin
        </button>
      ) : (
        <button
          className="btn sm"
          disabled={busy || u.status !== "active"}
          data-testid="grant-admin"
          onClick={() => void act(`Make ${u.email} a super admin? They will see every account and workspace on this server.`, async () => (await patch({ platformRole: "super_admin" }), "Now a super admin."))}
        >
          Make super admin
        </button>
      )}
    </div>
  );
}

/** The temporary password / sign-in link, with a copy button. Closing it is final: it is not shown again. */
function SecretBox({ secret, onClose }: { secret: { kind: "password" | "link"; value: string; email: string; note: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret.value);
      setCopied(true);
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  }
  return (
    <div className="alert ok stack" style={{ gap: 6 }} data-testid="secret-box">
      <strong>{secret.kind === "password" ? "Temporary password" : "Sign-in link"} for {secret.email}</strong>
      <code style={{ userSelect: "all", overflowWrap: "anywhere", fontSize: 15 }} data-testid="secret-value">
        {secret.value}
      </code>
      <span className="small">{secret.note} It is shown only now.</span>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => void copy()} data-testid="secret-copy">
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
