// Instant phone and browser notifications, for every school (190).
//
// Called by the database the moment a chat message or an in-app
// notification is saved (triggers in 190_push_notifications.sql, over
// pg_net), so a message reaches the phone in a second or two, the way
// WhatsApp's do. There is no signed-in caller, so a shared secret stands in,
// as for payment-notify.
//
//   chat          push to every member of the chat except the author, on
//                 the devices they subscribed from that school's site, and
//                 skip muted chats. The first unread message in a chat also
//                 emails them through the school's own mailbox; later
//                 messages stay quiet until they have read it.
//   notification  push the in-app notification (a bill, an admission step, a
//                 ticket, a notice...) to its person.
//
// Pushes are tagged by chat, so a burst of messages shows as one updating
// notification per conversation, not a stack of ten.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { buildEmail, escapeHtml } from "../_shared/email/render.ts";
import { sendViaSchoolMailbox } from "../_shared/mailbox/send.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differences === 0;
};

type Subscription = { endpoint: string; p256dh: string; auth: string };

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

// What a chat message says in a notification: its words, or what it carries.
const chatPreview = (text: string, attachmentName: string | null, mime: string | null) => {
  if (text) return clip(text, 140);
  if (attachmentName) return mime?.startsWith("image/") ? "📷 Photo" : `📎 ${attachmentName}`;
  return "New message";
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("PUSH_NOTIFY_SECRET");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!secret || !publicKey || !privateKey) {
    console.error("push-notify is missing PUSH_NOTIFY_SECRET or its VAPID keys");
    return json({ error: "Not configured" }, 503);
  }
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", secret)) {
    return json({ error: "Not authorized" }, 401);
  }
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:support@schoolivio.com", publicKey, privateKey);

  let payload: { type?: string; message_id?: string; notification_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Unreadable body" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "classroom" },
  });

  // Sends one push to each device; forgets the ones the push service says
  // are gone. High urgency, a day to live: a phone that was off gets it
  // when it comes back, and one that is on gets it now.
  const pushTo = async (subs: Subscription[], message: Record<string, unknown>) => {
    const body = JSON.stringify(message);
    const results = await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 86400, urgency: "high", topic: typeof message.tag === "string" ? message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : undefined },
          );
          return "sent";
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await admin.rpc("forget_push_subscription", { endpoint_in: s.endpoint });
            return "gone";
          }
          console.error("push failed", status, (err as Error).message);
          return "failed";
        }
      }),
    );
    return {
      sent: results.filter((r) => r === "sent").length,
      gone: results.filter((r) => r === "gone").length,
      failed: results.filter((r) => r === "failed").length,
    };
  };

  try {
    if (payload.type === "chat" && payload.message_id) {
      const { data: ctx, error } = await admin.rpc("get_chat_push_context", { target_message: payload.message_id });
      if (error || !ctx) return json({ skipped: "No such message" });

      const isGroup = ctx.channel.kind === "group";
      const preview = chatPreview(ctx.text || "", ctx.attachment_name, ctx.attachment_mime);
      const title = isGroup ? ctx.channel.name || "Group chat" : ctx.author;
      const body = isGroup ? `${ctx.author}: ${preview}` : preview;
      const url = `/Chat/${ctx.channel.id}`;
      const appUrl = `https://${ctx.school.slug}.schoolivio.com${url}`;

      const report = { pushed: 0, gone: 0, failed: 0, emailed: 0, recipients: 0 };
      for (const r of ctx.recipients || []) {
        if (r.muted) continue;
        report.recipients += 1;

        if (r.subscriptions?.length) {
          const res = await pushTo(r.subscriptions, {
            title,
            body,
            url,
            tag: `chat-${ctx.channel.id}`,
            icon: ctx.school.logo_url || undefined,
          });
          report.pushed += res.sent;
          report.gone += res.gone;
          report.failed += res.failed;
        }

        // First unread in this chat, then quiet until they have read it.
        if (r.first_unread && r.chat_email && r.email) {
          const who = escapeHtml(ctx.author);
          const where = isGroup ? ` in <strong>${escapeHtml(ctx.channel.name || "a group chat")}</strong>` : "";
          const quoted = ctx.text
            ? `<p style="margin:14px 0 0;padding:12px 14px;border-left:3px solid #d0d4dc;background:#f6f7f9;border-radius:6px;">${escapeHtml(clip(ctx.text, 400))}</p>`
            : `<p style="margin:14px 0 0;">${escapeHtml(preview)}</p>`;
          const { html, text } = buildEmail({
            school: { name: ctx.school.name, slug: ctx.school.slug, logoUrl: ctx.school.logo_url, themeColor: ctx.school.theme_color },
            preheader: `${ctx.author}: ${preview}`,
            badge: "New message",
            heading: `${ctx.author} sent you a message`,
            bodyHtml: `<p style="margin:0;">${who} messaged you${where} on ${escapeHtml(ctx.school.name)}.</p>${quoted}`,
            ctaLabel: "Reply in the app",
            ctaUrl: appUrl,
            footNote: "You get one email per conversation until you read it. Turn chat emails off in Account settings.",
          });
          const sent = await sendViaSchoolMailbox(admin, {
            schoolId: ctx.school.id,
            to: [r.email],
            subject: isGroup ? `${ctx.author} in ${ctx.channel.name || "a group chat"}: ${clip(preview, 60)}` : `${ctx.author}: ${clip(preview, 70)}`,
            html,
            text,
          });
          if (sent.ok) report.emailed += 1;
        }
      }
      return json(report);
    }

    if (payload.type === "notification" && payload.notification_id) {
      const { data: ctx, error } = await admin.rpc("get_notification_push_context", { target_notification: payload.notification_id });
      if (error || !ctx) return json({ skipped: "No such notification" });
      if (!ctx.subscriptions?.length) return json({ skipped: "No devices" });
      const res = await pushTo(ctx.subscriptions, {
        title: ctx.title || "Schoolivio",
        body: ctx.body || "",
        url: ctx.link || "/Dashboard",
        tag: `note-${payload.notification_id}`,
        icon: ctx.school?.logo_url || undefined,
      });
      return json(res);
    }

    // New mail in someone's Inbox (supabase/243), if they want it pushed.
    if (payload.type === "mail" && payload.message_id) {
      const { data: ctx, error } = await admin.rpc("get_mail_push_context", { target_message: payload.message_id });
      if (error || !ctx) return json({ skipped: "Not pushed" });
      if (!ctx.subscriptions?.length) return json({ skipped: "No devices" });
      const res = await pushTo(ctx.subscriptions, {
        title: ctx.title || "New mail",
        body: ctx.body || "",
        url: ctx.link || "/Mail",
        tag: `mail-${payload.message_id}`,
        icon: ctx.school?.logo_url || undefined,
      });
      return json(res);
    }

    return json({ error: "Unknown event" }, 400);
  } catch (err) {
    console.error("push-notify failed", payload, (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
