// WordPress.org readiness checks for the plugin, in one command:
//   pnpm check:wp            phpcs (WordPress standard: security, i18n, formatting) + JS formatting (wp-prettier)
//                            + the .pot file is current + plain-PHP tests
//   pnpm format:wp           rewrites the plugin's JS / JSON in the WordPress style
// phpcs comes from $PHPCS, the PATH, or Composer's global bin folder; WP-CLI (for the .pot check) from $WP_CLI_PHAR.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "connectors/wordpress/sceneflow");
const JS = ["assets/sceneflow-init.js", "assets/sceneflow-picker.js", "assets/sceneflow-woo.js", "blocks/player/block.js", "blocks/player/block.json"];
// Relative to the plugin folder (the cwd): Windows shells split absolute paths that contain spaces.
const PRETTIER = ["--config", "../../../scripts/wp-prettier.config.cjs"];
const win = process.platform === "win32";
let failed = 0;
const run = (label, cmd, args, opts = {}) => {
  // A shell only for npx / .bat wrappers on Windows; real executables get their arguments untouched.
  const shell = win && (cmd === "npx" || cmd === "phpcs" || /\.(bat|cmd)$/i.test(cmd));
  const r = spawnSync(shell && cmd.includes(" ") ? `"${cmd}"` : cmd, args, { cwd: opts.cwd ?? PLUGIN, stdio: opts.quiet ? "pipe" : "inherit", shell, encoding: "utf8" });
  const ok = r.status === 0;
  console.log(`${ok ? "\u2713" : "\u2717"} ${label}`);
  if (!ok) {
    failed++;
    if (opts.quiet) console.log((r.stdout || "") + (r.stderr || ""));
  }
  return r;
};

if (process.argv.includes("--fix")) {
  run("JS / JSON formatted (wp-prettier)", "npx", ["prettier", ...PRETTIER, "--write", ...JS]);
  process.exit(failed ? 1 : 0);
}

// 1. PHP: WordPress Coding Standards (escaping, nonces, sanitizing, prefixes, i18n, formatting).
const phpcsCandidates = [process.env.PHPCS, "phpcs", join(process.env.APPDATA ?? join(homedir(), ".config"), "Composer/vendor/bin/phpcs" + (win ? ".bat" : ""))].filter(Boolean);
const phpcs = phpcsCandidates.find((c) => c === "phpcs" ? spawnSync(c, ["--version"], { shell: win }).status === 0 : existsSync(c));
if (!phpcs) {
  console.log("\u2717 phpcs not found (set PHPCS=/path/to/phpcs)");
  failed++;
} else {
  run("phpcs --standard=WordPress", phpcs, ["--standard=WordPress", "--extensions=php", "--ignore=*/tests/*", "--report=summary", "-q", "."]);
}

// 2. JS / JSON: WordPress JavaScript style.
run("JS / JSON formatting (wp-prettier, @wordpress/prettier-config)", "npx", ["prettier", ...PRETTIER, "--check", ...JS], { quiet: true });

// 3. Translations: the shipped .pot matches the source strings (regenerate with WP-CLI and compare msgids).
const phar = process.env.WP_CLI_PHAR ?? "D:/programs/local/resources/extraResources/bin/wp-cli/wp-cli.phar";
const php = process.env.PHP_BIN ?? "D:/programs/local/resources/extraResources/lightning-services/php-8.2.27+1/bin/win64/php.exe";
if (existsSync(phar) && existsSync(php)) {
  const dir = mkdtempSync(join(tmpdir(), "sf-pot-"));
  const out = join(dir, "sceneflow.pot");
  const ext = join(php, "..", "ext");
  try {
    execFileSync(php, ["-d", `extension_dir=${ext}`, "-d", "extension=mbstring", "-d", "extension=curl", "-d", "extension=openssl", "-d", "memory_limit=512M", phar, "i18n", "make-pot", PLUGIN, out, "--slug=sceneflow", "--domain=sceneflow", "--exclude=tests,assets/sceneflow.runtime.js,assets/sceneflow.runtime.min.js"], { stdio: "pipe" });
    const ids = (f) => [...readFileSync(f, "utf8").matchAll(/^msgid "(.*)"$/gm)].map((m) => m[1]).sort().join("\n");
    const same = ids(out) === ids(join(PLUGIN, "languages/sceneflow.pot"));
    console.log(`${same ? "\u2713" : "\u2717"} languages/sceneflow.pot is current${same ? "" : " (run: wp i18n make-pot connectors/wordpress/sceneflow connectors/wordpress/sceneflow/languages/sceneflow.pot --exclude=tests,assets/sceneflow.runtime.js,assets/sceneflow.runtime.min.js)"}`);
    if (!same) failed++;
  } catch (e) {
    console.log(`\u2717 make-pot failed: ${String(e.stderr ?? e.message).trim().split("\n").pop()}`);
    failed++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log("- .pot check skipped (set WP_CLI_PHAR and PHP_BIN)");
}

// 4. Plain-PHP unit tests (signature + config validation).
run("PHP tests", php && existsSync(php) ? php : "php", ["tests/run.php"], { quiet: true });

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll WordPress checks passed. Also run `wp plugin check sceneflow` on a test site.");
process.exit(failed ? 1 : 0);
