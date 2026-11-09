import type { Project } from "@/lib/types";

/** Human label + tone for a project's review state (doc §23), taking "edited since approval" into account. */
export function reviewLabel(p: Pick<Project, "reviewStatus" | "approvedBy" | "approvedVersion" | "approvedChecksum" | "reviewVersion">, draftChecksum?: string | null): { text: string; tone: "muted" | "warn" | "bad" | "ok" } {
  switch (p.reviewStatus) {
    case "internal":
      return { text: `In internal review${p.reviewVersion ? ` · v${p.reviewVersion}` : ""}`, tone: "warn" };
    case "client":
      return { text: `Waiting for the client${p.reviewVersion ? ` · v${p.reviewVersion}` : ""}`, tone: "warn" };
    case "changes":
      return { text: "Changes requested", tone: "bad" };
    case "approved": {
      const stale = draftChecksum !== undefined && draftChecksum !== null && p.approvedChecksum !== draftChecksum;
      return stale ? { text: `Approved v${p.approvedVersion ?? "?"} · edited since`, tone: "warn" } : { text: `Approved${p.approvedBy ? ` by ${p.approvedBy}` : ""}${p.approvedVersion ? ` · v${p.approvedVersion}` : ""}`, tone: "ok" };
    }
    default:
      return { text: "Draft", tone: "muted" };
  }
}

export function ReviewChip({ project, draftChecksum, hideDraft }: { project: Parameters<typeof reviewLabel>[0]; draftChecksum?: string | null; hideDraft?: boolean }) {
  const l = reviewLabel(project, draftChecksum);
  if (hideDraft && project.reviewStatus === "none") return null;
  return <span className={`badge ${l.tone === "muted" ? "" : l.tone}`}>{l.text}</span>;
}
