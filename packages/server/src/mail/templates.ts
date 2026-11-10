/*
 * The e-mails SceneFlow sends. Plain, short, one action each; every template returns text + HTML.
 * HTML is a single centred card with inline styles (what mail clients render reliably); nothing is loaded
 * from the network, so a mail looks the same in Gmail, Outlook and Apple Mail.
 */
import type { MailContent } from "./types.js";

export interface MailBrand {
  /** Origin of the web app, for the footer link. */
  webOrigin: string;
  product?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The shared frame: title, paragraphs, optional button, footer with the app link. */
export function layout(brand: MailBrand, opts: { title: string; paragraphs: string[]; button?: { href: string; label: string }; small?: string }): string {
  const product = esc(brand.product ?? "SceneFlow");
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1d1d1f">${p}</p>`).join("");
  const button = opts.button
    ? `<p style="margin:22px 0"><a href="${esc(opts.button.href)}" style="display:inline-block;background:#1d1d1f;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:999px">${esc(opts.button.label)}</a></p>` +
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#6e6e73;word-break:break-all">If the button does not work, copy this link into your browser:<br><a href="${esc(opts.button.href)}" style="color:#1d1d1f">${esc(opts.button.href)}</a></p>`
    : "";
  const small = opts.small ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#6e6e73">${opts.small}</p>` : "";
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(opts.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f5f5f7;font-family:${FONT}">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 16px">` +
    `<div style="font-weight:700;font-size:15px;letter-spacing:.2px;color:#1d1d1f;margin:0 0 14px">${product}</div>` +
    `<div style="background:#ffffff;border-radius:16px;padding:28px 28px 22px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 10px 30px rgba(0,0,0,.05)">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#1d1d1f;font-weight:700">${esc(opts.title)}</h1>${body}${button}${small}</div>` +
    `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#86868b">Sent by ${product} · <a href="${esc(brand.webOrigin)}" style="color:#86868b">${esc(brand.webOrigin.replace(/^https?:\/\//, ""))}</a></p>` +
    `</div></body></html>`
  );
}

const greet = (name: string) => (name.trim() ? `Hi ${name.trim()},` : "Hi,");

/** "Reset your password": the link is the whole point; it is valid for `minutes` and works once. */
export function passwordResetMail(brand: MailBrand, p: { name: string; link: string; minutes: number }): MailContent {
  const product = brand.product ?? "SceneFlow";
  const subject = `Reset your ${product} password`;
  const text = [greet(p.name), "", `Someone — hopefully you — asked to reset the password of your ${product} account. Open this link to choose a new one:`, "", p.link, "", `The link works for ${p.minutes} minutes and only once. If you did not ask for this, you can ignore this e-mail; your password stays as it is.`].join("\n");
  const html = layout(brand, {
    title: "Reset your password",
    paragraphs: [esc(greet(p.name)), `Someone — hopefully you — asked to reset the password of your ${esc(product)} account. Choose a new one here:`],
    button: { href: p.link, label: "Choose a new password" },
    small: `The link works for ${p.minutes} minutes and only once. If you did not ask for this, ignore this e-mail — your password stays as it is.`,
  });
  return { subject, text, html };
}

/** Sent after a password changed (reset link or account page), so a hijack does not go unnoticed. */
export function passwordChangedMail(brand: MailBrand, p: { name: string; resetLink: string }): MailContent {
  const product = brand.product ?? "SceneFlow";
  const subject = `Your ${product} password was changed`;
  const text = [greet(p.name), "", `The password of your ${product} account was just changed and every other device was signed out.`, "", `If this was you, there is nothing to do. If it was not, reset your password right away: ${p.resetLink}`].join("\n");
  const html = layout(brand, {
    title: "Your password was changed",
    paragraphs: [esc(greet(p.name)), `The password of your ${esc(product)} account was just changed and every other device was signed out.`, `If this was you, there is nothing to do. If it was not, reset your password right away.`],
    button: { href: p.resetLink, label: "Reset my password" },
  });
  return { subject, text, html };
}

/** Workspace invitation with the one-time join link (when the admin typed an e-mail address). */
export function inviteMail(brand: MailBrand, p: { inviterName: string | null; workspaceName: string; role: string; link: string; days: number }): MailContent {
  const product = brand.product ?? "SceneFlow";
  const who = p.inviterName?.trim() || "Someone";
  const subject = `${who} invited you to ${p.workspaceName} on ${product}`;
  const text = ["Hi,", "", `${who} invited you to join the workspace "${p.workspaceName}" on ${product} as ${p.role}. Accept here:`, "", p.link, "", `The link works once and for ${p.days} days. You can sign in or create a free account when you open it.`].join("\n");
  const html = layout(brand, {
    title: `You are invited to ${p.workspaceName}`,
    paragraphs: ["Hi,", `<strong>${esc(who)}</strong> invited you to join <strong>${esc(p.workspaceName)}</strong> on ${esc(product)} as <strong>${esc(p.role)}</strong>.`],
    button: { href: p.link, label: "Accept the invitation" },
    small: `The link works once and for ${p.days} days. You can sign in or create a free account when you open it.`,
  });
  return { subject, text, html };
}

/** The MP4 render finished — one click back to the project page, where the download button is. */
export function exportReadyMail(brand: MailBrand, p: { name: string; projectName: string; fileName: string; quality: string; link: string }): MailContent {
  const subject = `Your video "${p.projectName}" is ready to download`;
  const text = [greet(p.name), "", `The MP4 of "${p.projectName}" (${p.quality}) finished rendering. Download it from the project page:`, "", p.link, "", `File: ${p.fileName}`].join("\n");
  const html = layout(brand, {
    title: "Your video is ready",
    paragraphs: [esc(greet(p.name)), `The MP4 of <strong>${esc(p.projectName)}</strong> (${esc(p.quality)}) finished rendering.`],
    button: { href: p.link, label: "Download it from the project page" },
    small: `File: ${esc(p.fileName)}`,
  });
  return { subject, text, html };
}
