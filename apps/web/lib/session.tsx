"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { User, Workspace } from "./types";

interface SessionState {
  user: User | null | undefined; // undefined = loading
  /** Every workspace the user belongs to (own + ones they were invited to). */
  workspaces: Workspace[];
  /** The one the app is showing; remembered per browser. null while loading or when the user has none. */
  workspace: Workspace | null;
  selectWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);
const WS_KEY = "sf_workspace";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api<{ user: User | null }>("/api/v1/auth/me");
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const { workspaces } = await api<{ workspaces: Workspace[] }>("/api/v1/workspaces");
      setWorkspaces(workspaces);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/v1/auth/logout", { method: "POST" });
    setUser(null);
    setWorkspaces([]);
  }, []);

  useEffect(() => {
    void refresh();
    try {
      setChosen(localStorage.getItem(WS_KEY));
    } catch {
      /* private mode */
    }
  }, [refresh]);

  // A different account (sign-in, "Sign in as", returning from it) must never see the previous account's
  // workspace list, not even for one render: clear first, then load.
  const userId = user?.id;
  useEffect(() => {
    setWorkspaces([]);
    if (userId) void refreshWorkspaces();
  }, [userId, refreshWorkspaces]);

  const selectWorkspace = useCallback((id: string) => {
    setChosen(id);
    try {
      localStorage.setItem(WS_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const workspace = useMemo(() => workspaces.find((w) => w.id === chosen) ?? workspaces.find((w) => w.role === "owner") ?? workspaces[0] ?? null, [workspaces, chosen]);
  const value = useMemo(() => ({ user, workspaces, workspace, selectWorkspace, refresh, refreshWorkspaces, signOut }), [user, workspaces, workspace, selectWorkspace, refresh, refreshWorkspaces, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
