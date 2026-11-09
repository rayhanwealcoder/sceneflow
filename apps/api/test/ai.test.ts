import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServices, QUEUES, StarterTextProvider, type SpeechProvider } from "@sceneflow/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";

let app: FastifyInstance;
let storageDir: string;
const send = vi.fn(async () => "job");

/** 0.5 s of silence as a PCM WAV, like the system voice would return. */
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const data = Math.round(rate * 2 * seconds);
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(data, 40);
  return b;
}
const fakeSpeech: SpeechProvider = {
  id: "fake-voice",
  label: "Fake voice",
  voices: async () => [{ id: "v1", name: "Test voice", language: "en-US" }],
  synthesize: vi.fn(async (text: string) => ({ audio: silentWav(Math.max(0.5, text.length / 40)), mimeType: "audio/wav", ext: "wav", durationSeconds: Math.max(0.5, text.length / 40) })),
};

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-ai-"));
  app = await buildApp(testConfig(storageDir), { queue: { send }, ai: buildServices({ text: new StarterTextProvider(), speech: fakeSpeech, transcription: null }) });
});
afterAll(async () => {
  await app.close();
  await rm(storageDir, { recursive: true, force: true });
});

async function register(name = "Tester") {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email: `u-${crypto.randomUUID()}@test.dev`, password: "password123", name } });
  const cookie = res.cookies.find((c) => c.name === "sf_session")!;
  return { cookies: { sf_session: cookie.value }, workspaceId: res.json().workspaceId as string };
}

describe("AI routes (doc §10.2)", () => {
  it("reports what is configured, writes a script and copy for a project, and rejects junk", async () => {
    const { cookies, workspaceId } = await register();
    expect((await app.inject({ method: "GET", url: "/api/v1/ai/status" })).statusCode).toBe(401);
    const status = await app.inject({ method: "GET", url: "/api/v1/ai/status", cookies });
    expect(status.json()).toMatchObject({ text: { provider: "starter", real: false }, speech: { provider: "fake-voice", voices: [{ id: "v1" }] }, transcription: null });
    expect(status.json().hints.length).toBeGreaterThan(0);

    const { project } = (await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "AI test" } })).json();
    const config = { playback: { mode: "click" }, scenes: [{ id: "a", name: "A", start: 0, end: 5, background: { type: "color", color: "#000" }, layers: [{ id: "p", type: "product", frame: { x: 60, y: 10, w: 30, h: 80 }, product: { provider: "manual", productId: "1", title: "Aero Kettle", price: "$89", url: "https://shop.test/k" } }] }] };
    expect((await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies, payload: { config } })).statusCode).toBe(200);

    const script = await app.inject({ method: "POST", url: "/api/v1/ai/script", cookies, payload: { projectId: project.id, brief: "Launch the kettle for tea lovers", durationSeconds: 20, tone: "premium" } });
    expect(script.statusCode, script.body).toBe(200);
    expect(script.json().provider).toBe("starter");
    expect(script.json().script.scenes.reduce((n: number, s: { duration: number }) => n + s.duration, 0)).toBe(20);
    expect(script.json().script.scenes[0].headline).toContain("Aero Kettle"); // product from the draft used as context
    expect((await app.inject({ method: "POST", url: "/api/v1/ai/script", cookies, payload: { projectId: project.id, brief: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/ai/script", cookies, payload: { projectId: crypto.randomUUID(), brief: "A fine brief" } })).statusCode).toBe(404);

    const copy = await app.inject({ method: "POST", url: "/api/v1/ai/copy", cookies, payload: { projectId: project.id, kind: "button", text: "Shop now", count: 3 } });
    expect(copy.statusCode, copy.body).toBe(200);
    expect(copy.json().variants).toHaveLength(3);

    // Someone from another workspace cannot use the project as context.
    const other = await register("Other");
    expect((await app.inject({ method: "POST", url: "/api/v1/ai/copy", cookies: other.cookies, payload: { projectId: project.id, kind: "headline", text: "Hi" } })).statusCode).toBe(403);
  });

  it("turns a voiceover into a queued audio asset stored like an upload; captions from audio need a provider", async () => {
    const { cookies, workspaceId } = await register();
    const { project } = (await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "VO" } })).json();
    await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies, payload: { config: { scenes: [{ id: "s1", name: "Intro", start: 0, end: 4, background: { type: "color", color: "#000" } }] } } });
    send.mockClear();

    const vo = await app.inject({ method: "POST", url: "/api/v1/ai/voiceover", cookies, payload: { projectId: project.id, sceneId: "s1", text: "Meet the kettle that pours like a dream.", voiceId: "v1" } });
    expect(vo.statusCode, vo.body).toBe(201);
    const body = vo.json();
    expect(body).toMatchObject({ provider: "fake-voice", voiceId: "v1" });
    expect(body.asset).toMatchObject({ type: "audio", mimeType: "audio/wav", status: "uploaded", originalName: "Voiceover – Intro.wav" });
    expect(body.asset.providerAssetId).toBeUndefined(); // storage key never leaves the API
    expect(body.durationSeconds).toBeGreaterThan(0.5);
    expect(fakeSpeech.synthesize).toHaveBeenCalledWith("Meet the kettle that pours like a dream.", "v1");
    expect(send).toHaveBeenCalledWith(QUEUES.mediaProcess, { assetId: body.asset.id }, expect.anything());
    // The original landed in storage under <workspace>/<asset>/original.wav and is visible in the media list.
    const files = await readdir(join(storageDir, "originals", workspaceId, body.asset.id));
    expect(files).toEqual(["original.wav"]);
    const list = await app.inject({ method: "GET", url: `/api/v1/media?workspaceId=${workspaceId}`, cookies });
    expect(list.json().assets.map((a: { id: string }) => a.id)).toContain(body.asset.id);

    expect((await app.inject({ method: "POST", url: "/api/v1/ai/voiceover", cookies, payload: { projectId: project.id, text: "" } })).statusCode).toBe(400);
    // Voice ids are identifiers, never free text (they can reach a provider command line).
    for (const voiceId of ["x'; Start-Process calc; '", "x’; Start-Process calc", "a\nb", "é", "x".repeat(121)]) {
      expect((await app.inject({ method: "POST", url: "/api/v1/ai/voiceover", cookies, payload: { projectId: project.id, text: "Hello", voiceId } })).statusCode, voiceId).toBe(400);
    }
    const cap = await app.inject({ method: "POST", url: "/api/v1/ai/captions", cookies, payload: { projectId: project.id, assetId: body.asset.id } });
    expect(cap.statusCode).toBe(501);
    expect(cap.json().error).toBe("AI_NOT_CONFIGURED");
  });

  it("publishing strips storyboard notes but keeps captions", async () => {
    const { cookies, workspaceId } = await register();
    const { project } = (await app.inject({ method: "POST", url: "/api/v1/projects", cookies, payload: { workspaceId, name: "Pub" } })).json();
    const config = { captions: { cues: [{ start: 0, end: 2, text: "Hello" }] }, scenes: [{ id: "s1", name: "Intro", start: 0, end: 4, background: { type: "color", color: "#000" }, script: { voiceover: "Hello there", shot: "Push-in" } }] };
    await app.inject({ method: "PUT", url: `/api/v1/projects/${project.id}/draft`, cookies, payload: { config } });
    expect((await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/publish`, cookies, payload: {} })).statusCode).toBe(200);
    const live = (await app.inject({ method: "GET", url: `/p/${project.id}.json` })).json();
    expect(live.scenes[0].script).toBeUndefined();
    expect(live.captions.cues).toHaveLength(1);
    expect(live.playback.captions).toBe(true);
  });
});
