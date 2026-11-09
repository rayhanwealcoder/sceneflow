import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { analyticsEvents, projects, sites } from "@sceneflow/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";
import { parseMentions } from "../src/lib/review.js";

let app: FastifyInstance;
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-agency-"));
  app = await buildApp(testConfig(storageDir), { queue: { send: vi.fn(async () => "job") } });
});
afterAll(async () => {
  await app.close();
  await rm(storageDir, { recursive: true, force: true });
});

async function register(name = "Tester", email = `u-${crypto.randomUUID()}@test.dev`) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: "password123", name } });
  const cookie = res.cookies.find((c) => c.name === "sf_session")!;
  return { cookies: { sf_session: cookie.value }, workspaceId: res.json().workspaceId as string, userId: res.json().user.id as string, email, name };
}
const draftConfig = (label = "Hello") => ({ scenes: [{ id: "s1", name: "Intro", start: 0, end: 4, background: { type: "color", color: "#000" }, script: { voiceover: "internal note", shot: "push-in" }, layers: [{ id: "t", type: "text", frame: { x: 10, y: 10, w: 50, h: 10 }, content: { text: label } }] }] });
async function projectWithDraft(cookies: Record<string, string>, workspaceId: string, name = "Spring launch", extra: Record<string, unknown> = {}) {
  const { project } = (await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name, ...extra } })).json();
  const saved = await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies, payload: { config: draftConfig() } });
  expect(saved.statusCode).toBe(200);
  return project as { id: string; workspaceId: string };
}
const tokenOf = (url: string) => url.split("/").pop()!;

describe("team: invitation links and roles", () => {
  it("invites by link, accepts as a new user, lists members, changes roles with the right limits", async () => {
    const owner = await register("Olivia Owner");
    // Only admins create invites.
    const viewerToBe = await register("Vic Viewer");
    const inv = await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "editor" } });
    expect(inv.statusCode, inv.body).toBe(201);
    const url: string = inv.json().url;
    expect(url).toMatch(/^http:\/\/localhost:3000\/join\/[0-9a-f]{64}$/);
    const token = tokenOf(url);

    // Public preview of the invitation, no cookie needed.
    const peek = await app.inject({ method: "GET", url: `/api/v1/invites/${token}` });
    expect(peek.statusCode).toBe(200);
    expect(peek.json()).toMatchObject({ workspaceName: "Olivia Owner's workspace", role: "editor", invitedBy: "Olivia Owner" });
    expect((await app.inject({ method: "GET", url: `/api/v1/invites/${"0".repeat(64)}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/invites/not-a-token` })).statusCode).toBe(404);

    // Accepting needs a signed-in user; the editor joins and sees both workspaces.
    expect((await app.inject({ method: "POST", url: `/api/v1/invites/${token}/accept` })).statusCode).toBe(401);
    const editor = await register("Ed Editor");
    const accepted = await app.inject({ method: "POST", url: `/api/v1/invites/${token}/accept`, cookies: editor.cookies });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ workspaceId: owner.workspaceId, role: "editor" });
    expect((await app.inject({ method: "POST", url: `/api/v1/invites/${token}/accept`, cookies: editor.cookies })).statusCode).toBe(410); // used
    const mine = (await app.inject({ method: "GET", url: "/api/v1/workspaces", cookies: editor.cookies })).json().workspaces;
    expect(mine.map((w: { role: string }) => w.role).sort()).toEqual(["editor", "owner"]);
    // The workspace became a team.
    const ws = (await app.inject({ method: "GET", url: `/api/v1/workspaces/${owner.workspaceId}`, cookies: owner.cookies })).json();
    expect(ws.workspace.type).toBe("team");
    expect(ws.members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`)).toEqual(["Olivia Owner:owner", "Ed Editor:editor"]);

    // Editors cannot invite or change roles; admins can; the owner is fixed; nobody edits their own role.
    expect((await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: editor.cookies, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/workspaces/${owner.workspaceId}/members/${editor.userId}`, cookies: editor.cookies, payload: { role: "admin" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/workspaces/${owner.workspaceId}/members/${editor.userId}`, cookies: owner.cookies, payload: { role: "admin" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`, cookies: owner.cookies, payload: { role: "viewer" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/workspaces/${owner.workspaceId}/members/${editor.userId}`, cookies: owner.cookies, payload: { role: "owner" } })).statusCode).toBe(400);
    // The new admin can rename the workspace and invite a viewer restricted to one e-mail.
    expect((await app.inject({ method: "PATCH", url: `/api/v1/workspaces/${owner.workspaceId}`, cookies: editor.cookies, payload: { name: "Studio Nine" } })).statusCode).toBe(200);
    const inv2 = (await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: editor.cookies, payload: { role: "viewer", email: viewerToBe.email.toUpperCase() } })).json();
    const stranger = await register("Stranger");
    expect((await app.inject({ method: "POST", url: `/api/v1/invites/${tokenOf(inv2.url)}/accept`, cookies: stranger.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/v1/invites/${tokenOf(inv2.url)}/accept`, cookies: viewerToBe.cookies })).statusCode).toBe(200);
    // Viewers read but do not create projects; they can leave; the owner cannot be removed.
    expect((await app.inject({ method: "GET", url: `/api/v1/projects?workspaceId=${owner.workspaceId}`, cookies: viewerToBe.cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/projects", cookies: viewerToBe.cookies, payload: { workspaceId: owner.workspaceId, name: "Nope" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`, cookies: editor.cookies })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/workspaces/${owner.workspaceId}/members/${viewerToBe.userId}`, cookies: viewerToBe.cookies })).statusCode).toBe(200);
    const pending = (await app.inject({ method: "GET", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies })).json().invites;
    expect(pending).toHaveLength(0); // both accepted
  });
});

describe("clients", () => {
  it("creates clients, assigns projects, keeps workspaces apart, deleting a client keeps its projects", async () => {
    const me = await register("Agency");
    const other = await register("Other");
    const created = await app.inject({ method: "POST", url: "/api/v1/clients", cookies: me.cookies, payload: { workspaceId: me.workspaceId, name: "Acme Coffee", contactEmail: "" } });
    expect(created.statusCode, created.body).toBe(201);
    const client = created.json().client;
    expect(client.contactEmail).toBeNull();
    const project = await projectWithDraft(me.cookies, me.workspaceId, "Acme launch", { clientId: client.id });
    const list = (await app.inject({ method: "GET", url: `/api/v1/clients?workspaceId=${me.workspaceId}`, cookies: me.cookies })).json().clients;
    expect(list).toEqual([expect.objectContaining({ name: "Acme Coffee", projectCount: 1 })]);
    const detail = (await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}`, cookies: me.cookies })).json();
    expect(detail.client).toMatchObject({ name: "Acme Coffee" });
    expect(detail.role).toBe("owner");
    expect(detail.project.reviewTokenHash).toBeUndefined();
    expect(detail.project.hasReviewLink).toBe(false);
    // Another workspace's client cannot be attached; another workspace cannot see our clients.
    const theirs = (await app.inject({ method: "POST", url: "/api/v1/clients", cookies: other.cookies, payload: { workspaceId: other.workspaceId, name: "Theirs" } })).json().client;
    expect((await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}`, cookies: me.cookies, payload: { clientId: theirs.id } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/v1/clients?workspaceId=${me.workspaceId}`, cookies: other.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/clients/${client.id}`, cookies: other.cookies, payload: { name: "Hijack" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/clients/${client.id}`, cookies: me.cookies, payload: { name: "Acme Coffee Co", notes: "Likes warm colours" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/clients/${client.id}`, cookies: me.cookies })).statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}`, cookies: me.cookies })).json();
    expect(after.project.clientId).toBeNull();
    expect(after.client).toBeNull();
  });
});

describe("comments", () => {
  it("anchors comments to time / scene / element / point, parses mentions, resolves, and limits edit/delete to author or admin", async () => {
    const owner = await register("Olivia Owner");
    const editor = await register("Ed Editor");
    const inv = (await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "editor" } })).json();
    await app.inject({ method: "POST", url: `/api/v1/invites/${tokenOf(inv.url)}/accept`, cookies: editor.cookies });
    const project = await projectWithDraft(owner.cookies, owner.workspaceId);

    const c1 = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/comments`, cookies: editor.cookies, payload: { body: "@Olivia the headline overlaps the logo here", t: 1.5, sceneId: "s1", layerId: "t", x: 42.5, y: 18 } });
    expect(c1.statusCode, c1.body).toBe(201);
    expect(c1.json().comment).toMatchObject({ authorName: "Ed Editor", source: "team", t: 1.5, sceneId: "s1", layerId: "t", x: 42.5, y: 18, mentionsJson: [owner.userId], resolvedAt: null });
    const reply = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/comments`, cookies: owner.cookies, payload: { body: "Good catch — moving it", parentId: c1.json().comment.id } });
    expect(reply.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/comments`, cookies: owner.cookies, payload: { body: "orphan", parentId: crypto.randomUUID() } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/comments`, cookies: owner.cookies, payload: { body: "", t: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/comments`, cookies: owner.cookies, payload: { body: "x", x: 140 } })).statusCode).toBe(400);

    // The editor cannot edit the owner's text, but can resolve it; the owner (admin) can edit anything.
    const rid = reply.json().comment.id;
    expect((await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}/comments/${rid}`, cookies: editor.cookies, payload: { body: "changed" } })).statusCode).toBe(403);
    const resolved = await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}/comments/${c1.json().comment.id}`, cookies: editor.cookies, payload: { resolved: true } });
    expect(resolved.json().comment.resolvedBy).toBe("Ed Editor");
    expect((await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}/comments/${c1.json().comment.id}`, cookies: owner.cookies, payload: { body: "edited by admin" } })).statusCode).toBe(200);
    const all = (await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/comments`, cookies: editor.cookies })).json().comments;
    expect(all).toHaveLength(2);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/projects/${project.id}/comments/${rid}`, cookies: editor.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/projects/${project.id}/comments/${rid}`, cookies: owner.cookies })).statusCode).toBe(200);
    // Outsiders see nothing.
    const outsider = await register("Out");
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/comments`, cookies: outsider.cookies })).statusCode).toBe(403);
  });

  it("parseMentions matches full and first names, longest first, and ignores unknown names", () => {
    const members = [
      { userId: "a", name: "Olivia Owner" },
      { userId: "b", name: "Olivia" },
      { userId: "c", name: "Ed Editor" },
    ];
    expect(parseMentions("@Olivia Owner please", members)).toEqual(["a"]);
    expect(parseMentions("hey @olivia", members)).toEqual(["b"]); // first name of "a" is also Olivia; shortest tie keeps the first exact
    expect(parseMentions("@Ed and @Olivia Owner", members).sort()).toEqual(["a", "c"]);
    expect(parseMentions("@Eddie is not Ed", members)).toEqual([]);
    expect(parseMentions("no mentions", members)).toEqual([]);
  });
});

describe("review workflow (doc §23)", () => {
  it("editor cannot publish without approval; client link → comment → approve → publish; edits after approval block again; admins bypass", async () => {
    const owner = await register("Olivia Owner");
    const editor = await register("Ed Editor");
    const inv = (await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "editor" } })).json();
    await app.inject({ method: "POST", url: `/api/v1/invites/${tokenOf(inv.url)}/accept`, cookies: editor.cookies });
    const project = await projectWithDraft(owner.cookies, owner.workspaceId);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}`, cookies: owner.cookies, payload: { approvalRequired: true } })).statusCode).toBe(200);

    // Editor: blocked. Status is plain draft.
    const blocked = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/publish`, cookies: editor.cookies, payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("APPROVAL_REQUIRED");

    // Editor sends it to the client → link.
    const sent = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/review`, cookies: editor.cookies, payload: { action: "request_client", note: "Ready for your look" } });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().project).toMatchObject({ reviewStatus: "client", reviewVersion: 1, hasReviewLink: true });
    const url: string = sent.json().reviewUrl;
    expect(url).toMatch(/\/review\/[0-9a-f]{64}$/);
    const token = tokenOf(url);
    // The same link is returned again later (it is stored encrypted, never shown as a hash).
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/review-link`, cookies: owner.cookies })).json().url).toBe(url);
    // Viewers (not editors) cannot see the link.
    const viewer = await register("Vic");
    const vinv = (await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "viewer" } })).json();
    await app.inject({ method: "POST", url: `/api/v1/invites/${tokenOf(vinv.url)}/accept`, cookies: viewer.cookies });
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/review-link`, cookies: viewer.cookies })).statusCode).toBe(403);

    // Client (no account): sees the draft without storyboard notes, comments, approves.
    const view = await app.inject({ method: "GET", url: `/api/v1/review/${token}` });
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({ project: { name: "Spring launch", from: "Olivia Owner's workspace" }, status: "client", canApprove: true, version: 1 });
    expect(view.json().config.scenes[0].script).toBeUndefined();
    expect(view.json().config.scenes[0].layers[0].content.text).toBe("Hello");
    const cc = await app.inject({ method: "POST", url: `/api/v1/review/${token}/comments`, payload: { name: "Chris (Acme)", body: "Can the button be green?", t: 2, x: 50, y: 80 } });
    expect(cc.statusCode, cc.body).toBe(201);
    expect(cc.json().comment).toMatchObject({ source: "client", authorName: "Chris (Acme)", authorId: null });
    expect((await app.inject({ method: "POST", url: `/api/v1/review/${token}/comments`, payload: { name: "", body: "x" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/api/v1/review/${token}/approve`, payload: { name: "Chris (Acme)" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: "approved", approvedBy: "Chris (Acme)", version: 1 });
    expect((await app.inject({ method: "GET", url: `/api/v1/review/${token}` })).json().canApprove).toBe(false);

    // Team sees the approval and the client's comment; the editor can publish now.
    const after = (await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}`, cookies: editor.cookies })).json();
    expect(after.project).toMatchObject({ reviewStatus: "approved", approvedVersion: 1, approvedBy: "Chris (Acme)" });
    expect(after.project.approvedChecksum).toBe(after.draft.checksum);
    const published = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/publish`, cookies: editor.cookies, payload: {} });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().publishedVersion).toBe(1);

    // Edit after approval → a new draft version with a new checksum → editor blocked again, admin not.
    await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies: editor.cookies, payload: { config: draftConfig("Changed") } });
    const again = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/publish`, cookies: editor.cookies, payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toMatch(/changed afterwards/);
    const diag = (await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/diagnostics`, cookies: editor.cookies })).json().checks;
    expect(diag.find((c: { id: string }) => c.id === "approval")).toMatchObject({ status: "info", title: "Edited since it was approved" });
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/publish`, cookies: owner.cookies, payload: {} })).statusCode).toBe(200);

    // Internal path: editor requests, admin approves; editors cannot approve.
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/review`, cookies: editor.cookies, payload: { action: "request_internal" } })).json().project.reviewStatus).toBe("internal");
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/review`, cookies: editor.cookies, payload: { action: "approve" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/review`, cookies: viewer.cookies, payload: { action: "request_internal" } })).statusCode).toBe(403);
    const approved = (await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/review`, cookies: owner.cookies, payload: { action: "approve" } })).json().project;
    expect(approved).toMatchObject({ reviewStatus: "approved", approvedBy: "Olivia Owner", approvedVersion: 2 });

    // Client asks for changes with a note → status + comment. Then the link is revoked → 404.
    const rc = await app.inject({ method: "POST", url: `/api/v1/review/${token}/request-changes`, payload: { name: "Chris (Acme)", note: "Logo is too small" } });
    expect(rc.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}`, cookies: owner.cookies })).json().project.reviewStatus).toBe("changes");
    const comments = (await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/comments`, cookies: owner.cookies })).json().comments;
    expect(comments.map((c: { body: string }) => c.body)).toEqual(["Can the button be green?", "Logo is too small"]);
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/review-link`, cookies: editor.cookies, payload: { action: "revoke" } })).json().url).toBeNull();
    expect((await app.inject({ method: "GET", url: `/api/v1/review/${token}` })).statusCode).toBe(404);
    // A fresh link works; an expired one answers 410.
    const fresh = (await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/review-link`, cookies: editor.cookies, payload: { action: "create" } })).json();
    expect((await app.inject({ method: "GET", url: `/api/v1/review/${tokenOf(fresh.url)}` })).statusCode).toBe(200);
    const { db } = (app as unknown as { ctx?: never }) && (await import("@sceneflow/server")).createDb(testConfig(storageDir).databaseUrl);
    await db.update(projects).set({ reviewTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(projects.id, project.id));
    expect((await app.inject({ method: "GET", url: `/api/v1/review/${tokenOf(fresh.url)}` })).statusCode).toBe(410);
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}`, cookies: owner.cookies })).json().project.hasReviewLink).toBe(false);

    // Activity feed tells the story in order.
    const feed = (await app.inject({ method: "GET", url: `/api/v1/workspaces/${owner.workspaceId}/activity`, cookies: owner.cookies })).json().activity;
    expect(feed.map((a: { type: string; actorName: string }) => `${a.type}:${a.actorName}`)).toEqual([
      "changes_requested:Chris (Acme)",
      "approved:Olivia Owner",
      "review_requested:Ed Editor",
      "published:Olivia Owner",
      "published:Ed Editor",
      "approved:Chris (Acme)",
      "client_comment:Chris (Acme)",
      "client_review_requested:Ed Editor",
    ]);
  });
});

describe("agency dashboard", () => {
  it("lists projects with client, site health, review state, 7-day numbers, open comments; raises alerts; shows my mentions", async () => {
    const owner = await register("Olivia Owner");
    const editor = await register("Ed Editor");
    const inv = (await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "editor" } })).json();
    await app.inject({ method: "POST", url: `/api/v1/invites/${tokenOf(inv.url)}/accept`, cookies: editor.cookies });
    const client = (await app.inject({ method: "POST", url: "/api/v1/clients", cookies: owner.cookies, payload: { workspaceId: owner.workspaceId, name: "Acme" } })).json().client;
    const p1 = await projectWithDraft(owner.cookies, owner.workspaceId, "Acme launch", { clientId: client.id });
    const p2 = await projectWithDraft(owner.cookies, owner.workspaceId, "Internal demo");
    // p1: approved by the client but not published → info alert; a mention of the owner; an open client comment.
    await app.inject({ method: "PATCH", url: `/api/v1/projects/${p1.id}`, cookies: owner.cookies, payload: { approvalRequired: true } });
    const sent = (await app.inject({ method: "POST", url: `/api/v1/projects/${p1.id}/review`, cookies: editor.cookies, payload: { action: "request_client" } })).json();
    await app.inject({ method: "POST", url: `/api/v1/review/${tokenOf(sent.reviewUrl)}/comments`, payload: { name: "Chris", body: "Looks good, one thing: the price" } });
    await app.inject({ method: "POST", url: `/api/v1/review/${tokenOf(sent.reviewUrl)}/approve`, payload: { name: "Chris" } });
    await app.inject({ method: "POST", url: `/api/v1/projects/${p1.id}/comments`, cookies: editor.cookies, payload: { body: "@Olivia can you publish this one?" } });
    // p2: published, then a site in error + player errors in analytics → alerts.
    await app.inject({ method: "POST", url: `/api/v1/projects/${p2.id}/publish`, cookies: owner.cookies, payload: {} });
    const { db } = (await import("@sceneflow/server")).createDb(testConfig(storageDir).databaseUrl);
    const [site] = await db.insert(sites).values({ workspaceId: owner.workspaceId, url: "https://broken.example", name: "Broken site", connectionStatus: "error", lastError: "HTTP 500 from the site" }).returning();
    await db.update(projects).set({ siteId: site!.id }).where(eq(projects.id, p2.id));
    await db.insert(analyticsEvents).values([
      { id: crypto.randomUUID(), projectId: p2.id, version: 1, sessionId: "s1", type: "player_loaded", occurredAt: new Date() },
      { id: crypto.randomUUID(), projectId: p2.id, version: 1, sessionId: "s1", type: "video_play", occurredAt: new Date() },
      { id: crypto.randomUUID(), projectId: p2.id, version: 1, sessionId: "s1", type: "element_click", occurredAt: new Date() },
      { id: crypto.randomUUID(), projectId: p2.id, version: 1, sessionId: "s1", type: "player_error", occurredAt: new Date() },
      { id: crypto.randomUUID(), projectId: p2.id, version: 1, sessionId: "old", type: "player_loaded", occurredAt: new Date(Date.now() - 10 * 86400_000) },
    ]);

    const res = await app.inject({ method: "GET", url: `/api/v1/workspaces/${owner.workspaceId}/dashboard`, cookies: owner.cookies });
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.clients).toEqual([expect.objectContaining({ name: "Acme", projectCount: 1 })]);
    const acme = d.projects.find((p: { id: string }) => p.id === p1.id);
    const demo = d.projects.find((p: { id: string }) => p.id === p2.id);
    expect(acme).toMatchObject({ clientName: "Acme", reviewStatus: "approved", approvedBy: "Chris", openComments: 2, totalComments: 2, site: null, publishedVersion: null });
    expect(acme.reviewTokenHash).toBeUndefined();
    expect(demo).toMatchObject({ clientName: null, status: "published", publishedVersion: 1, site: { name: "Broken site", connectionStatus: "error" }, stats7d: { loads: 1, plays: 1, clicks: 1, errors: 1 } });
    expect(d.alerts.map((a: { kind: string }) => a.kind).sort()).toEqual(["approved_unpublished", "player_errors", "site_error"]);
    expect(d.alerts[0].kind).toBe("site_error"); // most severe first
    expect(d.mentions).toEqual([expect.objectContaining({ projectId: p1.id, projectName: "Acme launch", authorName: "Ed Editor" })]);
    expect(d.totals).toMatchObject({ projects: 2, published: 1, inReview: 0, openComments: 2, loads7d: 1, plays7d: 1, clicks7d: 1 });
    expect(d.activity[0]).toMatchObject({ type: "published", projectName: "Internal demo" });
    // The editor sees no mentions of their own; an outsider sees nothing.
    expect((await app.inject({ method: "GET", url: `/api/v1/workspaces/${owner.workspaceId}/dashboard`, cookies: editor.cookies })).json().mentions).toEqual([]);
    const outsider = await register("Out");
    expect((await app.inject({ method: "GET", url: `/api/v1/workspaces/${owner.workspaceId}/dashboard`, cookies: outsider.cookies })).statusCode).toBe(403);
  });
});
