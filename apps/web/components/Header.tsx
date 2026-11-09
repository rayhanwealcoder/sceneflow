"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  return (
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
          <span className="muted small">{user.email}</span>
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
  );
}
