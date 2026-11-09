"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

type Info = { workspaceName: string; role: string; email: string | null; invitedBy: string | null; expiresAt: string };

/** Landing page of an invitation link: who invited you, to what, as which role — then one button. */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const { user, refreshWorkspaces, selectWorkspace } = useSession();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Info>(`/api/v1/invites/${token}`)
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : errorMessage(e)));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ workspaceId: string; role: string }>(`/api/v1/invites/${token}/accept`, { method: "POST" });
      await refreshWorkspaces();
      selectWorkspace(r.workspaceId);
      router.push("/projects");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const next = encodeURIComponent(`/join/${token}`);
  return (
    <div className="card stack connect-card" data-testid="join-card">
      <h1 style={{ margin: 0 }}>You are invited</h1>
      {error && <div className="alert error">{error}</div>}
      {info && (
        <>
          <p style={{ margin: 0 }}>
            {info.invitedBy ? <strong>{info.invitedBy}</strong> : "Someone"} invited you to join <strong>{info.workspaceName}</strong> on SceneFlow as <strong>{info.role}</strong>.
            {info.email ? ` This invitation is for ${info.email}.` : ""}
          </p>
          <p className="muted small" style={{ margin: 0 }}>
            {info.role === "viewer" ? "You will be able to see every video and leave comments." : info.role === "editor" ? "You will be able to build and publish videos in this workspace." : "You will be able to do everything, including approving videos and inviting people."}
          </p>
          {user === undefined ? (
            <p className="muted">Checking your account…</p>
          ) : user ? (
            <div className="row">
              <button className="btn primary" onClick={() => void accept()} disabled={busy} data-testid="accept-invite">
                {busy ? "Joining…" : `Join as ${user.name}`}
              </button>
              <span className="muted small">Signed in as {user.email}</span>
            </div>
          ) : (
            <div className="row">
              <Link className="btn primary" href={`/login?next=${next}`}>
                Sign in to accept
              </Link>
              <Link className="btn" href={`/login?next=${next}&mode=signup`}>
                Create a free account
              </Link>
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            The link works once and expires {new Date(info.expiresAt).toLocaleDateString()}.
          </p>
        </>
      )}
    </div>
  );
}
