import { z } from "zod";
import { OutboxMailProvider, ResendProvider, SmtpProvider, type SmtpOptions } from "./providers.js";
import type { Mail, Mailer, MailerStatus, MailProvider } from "./types.js";

export * from "./types.js";
export * from "./templates.js";
export { OutboxMailProvider, ResendProvider, SmtpProvider, linksIn, type SmtpOptions } from "./providers.js";

/** Environment variables for outgoing e-mail; the API and the worker (finished exports) read the same ones. */
export const mailEnvSchema = z.object({
  /** auto (default): Resend when RESEND_API_KEY is set, else SMTP when SMTP_URL / SMTP_HOST is set, else the outbox folder. */
  MAIL_PROVIDER: z.enum(["auto", "resend", "smtp", "log"]).default("auto"),
  /** Sender, e.g. "SceneFlow <no-reply@yourdomain.com>". Required for Resend / SMTP (the domain must be verified at the provider). */
  MAIL_FROM: z.string().max(200).optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(["true", "false"]).optional(),
  /** Where the outbox provider writes messages. Default: <STORAGE_DIR>/outbox. */
  MAIL_OUTBOX_DIR: z.string().optional(),
});
export type MailEnv = z.infer<typeof mailEnvSchema>;

export interface MailConfig {
  provider: "resend" | "smtp" | "log";
  from: string;
  resend?: { apiKey: string };
  smtp?: SmtpOptions;
  outboxDir: string;
}

const LOCAL_FROM = "SceneFlow <no-reply@localhost>";

/** Picks the provider from the environment. Explicit choices fail loudly when their settings are missing. */
export function mailConfigFromEnv(env: MailEnv, args: { defaultOutboxDir: string; resolveDir?: (dir: string) => string }): MailConfig {
  const resolveDir = args.resolveDir ?? ((d) => d);
  const outboxDir = env.MAIL_OUTBOX_DIR ? resolveDir(env.MAIL_OUTBOX_DIR) : args.defaultOutboxDir;
  const hasSmtp = Boolean(env.SMTP_URL || env.SMTP_HOST);
  const choice = env.MAIL_PROVIDER === "auto" ? (env.RESEND_API_KEY ? "resend" : hasSmtp ? "smtp" : "log") : env.MAIL_PROVIDER;
  if (choice === "log") return { provider: "log", from: env.MAIL_FROM ?? LOCAL_FROM, outboxDir };
  if (!env.MAIL_FROM) throw new Error(`MAIL_PROVIDER=${choice} needs MAIL_FROM (e.g. "SceneFlow <no-reply@yourdomain.com>")`);
  if (choice === "resend") {
    if (!env.RESEND_API_KEY) throw new Error("MAIL_PROVIDER=resend needs RESEND_API_KEY");
    return { provider: "resend", from: env.MAIL_FROM, resend: { apiKey: env.RESEND_API_KEY }, outboxDir };
  }
  if (!hasSmtp) throw new Error("MAIL_PROVIDER=smtp needs SMTP_URL or SMTP_HOST");
  return { provider: "smtp", from: env.MAIL_FROM, smtp: { url: env.SMTP_URL, host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : undefined }, outboxDir };
}

export interface MailerOptions {
  log?: (line: string) => void;
  fetchFn?: typeof fetch;
}

/** Builds the configured provider and wraps it in a `Mailer`. */
export function createMailer(cfg: MailConfig, opts: MailerOptions = {}): Mailer {
  const log = opts.log ?? ((l: string) => console.log(l));
  const provider: MailProvider =
    cfg.provider === "resend" && cfg.resend ? new ResendProvider(cfg.resend.apiKey, opts.fetchFn) : cfg.provider === "smtp" && cfg.smtp ? new SmtpProvider(cfg.smtp) : new OutboxMailProvider(cfg.outboxDir, log);
  return buildMailer(provider, cfg.from, log);
}

/** Wraps any provider (tests inject fakes here). */
export function buildMailer(provider: MailProvider, from: string, log: (line: string) => void = (l) => console.log(l)): Mailer {
  const delivers = provider.id !== "log";
  const send = (mail: Mail) => provider.send({ ...mail, from });
  return {
    provider,
    from,
    delivers,
    send,
    sendLater(mail) {
      void send(mail).catch((err: unknown) => log(`[mail] could not send "${mail.subject}" to ${mail.to} via ${provider.label}: ${err instanceof Error ? err.message : String(err)}`));
    },
    status(): MailerStatus {
      const outbox = provider instanceof OutboxMailProvider ? provider.outboxDir : null;
      return {
        provider: provider.id,
        label: provider.label,
        delivers,
        from,
        hint: delivers ? null : `No mail service is configured: links are written to the API log${outbox ? ` and to ${outbox}` : ""}. Set RESEND_API_KEY (or SMTP_URL) and MAIL_FROM in apps/api/.env to send real e-mail.`,
      };
    },
  };
}
