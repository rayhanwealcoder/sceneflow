"use client";

import { create } from "zustand";
import { api } from "./api";
import type { Comment, CommentAnchor } from "./types";

/**
 * Review comments inside the editor (doc §23). Kept apart from the project store: comments are not part
 * of the project document, have no undo, and live on the server as soon as they are posted.
 */
interface CommentsState {
  open: boolean;
  projectId: string | null;
  comments: Comment[];
  loaded: boolean;
  /** Highlighted thread (clicked in the list or on a pin). */
  activeId: string | null;
  /** "Pin on canvas": the next click on the stage becomes the draft anchor. */
  placing: boolean;
  draftAnchor: CommentAnchor | null;
  filter: "open" | "resolved";
}

interface CommentsActions {
  setOpen(open: boolean): void;
  load(projectId: string): Promise<void>;
  add(input: { body: string; parentId?: string | null } & CommentAnchor): Promise<Comment>;
  patch(id: string, patch: { resolved?: boolean; body?: string }): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(id: string | null): void;
  setPlacing(on: boolean): void;
  setDraftAnchor(anchor: CommentAnchor | null): void;
  setFilter(f: "open" | "resolved"): void;
}

export const useComments = create<CommentsState & CommentsActions>()((set, get) => ({
  open: false,
  projectId: null,
  comments: [],
  loaded: false,
  activeId: null,
  placing: false,
  draftAnchor: null,
  filter: "open",

  setOpen: (open) => set({ open, placing: open ? get().placing : false }),
  load: async (projectId) => {
    const r = await api<{ comments: Comment[] }>(`/api/v1/projects/${projectId}/comments`);
    set({ projectId, comments: r.comments, loaded: true });
  },
  add: async (input) => {
    const { projectId } = get();
    if (!projectId) throw new Error("No project");
    const r = await api<{ comment: Comment }>(`/api/v1/projects/${projectId}/comments`, { method: "POST", json: input });
    set((s) => ({ comments: [...s.comments, r.comment], draftAnchor: null, placing: false, activeId: r.comment.parentId ?? r.comment.id }));
    return r.comment;
  },
  patch: async (id, patch) => {
    const { projectId } = get();
    if (!projectId) return;
    const r = await api<{ comment: Comment }>(`/api/v1/projects/${projectId}/comments/${id}`, { method: "PATCH", json: patch });
    set((s) => ({ comments: s.comments.map((c) => (c.id === id ? r.comment : c)) }));
  },
  remove: async (id) => {
    const { projectId } = get();
    if (!projectId) return;
    await api(`/api/v1/projects/${projectId}/comments/${id}`, { method: "DELETE" });
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id && c.parentId !== id), activeId: s.activeId === id ? null : s.activeId }));
  },
  setActive: (activeId) => set({ activeId }),
  setPlacing: (placing) => set({ placing }),
  setDraftAnchor: (draftAnchor) => set({ draftAnchor, placing: false }),
  setFilter: (filter) => set({ filter }),
}));

/** Top-level comments of a scene that carry a point, numbered the way the list shows them. */
export function pinsForScene(comments: Comment[], sceneId: string): Array<{ comment: Comment; n: number }> {
  const roots = comments.filter((c) => !c.parentId);
  return roots.map((c, i) => ({ comment: c, n: i + 1 })).filter((p) => p.comment.sceneId === sceneId && p.comment.x !== null && p.comment.y !== null);
}
