// Emails everyone a published News notice was addressed to — the "always
// email on publish" half of the noticeboard. publish_notice() already
// raises an in-app notification for the same audience (see
// 101_scope_publish_notice_to_school.sql); this is that same audience,
// reached by email through the school's own connected mailbox, in small
// BCC batches so a large audience doesn't get sent as one giant recipient
// list or as one SMTP call per person.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildEmail, escapeHtml } from "../_shared/email/render.ts";
import { sendBulkViaSchoolMailbox } from "../_shared/mailbox/send.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { noticeId, schoolId } = await req.json();
    if (!noticeId || !schoolId) return json({ error: "Missing noticeId or schoolId." }, 400);

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { db: { schema: "classroom" }, global: { headers: { Authorization: authorization } } },
    );

    const { data: authUser } = await caller.auth.getUser();
    if (!authUser?.user) return json({ error: "Sign in first." }, 401);

    const { data: n, error: noticeError } = await caller
      .from("notices")
      .select("id, school_id, title, audience, is_event, published_at")
      .eq("id", noticeId)
      .single();
    if (noticeError || !n) return json({ error: "That notice could not be found." }, 404);
    if (!schoolId || n.school_id !== schoolId) return json({ error: "That notice could not be found." }, 404);
    if (!n.published_at) return json({ error: "This notice hasn't been published yet." }, 400);

    const { data: canPost, error: postError } = await caller.rpc("can_post_notices", { target_school: n.school_id });
    if (postError) return json({ error: postError.message }, 400);
    if (!canPost) return json({ error: "Only the school office can email a notice." }, 403);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    const { data: school, error: schoolError } = await admin
      .from("schools")
      .select("id, name, slug, logo_url, theme_color")
      .eq("id", n.school_id)
      .single();
    if (schoolError || !school) return json({ error: "That school could not be found." }, 404);

    const { data: recipientRows, error: recipientsError } = await admin.rpc("notice_recipients", { target_notice: noticeId });
    if (recipientsError) return json({ error: recipientsError.message }, 500);
    const recipients: string[] = (recipientRows || []).map((r: { email: string }) => r.email).filter(Boolean);

    if (recipients.length === 0) {
      return json({ sent: false, reason: "no_recipients" });
    }

    // A nudge, not a copy — the notice's own title carries the email (as
    // both subject and heading, since a bare "you have a new announcement"
    // doesn't give anyone a reason to care), but never its body or event
    // date/place. Those stay inside the app, read there by the person it's
    // about, in the account it's about; this email exists only to get them
    // to open News for the rest.
    const noticeUrl = `https://${school.slug}.schoolivio.com/News`;
    const bodyHtml = `<p style="margin:0;">${escapeHtml(
      n.is_event
        ? `${school.name} just posted a new event. Tap below to see the details in the app.`
        : `${school.name} just posted a new announcement. Tap below to read it in the app.`
    )}</p>`;

    const { html, text } = buildEmail({
      school: { name: school.name, slug: school.slug, logoUrl: school.logo_url, themeColor: school.theme_color },
      preheader: `${n.title} — tap to read it in the app.`,
      badge: n.is_event ? "New event" : "New announcement",
      heading: n.title,
      bodyHtml,
      ctaLabel: "Read it in the app",
      ctaUrl: noticeUrl,
      footNote: "You're receiving this because it was posted to News for your school.",
    });

    const result = await sendBulkViaSchoolMailbox(admin, {
      schoolId: n.school_id,
      recipients,
      subject: n.title,
      html,
      text,
    });

    if (!result.ok) {
      return json({ sent: false, reason: result.reason });
    }
    return json({ sent: true, count: result.sent, failedBatches: result.failedBatches });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not email that notice." }, 500);
  }
});
