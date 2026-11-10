"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AdminAudit } from "@/components/admin/AdminAudit";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AdminSites } from "@/components/admin/AdminSites";
import { AdminSystem } from "@/components/admin/AdminSystem";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminWorkspaces } from "@/components/admin/AdminWorkspaces";
import { useSession } from "@/lib/session";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "workspaces", label: "Workspaces" },
  { id: "sites", label: "Sites" },
  { id: "system", label: "System" },
  { id: "audit", label: "Audit log" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminConsole />
    </Suspense>
  );
}

/** Super admin console. Non-admins get the same "not found" the API gives them. The tab lives in the URL. */
function AdminConsole() {
  const { user } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const tab = (TABS.some((t) => t.id === search.get("tab")) ? search.get("tab") : "overview") as Tab;
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) router.replace("/login?next=%2Fadmin");
  }, [user, router]);

  const go = (t: Tab) => router.push(t === "overview" ? "/admin" : `/admin?tab=${t}`);
  const openWorkspace = (id: string) => {
    setWorkspaceId(id);
    go("workspaces");
  };
  const openUser = (email: string) => {
    setUserQuery(email);
    go("users");
  };

  if (!user) return <p className="muted">Loading…</p>;
  if (!user.superAdmin)
    return (
      <div className="card stack" data-testid="admin-denied">
        <h1 style={{ margin: 0 }}>Page not found</h1>
        <p className="muted" style={{ margin: 0 }}>
          There is nothing at this address.
        </p>
      </div>
    );

  return (
    <div className="stack admin" data-testid="admin-console">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Admin</h1>
        <span className="muted small">Every account and workspace on this SceneFlow server. Changes are recorded in the audit log.</span>
      </div>
      <div className="admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)} data-testid={`admin-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <AdminOverview onOpenWorkspace={openWorkspace} />}
      {tab === "users" && <AdminUsers initialQuery={userQuery} onOpenWorkspace={openWorkspace} />}
      {tab === "workspaces" && <AdminWorkspaces openId={workspaceId} onOpenUser={openUser} />}
      {tab === "sites" && <AdminSites onOpenWorkspace={openWorkspace} />}
      {tab === "system" && <AdminSystem />}
      {tab === "audit" && <AdminAudit />}
    </div>
  );
}
