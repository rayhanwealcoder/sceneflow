/*
 * Server-side super admin management. Whoever can run this has the database, so this is where the first
 * super admin comes from (the web console can grant more afterwards). Every change is audited as "cli".
 *   pnpm admin list
 *   pnpm admin grant you@example.com
 *   pnpm admin revoke someone@example.com
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { adminAudit, createDb, runMigrations, users } from "@sceneflow/server";

const [cmd, rawEmail] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (run through `pnpm admin`, which loads apps/api/.env).");
  process.exit(1);
}
const { db, close } = createDb(url);
const out = (line: string) => console.log(line);
const usage = () => out("Usage: pnpm admin list | grant <email> | revoke <email>");

async function main(): Promise<number> {
  await runMigrations(db);
  if (cmd === "list") {
    const list = await db.select({ email: users.email, name: users.name, status: users.status, lastSignInAt: users.lastSignInAt }).from(users).where(eq(users.platformRole, "super_admin")).orderBy(users.createdAt);
    if (list.length === 0) out("No super admins yet. Create one with: pnpm admin grant <email of an existing account>");
    for (const u of list) out(`${u.email}  ${u.name}  ${u.status}${u.lastSignInAt ? `  last sign-in ${u.lastSignInAt.toISOString()}` : ""}`);
    return 0;
  }
  if ((cmd !== "grant" && cmd !== "revoke") || !rawEmail) {
    usage();
    return 1;
  }
  const email = rawEmail.trim().toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    out(`No account with the e-mail ${email}. Sign up in the app first, then run this again.`);
    return 1;
  }
  const to = cmd === "grant" ? "super_admin" : "user";
  if (user.platformRole === to) {
    out(`${email} is already ${to === "super_admin" ? "a super admin" : "not a super admin"}.`);
    return 0;
  }
  if (to === "super_admin" && user.status !== "active") {
    out(`${email} is disabled. Enable it first (another super admin can, or: update users set status='active').`);
    return 1;
  }
  if (to === "user") {
    const [other] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.platformRole, "super_admin"), eq(users.status, "active"), ne(users.id, user.id)));
    if (!other?.n) out("Note: this was the last super admin; /admin is closed until you grant someone again.");
  }
  await db.update(users).set({ platformRole: to }).where(eq(users.id, user.id));
  await db.insert(adminAudit).values({ actorEmail: "cli", action: to === "super_admin" ? "user.grant_super_admin" : "user.revoke_super_admin", targetType: "user", targetId: user.id, targetLabel: email, detailJson: { from: user.platformRole, to, via: "cli" } });
  out(to === "super_admin" ? `${email} is now a super admin. Sign in and open /admin.` : `${email} is no longer a super admin.`);
  return 0;
}

main()
  .then(async (code) => {
    await close();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await close();
    process.exit(1);
  });
