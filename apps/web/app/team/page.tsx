"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { copyText } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { BrandKitRow, Client, Invite, WorkspaceDetail, WorkspaceRole } from "@/lib/types";

/*
 * Team & clients (doc §23 team roles + client grouping). Invitations are links — no e-mail server needed:
 * the admin copies the link and sends it however they like. Clients are the agency's customers; a project
 * belongs to one client, and the client can get its own brand kit.
 */

const ROLE_HELP: Record<WorkspaceRole, string> = {
  viewer: "Sees projects, leaves comments. Cannot edit or publish.",
  editor: "Builds and publishes videos (only approved ones when a project requires approval).",
  admin: "Everything an editor does, plus approve, invite people, manage clients.",
  owner: "The account that created the workspace.",
};

export default function TeamPage() {
  const { user, workspace, refreshWorkspaces } = useSession();
  const router = useRouter();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [kits, setKits] = useState<BrandKitRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wsName, setWsName] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor" | "admin">("editor");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  /** After creating an invite with an address: was it e-mailed (this server can send mail) or is the link all there is? */
  const [inviteMail, setInviteMail] = useState<{ email: string; sent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [clientForm, setClientForm] = useState({ name: "", contactName: "", contactEmail: "", brandKitId: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", contactName: "", contactEmail: "", brandKitId: "", notes: "" });

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  const load = useCallback(async () => {
    if (!workspace) return;
    const d = await api<WorkspaceDetail>(`/api/v1/workspaces/${workspace.id}`);
    setDetail(d);
    setWsName(d.workspace.name);
    const admin = d.role === "admin" || d.role === "owner";
    const [c, k, i] = await Promise.all([
      api<{ clients: Client[] }>(`/api/v1/clients?workspaceId=${workspace.id}`),
      api<{ kits: BrandKitRow[] }>(`/api/v1/brand-kits?workspaceId=${workspace.id}`).catch(() => ({ kits: [] as BrandKitRow[] })),
      admin ? api<{ invites: Invite[] }>(`/api/v1/workspaces/${workspace.id}/invites`) : Promise.resolve({ invites: [] as Invite[] }),
    ]);
    setClients(c.clients);
    setKits(k.kits);
    setInvites(i.invites);
  }, [workspace]);

  useEffect(() => {
    if (!user || !workspace) return;
    load().catch((e) => setError(errorMessage(e)));
  }, [user, workspace, load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!user || !workspace) return <p className="muted">Loading…</p>;
  if (!detail) return error ? <div className="alert error">{error}</div> : <p className="muted">Loading team…</p>;
  const admin = detail.role === "admin" || detail.role === "owner";
  const canEdit = detail.role !== "viewer";

  const createInvite = (e: FormEvent) => {
    e.preventDefault();
    void run("invite", async () => {
      const addr = inviteEmail.trim();
      const r = await api<{ url: string; sent: boolean }>(`/api/v1/workspaces/${workspace.id}/invites`, { method: "POST", json: { role: inviteRole, email: addr || undefined } });
      setInviteUrl(r.url);
      setInviteMail(addr ? { email: addr, sent: r.sent } : null);
      setInviteEmail("");
      await refreshWorkspaces();
    });
  };
  const addClient = (e: FormEvent) => {
    e.preventDefault();
    void run("client", async () => {
      await api("/api/v1/clients", { method: "POST", json: { workspaceId: workspace.id, name: clientForm.name.trim(), contactName: clientForm.contactName.trim() || null, contactEmail: clientForm.contactEmail.trim() || null, brandKitId: clientForm.brandKitId || null } });
      setClientForm({ name: "", contactName: "", contactEmail: "", brandKitId: "" });
    });
  };
  const startEdit = (c: Client) => {
    setEditing(c.id);
    setEditForm({ name: c.name, contactName: c.contactName ?? "", contactEmail: c.contactEmail ?? "", brandKitId: c.brandKitId ?? "", notes: c.notes ?? "" });
  };
  const saveEdit = (id: string) =>
    run("edit", async () => {
      await api(`/api/v1/clients/${id}`, { method: "PATCH", json: { name: editForm.name.trim(), contactName: editForm.contactName.trim() || null, contactEmail: editForm.contactEmail.trim() || null, brandKitId: editForm.brandKitId || null, notes: editForm.notes.trim() || null } });
      setEditing(null);
    });

  return (
    <div className="stack">
      <div>
        <h1>Team &amp; clients</h1>
        <p className="muted">Who works in this workspace, and who the videos are for.</p>
      </div>
      {error && <div className="alert error">{error}</div>}

      <section className="card stack" id="team">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Team</h2>
          {admin ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (wsName.trim() && wsName.trim() !== detail.workspace.name) void run("rename", async () => { await api(`/api/v1/workspaces/${workspace.id}`, { method: "PATCH", json: { name: wsName.trim() } }); await refreshWorkspaces(); });
              }}
            >
              <input className="input sm" value={wsName} onChange={(e) => setWsName(e.target.value)} maxLength={120} aria-label="Workspace name" style={{ width: 240 }} />
              <button className="btn sm" type="submit" disabled={busy !== null || wsName.trim() === detail.workspace.name}>
                Rename
              </button>
            </form>
          ) : (
            <span className="muted small">{detail.workspace.name}</span>
          )}
        </div>
        <div className="list small" data-testid="members">
          {detail.members.map((m) => (
            <div key={m.userId} className="list-item">
              <span>
                <strong>{m.name}</strong>
                {m.userId === user.id ? " (you)" : ""} <span className="muted">· {m.email}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                {admin && m.role !== "owner" && m.userId !== user.id ? (
                  <select className="input sm" style={{ width: "auto" }} value={m.role} onChange={(e) => void run("role", () => api(`/api/v1/workspaces/${workspace.id}/members/${m.userId}`, { method: "PATCH", json: { role: e.target.value } }))} disabled={busy !== null} title={ROLE_HELP[m.role]}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span className="badge" title={ROLE_HELP[m.role]}>
                    {m.role}
                  </span>
                )}
                {((admin && m.role !== "owner" && m.userId !== user.id) || (m.userId === user.id && m.role !== "owner")) && (
                  <button className="btn sm" onClick={() => confirm(m.userId === user.id ? "Leave this workspace?" : `Remove ${m.name} from the workspace?`) && void run("remove", () => api(`/api/v1/workspaces/${workspace.id}/members/${m.userId}`, { method: "DELETE" }))} disabled={busy !== null}>
                    {m.userId === user.id ? "Leave" : "Remove"}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        <details className="small muted">
          <summary style={{ cursor: "pointer" }}>What each role can do</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {(Object.keys(ROLE_HELP) as WorkspaceRole[]).map((r) => (
              <li key={r}>
                <strong>{r}</strong> — {ROLE_HELP[r]}
              </li>
            ))}
          </ul>
        </details>

        {admin && (
          <div className="stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Invite someone</h3>
            <form className="row" onSubmit={createInvite}>
              <select className="input sm" style={{ width: "auto" }} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)} aria-label="Role">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <input className="input sm" style={{ flex: 1, minWidth: 220 }} type="email" placeholder="Only this e-mail may join (optional)" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <button className="btn sm primary" type="submit" disabled={busy !== null} data-testid="create-invite">
                {busy === "invite" ? "Creating…" : "Create invite link"}
              </button>
            </form>
            {inviteMail && (
              <div className={`alert${inviteMail.sent ? " ok" : ""}`} data-testid={inviteMail.sent ? "invite-sent" : "invite-not-sent"}>
                {inviteMail.sent ? `Invitation e-mailed to ${inviteMail.email}. The link below works too.` : `This server cannot send e-mail yet: copy the link below and send it to ${inviteMail.email} yourself.`}
              </div>
            )}
            {inviteUrl && (
              <div className="review-link">
                <code data-testid="invite-url">{inviteUrl}</code>
                <button className="btn sm" onClick={async () => { if (await copyText(inviteUrl)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              Send the link by e-mail or chat. It works for 7 days and once. The person signs in or creates a free account, then lands in this workspace.
            </p>
            {invites.length > 0 && (
              <div className="list small">
                {invites.map((i) => (
                  <div key={i.id} className="list-item">
                    <span>
                      Pending {i.role} invite{i.email ? ` for ${i.email}` : ""} <span className="muted">· valid until {new Date(i.expiresAt).toLocaleDateString()}</span>
                    </span>
                    <button className="btn sm" onClick={() => void run("revoke", () => api(`/api/v1/workspaces/${workspace.id}/invites/${i.id}`, { method: "DELETE" }))} disabled={busy !== null}>
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card stack" id="clients">
        <h2 style={{ margin: 0 }}>Clients</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Group videos by the customer they are for. A client can have its own brand kit — new videos for that client start with it. Clients never need an account: you send them a review link from the project page.
        </p>
        {clients.length > 0 && (
          <div className="list small" data-testid="clients">
            {clients.map((c) =>
              editing === c.id ? (
                <form
                  key={c.id}
                  className="list-item stack"
                  style={{ alignItems: "stretch" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit(c.id);
                  }}
                >
                  <div className="row">
                    <input className="input sm" style={{ flex: 1, minWidth: 160 }} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required maxLength={120} aria-label="Client name" />
                    <input className="input sm" style={{ flex: 1, minWidth: 140 }} placeholder="Contact name" value={editForm.contactName} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} maxLength={120} />
                    <input className="input sm" style={{ flex: 1, minWidth: 180 }} type="email" placeholder="Contact e-mail" value={editForm.contactEmail} onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })} maxLength={254} />
                    <select className="input sm" style={{ width: "auto" }} value={editForm.brandKitId} onChange={(e) => setEditForm({ ...editForm, brandKitId: e.target.value })} aria-label="Brand kit">
                      <option value="">Workspace brand kit</option>
                      {kits.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea className="input sm" rows={2} placeholder="Notes (tone, dos and don'ts…)" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} maxLength={2000} />
                  <div className="row">
                    <button className="btn sm primary" type="submit" disabled={busy !== null}>
                      Save
                    </button>
                    <button className="btn sm" type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div key={c.id} className="list-item">
                  <span>
                    <strong>{c.name}</strong>
                    <span className="muted">
                      {" "}
                      · {c.projectCount} video{c.projectCount === 1 ? "" : "s"}
                      {c.contactName || c.contactEmail ? ` · ${[c.contactName, c.contactEmail].filter(Boolean).join(", ")}` : ""}
                      {c.brandKitId ? ` · brand kit: ${kits.find((k) => k.id === c.brandKitId)?.name ?? "—"}` : ""}
                    </span>
                    {c.notes && <div className="muted">{c.notes}</div>}
                  </span>
                  {canEdit && (
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => startEdit(c)} disabled={busy !== null}>
                        Edit
                      </button>
                      {admin && (
                        <button className="btn sm" onClick={() => confirm(`Delete client “${c.name}”? Its videos stay, just without a client.`) && void run("delete", () => api(`/api/v1/clients/${c.id}`, { method: "DELETE" }))} disabled={busy !== null}>
                          Delete
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        )}
        {canEdit && (
          <form className="row" onSubmit={addClient}>
            <input className="input sm" style={{ flex: 1, minWidth: 180 }} placeholder="Client name, e.g. Acme Coffee" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} required maxLength={120} data-testid="client-name" />
            <input className="input sm" style={{ flex: 1, minWidth: 140 }} placeholder="Contact name (optional)" value={clientForm.contactName} onChange={(e) => setClientForm({ ...clientForm, contactName: e.target.value })} maxLength={120} />
            <input className="input sm" style={{ flex: 1, minWidth: 180 }} type="email" placeholder="Contact e-mail (optional)" value={clientForm.contactEmail} onChange={(e) => setClientForm({ ...clientForm, contactEmail: e.target.value })} maxLength={254} />
            {kits.length > 0 && (
              <select className="input sm" style={{ width: "auto" }} value={clientForm.brandKitId} onChange={(e) => setClientForm({ ...clientForm, brandKitId: e.target.value })} aria-label="Brand kit">
                <option value="">Workspace brand kit</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn sm primary" type="submit" disabled={busy !== null} data-testid="client-add">
              {busy === "client" ? "Adding…" : "Add client"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
