"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

const NAV = [
  { href: "/projects", label: "Projects" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/team", label: "Team & clients" },
];

export function Header() {
  const { user, signOut, workspaces, workspace, selectWorkspace } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const imp = user?.impersonatedBy;

  async function stopImpersonating() {
    setLeaving(true);
    setLeaveError(null);
    try {
      const r = await api<{ restored: boolean }>("/api/v1/auth/impersonation/stop", { method: "POST" });
      // Full page load: nothing of the borrowed account's state survives in this tab.
      window.location.assign(r.restored ? "/admin?tab=users" : "/login");
    } catch (e) {
      setLeaveError(errorMessage(e));
    } finally {
      setLeaving(false);
    }
  }

  return (
    <>
    {imp && user && (
      <div className="impersonation-bar" role="status" data-testid="impersonation-bar">
        <span>
          You are signed in as <strong>{user.name}</strong> ({user.email}) by {imp.email}. Password and profile changes are off; this session ends within an hour.
        </span>
        <button className="btn sm" onClick={() => void stopImpersonating()} disabled={leaving} data-testid="stop-impersonating">
          {leaving ? "Returning…" : "Return to admin"}
        </button>
        {leaveError && <span>{leaveError}</span>}
      </div>
    )}
    <header className="topbar">
      <Link href={user ? "/projects" : "/"} className="brand">
        SceneFlow
      </Link>
      {user && (
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href || (n.href === "/projects" && pathname.startsWith("/projects")) ? "on" : ""}>
              {n.label}
            </Link>
          ))}
          {user.superAdmin && (
            <Link href="/admin" className={pathname.startsWith("/admin") ? "on" : ""} data-testid="admin-link">
              Admin
            </Link>
          )}
        </nav>
      )}
      {user ? (
        <div className="row" style={{ marginLeft: "auto" }}>
          {workspaces.length > 1 && workspace && (
            <select className="input sm" value={workspace.id} onChange={(e) => selectWorkspace(e.target.value)} title="Switch workspace" aria-label="Workspace" style={{ width: "auto" }}>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.role !== "owner" ? ` (${w.role})` : ""}
                </option>
              ))}
            </select>
          )}
          <Link href="/account" className={`muted small${pathname === "/account" ? " on" : ""}`} title="Account settings" data-testid="account-link">
            {user.email}
          </Link>
          <button
            className="btn sm"
            onClick={async () => {
              await signOut();
              router.push("/login");
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </header>
    </>
  );
}
