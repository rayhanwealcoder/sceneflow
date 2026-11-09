"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BrandKitCard } from "@/components/BrandKitCard";
import { Checklist } from "@/components/onboarding/Checklist";
import { GoalPicker } from "@/components/onboarding/GoalPicker";
import { ReviewChip } from "@/components/ReviewStatus";
import { SitesCard } from "@/components/SitesCard";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Client, Project } from "@/lib/types";

export default function ProjectsPage() {
  const { user, workspace, workspaces } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState<string>("all"); // all | none | <clientId>
  const [name, setName] = useState("");
  const [newClient, setNewClient] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user || !workspace) return;
    setProjects(null);
    (async () => {
      try {
        const [{ projects }, { clients }] = await Promise.all([api<{ projects: Project[] }>(`/api/v1/projects?workspaceId=${workspace.id}`), api<{ clients: Client[] }>(`/api/v1/clients?workspaceId=${workspace.id}`)]);
        setProjects(projects);
        setClients(clients);
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [user, workspace]);

  const filterClientId = filter !== "all" && filter !== "none" ? filter : null;
  const shown = useMemo(() => (projects ?? []).filter((p) => (filter === "all" ? true : filter === "none" ? !p.clientId : p.clientId === filter)), [projects, filter]);
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const clientId = newClient || filterClientId || null;
      const { project } = await api<{ project: Project }>("/api/v1/projects", { method: "POST", json: { workspaceId: workspace.id, name, clientId } });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!user) return <p className="muted">Loading…</p>;
  if (!workspace) return <p className="muted">{workspaces.length === 0 && user ? "Loading workspace…" : "Loading…"}</p>;
  const firstTime = projects !== null && projects.length === 0;
  const canEdit = workspace.role !== "viewer";

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>{firstTime ? `Welcome, ${user.name.split(" ")[0]}` : "Projects"}</h1>
          <p className="muted">
            {workspace.name}
            {workspace.role !== "owner" ? ` · you are ${workspace.role === "admin" ? "an admin" : `a${workspace.role === "editor" ? "n editor" : " viewer"}`}` : ""}
          </p>
        </div>
        {!firstTime && (
          <div className="row">
            <Link className="btn" href="/dashboard" title="Every project, client and site at a glance — with alerts">
              Dashboard
            </Link>
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {projects && canEdit && <Checklist workspaceId={workspace.id} projects={projects} onConnect={() => { setConnectOpen(true); document.getElementById("sites")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />}

      {canEdit && <GoalPicker workspaceId={workspace.id} compact={!firstTime} clientId={filterClientId} />}

      {!firstTime && canEdit && (
        <form className="card row" onSubmit={create}>
          <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Or name a blank project, e.g. Spring launch video" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          {clients.length > 0 && (
            <select className="input" style={{ width: "auto" }} value={newClient || filterClientId || ""} onChange={(e) => setNewClient(e.target.value)} title="Client this video is for">
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn" disabled={busy} type="submit">
            {busy ? "Creating…" : "Create blank project"}
          </button>
        </form>
      )}

      {clients.length > 0 && projects && (
        <div className="chip-row" role="tablist" aria-label="Filter by client">
          <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")} type="button">
            All ({projects.length})
          </button>
          {clients.map((c) => (
            <button key={c.id} className={`chip ${filter === c.id ? "on" : ""}`} onClick={() => setFilter(c.id)} type="button">
              {c.name} ({projects.filter((p) => p.clientId === c.id).length})
            </button>
          ))}
          {projects.some((p) => !p.clientId) && (
            <button className={`chip ${filter === "none" ? "on" : ""}`} onClick={() => setFilter("none")} type="button">
              No client ({projects.filter((p) => !p.clientId).length})
            </button>
          )}
          <Link className="chip" href="/team#clients" title="Add or edit clients">
            + Client
          </Link>
        </div>
      )}

      {projects === null ? (
        <p className="muted">Loading projects…</p>
      ) : shown.length > 0 ? (
        <div className="list">
          {shown.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="list-item">
              <span>
                <strong>{p.name}</strong>
                {p.clientId && filter === "all" && <span className="badge" style={{ marginLeft: 8 }}>{clientName(p.clientId)}</span>}
                <span className="muted small"> · updated {new Date(p.updatedAt).toLocaleString()}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <ReviewChip project={p} hideDraft />
                <span className={`badge ${p.status === "published" ? "ok" : ""}`}>{p.status === "published" ? `Published v${p.publishedVersion}` : p.currentDraftVersion ? `Draft v${p.currentDraftVersion}` : "Empty"}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : projects.length > 0 ? (
        <p className="muted">No projects for this client yet.</p>
      ) : null}

      {canEdit && <BrandKitCard workspaceId={workspace.id} />}

      <div id="sites">{canEdit && <SitesCard workspaceId={workspace.id} initialOpen={connectOpen} />}</div>
    </div>
  );
}
