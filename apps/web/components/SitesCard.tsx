"use client";

import { useEffect, useState, type FormEvent } from "react";
import { API_URL, api, errorMessage } from "@/lib/api";
import type { Site } from "@/lib/types";

/** WordPress sites of a workspace: connect with a pairing code, re-check, disconnect. */
export function SitesCard({ workspaceId, initialOpen = false }: { workspaceId: string; initialOpen?: boolean }) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen]);

  const load = () =>
    api<{ sites: Site[] }>(`/api/v1/sites?workspaceId=${workspaceId}`)
      .then((r) => setSites(r.sites))
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy("connect");
    setError(null);
    try {
      await api("/api/v1/sites/connect", { method: "POST", json: { workspaceId, url, pairingCode: code } });
      setUrl("");
      setCode("");
      setOpen(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function check(id: string) {
    setBusy(id);
    try {
      await api(`/api/v1/sites/${id}/check`, { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(site: Site) {
    if (!confirm(`Disconnect ${site.name ?? site.url}? Published videos keep working on the site; you just can't publish to it until you connect again.`)) return;
    setBusy(site.id);
    try {
      await api(`/api/v1/sites/${site.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>WordPress sites</h2>
        <div className="row">
          <a className="btn sm" href={`${API_URL}/downloads/sceneflow.zip`}>
            Download plugin
          </a>
          <button className="btn sm primary" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Connect a site"}
          </button>
        </div>
      </div>

      {open && (
        <form className="stack" onSubmit={connect} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10 }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>Easiest:</strong> install the plugin (download above), then in WordPress go to Settings → SceneFlow and click <strong>Connect with SceneFlow</strong>. You come straight back here, connected.
          </p>
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Or: in Settings → SceneFlow choose “Connect with a pairing code” and click “Generate pairing code”.</li>
            <li>Enter the site address and the code here.</li>
          </ol>
          <div className="row">
            <label className="field" style={{ flex: 2, minWidth: 220 }}>
              Site address
              <input className="input" placeholder="https://yoursite.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Pairing code
              <input className="input" placeholder="ABCD-1234" value={code} onChange={(e) => setCode(e.target.value)} required style={{ letterSpacing: 2, textTransform: "uppercase" }} />
            </label>
          </div>
          <div>
            <button className="btn primary" disabled={busy === "connect"} type="submit">
              {busy === "connect" ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      )}

      {error && <div className="alert error">{error}</div>}

      {sites === null ? (
        <p className="muted small">Loading sites…</p>
      ) : sites.length === 0 ? (
        <p className="muted small">No sites connected yet. Connect one to publish straight to WordPress and place videos on existing pages.</p>
      ) : (
        <div className="list">
          {sites.map((s) => (
            <div key={s.id} className="list-item">
              <span>
                <strong>{s.name ?? s.url}</strong> <span className="muted small">{s.url}</span>
                <div className="small muted">
                  {s.connectorVersion ? `Plugin ${s.connectorVersion}` : ""}
                  {s.platformVersion ? ` · WordPress ${s.platformVersion}` : ""}
                  {s.capabilitiesJson.includes("woocommerce") ? " · WooCommerce" : ""}
                  {s.lastError && s.connectionStatus === "error" ? <span className="badge bad"> {s.lastError}</span> : null}
                </div>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className={`badge ${s.connectionStatus === "connected" ? "ok" : "bad"}`}>{s.connectionStatus}</span>
                <button className="btn sm" disabled={busy === s.id} onClick={() => void check(s.id)} title="Re-check the connection">
                  ↻
                </button>
                <button className="btn sm" disabled={busy === s.id} onClick={() => void remove(s)} title="Disconnect">
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
