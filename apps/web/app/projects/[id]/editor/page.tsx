"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createEmptyProject } from "@sceneflow/editor";
import { parseProject, type Project as ProjectConfig } from "@sceneflow/schema";
import { Editor } from "@/components/editor/Editor";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ProjectDetail } from "@/lib/types";

type Loaded = { detail: ProjectDetail; config: ProjectConfig; savedVersion: number | null };

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
    api<ProjectDetail>(`/api/v1/projects/${id}`)
      .then((detail) => {
        let config: ProjectConfig;
        if (detail.draft) {
          const parsed = parseProject(detail.draft.config);
          if (!parsed.ok) throw new Error(`Saved project could not be read: ${parsed.message}`);
          config = parsed.project;
        } else config = createEmptyProject(detail.project.id);
        setData({ detail, config, savedVersion: detail.draft?.version ?? null });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [user, id]);

  if (error) return <div className="alert error">{error}</div>;
  if (!user || !data) return <p className="muted">Loading editor…</p>;
  const { project, client, role } = data.detail;
  return (
    <Suspense fallback={<p className="muted">Loading editor…</p>}>
      <Editor
        projectId={project.id}
        projectName={project.name}
        workspaceId={project.workspaceId}
        siteId={project.siteId}
        initialProject={data.config}
        savedVersion={data.savedVersion}
        brandKitId={client?.brandKitId ?? null}
        role={role}
        review={{ approvalRequired: project.approvalRequired, reviewStatus: project.reviewStatus, approvedChecksum: project.approvedChecksum }}
      />
    </Suspense>
  );
}
