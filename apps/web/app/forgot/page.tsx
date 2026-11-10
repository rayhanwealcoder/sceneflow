"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";

export default function ForgotPage() {
  return (
    <Suspense fallback={null}>
      <ForgotForm />
    </Suspense>
  );
}

type Done = { ok: true; delivery: "email" | "log" };

/** Forgot password: one field, one button. The answer is the same whether or not the address has an account. */
function ForgotForm() {
  const search = useSearchParams();
  const [email, setEmail] = useState(search.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await api<Done>("/api/v1/auth/forgot", { method: "POST", json: { email } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth stack">
      <div>
        <h1>Forgot your password?</h1>
        <p className="muted">Type the e-mail you signed up with and we send you a link to choose a new one.</p>
      </div>
      <div className="card stack" data-testid="forgot-card">
        {done ? (
          <div className="stack" style={{ gap: 10 }} data-testid="forgot-done" data-delivery={done.delivery}>
            {done.delivery === "email" ? (
              <>
                <div className="alert ok">
                  If an account exists for <strong>{email}</strong>, a reset link is on its way. It works for 60 minutes.
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  Nothing after a minute? Check the spam folder, or{" "}
                  <button type="button" className="btn sm" onClick={() => setDone(null)}>
                    try again
                  </button>
                </p>
              </>
            ) : (
              <>
                <div className="alert">
                  This SceneFlow server has no e-mail service yet, so the reset link for <strong>{email}</strong> (if it has an account) was written to the server&apos;s log and outbox folder instead of being sent.
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  Ask the person who runs this SceneFlow for the link. If that is you: it is in <code>data/outbox</code> next to the API (or in its log), and setting <code>RESEND_API_KEY</code> or <code>SMTP_URL</code> plus <code>MAIL_FROM</code> in <code>apps/api/.env</code> makes these e-mails go out for real.
                </p>
              </>
            )}
            <Link className="btn" href="/login" style={{ justifySelf: "start" }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <label className="field">
              Email
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
            </label>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary" disabled={busy} type="submit" data-testid="forgot-submit">
              {busy ? "Please wait..." : "Send reset link"}
            </button>
            <Link className="small muted" href="/login">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
