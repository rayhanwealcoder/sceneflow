/*
 * Three ways out: Resend (HTTP, no dependency — free tier is plenty for a small team), any SMTP server
 * (nodemailer), or the outbox folder when nothing is configured — the mail is written as JSON next to the
 * media files and its links are printed to the API log, so password reset and invitations keep working on a
 * laptop or a fresh server; the person running it copies the link.
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type { Mail, MailProvider } from "./types.js";

type Outgoing = Mail & { from: string };

export class ResendProvider implements MailProvider {
  readonly id = "resend" as const;
  readonly label = "Resend";

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(m: Outgoing): Promise<{ id: string | null }> {
    const res = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { id?: string };
    return { id: data.id ?? null };
  }
}

export interface SmtpOptions {
  /** smtp://user:pass@host:587 or smtps://user:pass@host:465 — wins over the separate fields. */
  url?: string;
  host?: string;
  port?: number;
  /** Implicit TLS (port 465). Default: STARTTLS on any other port. */
  secure?: boolean;
  user?: string;
  pass?: string;
}

export class SmtpProvider implements MailProvider {
  readonly id = "smtp" as const;
  readonly label: string;
  private readonly transport: nodemailer.Transporter;

  constructor(opts: SmtpOptions) {
    if (opts.url) {
      this.transport = nodemailer.createTransport(opts.url);
      this.label = `SMTP (${safeHost(opts.url)})`;
    } else {
      if (!opts.host) throw new Error("SMTP needs SMTP_URL or SMTP_HOST");
      const port = opts.port ?? 587;
      this.transport = nodemailer.createTransport({ host: opts.host, port, secure: opts.secure ?? port === 465, auth: opts.user ? { user: opts.user, pass: opts.pass ?? "" } : undefined });
      this.label = `SMTP (${opts.host})`;
    }
  }

  async send(m: Outgoing): Promise<{ id: string | null }> {
    const info = await this.transport.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return { id: info.messageId ?? null };
  }
}

const safeHost = (url: string) => {
  try {
    return new URL(url).hostname || "server";
  } catch {
    return "server";
  }
};

export const linksIn = (text: string): string[] => Array.from(text.matchAll(/https?:\/\/[^\s<>"')]+/g), (x) => x[0]);

/** No mail server: one JSON file per message in `outboxDir`, links echoed to the log. */
export class OutboxMailProvider implements MailProvider {
  readonly id = "log" as const;
  readonly label = "Outbox folder (no mail server configured)";

  constructor(
    readonly outboxDir: string,
    private readonly log: (line: string) => void = (l) => console.log(l),
  ) {}

  async send(m: Outgoing): Promise<{ id: string | null }> {
    await mkdir(this.outboxDir, { recursive: true });
    const id = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const file = join(this.outboxDir, `${id}.json`);
    await writeFile(file, JSON.stringify({ id, at: new Date().toISOString(), from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html }, null, 2), "utf8");
    const links = linksIn(m.text);
    this.log(`[mail] no mail server: "${m.subject}" for ${m.to} saved to ${file}${links.length ? ` — link: ${links.join(" ")}` : ""}`);
    return { id };
  }
}
