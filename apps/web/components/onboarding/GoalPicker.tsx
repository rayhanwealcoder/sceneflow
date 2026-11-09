"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectFromTemplate, TEMPLATES, type Template } from "@sceneflow/editor";
import { api, errorMessage } from "@/lib/api";
import type { Project } from "@/lib/types";

const ICON: Record<string, string> = { shoppable: "🛍", explainer: "💡", "scroll-story": "↕", blank: "▢" };

/**
 * Goal-first start (doc: template-first onboarding). The user says what they want; we create a project
 * from a template that already works and open the editor with the guided tour.
 */
export function GoalPicker({ workspaceId, compact = false }: { workspaceId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(t: Template) {
    setBusy(t.id);
    setError(null);
    try {
      const { project } = await api<{ project: Project }>("/api/v1/projects", { method: "POST", json: { workspaceId, name: t.id === "blank" ? "Untitled video" : t.title } });
      await api(`/api/v1/projects/${project.id}/draft`, { method: "PUT", json: { config: createProjectFromTemplate(t.id, project.id) } });
      router.push(`/projects/${project.id}/editor?tour=1`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <section className={compact ? "stack" : "card stack"}>
      <div>
        <h2 style={{ margin: 0 }}>{compact ? "New video" : "What do you want to make?"}</h2>
        {!compact && <p className="muted small" style={{ margin: "4px 0 0" }}>Pick a goal. You get a working video to start from, and a short tour shows you what to change.</p>}
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
      </div>
      {error && <div className="alert error small">{error}</div>}
    </section>
  );
}
