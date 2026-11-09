"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Placement, PlacementMode, Project, RemotePage, Site } from "@/lib/types";

const MODE_LABEL: Record<PlacementMode, string> = {
  replace: "Replace the element's content",
  before: "Insert before the element",
  after: "Insert after the element",
  append: "Add inside, at the end",
  prepend: "Add inside, at the start",
};

interface Picked {
  selector: string;
  description: string;
  pageUrl: string;
  pageTitle: string;
  path: string;
  postId: number;
}

/**
 * "Place on your site": choose a page, click an element on it (the plugin's picker runs inside an iframe
 * and posts the CSS selector back), choose how to insert, save. No shortcode needed.
 */
export function PlacementPanel({ project, site }: { project: Project; site: Site }) {
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [pages, setPages] = useState<RemotePage[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<RemotePage | null>(null);
  const [pick, setPick] = useState<{ url: string; origin: string } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [mode, setMode] = useState<PlacementMode>("replace");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(() => api<{ placements: Placement[] }>(`/api/v1/projects/${project.id}/placements`).then((r) => setPlacements(r.placements)).catch(() => {}), [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  // Page search (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ items: RemotePage[] }>(`/api/v1/sites/${site.id}/pages?search=${encodeURIComponent(search)}`)
        .then((r) => setPages(r.items))
        .catch((e) => setError(errorMessage(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [search, site.id]);

  // Messages from the picker inside the iframe.
  useEffect(() => {
    if (!pick) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== pick.origin || !e.data || typeof e.data !== "object") return;
      const d = e.data as { type?: string } & Partial<Picked>;
      if (d.type === "sceneflow:pick" && d.selector) {
        setPicked({ selector: d.selector, description: d.description ?? "", pageUrl: d.pageUrl ?? "", pageTitle: d.pageTitle ?? "", path: d.path ?? "", postId: d.postId ?? 0 });
      } else if (d.type === "sceneflow:cancel") {
        setPick(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pick]);

  async function startPick() {
    setError(null);
    setPicked(null);
    setBusy(true);
    try {
      const r = await api<{ pickUrl: string; siteOrigin: string }>(`/api/v1/sites/${site.id}/pick-session`, { method: "POST", json: page && page.id ? { postId: page.id } : page ? { pageUrl: page.url } : {} });
      setPick({ url: r.pickUrl, origin: r.siteOrigin });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const selector = picked?.selector ?? manual.trim();
    if (!selector) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/projects/${project.id}/placements`, {
        method: "POST",
        json: {
          postId: picked?.postId || page?.id || null,
          path: picked?.path || page?.path || null,
          pageUrl: picked?.pageUrl || page?.url,
          pageTitle: picked?.pageTitle || page?.title,
          selector,
          mode,
        },
      });
      setPick(null);
      setPicked(null);
      setManual("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Placement) {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; remoteOk: boolean; error?: string }>(`/api/v1/projects/${project.id}/placements/${p.id}`, { method: "DELETE" });
      if (!r.remoteOk) setError(`Removed here, but the site could not be reached (${r.error}). It will disappear from the site once it syncs again.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted small">
        Put this video inside an existing section of a page on <strong>{site.name ?? site.url}</strong> — no page editing, no shortcode. Pick the page, click the element, done.
      </p>
      {!project.publishedVersion && <div className="alert small">Publish the project first; placements show the published version.</div>}

      <div className="row">
        <label className="field" style={{ flex: 1, minWidth: 220 }}>
          Page
          <input className="input sm" placeholder="Search pages…" value={search} onChange={(e) => setSearch(e.target.value)} list="sf-pages" onBlur={() => setPage(pages.find((p) => p.title === search || p.url === search) ?? page)} />
          <datalist id="sf-pages">
            {pages.map((p) => (
              <option key={`${p.type}-${p.id}-${p.url}`} value={p.title} />
            ))}
          </datalist>
        </label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <button className="btn sm primary" onClick={() => void startPick()} disabled={busy}>
            Pick element on page
          </button>
        </div>
      </div>
      {pages.length > 0 && !page && (
        <div className="row small" style={{ gap: 6 }}>
          {pages.slice(0, 6).map((p) => (
            <button key={`${p.type}-${p.id}`} className="btn sm" onClick={() => { setPage(p); setSearch(p.title); }}>
              {p.title}
            </button>
          ))}
        </div>
      )}
      {page && (
        <div className="small muted">
          Selected page: <strong>{page.title}</strong> <span>({page.url})</span>{" "}
          <button className="btn sm" onClick={() => { setPage(null); setSearch(""); }}>
            change
          </button>
        </div>
      )}

      {pick && (
        <div className="modal-backdrop" onClick={() => setPick(null)}>
          <div className="modal stack" style={{ width: "min(1200px, 96vw)", height: "88vh", padding: 12 }} onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <span className="small">
                {picked ? (
                  <>
                    Selected <code>{picked.selector}</code> <span className="muted">({picked.description})</span>
                  </>
                ) : (
                  "Click the element on your page where the video should appear."
                )}
              </span>
              <span className="row">
                <a className="btn sm" href={pick.url} target="_blank" rel="noreferrer">
                  Open in new tab ↗
                </a>
                <button className="btn sm" onClick={() => setPick(null)}>
                  Close
                </button>
              </span>
            </div>
            <iframe ref={frameRef} src={pick.url} title="Pick an element" style={{ flex: 1, width: "100%", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", minHeight: 0 }} />
            <div className="row between">
              <label className="field" style={{ minWidth: 260 }}>
                How to insert
                <select className="input sm" value={mode} onChange={(e) => setMode(e.target.value as PlacementMode)}>
                  {(Object.keys(MODE_LABEL) as PlacementMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                Or type a CSS selector
                <input className="input sm" placeholder="#hero, .product-video, main > section:nth-of-type(2)" value={manual} onChange={(e) => setManual(e.target.value)} />
              </label>
              <button className="btn primary" disabled={busy || (!picked && !manual.trim())} onClick={() => void save()}>
                {busy ? "Saving…" : "Place video here"}
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              If the page does not load inside this window (some security plugins block it), use “Open in new tab”: clicking an element there shows the selector you can paste on the left.
            </p>
          </div>
        </div>
      )}

      {error && <div className="alert error small">{error}</div>}

      {placements.length > 0 && (
        <div className="list small">
          {placements.map((p) => (
            <div key={p.id} className="list-item">
              <span>
                <strong>{p.pageTitle ?? p.path ?? `Post ${p.postId}`}</strong> · <code>{p.selector}</code> <span className="muted">· {MODE_LABEL[p.mode]}</span>
                {p.pageUrl && (
                  <>
                    {" "}
                    <a href={p.pageUrl} target="_blank" rel="noreferrer">
                      open ↗
                    </a>
                  </>
                )}
              </span>
              <button className="btn sm" disabled={busy} onClick={() => void remove(p)} title="Remove placement">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
