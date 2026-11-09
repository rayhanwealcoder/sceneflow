// Releases the platform connectors as zip files: dist/connectors/<zip> + manifest.json.
//   pnpm build:connectors            every connector in connectors/*/connector.json
//   pnpm build:wp                    = --only wordpress
// Each connector.json says what to copy from the runtime build, what to exclude and where its version lives.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runtimeDir = resolve(root, "packages/core/dist");
const outDir = resolve(root, "dist/connectors");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

if (!existsSync(resolve(runtimeDir, "sceneflow.runtime.min.js"))) {
  console.error("Runtime bundle missing. Run `pnpm build` first.");
  process.exit(1);
}
const runtimeVersion = /VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(resolve(root, "packages/core/src/index.ts"), "utf8"))?.[1] ?? "0.0.0";

const connectorDirs = readdirSync(resolve(root, "connectors"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(root, "connectors", d.name, "connector.json")))
  .map((d) => resolve(root, "connectors", d.name))
  .filter((dir) => !only || basename(dir) === only);
if (!connectorDirs.length) {
  console.error(only ? `No connector named "${only}" (need connectors/${only}/connector.json)` : "No connectors found");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const staging = resolve(outDir, ".staging");
const manifest = { builtAt: new Date().toISOString(), runtimeVersion, connectors: {} };

for (const dir of connectorDirs) {
  const spec = JSON.parse(readFileSync(resolve(dir, "connector.json"), "utf8"));
  const version = spec.versionFrom ? (new RegExp(spec.versionFrom.pattern).exec(readFileSync(resolve(dir, spec.versionFrom.file), "utf8"))?.[1] ?? spec.version) : spec.version;

  // 1. Runtime files the connector ships (so the zip never depends on the API being reachable).
  for (const [target, files] of Object.entries(spec.runtime ?? {})) {
    mkdirSync(resolve(dir, target), { recursive: true });
    for (const f of files) copyFileSync(resolve(runtimeDir, f), resolve(dir, target, f));
  }

  // 2. Stage: the zip contains one top-level folder (`zipRoot`), with `exclude` paths left out.
  const src = resolve(dir, spec.root ?? ".");
  const stage = resolve(staging, spec.zipRoot);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const excluded = new Set([...(spec.exclude ?? []), "connector.json"].map((p) => resolve(src, p)));
  cpSync(src, stage, { recursive: true, filter: (p) => !excluded.has(resolve(p)) });

  // 3. Zip (bsdtar ships with Windows 10+ and macOS; `zip` elsewhere). Relative paths: bsdtar reads "D:" as a remote host.
  const zip = resolve(outDir, spec.zip);
  rmSync(zip, { force: true });
  // On Windows call System32\tar.exe (bsdtar) explicitly: inside Git Bash a plain `tar` is GNU tar, which ignores `-a` and writes a .tar.
  const bsdtar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  if (process.platform === "win32" || process.platform === "darwin") execFileSync(bsdtar, ["-a", "-c", "-f", spec.zip, "-C", ".staging", spec.zipRoot], { cwd: outDir, stdio: "inherit" });
  else execFileSync("zip", ["-rq", zip, spec.zipRoot], { cwd: staging, stdio: "inherit" });
  rmSync(staging, { recursive: true, force: true });

  const bytes = statSync(zip).size;
  manifest.connectors[basename(dir)] = { name: spec.name, version, file: basename(zip), bytes, sha256: createHash("sha256").update(readFileSync(zip)).digest("hex") };
  console.log(`${spec.name} ${version}: ${zip} (${(bytes / 1024).toFixed(0)} KB)`);
}

// Keep entries of connectors that were not rebuilt this run.
const manifestPath = resolve(outDir, "manifest.json");
if (only && existsSync(manifestPath)) {
  const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.connectors = { ...prev.connectors, ...manifest.connectors };
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${manifestPath} (runtime ${runtimeVersion})`);

// Make sure nothing is left in a half-moved state when a connector dir has no README (helps new connectors).
for (const dir of connectorDirs) if (!existsSync(join(dir, "README.md"))) console.warn(`warning: ${basename(dir)} has no README.md (get-started doc)`);
void dirname;
