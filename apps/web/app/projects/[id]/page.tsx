"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportCard } from "@/components/ExportCard";
import { PlacementPanel } from "@/components/PlacementPanel";
import { ReviewCard } from "@/components/ReviewCard";
import { ReviewChip } from "@/components/ReviewStatus";
import { Troubleshoot } from "@/components/Troubleshoot";
import { UploadBox } from "@/components/UploadBox";
import { API_URL, api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Client, Comment, MediaAsset, Project, ProjectDetail, Site, SitePublishResult, VersionSummary, WorkspaceRole } from "@/lib/types";

type Draft = { version: number; state: string; checksum: string; config: { video?: { assetId: string }; canvas?: { aspectRatio?: string }; scenes: unknown[] } } | null;

const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [role, setRole] = useState<WorkspaceRole>("viewer");
  const [draft, setDraft] = useState<Draft>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [openComments, setOpenComments] = useState(0);
  const [cta, setCta] = useState("Shop now");
  const [ctaUrl, setCtaUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [siteResults, setSiteResults] = useState<SitePublishResult[]>([]);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  const load = useCallback(async () => {
    const p = await api<ProjectDetail>(`/api/v1/projects/${id}`);
    setProject(p.project);
    setRole(p.role);
    setDraft(p.draft as Draft);
    const [{ assets }, { versions }, { sites }, { clients }, { comments }] = await Promise.all([
      api<{ assets: MediaAsset[] }>(`/api/v1/media?workspaceId=${p.project.workspaceId}`),
      api<{ versions: VersionSummary[] }>(`/api/v1/projects/${id}/versions`),
      api<{ sites: Site[] }>(`/api/v1/sites?workspaceId=${p.project.workspaceId}`),
      api<{ clients: Client[] }>(`/api/v1/clients?workspaceId=${p.project.workspaceId}`),
      api<{ comments: Comment[] }>(`/api/v1/projects/${id}/comments`),
    ]);
    setAssets(assets);
    setVersions(versions);
    setSites(sites);
    setClients(clients);
    setOpenComments(comments.filter((c) => !c.parentId && !c.resolvedAt).length);
  }, [id]);

  useEffect(() => {
    if (!user) return;
    load().catch((err) => setNotice({ kind: "error", text: errorMessage(err) }));
  }, [user, load]);

  const pending = assets.some((a) => a.status === "pending" || a.status === "uploaded" || a.status === "processing" || a.metadataJson.renditions?.status === "pending");
  useEffect(() => {
    if (!pending || !project) return;
    const t = setInterval(() => {
      api<{ assets: MediaAsset[] }>(`/api/v1/media?workspaceId=${project.workspaceId}`).then(({ assets }) => setAssets(assets)).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [pending, project]);

  const videos = useMemo(() => assets.filter((a) => a.type === "video"), [assets]);
  const selectedAssetId = draft?.config.video?.assetId ?? null;
  const site = useMemo(() => sites.find((s) => s.id === project?.siteId) ?? null, [sites, project]);
  const canEdit = role !== "viewer";
  const admin = role === "admin" || role === "owner";

  /** Quick start: one scene from the chosen video plus a call-to-action. The editor can refine it afterwards. */
  async function useVideo(asset: MediaAsset) {
    const m = asset.metadataJson;
    if (!m.proxyUrl || !m.duration) return;
    setBusy("save");
    setNotice(null);
    try {
      const action = ctaUrl.trim() ? { type: "OPEN_URL", url: ctaUrl.trim(), newTab: true } : { type: "OPEN_CART" };
      const config = {
        video: { provider: "local", assetId: asset.id, src: m.proxyUrl, poster: m.posterUrl, duration: m.duration },
        playback: { mode: "click", controls: true, muted: false },
        scenes: [
          {
            id: "scene_1",
            name: "Main",
            start: 0,
            end: m.duration,
            background: { type: "video", assetId: asset.id, sourceStart: 0 },
            layers: [{ id: "cta", type: "button", name: "Call to action", frame: { x: 6, y: 82, w: 32, h: 10 }, content: { label: cta.trim() || "Shop now" }, style: { background: "#4f46e5", color: "#ffffff", borderRadius: 10, fontWeight: 700 }, action }],
          },
        ],
      };
      const saved = await api<{ version: number }>(`/api/v1/projects/${id}/draft`, { method: "PUT", json: { config } });
      setNotice({ kind: "ok", text: `Saved draft v${saved.version}. Publish it when you are ready.` });
      await load();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function patch(json: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      await api(`/api/v1/projects/${id}`, { method: "PATCH", json });
      await load();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    setNotice(null);
    try {
      const r = await api<{ publishedVersion: number; sites: SitePublishResult[]; media?: { hdPending: number } }>(`/api/v1/projects/${id}/publish`, { method: "POST", json: {} });
      setSiteResults(r.sites);
      const failed = r.sites.filter((s) => !s.ok);
      const hd = r.media?.hdPending ? " HD versions are still being prepared — publish again later to ship them." : "";
      setNotice(failed.length ? { kind: "error", text: `Published v${r.publishedVersion}, but ${failed[0]!.siteName ?? "the site"} could not be updated: ${failed[0]!.error}` } : { kind: "ok", text: `Published v${r.publishedVersion}${r.sites.length ? ` and pushed to ${r.sites[0]!.siteName ?? "your site"}` : ""}.${hd}` });
      await load();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function previewOnSite() {
    setBusy("preview");
    try {
      const r = await api<{ previewUrl: string }>(`/api/v1/projects/${id}/preview-session`, { method: "POST", json: {} });
      window.open(r.previewUrl, "_blank", "noopener");
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  if (!user || !project) return <p className="muted">Loading…</p>;

  const configUrl = `${API_URL}/p/${project.id}.json`;
  const shortcode = `[sceneflow id="${project.id}"]`;
  const embed = `<div id="sceneflow-${project.id.slice(0, 8)}"></div>
<script src="${API_URL}/runtime/sceneflow.runtime.min.js"></script>
<script>
  new SceneFlow.Player({ target: '#sceneflow-${project.id.slice(0, 8)}', configUrl: '${configUrl}' }).init();
</script>`;
  // Doc §23 role-based publish: under an approval workflow editors need an approved, unchanged draft.
  const approvedCurrent = project.reviewStatus === "approved" && !!draft && project.approvedChecksum === draft.checksum;
  const publishBlocked = project.approvalRequired && !admin && !approvedCurrent;
  const publishLabel = busy === "publish" ? "Publishing…" : !draft ? "Save a draft first" : project.publishedVersion === draft.version ? "Latest draft is live" : publishBlocked ? "Needs approval to publish" : `Publish draft v${draft.version}${site ? ` to ${site.name ?? "site"}` : ""}`;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <a href="/projects" className="small">
            ← All projects
          </a>
          <h1>{project.name}</h1>
          {clients.length > 0 && canEdit && (
            <label className="row small muted" style={{ gap: 6 }}>
              Client
              <select className="input sm" style={{ width: "auto" }} value={project.clientId ?? ""} onChange={(e) => void patch({ clientId: e.target.value || null }, "client")} disabled={busy === "client"} data-testid="project-client">
                <option value="">— none —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="row">
          <ReviewChip project={project} draftChecksum={draft?.checksum ?? null} hideDraft />
          <span className={`badge ${project.status === "published" ? "ok" : ""}`}>
            {project.status === "published" ? `Published v${project.publishedVersion}` : "Not published"}
            {draft && project.publishedVersion !== draft.version ? ` · draft v${draft.version}` : ""}
          </span>
          <Troubleshoot projectId={project.id} />
          <a className="btn" href={`/projects/${project.id}/analytics`} title="Loads, plays, engagement timeline, clicks, add-to-carts">
            Analytics
          </a>
          <a className="btn primary" href={`/projects/${project.id}/editor`}>
            {canEdit ? "Open editor" : "Open (view & comment)"}
          </a>
        </div>
      </div>
      <p className="muted small">Quick start below gets a video live in a minute; the editor lets you add scenes, text, images, buttons, hotspots and a timeline.</p>

      {notice && <div className={`alert ${notice.kind}`}>{notice.text}</div>}

      {canEdit && (
        <section className="card stack">
          <h2>
            <span className="step">1</span> Upload your video
          </h2>
          <UploadBox workspaceId={project.workspaceId} onUploaded={() => load().catch(() => {})} />
          {videos.length > 0 && (
            <div className="list">
              {videos.map((a) => {
                const m = a.metadataJson;
                const ready = a.status === "ready";
                return (
                  <div key={a.id} className={`asset ${selectedAssetId === a.id ? "selected" : ""}`}>
                    {m.posterUrl ? <img src={m.posterUrl} alt="" /> : <div className="ph">{a.status === "failed" ? "failed" : "processing"}</div>}
                    <div>
                      <div>
                        <strong>{a.originalName}</strong>
                      </div>
                      <div className="muted small">
                        {fmtBytes(a.sizeBytes)}
                        {m.duration ? ` · ${m.duration.toFixed(1)}s` : ""}
                        {m.width ? ` · ${m.width}×${m.height}` : ""}
                        {a.status === "failed" && <span className="badge bad"> failed: {a.error}</span>}
                        {!ready && a.status !== "failed" && <span className="badge warn"> {m.progress?.stage ?? a.status}…</span>}
                        {ready && m.renditions?.status === "ready" && m.renditions.items.length > 0 && (
                          <span className="badge ok" title={m.renditions.items.map((r) => `${r.kind === "scrub" ? "scroll" : r.height + "p"} · ${fmtBytes(r.sizeBytes)}`).join(", ")}>
                            {" "}
                            HD ready · {m.renditions.items.filter((r) => r.kind === "progressive").map((r) => `${r.height}p`).join(" ")}
                            {m.renditions.items.some((r) => r.kind === "scrub") ? " + scroll" : ""}
                          </span>
                        )}
                        {ready && m.renditions?.status === "pending" && <span className="badge"> {m.progress?.stage ?? "Preparing HD"}…</span>}
                        {ready && m.renditions?.status === "failed" && <span className="badge warn"> HD failed — preview quality is used</span>}
                      </div>
                    </div>
                    <button className="btn sm primary" disabled={!ready || busy !== null} onClick={() => void useVideo(a)}>
                      {selectedAssetId === a.id ? "Update scene" : "Use this video"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {canEdit && (
        <section className="card stack">
          <h2>
            <span className="step">2</span> Call to action
          </h2>
          <p className="muted small">Shown as a button over the video. Change it, then click “Use this video” / “Update scene” above to save a new draft — or design everything in the editor.</p>
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 200 }}>
              Button label
              <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} maxLength={60} />
            </label>
            <label className="field" style={{ flex: 2, minWidth: 240 }}>
              Link (optional — leave empty to open the cart on WooCommerce sites)
              <input className="input" placeholder="https://yourshop.com/product/..." value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
            </label>
          </div>
        </section>
      )}

      <ReviewCard project={project} draftChecksum={draft?.checksum ?? null} role={role} openComments={openComments} onChange={load} />

      {canEdit && (
        <section className="card stack">
          <h2>
            <span className="step">4</span> Publish
          </h2>
          <div className="row">
            <label className="field" style={{ minWidth: 260 }}>
              WordPress site
              <select className="input sm" value={project.siteId ?? ""} onChange={(e) => void patch({ siteId: e.target.value || null }, "site")} disabled={busy === "site"}>
                <option value="">— none (embed snippet only) —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.url}
                    {s.connectionStatus !== "connected" ? ` (${s.connectionStatus})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {sites.length === 0 && (
              <span className="small muted">
                No site connected yet — <a href="/projects">connect one</a> to publish straight to WordPress.
              </span>
            )}
          </div>
          <div className="row">
            <button className="btn primary" disabled={!draft || busy !== null || project.publishedVersion === draft?.version || publishBlocked} onClick={() => void publish()} title={publishBlocked ? "Send it for review above; admins can always publish." : undefined} data-testid="publish">
              {publishLabel}
            </button>
            {site && draft && (
              <button className="btn" disabled={busy !== null} onClick={() => void previewOnSite()} title="Opens the current draft inside your WordPress theme">
                {busy === "preview" ? "Opening…" : "Preview draft on site ↗"}
              </button>
            )}
            {project.publishedVersion && (
              <a className="btn" href={`${API_URL}/demo/${project.id}`} target="_blank" rel="noreferrer">
                Open live preview ↗
              </a>
            )}
          </div>
          {siteResults.length > 0 && (
            <div className="small">
              {siteResults.map((r) => (
                <div key={r.siteId} className={`badge ${r.ok ? "ok" : "bad"}`}>
                  {r.siteName ?? r.siteId}: {r.ok ? "updated" : r.error}
                </div>
              ))}
            </div>
          )}

          {project.publishedVersion && (
            <div className="stack">
              {site && (
                <div>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    Shortcode for any page or post on {site.name ?? site.url} (also available as the “SceneFlow Video” block). The same code keeps working when you publish new versions:
                  </div>
                  <pre>{shortcode}</pre>
                </div>
              )}
              <details>
                <summary className="small muted">Embed on any other website (HTML snippet)</summary>
                <pre style={{ marginTop: 8 }}>{embed}</pre>
              </details>
            </div>
          )}

          {versions.length > 0 && (
            <details>
              <summary className="small muted">Version history ({versions.length})</summary>
              <div className="list small" style={{ marginTop: 8 }}>
                {versions.map((v) => (
                  <div key={v.version} className="list-item">
                    <span>
                      v{v.version} · {new Date(v.createdAt).toLocaleString()}
                      {v.version === project.approvedVersion ? ` · approved by ${project.approvedBy}` : ""}
                    </span>
                    <span className={`badge ${v.version === project.publishedVersion ? "ok" : ""}`}>{v.version === project.publishedVersion ? "live" : v.state}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {site && canEdit && (
        <section className="card stack" id="place">
          <h2>
            <span className="step">5</span> Place on your site
          </h2>
          <PlacementPanel project={project} site={site} />
        </section>
      )}

      <ExportCard project={project} draftVersion={draft?.version ?? null} role={role} portrait={/^(9:16|4:5)$/.test(draft?.config.canvas?.aspectRatio ?? "")} />
    </div>
  );
}
