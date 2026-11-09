"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { BrandKitCard } from "@/components/BrandKitCard";
import { Checklist } from "@/components/onboarding/Checklist";
import { GoalPicker } from "@/components/onboarding/GoalPicker";
import { SitesCard } from "@/components/SitesCard";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Project, Workspace } from "@/lib/types";

export default function ProjectsPage() {
  const { user } = useSession();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { workspaces } = await api<{ workspaces: Workspace[] }>("/api/v1/workspaces");
        const ws = workspaces[0] ?? null;
        setWorkspace(ws);
        if (ws) {
          const { projects } = await api<{ projects: Project[] }>(`/api/v1/projects?workspaceId=${ws.id}`);
          setProjects(projects);
        }
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [user]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api<{ project: Project }>("/api/v1/projects", { method: "POST", json: { workspaceId: workspace.id, name } });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!user) return <p className="muted">Loading…</p>;
  const firstTime = projects !== null && projects.length === 0;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>{firstTime ? `Welcome, ${user.name.split(" ")[0]}` : "Projects"}</h1>
          <p className="muted">{workspace ? workspace.name : "Loading workspace…"}</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {workspace && projects && <Checklist workspaceId={workspace.id} projects={projects} onConnect={() => { setConnectOpen(true); document.getElementById("sites")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />}

      {workspace && <GoalPicker workspaceId={workspace.id} compact={!firstTime} />}

      {!firstTime && (
        <form className="card row" onSubmit={create}>
          <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Or name a blank project, e.g. Spring launch video" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          <button className="btn" disabled={busy || !workspace} type="submit">
            {busy ? "Creating…" : "Create blank project"}
          </button>
        </form>
      )}

      {projects === null ? (
        <p className="muted">Loading projects…</p>
      ) : projects.length > 0 ? (
        <div className="list">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="list-item">
              <span>
                <strong>{p.name}</strong>
                <span className="muted small"> · updated {new Date(p.updatedAt).toLocaleString()}</span>
              </span>
              <span className={`badge ${p.status === "published" ? "ok" : ""}`}>{p.status === "published" ? `Published v${p.publishedVersion}` : p.currentDraftVersion ? `Draft v${p.currentDraftVersion}` : "Empty"}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {workspace && <BrandKitCard workspaceId={workspace.id} />}

      <div id="sites">{workspace && <SitesCard workspaceId={workspace.id} initialOpen={connectOpen} />}</div>
    </div>
  );
}
