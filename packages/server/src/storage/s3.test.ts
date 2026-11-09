import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStorage, storageConfigFromEnv, storageEnvSchema } from "./index.js";
import { S3StorageProvider } from "./s3.js";

/**
 * A tiny S3-compatible server (PUT/HEAD/GET/DELETE on /bucket/key) so the provider's wiring is
 * exercised for real — presigned URL shape, signed headers, HEAD size check, download, publish.
 * Signatures are not validated here; that is the real service's job (R2 / S3 / MinIO).
 */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const app = Fastify({ logger: false });
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  const keyOf = (url: string) => decodeURIComponent(new URL(url, "http://x").pathname.replace(/^\/sf-test\//, ""));
  app.put("/sf-test/*", async (req, reply) => {
    const key = keyOf(req.url);
    const q = new URL(req.url, "http://x").searchParams;
    if (q.has("X-Amz-Signature") && !q.get("X-Amz-SignedHeaders")?.includes("content-length")) return reply.code(403).send("content-length must be signed");
    objects.set(key, { body: (req.body as Buffer | undefined) ?? Buffer.alloc(0), type: String(req.headers["content-type"] ?? "") });
    return reply.header("ETag", '"x"').send();
  });
  app.head("/sf-test/*", async (req, reply) => {
    const o = objects.get(keyOf(req.url));
    if (!o) return reply.code(404).send();
    return reply.header("content-length", String(o.body.length)).header("content-type", o.type).header("ETag", '"x"').send();
  });
  app.get("/sf-test/*", async (req, reply) => {
    const o = objects.get(keyOf(req.url));
    if (!o) return reply.code(404).send();
    return reply.header("content-type", o.type).send(o.body);
  });
  app.delete("/sf-test/*", async (req, reply) => {
    objects.delete(keyOf(req.url));
    return reply.code(204).send();
  });
  return { app, objects };
}

let fake: ReturnType<typeof fakeS3>;
let endpoint: string;
let dir: string;

beforeAll(async () => {
  fake = fakeS3();
  await fake.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = fake.app.server.address();
  endpoint = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  dir = await mkdtemp(join(tmpdir(), "sf-s3-"));
});
afterAll(async () => {
  await (fake.app as FastifyInstance).close();
  await rm(dir, { recursive: true, force: true });
});

describe("S3 storage provider", () => {
  it("presigns uploads, confirms them, downloads originals and publishes derived files", async () => {
    const storage = new S3StorageProvider({ bucket: "sf-test", endpoint, region: "auto", forcePathStyle: true, accessKeyId: "test", secretAccessKey: "secret", publicBaseUrl: "https://media.test/public", cacheDir: dir });
    const key = "ws1/asset1/original.mp4";
    const bytes = Buffer.from("fake mp4 bytes");

    const target = await storage.createUploadUrl({ key, mimeType: "video/mp4", sizeBytes: bytes.length });
    expect(target.method).toBe("PUT");
    expect(target.url).toContain(`${endpoint}/sf-test/originals/ws1/asset1/original.mp4`);
    expect(target.url).toContain("X-Amz-Signature=");
    expect(target.url).toContain("X-Amz-Expires=3600");
    expect(decodeURIComponent(target.url)).toContain("content-length");

    expect(await storage.statOriginal(key)).toBeNull();
    const put = await fetch(target.url, { method: "PUT", headers: { ...target.headers, "content-length": String(bytes.length) }, body: bytes });
    expect(put.status).toBe(200);
    expect(await storage.statOriginal(key)).toBe(bytes.length);

    const local = await storage.readOriginal(key);
    expect((await readFile(local)).equals(bytes)).toBe(true);

    const poster = join(dir, "poster.jpg");
    await writeFile(poster, "jpeg!");
    const url = await storage.putPublic("ws1/asset1/poster.jpg", poster, "image/jpeg");
    expect(url).toBe("https://media.test/public/ws1/asset1/poster.jpg");
    expect(fake.objects.get("public/ws1/asset1/poster.jpg")?.type).toBe("image/jpeg");

    await storage.deleteObject(key);
    expect(fake.objects.has("originals/" + key)).toBe(false);
    expect(() => storage.publicUrl("../etc/passwd")).toThrow(/Unsafe/);
  });

  it("selects the provider from the environment", async () => {
    const resolveDir = (d: string) => join(dir, d);
    const local = storageConfigFromEnv(storageEnvSchema.parse({}), { publicUrl: "http://localhost:4800", secret: "s", resolveDir });
    expect(local.provider).toBe("local");
    expect((await createStorage(local)).id).toBe("local");

    expect(() => storageConfigFromEnv(storageEnvSchema.parse({ STORAGE_PROVIDER: "s3" }), { publicUrl: "http://localhost:4800", secret: "s", resolveDir })).toThrow(/S3_BUCKET/);
    const s3 = storageConfigFromEnv(storageEnvSchema.parse({ STORAGE_PROVIDER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "k", S3_PUBLIC_URL: "https://media.test/public", S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com" }), { publicUrl: "http://localhost:4800", secret: "s", resolveDir });
    expect(s3.provider).toBe("s3");
    expect((await createStorage(s3)).id).toBe("s3");
  });
});
