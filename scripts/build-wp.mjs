// Packages the WordPress plugin: copies the runtime bundle in and zips wordpress/sceneflow -> wordpress/dist/sceneflow.zip
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, "packages/core/dist/sceneflow.runtime.min.js");
const plugin = resolve(root, "wordpress/sceneflow");
const dist = resolve(root, "wordpress/dist");
const zip = resolve(dist, "sceneflow.zip");

if (!existsSync(runtime)) {
  console.error("Runtime bundle missing. Run `pnpm build` first.");
  process.exit(1);
}
copyFileSync(runtime, resolve(plugin, "assets/sceneflow.runtime.min.js"));
// Human-readable build next to the minified one (WordPress.org guideline 4).
copyFileSync(resolve(root, "packages/core/dist/sceneflow.runtime.js"), resolve(plugin, "assets/sceneflow.runtime.js"));
mkdirSync(dist, { recursive: true });
rmSync(zip, { force: true });

if (process.platform === "win32") {
  // Exclude tests/ from the distributable.
  const staging = resolve(dist, "staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  // robocopy exit codes 0-7 mean success (1 = files copied).
  try {
    execFileSync("robocopy", [plugin, resolve(staging, "sceneflow"), "/E", "/XD", "tests", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"], { stdio: "ignore" });
  } catch (err) {
    if (typeof err.status !== "number" || err.status >= 8) throw err;
  }
  // bsdtar ships with Windows 10+; "-a" picks the zip format from the extension (Compress-Archive chokes on some files).
  execFileSync("tar", ["-a", "-c", "-f", zip, "-C", staging, "sceneflow"], { stdio: "inherit" });
  rmSync(staging, { recursive: true, force: true });
} else {
  execFileSync("zip", ["-rq", zip, "sceneflow", "-x", "sceneflow/tests/*"], { cwd: resolve(root, "wordpress"), stdio: "inherit" });
}
console.log(`WordPress plugin: ${zip} (${(statSync(zip).size / 1024).toFixed(0)} KB)`);
