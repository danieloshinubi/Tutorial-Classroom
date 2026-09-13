// Checks every connected mailbox for new mail and turns it into tickets —
// the inbound half of the round trip. Triggered on a schedule by pg_cron
// (via pg_net's http_post — see 084_ticket_mail_cron.sql), not by a signed-in
// user, so there is no caller JWT to check here: a shared secret compared in
// constant time stands in for it, the same idea paystack-webhook uses an
// HMAC signature for, just simpler — both ends of this call are ours.
//
// Phase 2 only polls provider = 'imap_smtp' mailboxes. Microsoft 365 and
// Google will poll through their own APIs in a later phase, added onto this
// same function rather than a separate one, since "check what's new since
// last time" is the same job regardless of provider.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { ImapFlow } from "npm:imapflow@2.0.2";
import { simpleParser } from "npm:mailparser@3.9.26";

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
// failed — same helper paystack-webhook uses for its signature check.
const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differences === 0;
};

const asList = (value: string | string[] | undefined): string[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

// Connecting an existing, actively-used mailbox (not a fresh empty one) can
// mean thousands of pre-existing unread messages sitting in the inbox —
// fetching and parsing every single one in one run is what actually
// exhausted the function's compute budget the first time this ran for
// real, and (found live, against a real Gmail account) IMAP's SEARCH SINCE
// is date-only — it still returned every unseen message from earlier the
// same calendar day the mailbox was connected, turning a morning's worth of
// GitHub/Google/Otter notifications into 191 junk tickets. Two independent
// guards now: `since` is compared against each message's own envelope date
// in code (exact time, not the calendar day IMAP's SINCE works in) before
// anything is ingested, and MAX_PER_POLL caps how many run in one
// invocation regardless. A message older than `since` is left exactly as
// it was found — not marked \Seen — so nothing pre-existing in the
// person's real inbox has its read state changed by this; a message at or
// after `since` is ingested and then marked \Seen so it is never
// reconsidered. `since` is pinned to connection time forever rather than
// advancing each run, so a message that arrives after connecting is never
// skipped, only ever deferred to a later poll if MAX_PER_POLL is hit.
const MAX_PER_POLL = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const cronSecret = Deno.env.get("TICKET_MAIL_CRON_SECRET");
  if (!cronSecret) {
    console.error("TICKET_MAIL_CRON_SECRET is not set — refusing every request");
    return json({ error: "Not configured" }, 503);
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!sameSecret(provided, cronSecret)) {
    return json({ error: "Not authorized" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "classroom" } },
  );

  const { data: mailboxes, error: listError } = await admin.rpc("list_active_ticket_mailboxes", {
    provider_filter: "imap_smtp",
  });
  if (listError) return json({ error: listError.message }, 500);

  const results = [];
  for (const mailbox of mailboxes || []) {
    let ingested = 0;
    try {
      const { data: password, error: secretError } = await admin.rpc("get_mailbox_secret", {
        target_mailbox: mailbox.id,
        which: "password",
      });
      if (secretError || !password) throw new Error(secretError?.message || "No password stored for this mailbox.");

      const client = new ImapFlow({
        host: mailbox.imap_host,
        port: mailbox.imap_port || 993,
        secure: mailbox.imap_security === "ssl",
        auth: { user: mailbox.username, pass: password },
        logger: false,
      });

      await client.connect();
      try {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const since = new Date(mailbox.created_at);
          // Coarse, day-granular pass (all IMAP's SEARCH SINCE can do),
          // narrowed to an exact-time cutoff below before anything is
          // actually ingested.
          const candidateUids = (await client.search({ seen: false, since }, { uid: true })) || [];
          let processed = 0;
          for (const uid of candidateUids) {
            if (processed >= MAX_PER_POLL) {
              console.warn(
                `Mailbox ${mailbox.id}: hit the ${MAX_PER_POLL}-per-run cap with more unread mail left — the rest will be picked up on a later poll.`,
              );
              break;
            }

            const message = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
            if (!message?.source) continue;
            processed += 1;

            // The exact-time filter IMAP itself can't do: a message from
            // earlier the same calendar day the mailbox was connected is
            // left exactly as found — not marked \Seen — since it existed
            // before Schoolivio knew about this mailbox and was never ours
            // to touch.
            const receivedAt = message.envelope?.date ? new Date(message.envelope.date) : null;
            if (receivedAt && receivedAt < since) continue;

            const parsed = await simpleParser(message.source);
            const fromAddress = parsed.from?.value?.[0]?.address;
            if (!fromAddress) {
              await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
              continue;
            }

            // Keep the message's real formatting rather than flattening it —
            // a signature block, paragraph breaks and the odd bold word are
            // part of what was actually sent, not noise to strip out. Only a
            // genuinely plain-text email (no html part at all) falls back to
            // parsed.text; DOMPurify sanitizes html before it's ever rendered
            // (see TicketDetail.jsx / MyTicketDetail.jsx).
            const bodyIsHtml = Boolean(parsed.html);
            const body = bodyIsHtml ? parsed.html : (parsed.text || "");

            await admin.rpc("ingest_inbound_ticket_email", {
              target_mailbox: mailbox.id,
              message_id_in: parsed.messageId || null,
              in_reply_to_in: parsed.inReplyTo || null,
              references_in: asList(parsed.references),
              from_email_in: fromAddress,
              from_name_in: parsed.from?.value?.[0]?.name || null,
              subject_in: parsed.subject || "",
              body_in: body,
              body_format_in: bodyIsHtml ? "html" : "plain",
            });
            ingested += 1;

            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => client.close());
      }

      await admin.rpc("record_mailbox_poll_result", {
        target_mailbox: mailbox.id,
        status_in: "ok",
        error_in: null,
      });
      results.push({ mailboxId: mailbox.id, ingested });
    } catch (err) {
      const message = (err as Error).message || "Could not check this mailbox.";
      console.error(`Poll failed for mailbox ${mailbox.id}:`, message);
      await admin.rpc("record_mailbox_poll_result", {
        target_mailbox: mailbox.id,
        status_in: "error",
        error_in: message,
      });
      results.push({ mailboxId: mailbox.id, error: message });
    }
  }

  return json({ polled: results.length, results });
});
