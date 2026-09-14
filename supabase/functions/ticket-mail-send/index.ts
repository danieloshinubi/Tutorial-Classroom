// Sends a real email reply from a ticket — the outbound half of the email
// round trip. Only a ticket-staff member may trigger this (a plain member
// replying to their own ticket stays an internal reply via add_ticket_message,
// exactly as before); the reply itself always goes out over the school's own
// connected mailbox, never the platform's.
//
// The ticket-staff check happens with a caller-scoped client, same as
// pay-init/admin-reset-password. Only past that point does the service-role
// client appear — it is the only thing allowed to decrypt the mailbox's app
// password via classroom.get_mailbox_secret(), and the only thing allowed to
// record the outbound message via classroom.record_outbound_ticket_message().

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@10.0.9";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// A reply's subject stays anchored to "[#<number>]" so a customer's own
// reply threads back by subject even if their mail client drops headers —
// stripped and reapplied each time so it never accumulates "Re: Re: [#12] [#12]".
const bareSubject = (subject: string, number: number) =>
  subject
    .replace(/^(re:\s*)+/i, "")
    .replace(new RegExp(`\\[#${number}\\]\\s*`, "i"), "")
    .trim();

// The reply composer sends rich HTML (Tiptap) now, not plain text — this
// is only for the SMTP plain-text alternative and for checking the message
// actually has content (an empty editor still serialises to "<p></p>").
const stripHtml = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { ticketId, schoolId, body, to, cc, bcc } = await req.json();
    const plainBody = stripHtml(body || "");
    if (!ticketId || !plainBody) return json({ error: "A message body is required." }, 400);
    const toList: string[] = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (toList.length === 0) return json({ error: "At least one recipient is required." }, 400);
    const ccList: string[] = (Array.isArray(cc) ? cc : cc ? [cc] : []).filter(Boolean);
    const bccList: string[] = (Array.isArray(bcc) ? bcc : bcc ? [bcc] : []).filter(Boolean);

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        db: { schema: "classroom" },
        global: { headers: { Authorization: authorization } },
      },
    );

    const { data: authUser } = await caller.auth.getUser();
    if (!authUser?.user) return json({ error: "Sign in first." }, 401);

    const { data: ticket, error: ticketError } = await caller
      .from("tickets")
      .select("id, school_id, number, subject, channel, mailbox_id")
      .eq("id", ticketId)
      .single();
    if (ticketError || !ticket) return json({ error: "That ticket could not be found." }, 404);
    // The caller's own claim of "current school" must match the ticket's
    // real one — RLS/is_ticket_staff below only checks that this ticket's
    // actual school grants staff authority, not that it's the tenant the
    // caller currently has open, so a stale ticketId from another school
    // they also staff would otherwise be accepted here.
    if (!schoolId || ticket.school_id !== schoolId) {
      return json({ error: "That ticket could not be found." }, 404);
    }

    const { data: isStaff, error: staffError } = await caller.rpc("is_ticket_staff", {
      target_school: ticket.school_id,
    });
    if (staffError) return json({ error: staffError.message }, 400);
    if (!isStaff) return json({ error: "Only ticket-staff can send an email reply." }, 403);

    if (ticket.channel !== "email" || !ticket.mailbox_id) {
      return json({ error: "This ticket did not come in by email — reply stays inside the app." }, 400);
    }

    // Only past this point does anything privileged happen, and only with
    // the service role — get_mailbox_secret/record_outbound_ticket_message
    // are granted to nobody else. get_ticket_mailbox reads the mailbox row
    // itself, since "may send through it" (any ticket-staff role) is
    // broader than "may configure it" (owner/admin only — see 080's RLS) —
    // and service_role has no table-level grant on ticket_mailboxes or
    // ticket_messages at all (only `authenticated` does), so even a read
    // has to go through one of these SECURITY DEFINER functions.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    const { data: mailbox, error: mailboxError } = await admin
      .rpc("get_ticket_mailbox", { target_mailbox: ticket.mailbox_id })
      .single();
    if (mailboxError || !mailbox) return json({ error: "That mailbox is no longer connected." }, 404);
    if (!mailbox.is_active) return json({ error: "That mailbox has been disconnected." }, 400);
    if (mailbox.provider !== "imap_smtp") {
      return json({ error: "Sending through this provider isn't supported yet." }, 400);
    }

    const { data: password, error: secretError } = await admin.rpc("get_mailbox_secret", {
      target_mailbox: mailbox.id,
      which: "password",
    });
    if (secretError || !password) return json({ error: "Could not read that mailbox's credentials." }, 500);

    // The most recent message in the thread — whichever direction — is what
    // a reply threads onto, so the recipient's mail client groups it
    // correctly even without the "#N" subject token.
    const { data: lastMessageId } = await admin.rpc("last_ticket_email_message_id", {
      target_ticket: ticketId,
    });

    const transport = nodemailer.createTransport({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port || 587,
      secure: mailbox.smtp_security === "ssl",
      requireTLS: mailbox.smtp_security === "starttls",
      auth: { user: mailbox.username, pass: password },
    });

    const subject = `Re: [#${ticket.number}] ${bareSubject(ticket.subject, ticket.number)}`;
    const from = mailbox.display_name ? `"${mailbox.display_name}" <${mailbox.address}>` : mailbox.address;

    let messageId: string | null = null;
    let sendError: string | null = null;
    try {
      const info = await transport.sendMail({
        from,
        to: toList.join(", "),
        cc: ccList.length ? ccList.join(", ") : undefined,
        bcc: bccList.length ? bccList.join(", ") : undefined,
        subject,
        html: body,
        text: plainBody,
        inReplyTo: lastMessageId || undefined,
        references: lastMessageId || undefined,
      });
      messageId = info.messageId || null;
    } catch (err) {
      sendError = (err as Error).message || "The mail server refused that message.";
    }

    const { data: recorded, error: recordError } = await admin.rpc("record_outbound_ticket_message", {
      target_ticket: ticketId,
      body_in: body,
      to_addresses_in: toList,
      cc_addresses_in: ccList,
      bcc_addresses_in: bccList,
      email_message_id_in: messageId,
      send_status_in: sendError ? "failed" : "sent",
      send_error_in: sendError,
      actor: authUser.user.id,
      body_format_in: "html",
    });
    if (recordError) {
      console.error("record_outbound_ticket_message failed:", recordError.message);
    }

    if (sendError) return json({ error: sendError }, 502);
    return json(recorded);
  } catch (err) {
    return json({ error: (err as Error).message || "Could not send that reply." }, 500);
  }
});
