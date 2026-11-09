import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "../src/config.js";

let app: FastifyInstance;
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "sf-presets-"));
  app = await buildApp(testConfig(storageDir), { queue: { send: vi.fn(async () => "job") } });
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

const button = { id: "b1", type: "button", frame: { x: 10, y: 80, w: 30, h: 10 }, content: { label: "Shop" }, style: { background: "#000", color: "#fff", borderRadius: 4 }, action: { type: "OPEN_CART" } };

describe("preset library (AC-008)", () => {
  it("saves, lists, versions, rescopes and deletes presets; validates content", async () => {
    const { cookies, workspaceId } = await register();

    const created = await app.inject({ method: "POST", url: "/api/v1/presets", cookies, payload: { workspaceId, name: "Dark CTA", description: "Our standard button", inputs: ["cta"], config: { type: "element", layers: [button] } } });
    expect(created.statusCode, created.body).toBe(201);
    const preset = created.json().preset;
    expect(preset).toMatchObject({ type: "element", scope: "workspace", name: "Dark CTA", inputs: ["cta"], version: 1, mine: true });
    expect(preset.config.layers[0].id).toBe("b1");

    // Invalid content and the wrong shape are rejected before anything is stored.
    expect((await app.inject({ method: "POST", url: "/api/v1/presets", cookies, payload: { workspaceId, name: "Bad", config: { type: "element", layers: [] } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/presets", cookies, payload: { workspaceId, name: "Evil", config: { type: "element", layers: [{ ...button, action: { type: "OPEN_URL", url: "javascript:alert(1)", newTab: true } }] } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/presets", cookies, payload: { workspaceId, name: "Huge", config: { type: "element", layers: [{ ...button, content: { label: "x".repeat(5000) } }, ...Array.from({ length: 19 }, (_, i) => ({ ...button, id: `b${i + 2}`, content: { label: "y".repeat(5000) } }))] } } })).statusCode).toBe(201); // 20 × 5 KB fits
    // ~300 KB: over the 256 KB preset limit, under the 1 MB request body limit.
    const tooBig = { type: "template", project: { schemaVersion: "1.0", projectId: "t", version: 1, scenes: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, name: "S", start: i, end: i + 1, background: { type: "color", color: "#000" }, layers: Array.from({ length: 20 }, (_, j) => ({ ...button, id: `l${i}-${j}`, content: { label: "z".repeat(200) } })) })) } };
    expect((await app.inject({ method: "POST", url: "/api/v1/presets", cookies, payload: { workspaceId, name: "Too big", config: tooBig } })).json().error).toBe("PRESET_TOO_LARGE");

    // Scene + template presets, filtered listing.
    const scene = await app.inject({ method: "POST", url: "/api/v1/presets", cookies, payload: { workspaceId, name: "Intro", scope: "personal", config: { type: "scene", scene: { id: "s1", name: "Intro", start: 0, end: 4, background: { type: "color", color: "#000" }, layers: [button] } } } });
    expect(scene.statusCode).toBe(201);
    const all = await app.inject({ method: "GET", url: `/api/v1/presets?workspaceId=${workspaceId}`, cookies });
    expect(all.json().presets.map((p: { type: string }) => p.type).sort()).toEqual(["element", "element", "scene"]);
    const onlyScenes = await app.inject({ method: "GET", url: `/api/v1/presets?workspaceId=${workspaceId}&type=scene`, cookies });
    expect(onlyScenes.json().presets).toHaveLength(1);

    // Replacing the content is a new version; renaming is not.
    const renamed = await app.inject({ method: "PATCH", url: `/api/v1/presets/${preset.id}`, cookies, payload: { name: "Dark CTA (pill)" } });
    expect(renamed.json().preset).toMatchObject({ name: "Dark CTA (pill)", version: 1 });
    const updated = await app.inject({ method: "PATCH", url: `/api/v1/presets/${preset.id}`, cookies, payload: { config: { type: "element", layers: [{ ...button, style: { ...button.style, borderRadius: 999 } }] } } });
    expect(updated.json().preset.version).toBe(2);
    expect(updated.json().preset.config.layers[0].style.borderRadius).toBe(999);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/presets/${preset.id}`, cookies, payload: { config: { type: "animation", animation: {} } } })).json().error).toBe("PRESET_TYPE_MISMATCH");

    // Another workspace cannot see or touch them.
    const other = await register("Other");
    expect((await app.inject({ method: "GET", url: `/api/v1/presets?workspaceId=${workspaceId}`, cookies: other.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/presets/${preset.id}`, cookies: other.cookies })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/presets/${preset.id}`, cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/presets?workspaceId=${workspaceId}&type=element`, cookies })).json().presets).toHaveLength(1);
  });
});

describe("brand kits", () => {
  it("creates the first kit as default, versions config changes and moves the default on delete", async () => {
    const { cookies, workspaceId } = await register();
    const a = await app.inject({ method: "POST", url: "/api/v1/brand-kits", cookies, payload: { workspaceId, name: "Acme", config: { colors: { primary: "#facc15" }, fonts: { heading: '"Poppins", system-ui, sans-serif', loadGoogleFonts: true } } } });
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json().kit).toMatchObject({ name: "Acme", isDefault: true, version: 1 });
    expect(a.json().kit.config.colors.secondary).toBe("#ef4444"); // defaults filled in
    expect(a.json().kit.config.fonts.loadGoogleFonts).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/v1/brand-kits", cookies, payload: { workspaceId, config: { logo: { src: "javascript:x" } } } })).statusCode).toBe(400);

    const b = await app.inject({ method: "POST", url: "/api/v1/brand-kits", cookies, payload: { workspaceId, name: "Client B", config: {} } });
    expect(b.json().kit.isDefault).toBe(false);

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/brand-kits/${a.json().kit.id}`, cookies, payload: { config: { colors: { primary: "#0ea5e9" } } } });
    expect(patched.json().kit).toMatchObject({ version: 2 });
    expect(patched.json().kit.config.colors.primary).toBe("#0ea5e9");

    const madeDefault = await app.inject({ method: "PATCH", url: `/api/v1/brand-kits/${b.json().kit.id}`, cookies, payload: { isDefault: true } });
    expect(madeDefault.json().kit.isDefault).toBe(true);
    let list = (await app.inject({ method: "GET", url: `/api/v1/brand-kits?workspaceId=${workspaceId}`, cookies })).json().kits;
    expect(list.map((k: { name: string; isDefault: boolean }) => [k.name, k.isDefault])).toEqual([
      ["Client B", true],
      ["Acme", false],
    ]);

    await app.inject({ method: "DELETE", url: `/api/v1/brand-kits/${b.json().kit.id}`, cookies });
    list = (await app.inject({ method: "GET", url: `/api/v1/brand-kits?workspaceId=${workspaceId}`, cookies })).json().kits;
    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true);

    const other = await register("Other");
    expect((await app.inject({ method: "GET", url: `/api/v1/brand-kits?workspaceId=${workspaceId}`, cookies: other.cookies })).statusCode).toBe(403);
  });
});
