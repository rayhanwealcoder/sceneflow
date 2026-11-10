"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/** The page behind a reset link: whose account (masked), one new password, signed in on success. */
export default function ResetPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState<string | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ email: string }>(`/api/v1/auth/reset/${token}`)
      .then((r) => setEmail(r.email))
      .catch((e) => setDead(e instanceof ApiError ? e.message : errorMessage(e)));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/reset", { method: "POST", json: { token, password } });
      await refresh();
      router.push("/projects");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setDead(err.message);
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth stack">
      <div>
        <h1>Choose a new password</h1>
        {email && (
          <p className="muted" data-testid="reset-for">
            For the account <strong>{email}</strong>.
          </p>
        )}
      </div>
      <div className="card stack" data-testid="reset-card">
        {dead ? (
          <>
            <div className="alert error" data-testid="reset-dead">
              {dead}
            </div>
            <Link className="btn primary" href="/forgot" style={{ justifySelf: "start" }}>
              Request a new link
            </Link>
          </>
        ) : email === null ? (
          <p className="muted">Checking the link...</p>
        ) : (
          <form className="stack" onSubmit={submit}>
            <label className="field">
              <span>
                New password <span className="muted">(at least 8 characters)</span>
              </span>
              <PasswordInput value={password} onChange={setPassword} required minLength={8} autoComplete="new-password" autoFocus data-testid="reset-password" />
            </label>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary" disabled={busy} type="submit" data-testid="reset-submit">
              {busy ? "Please wait..." : "Set password and sign in"}
            </button>
            <p className="muted small" style={{ margin: 0 }}>
              Every other device signed in to this account will be signed out.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
