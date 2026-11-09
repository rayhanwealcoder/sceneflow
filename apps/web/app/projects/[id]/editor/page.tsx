"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createEmptyProject } from "@sceneflow/editor";
import { parseProject, type Project as ProjectConfig } from "@sceneflow/schema";
import { Editor } from "@/components/editor/Editor";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Project } from "@/lib/types";

type Loaded = { project: Project; config: ProjectConfig; savedVersion: number | null };

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    api<{ project: Project; draft: { version: number; config: unknown } | null }>(`/api/v1/projects/${id}`)
      .then(({ project, draft }) => {
        let config: ProjectConfig;
        if (draft) {
          const parsed = parseProject(draft.config);
          if (!parsed.ok) throw new Error(`Saved project could not be read: ${parsed.message}`);
          config = parsed.project;
        } else config = createEmptyProject(project.id);
        setData({ project, config, savedVersion: draft?.version ?? null });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [user, id]);

  if (error) return <div className="alert error">{error}</div>;
  if (!user || !data) return <p className="muted">Loading editor…</p>;
  return (
    <Suspense fallback={<p className="muted">Loading editor…</p>}>
      <Editor projectId={data.project.id} projectName={data.project.name} workspaceId={data.project.workspaceId} siteId={data.project.siteId} initialProject={data.config} savedVersion={data.savedVersion} />
    </Suspense>
  );
}
