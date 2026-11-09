// End-to-end smoke test against a RUNNING api + worker (local or VPS).
// Usage: pnpm smoke            (defaults to http://localhost:4800)
//        API_URL=https://api.example.com pnpm smoke
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const API = (process.env.API_URL ?? "http://localhost:4800").replace(/\/$/, "");
const ffmpeg = createRequire(resolve("apps/worker/package.json"))("@ffmpeg-installer/ffmpeg").path;
const exec = promisify(execFile);

let cookie = "";
const step = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

async function api(method, path, body, extra = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined && !(body instanceof Buffer) ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...extra.headers },
    body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok && !extra.allowError) fail(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return { status: res.status, json, headers: res.headers };
}

const health = await api("GET", "/health");
step(`API reachable at ${API} (${JSON.stringify(health.json)})`);

const reg = await api("POST", "/api/v1/auth/register", { email: `smoke-${Date.now()}@sceneflow.test`, password: "smoke-pass-123", name: "Smoke" });
const workspaceId = reg.json.workspaceId;
step(`registered user, workspace ${workspaceId}`);

const project = (await api("POST", "/api/v1/projects", { workspaceId, name: "Smoke project" })).json.project;
step(`created project ${project.id}`);

const tmp = await mkdtemp(join(tmpdir(), "sf-smoke-"));
const clip = join(tmp, "clip.mp4");
await exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
const bytes = await readFile(clip);
step(`generated test clip (${(bytes.length / 1024).toFixed(0)} KB)`);

const { assetId, upload } = (await api("POST", "/api/v1/media/uploads", { workspaceId, filename: "clip.mp4", mimeType: "video/mp4", sizeBytes: bytes.length })).json;
const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes });
if (!put.ok) fail(`upload PUT -> ${put.status} ${await put.text()}`);
step(`uploaded asset ${assetId} via signed URL`);

let asset;
for (let i = 0; i < 90; i++) {
  asset = (await api("GET", `/api/v1/media/${assetId}`)).json.asset;
  if (asset.status === "ready" || asset.status === "failed") break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (asset?.status !== "ready") fail(`asset status is ${asset?.status} (${asset?.error ?? "worker not running?"})`);
const meta = asset.metadataJson;
step(`worker processed it: ${meta.width}x${meta.height}, ${meta.duration.toFixed(1)}s, ${meta.thumbnails.length} thumbnails${meta.waveformUrl ? ", waveform" : ""}`);
if (!meta.waveformUrl) fail("no waveform.json produced (is an old worker still running?)");
for (const url of [meta.posterUrl, meta.proxyUrl]) {
  const r = await fetch(url, { method: "HEAD" });
  if (!r.ok) fail(`derived file not served: ${url} -> ${r.status}`);
}
step("poster + proxy are served from /files");

const config = {
  video: { provider: "local", assetId, src: meta.proxyUrl, poster: meta.posterUrl, duration: meta.duration },
  playback: { mode: "click", controls: true, muted: false },
  scenes: [
    {
      id: "intro",
      name: "Intro",
      start: 0,
      end: meta.duration,
      background: { type: "video", assetId, sourceStart: 0 },
      layers: [{ id: "cta", type: "commerce-button", frame: { x: 10, y: 80, w: 30, h: 10 }, content: { label: "Get Mine" }, action: { type: "ADD_TO_CART", productId: "182" } }],
    },
  ],
};
const saved = await api("POST", `/api/v1/projects/${project.id}/versions`, { config });
step(`saved version ${saved.json.version} (checksum ${saved.json.checksum.slice(0, 8)}…)`);

const published = await api("POST", `/api/v1/projects/${project.id}/publish`, {});
step(`published version ${published.json.publishedVersion}`);

const pub = await fetch(`${API}/p/${project.id}.json`);
const pubJson = await pub.json();
if (!pub.ok || pubJson.scenes?.length !== 1 || pub.headers.get("access-control-allow-origin") !== "*") fail("public config endpoint is wrong");
step("public config served with CORS *");

const demo = await fetch(`${API}/demo/${project.id}`);
const runtime = await fetch(`${API}/runtime/sceneflow.runtime.min.js`);
if (!demo.ok || !runtime.ok) fail("demo page or runtime bundle not served");
step(`runtime bundle ${(Number(runtime.headers.get("content-length") ?? 0) / 1024).toFixed(1)} KB served`);

await rm(tmp, { recursive: true, force: true });
console.log(`\nAll good. Open the demo: ${API}/demo/${project.id}`);
