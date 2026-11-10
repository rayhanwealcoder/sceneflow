"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

type Msg = { ok: boolean; text: string } | null;
type Busy = "name" | "password" | "email" | "notify" | null;

/**
 * Your name, e-mail address, password and mail settings. After a temporary password or an admin's sign-in
 * link, only the "choose your own password" card is shown until that is done.
 */
export default function AccountPage() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<Msg>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailMsg, setEmailMsg] = useState<Msg>(null);
  const [notifyMsg, setNotifyMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const userName = user?.name;

  useEffect(() => {
    if (user === null) router.replace("/login?next=%2Faccount");
  }, [user, router]);
  useEffect(() => {
    if (userName !== undefined) setName(userName);
  }, [userName]);

  if (!user) return <p className="muted">Loading...</p>;
  const setup = Boolean(user.passwordSetup);

  async function run(kind: Exclude<Busy, null>, set: (m: Msg) => void, fn: () => Promise<string>) {
    setBusy(kind);
    set(null);
    try {
      set({ ok: true, text: await fn() });
    } catch (err) {
      set({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  function saveName(e: FormEvent) {
    e.preventDefault();
    void run("name", setNameMsg, async () => {
      await api("/api/v1/auth/me", { method: "PATCH", json: { name: name.trim() } });
      await refresh();
      return "Saved.";
    });
  }

  function changePassword(e: FormEvent) {
    e.preventDefault();
    void run("password", setPwMsg, async () => {
      await api("/api/v1/auth/password", { method: "POST", json: setup ? { newPassword: next } : { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      if (setup) {
        await refresh();
        router.push("/projects");
        return "Password set. Welcome back.";
      }
      return "Password changed. Every other device was signed out; you stay signed in here.";
    });
  }

  function changeEmail(e: FormEvent) {
    e.preventDefault();
    void run("email", setEmailMsg, async () => {
      const r = await api<{ delivery: "email" | "log" }>("/api/v1/auth/email", { method: "POST", json: { newEmail: newEmail.trim(), currentPassword: emailPassword } });
      const sentTo = newEmail.trim();
      setEmailPassword("");
      setNewEmail("");
      return r.delivery === "email"
        ? `We sent a confirmation link to ${sentTo}. Your address changes when you open it (within 24 hours).`
        : `This server sends no mail: the confirmation link for ${sentTo} was written to the server's outbox folder. Ask the person who runs it.`;
    });
  }

  function toggleNotifications(on: boolean) {
    void run("notify", setNotifyMsg, async () => {
      await api("/api/v1/auth/me", { method: "PATCH", json: { emailNotifications: on } });
      await refresh();
      return on ? "You will get these mails." : "No more comment or approval mails.";
    });
  }

  const passwordCard = (
    <div className="card stack" data-testid="password-card">
      <h2 style={{ margin: 0 }}>{setup ? "Choose your own password" : "Password"}</h2>
      {setup && (
        <p className="muted" style={{ margin: 0 }} data-testid="password-setup-note">
          You signed in with a temporary password or a sign-in link from an administrator. Choose a password only you know to continue.
        </p>
      )}
      <form className="stack" onSubmit={changePassword}>
        {!setup && (
          <label className="field">
            Current password
            <PasswordInput value={current} onChange={setCurrent} required autoComplete="current-password" data-testid="current-password" />
          </label>
        )}
        <label className="field">
          <span>
            New password <span className="muted">(at least 8 characters)</span>
          </span>
          <PasswordInput value={next} onChange={setNext} required minLength={8} autoComplete="new-password" autoFocus={setup} data-testid="new-password" />
        </label>
        {pwMsg && (
          <div className={`alert ${pwMsg.ok ? "ok" : "error"}`} data-testid="password-msg">
            {pwMsg.text}
          </div>
        )}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy !== null} data-testid="change-password">
            {busy === "password" ? "Saving..." : setup ? "Set password and continue" : "Change password"}
          </button>
          {!setup && (
            <Link className="muted small" href={`/forgot?email=${encodeURIComponent(user.email)}`}>
              Forgot it? Send me a reset link
            </Link>
          )}
        </div>
      </form>
    </div>
  );

  if (setup) {
    return (
      <div className="stack" style={{ maxWidth: 560 }}>
        <h1 style={{ margin: 0 }}>Welcome back, {user.name}</h1>
        {passwordCard}
      </div>
    );
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

      <div className="card stack" data-testid="email-card">
        <h2 style={{ margin: 0 }}>E-mail address</h2>
        <p style={{ margin: 0 }}>
          You sign in with <strong data-testid="current-email">{user.email}</strong>. Password-reset links and notifications go there.
        </p>
        <form className="stack" onSubmit={changeEmail}>
          <label className="field">
            New e-mail address
            <input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required maxLength={254} autoComplete="email" data-testid="new-email" />
          </label>
          <label className="field">
            Your current password
            <PasswordInput value={emailPassword} onChange={setEmailPassword} required autoComplete="current-password" data-testid="email-password" />
          </label>
          {emailMsg && (
            <div className={`alert ${emailMsg.ok ? "ok" : "error"}`} data-testid="email-msg">
              {emailMsg.text}
            </div>
          )}
          <div className="row">
            <button className="btn" type="submit" disabled={busy !== null || !newEmail.trim()} data-testid="change-email">
              {busy === "email" ? "Sending..." : "Send confirmation link"}
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Nothing changes until you open the link we send to the new address. Your current address gets a notice too.
          </p>
        </form>
      </div>

      {passwordCard}

      <div className="card stack" data-testid="notify-card">
        <h2 style={{ margin: 0 }}>E-mail notifications</h2>
        <label className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <input type="checkbox" checked={user.emailNotifications !== false} disabled={busy !== null} onChange={(e) => toggleNotifications(e.target.checked)} data-testid="email-notifications" />
          <span>
            Email me when someone mentions me or replies to my comment, and about approvals (a draft waits for my approval, or mine was approved or sent back).
          </span>
        </label>
        {notifyMsg && (
          <div className={`alert ${notifyMsg.ok ? "ok" : "error"}`} data-testid="notify-msg">
            {notifyMsg.text}
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Password and security mails always arrive.
        </p>
      </div>
    </div>
  );
}
