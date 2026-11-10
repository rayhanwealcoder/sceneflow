import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { chromium } from "playwright-core";
import { parseProject } from "@sceneflow/schema";
import { createDb, LocalStorageProvider, mediaAssets, projectActivity, projects, runMigrations, users, videoExports, workspaces } from "@sceneflow/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderExport } from "./export.js";
import { FFMPEG, ffmpeg, ffprobe } from "./ffmpeg.js";
import { processMedia } from "./process.js";

const DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://postgres:sceneflow_dev@localhost:5432/sceneflow_test";
const exec = promisify(execFile);

// The renderer needs the installed Google Chrome; without one the suite is skipped (the plan is unit-tested in @sceneflow/server).
const chromeAvailable = await chromium
  .launch({ channel: "chrome", headless: true })
  .then(async (b) => (await b.close(), true))
  .catch(() => false);

let conn: ReturnType<typeof createDb>;
let rootDir: string;
let storage: LocalStorageProvider;
let workspaceId: string;
let projectId: string;

/** Average colour + brightest pixel of one frame of a video, through FFmpeg (raw RGB at 160×90). */
async function frameStats(file: string, at: number): Promise<{ r: number; g: number; b: number; maxLuma: number; pixels: Buffer }> {
  const { stdout } = await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 1 << 20 });
  const px = stdout as unknown as Buffer;
  let r = 0, g = 0, b = 0, maxLuma = 0;
  for (let i = 0; i < px.length; i += 3) {
    r += px[i]!;
    g += px[i + 1]!;
    b += px[i + 2]!;
    maxLuma = Math.max(maxLuma, 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!);
  }
  const n = px.length / 3;
  return { r: r / n, g: g / n, b: b / n, maxLuma, pixels: px };
}
const diff = (a: Buffer, b: Buffer) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
  return d / a.length;
};

async function uploadAndProcess(type: "video" | "audio", name: string, make: (out: string) => Promise<void>) {
  const [asset] = await conn.db.insert(mediaAssets).values({ workspaceId, provider: "local", providerAssetId: "", type, originalName: name, mimeType: type === "video" ? "video/mp4" : "audio/wav", sizeBytes: 1, status: "uploaded" }).returning();
  const key = `${workspaceId}/${asset!.id}/original.${name.split(".").pop()}`;
  await conn.db.update(mediaAssets).set({ providerAssetId: key }).where(eq(mediaAssets.id, asset!.id));
  const original = storage.originalPath(key);
  await mkdir(dirname(original), { recursive: true });
  await make(original);
  const meta = await processMedia({ db: conn.db, storage }, asset!.id);
  return { id: asset!.id, meta };
}

beforeAll(async () => {
  conn = createDb(DATABASE_URL);
  await runMigrations(conn.db);
  rootDir = await mkdtemp(join(tmpdir(), "sf-export-"));
  storage = new LocalStorageProvider({ rootDir, publicBaseUrl: "http://localhost:4000/files", uploadBaseUrl: "http://localhost:4000/uploads", secret: "test-secret-test-secret" });
  await storage.ensureDirs();
  const [u] = await conn.db.insert(users).values({ email: `x-${crypto.randomUUID()}@test.dev`, name: "Exporter", passwordHash: "x" }).returning();
  const [ws] = await conn.db.insert(workspaces).values({ ownerId: u!.id, name: "X" }).returning();
  workspaceId = ws!.id;
  const [p] = await conn.db.insert(projects).values({ workspaceId, name: "Export test" }).returning();
  projectId = p!.id;
});

afterAll(async () => {
  await conn.close();
  await rm(rootDir, { recursive: true, force: true });
});

describe.skipIf(!chromeAvailable)("renderExport", () => {
  it("renders scenes, layers, captions and a video background into an MP4 with mixed audio", async () => {
    // A 4 s test pattern with a 440 Hz tone, and a 2 s 330 Hz "voiceover".
    const clip = await uploadAndProcess("video", "clip.mp4", (out) => ffmpeg(["-f", "lavfi", "-i", "testsrc2=duration=4:size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]));
    const voice = await uploadAndProcess("audio", "voice.wav", (out) => ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=2", out]));
    expect(clip.meta.proxyUrl).toBeTruthy();
    expect(voice.meta.audioUrl).toBeTruthy();

    const parsed = parseProject({
      schemaVersion: "1.0",
      projectId,
      version: 1,
      canvas: { aspectRatio: "16:9" },
      playback: { mode: "scroll", controls: true }, // exports as a plain play-through
      captions: { cues: [{ start: 0.2, end: 0.9, text: "Caption" }] },
      scenes: [
        { id: "red", name: "Red", start: 0, end: 1, background: { type: "color", color: "#ff0000" }, layers: [{ id: "t", type: "text", frame: { x: 5, y: 5, w: 40, h: 12 }, content: { text: "Hello" }, style: { color: "#ffffff", fontSize: 48, fontWeight: 800 }, animation: { in: { type: "fade", duration: 0.3 } } }] },
        { id: "blue", name: "Blue", start: 1, end: 2, background: { type: "color", color: "#0000ff" }, layers: [{ id: "hs", type: "hotspot", frame: { x: 50, y: 50, w: 3, h: 5 }, content: { tooltip: "Tip" } }] },
        { id: "clip", name: "Clip", start: 2, end: 4, background: { type: "video", assetId: clip.id, src: clip.meta.proxyUrl, poster: clip.meta.posterUrl, sourceStart: 0.5 }, layers: [{ id: "vo", type: "audio", frame: { x: 0, y: 0, w: 10, h: 10 }, assetId: voice.id, src: voice.meta.audioUrl, content: { volume: 0.8, voiceover: true } }] },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const [row] = await conn.db
      .insert(videoExports)
      .values({ workspaceId, projectId, requestedByName: "Exporter", source: "draft", version: 1, checksum: "c", configJson: parsed.project, optionsJson: { quality: "720p", width: 1280, height: 720, fps: 12, device: "desktop" }, fileName: "export-test-720p.mp4" })
      .returning();

    const result = await renderExport({ db: conn.db, storage, publicUrl: "http://localhost:4000" }, row!.id);
    console.log(`[export.test] ${result.frames} frames in ${result.renderMs} ms → ${(result.renderMs / result.frames).toFixed(0)} ms/frame, ${result.slowFrames} slow, ${(result.sizeBytes / 1024).toFixed(0)} KB`);
    expect(result.frames).toBe(48);
    expect(result.pageErrors).toEqual([]);
    expect(result.slowFrames).toBe(0);

    const saved = await conn.db.query.videoExports.findFirst({ where: eq(videoExports.id, row!.id) });
    expect(saved?.status).toBe("ready");
    expect(saved?.storageKey).toBe(`${workspaceId}/exports/${row!.id}.mp4`);
    expect(saved?.progressJson).toBeNull();
    expect(saved?.sizeBytes).toBeGreaterThan(10_000);
    const file = join(rootDir, "public", saved!.storageKey!);
    await stat(file);
    const probe = await ffprobe(file);
    expect(probe.width).toBe(1280);
    expect(probe.height).toBe(720);
    expect(probe.duration).toBeGreaterThan(3.8);
    expect(probe.duration).toBeLessThan(4.3);
    expect(probe.hasAudio).toBe(true);
    expect(probe.codec).toBe("h264");

    // What the frames show: red scene with white text, blue scene, then the moving test pattern of the clip.
    const red = await frameStats(file, 0.5);
    expect(red.r).toBeGreaterThan(170);
    expect(red.g).toBeLessThan(70);
    expect(red.b).toBeLessThan(70);
    expect(red.maxLuma).toBeGreaterThan(200); // the "Hello" text
    const blue = await frameStats(file, 1.5);
    expect(blue.b).toBeGreaterThan(170);
    expect(blue.r).toBeLessThan(70);
    const clipA = await frameStats(file, 2.5);
    const clipB = await frameStats(file, 3.6);
    expect(diff(clipA.pixels, red.pixels)).toBeGreaterThan(40); // not the red scene any more
    expect(diff(clipA.pixels, clipB.pixels)).toBeGreaterThan(3); // the video actually advances between frames

    // The agency feed knows about it.
    const feed = await conn.db.select().from(projectActivity).where(eq(projectActivity.projectId, projectId));
    expect(feed.map((a) => [a.type, a.detail])).toEqual([["exported", "v1 720p"]]);
  }, 180_000);

  it("fails readably when the project has nothing to render", async () => {
    const parsed = parseProject({ schemaVersion: "1.0", projectId, version: 1, scenes: [] });
    if (!parsed.ok) throw new Error(parsed.message);
    const [row] = await conn.db
      .insert(videoExports)
      .values({ workspaceId, projectId, requestedByName: "Exporter", version: 1, checksum: "c", configJson: parsed.project, optionsJson: { quality: "720p", width: 1280, height: 720, fps: 30, device: "desktop" } })
      .returning();
    await expect(renderExport({ db: conn.db, storage, publicUrl: "http://localhost:4000" }, row!.id)).rejects.toThrow(/no scenes/);
    const saved = await conn.db.query.videoExports.findFirst({ where: eq(videoExports.id, row!.id) });
    expect(saved?.status).toBe("failed");
    expect(saved?.error).toMatch(/no scenes/);
  }, 30_000);
});
