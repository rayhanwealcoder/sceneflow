"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Project, Site } from "@/lib/types";

interface Step {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action?: { label: string; onClick?: () => void; href?: string };
}

/**
 * Getting-started checklist computed from real state (no stored progress to get out of sync):
 * create a video → connect WordPress → publish. Hidden once everything is done or dismissed.
 */
export function Checklist({ workspaceId, projects, onConnect }: { workspaceId: string; projects: Project[]; onConnect: () => void }) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    api<{ sites: Site[] }>(`/api/v1/sites?workspaceId=${workspaceId}`)
      .then((r) => setSites(r.sites))
      .catch(() => setSites([]));
    try {
      setHidden(localStorage.getItem(`sf_checklist_${workspaceId}`) === "hidden");
    } catch {
      setHidden(false);
    }
  }, [workspaceId]);

  if (hidden || sites === null) return null;
  const published = projects.find((p) => p.status === "published");
  const connected = sites.some((s) => s.connectionStatus === "connected");
  const steps: Step[] = [
    { id: "video", title: "Create your first video", detail: "Pick a goal below — you start from a working template.", done: projects.length > 0 },
    { id: "site", title: "Connect your WordPress site", detail: "One click from Settings → SceneFlow in WordPress, or with a pairing code here.", done: connected, action: { label: "Connect a site", onClick: onConnect } },
    {
      id: "publish",
      title: "Publish it",
      detail: "Publish pushes the video to your site. Then add the shortcode or place it on an existing element.",
      done: Boolean(published),
      action: projects[0] ? { label: "Open project", href: `/projects/${projects[0].id}` } : undefined,
    },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  if (remaining === 0) return null;

  const hide = () => {
    try {
      localStorage.setItem(`sf_checklist_${workspaceId}`, "hidden");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>Getting started · {steps.length - remaining}/{steps.length}</h2>
        <button className="btn sm" onClick={hide} title="Hide this checklist">
          Hide
        </button>
      </div>
      <div className="check-list">
        {steps.map((s) => (
          <div key={s.id} className={`check-item ${s.done ? "done" : ""}`}>
            <span className="check-mark" aria-hidden="true">
              {s.done ? "✓" : ""}
            </span>
            <span style={{ flex: 1 }}>
              <strong>{s.title}</strong>
              <div className="muted small">{s.detail}</div>
            </span>
            {!s.done && s.action && (s.action.href ? (
              <Link className="btn sm" href={s.action.href}>
                {s.action.label}
              </Link>
            ) : (
              <button className="btn sm" onClick={s.action.onClick}>
                {s.action.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
