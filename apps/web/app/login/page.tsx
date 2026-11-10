"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

/** Only same-app paths are honoured for the post-login redirect (never an absolute URL). */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/projects";
}

function LoginForm() {
  const search = useSearchParams();
  const next = safeNext(search.get("next"));
  const [mode, setMode] = useState<"signin" | "signup">(search.get("mode") === "signup" ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useSession();
  const router = useRouter();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await api("/api/v1/auth/register", { method: "POST", json: { name, email, password } });
      else await api("/api/v1/auth/login", { method: "POST", json: { email, password } });
      await refresh();
      router.push(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth stack">
      <div>
        <h1>Welcome to SceneFlow</h1>
        <p className="muted">Create interactive, shoppable video for your website.</p>
      </div>
      <div className="card stack">
        <div className="tabs" role="tablist">
          <button className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")} type="button">
            Sign in
          </button>
          <button className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")} type="button">
            Create account
          </button>
        </div>
        <form className="stack" onSubmit={submit}>
          {mode === "signup" && (
            <label className="field">
              Your name
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
            </label>
          )}
          <label className="field">
            Email
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className="field">
            <span>
              Password {mode === "signup" && <span className="muted">(at least 8 characters)</span>}
            </span>
            <PasswordInput value={password} onChange={setPassword} required minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          </label>
          {mode === "signin" && (
            <Link className="small muted" style={{ justifySelf: "end", marginTop: -8 }} href={`/forgot${email ? `?email=${encodeURIComponent(email)}` : ""}`} data-testid="forgot-link">
              Forgot your password?
            </Link>
          )}
          {error && <div className="alert error">{error}</div>}
          <button className="btn primary" disabled={busy} type="submit">
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
