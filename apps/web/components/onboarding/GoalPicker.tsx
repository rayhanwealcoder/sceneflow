"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createProjectFromTemplate, projectFromTemplateConfig, TEMPLATES, type Template } from "@sceneflow/editor";
import type { Project as ProjectConfig } from "@sceneflow/schema";
import { api, errorMessage } from "@/lib/api";
import type { BrandKitRow, LibraryPreset, Project } from "@/lib/types";

const ICON: Record<string, string> = { shoppable: "🛍", explainer: "💡", "scroll-story": "↕", blank: "▢" };

/**
 * Goal-first start (doc: template-first onboarding). The user says what they want; we create a project
 * from a template that already works — styled with the workspace brand kit when there is one — and open
 * the editor with the guided tour. Templates the user saved ("Save as template") appear next to ours.
 */
export function GoalPicker({ workspaceId, compact = false }: { workspaceId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<LibraryPreset[]>([]);
  const [kit, setKit] = useState<BrandKitRow | null>(null);

  useEffect(() => {
    api<{ presets: LibraryPreset[] }>(`/api/v1/presets?workspaceId=${workspaceId}&type=template`)
      .then((r) => setMine(r.presets))
      .catch(() => setMine([]));
    api<{ kits: BrandKitRow[] }>(`/api/v1/brand-kits?workspaceId=${workspaceId}`)
      .then((r) => setKit(r.kits.find((k) => k.isDefault) ?? r.kits[0] ?? null))
      .catch(() => setKit(null));
  }, [workspaceId]);

  const brand = kit ? { kit: kit.config, ref: { kitId: kit.id, version: kit.version } } : null;

  async function create(name: string, build: (projectId: string) => ProjectConfig, key: string) {
    setBusy(key);
    setError(null);
    try {
      const { project } = await api<{ project: Project }>("/api/v1/projects", { method: "POST", json: { workspaceId, name } });
      await api(`/api/v1/projects/${project.id}/draft`, { method: "PUT", json: { config: build(project.id) } });
      router.push(`/projects/${project.id}/editor?tour=1`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  const start = (t: Template) => create(t.id === "blank" ? "Untitled video" : t.title, (id) => createProjectFromTemplate(t.id, id, brand), t.id);
  const startMine = (p: LibraryPreset) => create(p.name, (id) => projectFromTemplateConfig(p.config, id, brand ? { brand: brand.kit, ref: brand.ref } : {}), p.id);

  async function removeMine(p: LibraryPreset) {
    if (!confirm(`Delete the template “${p.name}”? Videos made from it are not affected.`)) return;
    try {
      await api(`/api/v1/presets/${p.id}`, { method: "DELETE" });
      setMine((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className={compact ? "stack" : "card stack"}>
      <div>
        <h2 style={{ margin: 0 }}>{compact ? "New video" : "What do you want to make?"}</h2>
        {!compact && <p className="muted small" style={{ margin: "4px 0 0" }}>Pick a goal. You get a working video to start from, and a short tour shows you what to change.</p>}
        {kit && (
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            New videos use your brand kit “{kit.name}” (colours, fonts, logo).
          </p>
        )}
      </div>
      <div className="goal-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="goal-card" onClick={() => void start(t)} disabled={busy !== null}>
            <span className="goal-icon">{ICON[t.id]}</span>
            <strong>{t.title}</strong>
            <span className="muted small">“{t.goal}”</span>
            {!compact && <span className="small">{t.description}</span>}
            <span className="small muted">{busy === t.id ? "Creating…" : t.steps.join(" → ")}</span>
          </button>
        ))}
        {mine.map((p) => (
          <div key={p.id} className="goal-card goal-mine" role="button" tabIndex={0} onClick={() => busy === null && void startMine(p)} onKeyDown={(e) => e.key === "Enter" && void startMine(p)} aria-disabled={busy !== null}>
            <span className="row between">
              <span className="goal-icon">★</span>
              <button className="btn sm" title="Delete this template" onClick={(e) => { e.stopPropagation(); void removeMine(p); }}>
                ✕
              </button>
            </span>
            <strong>{p.name}</strong>
            <span className="muted small">{p.description || "Your template"}</span>
            <span className="small muted">{busy === p.id ? "Creating…" : `${p.config.type === "template" ? p.config.project.scenes.length : 0} scenes · saved by ${p.mine ? "you" : "your team"}`}</span>
          </div>
        ))}
      </div>
      {error && <div className="alert error small">{error}</div>}
    </section>
  );
}
