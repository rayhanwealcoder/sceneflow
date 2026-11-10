"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/** The link sent to a new e-mail address: one button makes it the account's sign-in address. */
export default function ConfirmEmailPage() {
  const { token } = useParams<{ token: string }>();
  const { refresh } = useSession();
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ newEmail: string }>(`/api/v1/auth/email/${token}`)
      .then((r) => setNewEmail(r.newEmail))
      .catch((e) => setDead(e instanceof ApiError ? e.message : errorMessage(e)));
  }, [token]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/email/confirm", { method: "POST", json: { token } });
      setDone(true);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setDead(err.message);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth stack">
      <h1>Confirm your new e-mail address</h1>
      <div className="card stack" data-testid="confirm-email-card">
        {dead ? (
          <div className="alert error" data-testid="confirm-dead">
            {dead}
          </div>
        ) : done ? (
          <>
            <div className="alert ok" data-testid="confirm-done">
              Done. You now sign in with <strong>{newEmail}</strong>.
            </div>
            <Link className="btn primary" href="/projects" style={{ justifySelf: "start" }}>
              Open SceneFlow
            </Link>
          </>
        ) : newEmail === null ? (
          <p className="muted">Checking the link...</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              Use <strong data-testid="confirm-new-email">{newEmail}</strong> to sign in from now on?
            </p>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary" disabled={busy} onClick={() => void confirm()} data-testid="confirm-email" style={{ justifySelf: "start" }}>
              {busy ? "Confirming..." : "Confirm"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
