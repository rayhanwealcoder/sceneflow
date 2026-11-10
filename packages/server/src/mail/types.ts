/** One outgoing message. Every mail carries both a text and an HTML body. */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** A mail minus the recipient — what the templates produce. */
export type MailContent = Omit<Mail, "to">;

export type MailProviderId = "resend" | "smtp" | "log";

export interface MailProvider {
  readonly id: MailProviderId;
  readonly label: string;
  send(mail: Mail & { from: string }): Promise<{ id: string | null }>;
}

export interface MailerStatus {
  provider: MailProviderId;
  label: string;
  /** true when messages actually leave this machine (Resend / SMTP); false for the outbox folder. */
  delivers: boolean;
  from: string;
  /** What to configure when nothing delivers; null when mail is set up. */
  hint: string | null;
}

export interface Mailer {
  readonly provider: MailProvider;
  readonly from: string;
  readonly delivers: boolean;
  /** Sends and resolves with the provider's message id; rejects when the provider fails. */
  send(mail: Mail): Promise<{ id: string | null }>;
  /** Fire-and-forget: the request that triggered the mail never waits for (or leaks the timing of) the mail server. Failures are logged. */
  sendLater(mail: Mail): void;
  status(): MailerStatus;
}
