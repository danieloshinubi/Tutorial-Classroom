// Extracted from ticket-mail-send — the "look up the school's connected
// mailbox, decrypt its password, hand nodemailer a transport" sequence,
// now shared by anything that needs to send branded mail through a
// school's own SMTP mailbox (admissions-notify, auth-email-send,
// notice-mail-send) instead of only ticket replies. Every caller still
// does its OWN authorization check before reaching this — this module
// only knows how to send, not who's allowed to ask it to.
import nodemailer from "npm:nodemailer@10.0.9";

// deno-lint-ignore no-explicit-any
type AdminClient = any;
// deno-lint-ignore no-explicit-any
type Transport = any;

export type MailboxReason = "no_mailbox" | "inactive" | "unsupported_provider" | "no_secret";

export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; reason: MailboxReason | "send_failed"; error?: string };

// One school can have more than one mailbox (Tickets currently only ever
// creates one, but the schema allows more) — the oldest active one is
// treated as "the" mailbox a school-wide email goes out from, same
// tie-break get_ticket_mailbox's caller already relies on implicitly by
// having exactly one row per school in practice today.
async function getSchoolMailboxTransport(
  admin: AdminClient,
  schoolId: string,
): Promise<{ ok: true; transport: Transport; from: string } | { ok: false; reason: MailboxReason }> {
  const { data: mailbox, error: mailboxError } = await admin
    .rpc("get_school_mailbox", { target_school: schoolId })
    .maybeSingle();
  if (mailboxError || !mailbox) return { ok: false, reason: "no_mailbox" };
  if (!mailbox.is_active) return { ok: false, reason: "inactive" };
  if (mailbox.provider !== "imap_smtp") return { ok: false, reason: "unsupported_provider" };

  const { data: password, error: secretError } = await admin.rpc("get_mailbox_secret", {
    target_mailbox: mailbox.id,
    which: "password",
  });
  if (secretError || !password) return { ok: false, reason: "no_secret" };

  const transport = nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port || 587,
    secure: mailbox.smtp_security === "ssl",
    requireTLS: mailbox.smtp_security === "starttls",
    auth: { user: mailbox.username, pass: password },
  });

  const from = mailbox.display_name ? `"${mailbox.display_name}" <${mailbox.address}>` : mailbox.address;
  return { ok: true, transport, from };
}

export async function sendViaSchoolMailbox(
  admin: AdminClient,
  args: { schoolId: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; html: string; text: string },
): Promise<SendResult> {
  const mailbox = await getSchoolMailboxTransport(admin, args.schoolId);
  if (!mailbox.ok) return mailbox;

  try {
    const info = await mailbox.transport.sendMail({
      from: mailbox.from,
      to: args.to.join(", "),
      cc: args.cc?.length ? args.cc.join(", ") : undefined,
      bcc: args.bcc?.length ? args.bcc.join(", ") : undefined,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    return { ok: true, messageId: info.messageId || null };
  } catch (err) {
    return { ok: false, reason: "send_failed", error: (err as Error).message || "The mail server refused that message." };
  }
}

export type BulkSendResult =
  | { ok: true; sent: number; failedBatches: number }
  | { ok: false; reason: MailboxReason };

// A school-wide announcement can address hundreds of people at once — one
// SMTP call per recipient would be slow and is exactly the pattern mail
// providers rate-limit or flag as spam. Recipients are BCC'd in small
// batches instead (nobody sees anyone else's address either way), reusing
// one transport/connection for the whole run rather than re-authenticating
// per batch.
export async function sendBulkViaSchoolMailbox(
  admin: AdminClient,
  args: { schoolId: string; recipients: string[]; subject: string; html: string; text: string; batchSize?: number },
): Promise<BulkSendResult> {
  const mailbox = await getSchoolMailboxTransport(admin, args.schoolId);
  if (!mailbox.ok) return mailbox;

  const batchSize = args.batchSize || 40;
  let sent = 0;
  let failedBatches = 0;

  for (let i = 0; i < args.recipients.length; i += batchSize) {
    const batch = args.recipients.slice(i, i + batchSize);
    try {
      await mailbox.transport.sendMail({
        from: mailbox.from,
        // RFC 5322 empty-group syntax — a real recipient list stays in bcc
        // (nobody sees anyone else's address), while "To" reads as an
        // intentional bulk send rather than the mailbox owner's own address,
        // which several spam filters specifically penalise as a from==to
        // pattern.
        to: "Undisclosed recipients:;",
        bcc: batch.join(", "),
        subject: args.subject,
        html: args.html,
        text: args.text,
        headers: {
          // A recognised bulk-mail signal most spam filters weight heavily
          // in the other direction — its absence on a many-recipient send
          // is itself a mark against deliverability.
          "List-Unsubscribe": `<mailto:${mailbox.from.match(/<(.+)>/)?.[1] || mailbox.from}?subject=unsubscribe>`,
          "Precedence": "bulk",
        },
      });
      sent += batch.length;
    } catch {
      failedBatches += 1;
    }
  }

  return { ok: true, sent, failedBatches };
}
