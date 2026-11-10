"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

type Msg = { ok: boolean; text: string } | null;

/** Your name and your password. The e-mail is the sign-in and where reset links go; it cannot be changed here yet. */
export default function AccountPage() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<Msg>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<"name" | "password" | null>(null);
  const userName = user?.name;

  useEffect(() => {
    if (user === null) router.replace("/login?next=%2Faccount");
  }, [user, router]);
  useEffect(() => {
    if (userName !== undefined) setName(userName);
  }, [userName]);

  if (!user) return <p className="muted">Loading...</p>;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setBusy("name");
    setNameMsg(null);
    try {
      await api("/api/v1/auth/me", { method: "PATCH", json: { name: name.trim() } });
      await refresh();
      setNameMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setNameMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setBusy("password");
    setPwMsg(null);
    try {
      await api("/api/v1/auth/password", { method: "POST", json: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setPwMsg({ ok: true, text: "Password changed. Every other device was signed out; you stay signed in here." });
    } catch (err) {
      setPwMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1 style={{ margin: 0 }}>Account</h1>
      <div className="card stack" data-testid="profile-card">
        <h2 style={{ margin: 0 }}>Profile</h2>
        <form className="stack" onSubmit={saveName}>
          <label className="field">
            Your name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" data-testid="account-name" />
          </label>
          <label className="field">
            Email
            <input className="input" value={user.email} disabled readOnly />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            Your e-mail is how you sign in and where password-reset links go.
          </p>
          {nameMsg && (
            <div className={`alert ${nameMsg.ok ? "ok" : "error"}`} data-testid="name-msg">
              {nameMsg.text}
            </div>
          )}
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy !== null || name.trim() === user.name || !name.trim()}>
              {busy === "name" ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
      <div className="card stack" data-testid="password-card">
        <h2 style={{ margin: 0 }}>Password</h2>
        <form className="stack" onSubmit={changePassword}>
          <label className="field">
            Current password
            <PasswordInput value={current} onChange={setCurrent} required autoComplete="current-password" data-testid="current-password" />
          </label>
          <label className="field">
            <span>
              New password <span className="muted">(at least 8 characters)</span>
            </span>
            <PasswordInput value={next} onChange={setNext} required minLength={8} autoComplete="new-password" data-testid="new-password" />
          </label>
          {pwMsg && (
            <div className={`alert ${pwMsg.ok ? "ok" : "error"}`} data-testid="password-msg">
              {pwMsg.text}
            </div>
          )}
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy !== null} data-testid="change-password">
              {busy === "password" ? "Changing..." : "Change password"}
            </button>
            <Link className="muted small" href={`/forgot?email=${encodeURIComponent(user.email)}`}>
              Forgot it? Send me a reset link
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
