"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlayerView } from "@/components/PlayerView";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Project } from "@/lib/types";

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const router = useRouter();
  const [data, setData] = useState<{ project: Project; config: unknown; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    api<{ project: Project; draft: { version: number; config: unknown } | null }>(`/api/v1/projects/${id}`)
      .then(({ project, draft }) => {
        if (!draft) throw new Error("Nothing to preview yet. Open the editor and add a scene.");
        setData({ project, config: draft.config, version: draft.version });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [user, id]);

  if (error) return <div className="alert error">{error}</div>;
  if (!user || !data) return <p className="muted">Loading preview…</p>;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <Link href={`/projects/${id}/editor`} className="small">
            ← Back to editor
          </Link>
          <h1>{data.project.name}</h1>
          <p className="muted">
            Draft v{data.version}
            {data.project.publishedVersion ? ` · live is v${data.project.publishedVersion}` : " · not published yet"}
          </p>
        </div>
      </div>
      <PlayerView config={data.config} />
    </div>
  );
}
