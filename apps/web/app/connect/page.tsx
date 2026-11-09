"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Site, Workspace } from "@/lib/types";

/**
 * One-click connect from WordPress: the plugin sends the admin here with the site URL and a
 * one-time pairing code. After approval the browser goes back to wp-admin, connected.
 */
export default function ConnectPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ConnectFlow />
    </Suspense>
  );
}

function ConnectFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useSession();
  const site = params.get("site") ?? "";
  const code = params.get("code") ?? "";
  const siteName = params.get("name") ?? "";
  const returnTo = params.get("return") ?? "";
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only ever send the admin back to the site that started the flow.
  const safeReturn = useMemo(() => {
    try {
      const r = new URL(returnTo);
      const s = new URL(site);
      return r.origin === s.origin && /^https?:$/.test(r.protocol) ? r.toString() : "";
    } catch {
      return "";
    }
  }, [returnTo, site]);

  useEffect(() => {
    if (user === null) router.replace(`/login?next=${encodeURIComponent(`/connect?${params.toString()}`)}`);
  }, [user, router, params]);

  useEffect(() => {
    if (!user) return;
    api<{ workspaces: Workspace[] }>("/api/v1/workspaces")
      .then((r) => setWorkspace(r.workspaces[0] ?? null))
      .catch((e) => setError(errorMessage(e)));
  }, [user]);

  useEffect(() => {
    if (!done || !safeReturn) return;
    const t = setTimeout(() => {
      const u = new URL(safeReturn);
      u.searchParams.set("sceneflow_connected", "1");
      window.location.assign(u.toString());
    }, 1200);
    return () => clearTimeout(t);
  }, [done, safeReturn]);

  async function approve() {
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ site: Site }>("/api/v1/sites/connect", { method: "POST", json: { workspaceId: workspace.id, url: site, pairingCode: code } });
      setDone(r.site);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <p className="muted">Loading…</p>;
  if (!site || !code) {
    return (
      <div className="card connect-card stack">
        <h1>Connect a WordPress site</h1>
        <p className="muted">This page is opened from WordPress: install the SceneFlow plugin, go to Settings → SceneFlow and click “Connect with SceneFlow”. You can also connect with a pairing code from Projects → WordPress sites.</p>
      </div>
    );
  }

  return (
    <div className="card connect-card stack">
      <h1>Connect {siteName || hostOf(site)}</h1>
      {done ? (
        <>
          <div className="alert ok">
            <strong>{done.name ?? done.url}</strong> is now connected to {workspace?.name}.{safeReturn ? " Taking you back to WordPress…" : ""}
          </div>
          {!safeReturn && (
            <button className="btn primary" onClick={() => router.push("/projects")}>
              Go to projects
            </button>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            <strong>{hostOf(site)}</strong> wants to connect to your SceneFlow workspace <strong>{workspace?.name ?? "…"}</strong>. You will be able to publish videos to this site, place them on its pages and use its WooCommerce products.
          </p>
          <p className="muted small">Signed in as {user.email}. Not you? Sign out from the top right and try again.</p>
          {error && <div className="alert error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={() => void approve()} disabled={busy || !workspace}>
              {busy ? "Connecting…" : "Connect site"}
            </button>
            {safeReturn && (
              <a className="btn" href={safeReturn}>
                Cancel
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
