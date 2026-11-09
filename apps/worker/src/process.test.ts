import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, LocalStorageProvider, mediaAssets, runMigrations, users, workspaces } from "@sceneflow/server";
import { ffmpeg, renditionPlan, testClipArgs } from "./ffmpeg.js";
import { processMedia, processRenditions } from "./process.js";

const DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://postgres:sceneflow_dev@localhost:5432/sceneflow_test";

let conn: ReturnType<typeof createDb>;
let rootDir: string;
let storage: LocalStorageProvider;
let workspaceId: string;

beforeAll(async () => {
  conn = createDb(DATABASE_URL);
  await runMigrations(conn.db);
  rootDir = await mkdtemp(join(tmpdir(), "sf-worker-"));
  storage = new LocalStorageProvider({ rootDir, publicBaseUrl: "http://localhost:4000/files", uploadBaseUrl: "http://localhost:4000/uploads", secret: "test-secret-test-secret" });
  await storage.ensureDirs();
  const [u] = await conn.db.insert(users).values({ email: `w-${crypto.randomUUID()}@test.dev`, name: "W", passwordHash: "x" }).returning();
  const [ws] = await conn.db.insert(workspaces).values({ ownerId: u!.id, name: "W" }).returning();
  workspaceId = ws!.id;
});

afterAll(async () => {
  await conn.close();
  await rm(rootDir, { recursive: true, force: true });
});

describe("processMedia", () => {
  it("creates poster, proxy, thumbnails and metadata for a video", async () => {
    const [asset] = await conn.db
      .insert(mediaAssets)
      .values({ workspaceId, provider: "local", providerAssetId: "", type: "video", originalName: "clip.mp4", mimeType: "video/mp4", sizeBytes: 1, status: "uploaded" })
      .returning();
    const key = `${workspaceId}/${asset!.id}/original.mp4`;
    await conn.db.update(mediaAssets).set({ providerAssetId: key }).where(eq(mediaAssets.id, asset!.id));
    const original = storage.originalPath(key);
    await mkdir(dirname(original), { recursive: true });
    await ffmpeg(testClipArgs(original, 2));

    const meta = await processMedia({ db: conn.db, storage }, asset!.id);
    expect(meta.duration).toBeGreaterThan(1.5);
    expect(meta.width).toBe(320);
    expect(meta.hasAudio).toBe(true);
    expect(meta.posterUrl).toBe(`http://localhost:4000/files/${workspaceId}/${asset!.id}/poster.jpg`);
    expect(meta.proxyUrl).toContain("proxy-540.mp4");
    expect(meta.thumbnails!.length).toBeGreaterThan(0);
    await stat(join(rootDir, "public", workspaceId, asset!.id, "poster.jpg"));
    await stat(join(rootDir, "public", workspaceId, asset!.id, "proxy-540.mp4"));
    expect(meta.waveformUrl).toContain("waveform.json");
    const wf = JSON.parse(await readFile(join(rootDir, "public", workspaceId, asset!.id, "waveform.json"), "utf8")) as { peaks: number[]; duration: number };
    expect(wf.peaks.length).toBeGreaterThan(100);
    expect(Math.max(...wf.peaks)).toBeGreaterThan(0.1); // the test clip has a sine tone
    expect(Math.max(...wf.peaks)).toBeLessThanOrEqual(1);

    const row = await conn.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, asset!.id) });
    expect(row?.status).toBe("ready");
  }, 60_000);

  it("creates an AAC variant and waveform for audio uploads", async () => {
    const [asset] = await conn.db
      .insert(mediaAssets)
      .values({ workspaceId, provider: "local", providerAssetId: "", type: "audio", originalName: "tone.wav", mimeType: "audio/wav", sizeBytes: 1, status: "uploaded" })
      .returning();
    const key = `${workspaceId}/${asset!.id}/original.wav`;
    await conn.db.update(mediaAssets).set({ providerAssetId: key }).where(eq(mediaAssets.id, asset!.id));
    const original = storage.originalPath(key);
    await mkdir(dirname(original), { recursive: true });
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=2", original]);
    const meta = await processMedia({ db: conn.db, storage }, asset!.id);
    expect(meta.audioUrl).toContain("audio.m4a");
    expect(meta.waveformUrl).toContain("waveform.json");
    expect(meta.duration).toBeGreaterThan(1.5);
    await stat(join(rootDir, "public", workspaceId, asset!.id, "audio.m4a"));
  }, 60_000);

  it("plans renditions from the source size and clip length (never upscales)", () => {
    expect(renditionPlan(1080, 30)).toEqual([
      { height: 720, kind: "progressive" },
      { height: 1080, kind: "progressive" },
      { height: 720, kind: "scrub" },
    ]);
    expect(renditionPlan(720, 600)).toEqual([{ height: 720, kind: "progressive" }]); // long clip: no scrub version
    expect(renditionPlan(480, 10)).toEqual([{ height: 480, kind: "scrub" }]);
    expect(renditionPlan(360, 500)).toEqual([]);
  });

  it("queues the renditions job after the fast path and produces a scroll-optimized MP4 for short clips", async () => {
    const sent: Array<{ name: string; data: object }> = [];
    const queue = { send: async (name: string, data: object) => (sent.push({ name, data }), "job") };
    const [asset] = await conn.db
      .insert(mediaAssets)
      .values({ workspaceId, provider: "local", providerAssetId: "", type: "video", originalName: "hd.mp4", mimeType: "video/mp4", sizeBytes: 1, status: "uploaded" })
      .returning();
    const key = `${workspaceId}/${asset!.id}/original.mp4`;
    await conn.db.update(mediaAssets).set({ providerAssetId: key }).where(eq(mediaAssets.id, asset!.id));
    const original = storage.originalPath(key);
    await mkdir(dirname(original), { recursive: true });
    // 1280x720 source so the 720p rendition is planned (no 1080p: never upscale).
    await ffmpeg(["-f", "lavfi", "-i", "testsrc=duration=2:size=1280x720:rate=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", original]);

    const meta = await processMedia({ db: conn.db, storage, queue }, asset!.id);
    expect(meta.renditions).toEqual({ status: "pending", items: [] });
    expect(sent).toEqual([{ name: "media.renditions", data: { assetId: asset!.id } }]);
    const ready = await conn.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, asset!.id) });
    expect(ready?.status).toBe("ready"); // editor can use the proxy before renditions exist

    const items = await processRenditions({ db: conn.db, storage }, asset!.id);
    expect(items.map((r) => [r.kind, r.height])).toEqual([
      ["progressive", 720],
      ["scrub", 720],
    ]);
    expect(items.every((r) => r.sizeBytes > 0 && r.src.startsWith("http://localhost:4000/files/"))).toBe(true);
    await stat(join(rootDir, "public", workspaceId, asset!.id, "video-720.mp4"));
    await stat(join(rootDir, "public", workspaceId, asset!.id, "scrub-720.mp4"));
    const row = await conn.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, asset!.id) });
    expect(row?.metadataJson.renditions?.status).toBe("ready");
    expect(row?.metadataJson.progress).toBeUndefined();
  }, 120_000);

  it("marks the asset failed when the original is missing", async () => {
    const [asset] = await conn.db
      .insert(mediaAssets)
      .values({ workspaceId, provider: "local", providerAssetId: `${workspaceId}/missing/original.mp4`, type: "video", originalName: "x.mp4", mimeType: "video/mp4", sizeBytes: 1, status: "uploaded" })
      .returning();
    await expect(processMedia({ db: conn.db, storage }, asset!.id)).rejects.toThrow();
    const row = await conn.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, asset!.id) });
    expect(row?.status).toBe("failed");
    expect(row?.error).toBeTruthy();
  });
});
