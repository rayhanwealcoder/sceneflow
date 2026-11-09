// Builds the browser runtime (IIFE, window.SceneFlow), its optional modules, and enforces the size budget from doc 11.4.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const out = "dist/sceneflow.runtime.min.js";
const BUDGET_GZIP = 80 * 1024;

const common = { bundle: true, format: "iife", target: ["es2019"], legalComments: "none" };
// Core runtime: everything a published page needs, zero platform code.
await build({ ...common, entryPoints: ["src/index.ts"], globalName: "SceneFlow", minify: true, sourcemap: true, outfile: out });
// Readable copy: shipped next to the minified file in the WordPress plugin (WordPress.org asks for human-readable sources).
await build({ ...common, entryPoints: ["src/index.ts"], globalName: "SceneFlow", minify: false, sourcemap: false, outfile: "dist/sceneflow.runtime.js" });
// Optional modules (runtime split): loaded only on the platforms that need them.
await build({ ...common, entryPoints: ["src/shopify.module.ts"], minify: true, sourcemap: true, outfile: "dist/sceneflow.shopify.min.js" });

const report = (file) => {
  const raw = readFileSync(file);
  const gz = gzipSync(raw).length;
  console.log(`${file.replace("dist/", "")}: ${(raw.length / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`);
  return gz;
};
const coreGz = report(out);
report("dist/sceneflow.shopify.min.js");
console.log(`budget: ${BUDGET_GZIP / 1024} KB gzip for the core runtime`);
if (coreGz > BUDGET_GZIP) {
  console.error("Runtime bundle exceeds the gzip size budget");
  process.exit(1);
}
