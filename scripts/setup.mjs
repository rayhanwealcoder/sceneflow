// One-time local setup: creates .env files from the examples with a fresh secret.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("hex");
for (const dir of ["apps/api", "apps/worker", "apps/web"]) {
  const target = `${dir}/.env`;
  if (existsSync(target)) {
    console.log(`${target} already exists, leaving it alone`);
    continue;
  }
  copyFileSync(`${dir}/.env.example`, target);
  writeFileSync(target, readFileSync(target, "utf8").replace(/SESSION_SECRET=.*/, `SESSION_SECRET=${secret}`));
  console.log(`created ${target}`);
}
console.log("\nNext: pnpm build && pnpm dev   (API on http://localhost:4800)");
