import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createDb, videoExports } from "@sceneflow/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";

let app: FastifyInstance;
let storageDir: string;
const send = vi.fn(async () => "job");

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-exports-"));
  app = await buildApp(testConfig(storageDir), { queue: { send } });
});
afterAll(async () => {
  await app.close();
  await rm(storageDir, { recursive: true, force: true });
});

async function register(name = "Tester", email = `u-${crypto.randomUUID()}@test.dev`) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: "password123", name } });
  const cookie = res.cookies.find((c) => c.name === "sf_session")!;
  return { cookies: { sf_session: cookie.value }, workspaceId: res.json().workspaceId as string, userId: res.json().user.id as string, email };
}
const scenes = (end = 6) => [
  { id: "a", name: "Intro", start: 0, end: end / 2, background: { type: "gradient", css: "linear-gradient(#000,#444)" }, layers: [{ id: "t", type: "text", frame: { x: 10, y: 10, w: 50, h: 10 }, content: { text: "Hi" } }] },
  { id: "b", name: "Outro", start: end / 2, end, background: { type: "color", color: "#123456" }, layers: [] },
];

describe("MP4 exports", () => {
  it("queues a render of the draft with frozen options, lists it, downloads it when ready, deletes it", async () => {
    const owner = await register("Olivia Owner");
    const { project } = (await app.inject({ method: "POST", url: "/api/v1/projects", cookies: owner.cookies, payload: { workspaceId: owner.workspaceId, name: "Spring Launch 2026" } })).json();

    // Nothing saved yet → nothing to export.
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies: owner.cookies, payload: { config: { canvas: { aspectRatio: "9:16" }, playback: { mode: "scroll" }, scenes: scenes(6) } } })).statusCode).toBe(200);
    // Not published yet → the published source is not available.
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies, payload: { source: "published" } })).statusCode).toBe(404);
    // Bad options are rejected before anything is queued.
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies, payload: { fps: 17 } })).statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();

    const created = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies, payload: { quality: "720p", fps: 25 } });
    expect(created.statusCode, created.body).toBe(201);
    const ex = created.json().export;
    expect(ex).toMatchObject({ status: "queued", source: "draft", version: 1, requestedByName: "Olivia Owner", fileName: "spring-launch-2026-720p.mp4", fileUrl: null });
    // Portrait canvas → mobile layout, 720×1280.
    expect(ex.options).toEqual({ quality: "720p", width: 720, height: 1280, fps: 25, device: "mobile" });
    expect(ex.configJson).toBeUndefined();
    expect(ex.storageKey).toBeUndefined();
    expect(send).toHaveBeenCalledWith("export.render", { exportId: ex.id }, expect.objectContaining({ retryLimit: 0 }));
    // The frozen config is a plain play-through of what was saved, never changed by later autosaves.
    const db = createDb(testConfig(storageDir).databaseUrl);
    const row = (await db.db.query.videoExports.findFirst({ where: eq(videoExports.id, ex.id) }))!;
    expect(row.configJson.scenes).toHaveLength(2);
    expect(row.configJson.playback.mode).toBe("scroll"); // the worker's exportConfig() switches it; the row keeps the authored config
    await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies: owner.cookies, payload: { config: { scenes: scenes(8) } } });
    expect((await db.db.query.videoExports.findFirst({ where: eq(videoExports.id, ex.id) }))!.configJson.scenes[1]!.end).toBe(6);

    // Listing + single read; not ready yet → the download says so.
    const list = (await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies })).json().exports;
    expect(list.map((e: { id: string }) => e.id)).toEqual([ex.id]);
    expect((await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}`, cookies: owner.cookies })).json().export.id).toBe(ex.id);
    expect((await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}/file`, cookies: owner.cookies })).statusCode).toBe(409);

    // Pretend the worker finished: drop a file in local public storage.
    const key = `${owner.workspaceId}/exports/${ex.id}.mp4`;
    const path = join(storageDir, "public", key);
    await mkdir(dirname(path), { recursive: true });
    const fake = Buffer.from("not really an mp4 but 30 bytes");
    await writeFile(path, fake);
    await db.db.update(videoExports).set({ status: "ready", storageKey: key, sizeBytes: fake.length, durationSec: 6, progressJson: null, finishedAt: new Date() }).where(eq(videoExports.id, ex.id));
    const ready = (await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}`, cookies: owner.cookies })).json().export;
    expect(ready.fileUrl).toBe(`http://localhost:4800/api/v1/exports/${ex.id}/file`);
    const dl = await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}/file`, cookies: owner.cookies });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("video/mp4");
    expect(dl.headers["content-disposition"]).toBe('attachment; filename="spring-launch-2026-720p.mp4"');
    expect(dl.headers["content-length"]).toBe(String(fake.length));
    expect(dl.body).toBe(fake.toString());

    // Members only; viewers may download but not create or delete.
    expect((await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}/file` })).statusCode).toBe(401);
    const stranger = await register("Stranger");
    expect((await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}`, cookies: stranger.cookies })).statusCode).toBe(403);
    const inv = (await app.inject({ method: "POST", url: `/api/v1/workspaces/${owner.workspaceId}/invites`, cookies: owner.cookies, payload: { role: "viewer" } })).json();
    const viewer = await register("Vic Viewer");
    await app.inject({ method: "POST", url: `/api/v1/invites/${inv.url.split("/").pop()}/accept`, cookies: viewer.cookies });
    expect((await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}/file`, cookies: viewer.cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: viewer.cookies, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/exports/${ex.id}`, cookies: viewer.cookies })).statusCode).toBe(403);

    // Delete removes the row and the file.
    expect((await app.inject({ method: "DELETE", url: `/api/v1/exports/${ex.id}`, cookies: owner.cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/exports/${ex.id}`, cookies: owner.cookies })).statusCode).toBe(404);
    await expect(import("node:fs/promises").then((fs) => fs.stat(path))).rejects.toThrow();
    await db.close();
  });

  it("exports the published version on request and refuses projects over the length limit", async () => {
    const owner = await register("Pat Publisher");
    const { project } = (await app.inject({ method: "POST", url: "/api/v1/projects", cookies: owner.cookies, payload: { workspaceId: owner.workspaceId, name: "Long one" } })).json();
    await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies: owner.cookies, payload: { config: { scenes: scenes(10) } } });
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/publish`, cookies: owner.cookies, payload: {} })).statusCode).toBe(200);
    // New draft after publishing (v2); the published export still renders v1.
    await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies: owner.cookies, payload: { config: { scenes: scenes(12) } } });
    const pub = (await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies, payload: { source: "published", device: "tablet" } })).json().export;
    expect(pub).toMatchObject({ source: "published", version: 1, status: "queued" });
    expect(pub.options).toEqual({ quality: "1080p", width: 1920, height: 1080, fps: 30, device: "tablet" });
    const draft = (await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies, payload: {} })).json().export;
    expect(draft).toMatchObject({ source: "draft", version: 2 });

    await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies: owner.cookies, payload: { config: { scenes: scenes(601) } } });
    const tooLong = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/exports`, cookies: owner.cookies, payload: {} });
    expect(tooLong.statusCode).toBe(422);
    expect(tooLong.json().error).toBe("EXPORT_TOO_LONG");
  });
});
