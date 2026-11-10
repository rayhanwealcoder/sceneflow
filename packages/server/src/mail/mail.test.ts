import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMailer, createMailer, exportReadyMail, inviteMail, linksIn, mailConfigFromEnv, mailEnvSchema, OutboxMailProvider, passwordChangedMail, passwordResetMail, ResendProvider } from "./index.js";

const brand = { webOrigin: "https://app.example.com" };
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sf-mail-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("templates", () => {
  it("carry the link in text and HTML, escape what users typed, and stay self-contained", () => {
    const link = "https://app.example.com/reset/abc123";
    const m = passwordResetMail(brand, { name: "Mia <script>", link, minutes: 60 });
    expect(m.subject).toBe("Reset your SceneFlow password");
    expect(m.text).toContain(link);
    expect(m.text).toContain("60 minutes");
    expect(m.html).toContain(`href="${link}"`);
    expect(m.html).toContain("Mia &lt;script&gt;");
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toMatch(/<(img|link|script)\b/);
    expect(linksIn(m.text)).toEqual([link]);

    const inv = inviteMail(brand, { inviterName: "Olivia & Co", workspaceName: "Studio \"North\"", role: "editor", link: "https://app.example.com/join/t", days: 7 });
    expect(inv.subject).toBe('Olivia & Co invited you to Studio "North" on SceneFlow');
    expect(inv.html).toContain("Olivia &amp; Co");
    expect(inv.html).toContain("Studio &quot;North&quot;");
    expect(inviteMail(brand, { inviterName: null, workspaceName: "W", role: "viewer", link: "https://x/y", days: 7 }).subject).toMatch(/^Someone invited/);

    const ex = exportReadyMail(brand, { name: "", projectName: "Spring launch", fileName: "spring-launch-1080p.mp4", quality: "1080p", link: "https://app.example.com/projects/p1" });
    expect(ex.text.startsWith("Hi,")).toBe(true);
    expect(ex.text).toContain("spring-launch-1080p.mp4");
    expect(passwordChangedMail(brand, { name: "Mia", resetLink: "https://app.example.com/forgot" }).html).toContain("/forgot");
  });
});

describe("outbox provider (no mail server)", () => {
  it("writes one JSON file per message and prints the link to the log", async () => {
    const lines: string[] = [];
    const mailer = buildMailer(new OutboxMailProvider(join(dir, "outbox"), (l) => lines.push(l)), "SceneFlow <no-reply@localhost>", (l) => lines.push(l));
    expect(mailer.delivers).toBe(false);
    expect(mailer.status().hint).toMatch(/RESEND_API_KEY/);
    const r = await mailer.send({ to: "a@b.c", subject: "Hello", text: "Open https://app.example.com/reset/t1 now", html: "<p>x</p>" });
    expect(r.id).toBeTruthy();
    const files = await readdir(join(dir, "outbox"));
    expect(files).toHaveLength(1);
    const saved = JSON.parse(await readFile(join(dir, "outbox", files[0]!), "utf8"));
    expect(saved.to).toBe("a@b.c");
    expect(saved.from).toBe("SceneFlow <no-reply@localhost>");
    expect(lines.some((l) => l.includes("https://app.example.com/reset/t1"))).toBe(true);
  });

  it("sendLater never throws — a broken provider is logged", async () => {
    const lines: string[] = [];
    const mailer = buildMailer({ id: "smtp", label: "SMTP (broken)", send: async () => { throw new Error("ECONNREFUSED"); } }, "x <x@y.z>", (l) => lines.push(l));
    mailer.sendLater({ to: "a@b.c", subject: "S", text: "t", html: "h" });
    await new Promise((r) => setTimeout(r, 10));
    expect(lines[0]).toMatch(/could not send "S" to a@b.c via SMTP \(broken\): ECONNREFUSED/);
  });
});

describe("Resend provider", () => {
  it("posts the message with the bearer key and returns the id; surfaces API errors", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer re_test");
      const body = JSON.parse(String(init!.body));
      expect(body).toEqual({ from: "SceneFlow <no-reply@example.com>", to: ["a@b.c"], subject: "S", text: "t", html: "<p>h</p>" });
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = createMailer({ provider: "resend", from: "SceneFlow <no-reply@example.com>", resend: { apiKey: "re_test" }, outboxDir: dir }, { fetchFn });
    expect(mailer.delivers).toBe(true);
    expect(mailer.status()).toMatchObject({ provider: "resend", hint: null });
    expect(await mailer.send({ to: "a@b.c", subject: "S", text: "t", html: "<p>h</p>" })).toEqual({ id: "msg_1" });

    const failing = new ResendProvider("re_bad", (async () => new Response("invalid key", { status: 401 })) as unknown as typeof fetch);
    await expect(failing.send({ from: "f", to: "a@b.c", subject: "S", text: "t", html: "h" })).rejects.toThrow(/401/);
  });
});

describe("mailConfigFromEnv", () => {
  const parse = (env: Record<string, string>) => mailConfigFromEnv(mailEnvSchema.parse(env), { defaultOutboxDir: "/data/outbox" });
  it("auto-detects Resend, then SMTP, then the outbox", () => {
    expect(parse({}).provider).toBe("log");
    expect(parse({})).toMatchObject({ from: "SceneFlow <no-reply@localhost>", outboxDir: "/data/outbox" });
    expect(parse({ RESEND_API_KEY: "re_1", MAIL_FROM: "A <a@b.c>" })).toMatchObject({ provider: "resend", resend: { apiKey: "re_1" } });
    expect(parse({ SMTP_URL: "smtps://u:p@mail.example.com:465", MAIL_FROM: "A <a@b.c>" })).toMatchObject({ provider: "smtp", smtp: { url: "smtps://u:p@mail.example.com:465" } });
    expect(parse({ SMTP_HOST: "mail.example.com", SMTP_PORT: "2525", SMTP_SECURE: "false", MAIL_FROM: "A <a@b.c>" }).smtp).toMatchObject({ host: "mail.example.com", port: 2525, secure: false });
    expect(parse({ MAIL_PROVIDER: "log", RESEND_API_KEY: "re_1", MAIL_OUTBOX_DIR: "/tmp/ob" })).toMatchObject({ provider: "log", outboxDir: "/tmp/ob" });
  });
  it("fails loudly when an explicit provider lacks its settings", () => {
    expect(() => parse({ MAIL_PROVIDER: "resend" })).toThrow(/MAIL_FROM/);
    expect(() => parse({ MAIL_PROVIDER: "resend", MAIL_FROM: "A <a@b.c>" })).toThrow(/RESEND_API_KEY/);
    expect(() => parse({ MAIL_PROVIDER: "smtp", MAIL_FROM: "A <a@b.c>" })).toThrow(/SMTP_URL or SMTP_HOST/);
    expect(() => parse({ RESEND_API_KEY: "re_1" })).toThrow(/MAIL_FROM/);
  });
  it("builds an SMTP mailer without connecting", () => {
    const m = createMailer({ provider: "smtp", from: "A <a@b.c>", smtp: { host: "mail.example.com", port: 465 }, outboxDir: dir });
    expect(m.provider.label).toBe("SMTP (mail.example.com)");
    expect(createMailer({ provider: "smtp", from: "A <a@b.c>", smtp: { url: "smtp://u:p@relay.example.net:587" }, outboxDir: dir }).provider.label).toBe("SMTP (relay.example.net)");
  });
});
