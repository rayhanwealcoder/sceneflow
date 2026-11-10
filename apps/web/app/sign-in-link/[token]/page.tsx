"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

type LinkInfo = { email: string; name: string; passwordSetup: boolean; expiresAt: string };

/**
 * A sign-in link from a super admin. Opening the page spends nothing: the button does (so mail and chat
 * link previews cannot use it up). With `passwordSetup` the next stop is "choose your own password".
 */
export default function SignInLinkPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { refresh } = useSession();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LinkInfo>(`/api/v1/auth/login-link/${token}`)
      .then(setInfo)
      .catch((e) => setDead(e instanceof ApiError ? e.message : errorMessage(e)));
  }, [token]);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ passwordSetup: boolean }>("/api/v1/auth/login-link", { method: "POST", json: { token } });
      await refresh();
      router.push(r.passwordSetup ? "/account?setup=1" : "/projects");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setDead(err.message);
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth stack">
      <div>
        <h1>Sign in</h1>
        {info && (
          <p className="muted" data-testid="link-for">
            An administrator made this link for <strong>{info.email}</strong>.
          </p>
        )}
      </div>
      <div className="card stack" data-testid="link-card">
        {dead ? (
          <>
            <div className="alert error" data-testid="link-dead">
              {dead}
            </div>
            <Link className="btn primary" href="/login" style={{ justifySelf: "start" }}>
              Go to sign in
            </Link>
          </>
        ) : info === null ? (
          <p className="muted">Checking the link...</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              Hi {info.name}. {info.passwordSetup ? "After signing in you choose a new password." : "This link signs you in once."}
            </p>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary" disabled={busy} onClick={() => void signIn()} data-testid="link-sign-in" style={{ justifySelf: "start" }}>
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <p className="muted small" style={{ margin: 0 }}>
              The link works once. If you did not expect it, close this page and tell your administrator.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
