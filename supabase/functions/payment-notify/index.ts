// Emails a school's bursary team the moment a payment is actually approved —
// money taken at the desk, settled online through Paystack, or a parent's
// declared transfer once a bursar approves it. Triggered by
// classroom.notify_payment_received() (114_payment_notifications.sql) over
// pg_net, not by a signed-in user, so there is no caller JWT to check: a
// shared secret compared in constant time stands in, the same pattern
// ticket-mail-poll uses for the same reason.
//
// Sends through the school's own connected mailbox — the one already set up
// for Tickets (080_ticket_mailboxes.sql) — rather than a platform-wide
// address. A school that has not connected a mailbox yet simply gets no
// email here, silently, exactly like it gets no inbound tickets either.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@10.0.9";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Length-independent comparison, so a mismatch does not leak where it
// failed — same helper paystack-webhook and ticket-mail-poll use.
const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differences === 0;
};

const money = (amount: number) =>
  amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const methodLabel: Record<string, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  pos: "POS",
  cheque: "Cheque",
  online: "Online (Paystack)",
  waiver: "Waiver",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const cronSecret = Deno.env.get("PAYMENT_NOTIFY_SECRET");
  if (!cronSecret) {
    console.error("PAYMENT_NOTIFY_SECRET is not set — refusing every request");
    return json({ error: "Not configured" }, 503);
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!sameSecret(provided, cronSecret)) {
    return json({ error: "Not authorized" }, 401);
  }

  let paymentId: string | undefined;
  try {
    ({ payment_id: paymentId } = await req.json());
  } catch {
    return json({ error: "Unreadable body" }, 400);
  }
  if (!paymentId) return json({ error: "payment_id is required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "classroom" } },
  );

  try {
    const { data: context, error: contextError } = await admin
      .rpc("get_payment_notification_context", { target_payment: paymentId })
      .single();
    if (contextError || !context) {
      console.error("No notification context for payment", paymentId, contextError?.message);
      return json({ skipped: "No such payment" }, 200);
    }

    const recipients: string[] = context.recipients || [];
    if (!context.mailbox_id) {
      return json({ skipped: "This school has no mailbox connected yet." }, 200);
    }
    if (recipients.length === 0) {
      return json({ skipped: "No owner, admin or bursar has an email address on file." }, 200);
    }

    const { data: mailbox, error: mailboxError } = await admin
      .rpc("get_ticket_mailbox", { target_mailbox: context.mailbox_id })
      .single();
    if (mailboxError || !mailbox || !mailbox.is_active || mailbox.provider !== "imap_smtp") {
      return json({ skipped: "That mailbox is no longer connected." }, 200);
    }

    const { data: password, error: secretError } = await admin.rpc("get_mailbox_secret", {
      target_mailbox: mailbox.id,
      which: "password",
    });
    if (secretError || !password) {
      console.error("Could not read mailbox credentials for", mailbox.id, secretError?.message);
      return json({ error: "Could not read that mailbox's credentials." }, 500);
    }

    const transport = nodemailer.createTransport({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port || 587,
      secure: mailbox.smtp_security === "ssl",
      requireTLS: mailbox.smtp_security === "starttls",
      auth: { user: mailbox.username, pass: password },
    });

    const from = mailbox.display_name ? `"${mailbox.display_name}" <${mailbox.address}>` : mailbox.address;
    const amount = `${context.currency || ""} ${money(context.amount)}`.trim();
    const subject = `Payment received — ${amount} on ${context.invoice_reference}`;
    const lines = [
      `${context.student_name}${context.class_name ? ` (${context.class_name})` : ""} — ${amount} against invoice ${context.invoice_reference}.`,
      "",
      `Method: ${methodLabel[context.method] || context.method}`,
      `Date: ${context.paid_on}`,
      context.payment_reference ? `Reference: ${context.payment_reference}` : null,
      "",
      `— ${context.school_name}, via Schoolivio`,
    ].filter((line) => line !== null);
    const text = lines.join("\n");

    const info = await transport.sendMail({
      from,
      to: recipients.join(", "),
      subject,
      text,
    });

    return json({ sent: true, messageId: info.messageId, to: recipients });
  } catch (err) {
    const message = (err as Error).message || "Could not send that notification.";
    console.error("payment-notify failed for", paymentId, message);
    return json({ error: message }, 500);
  }
});
