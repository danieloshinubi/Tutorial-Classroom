// Delivery reports from a school's own Resend (supabase/236): delivered,
// delayed, bounced, marked as spam, failed or suppressed, for mail that
// mail-outbound sent; and mail received from outside (supabase/238,
// receive.ts). Each school's webhook carries its school in the
// address (?school=…) and is signed with that school's own secret, kept in
// Vault; anything unsigned or signed with another secret is refused.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { verifySignature } from "../_shared/mail/resend.ts";
import { receive } from "./receive.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Report {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[];
    bounce?: { message?: string; type?: string; subType?: string };
    failed?: { reason?: string };
    suppressed?: { message?: string; type?: string };
  };
}

// What the sender is told, in plain words.
function detailFor(r: Report): string | null {
  const d = r.data ?? {};
  switch (r.type) {
    case "email.bounced":
      return d.bounce?.message || "The receiving mail server refused it permanently (the address may not exist).";
    case "email.failed":
      return d.failed?.reason || "The mail service could not send it.";
    case "email.suppressed":
      return d.suppressed?.message || "It was not sent: this address bounced or reported spam before, so Resend holds back mail to it.";
    case "email.complained":
      return "The recipient marked it as spam.";
    case "email.delivery_delayed":
      return "The receiving mail server is slow to accept it. Resend keeps trying.";
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const school = new URL(req.url).searchParams.get("school") ?? "";
  if (!UUID.test(school)) return json({ error: "Unknown school" }, 404);

  const raw = await req.text();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "classroom" },
  });
  const { data } = await admin.rpc("mail_settings_secrets", { target_school: school });
  const settings = ((data as { webhook_secret: string | null; api_key: string | null; domain: string | null; sending_enabled: boolean }[] | null) ?? [])[0];
  const secret = settings?.webhook_secret;
  if (!secret) return json({ error: "Reports are not switched on for this school" }, 404);
  if (!(await verifySignature(secret, req.headers, raw))) return json({ error: "Bad signature" }, 401);

  let report: Report;
  try {
    report = JSON.parse(raw);
  } catch {
    return json({ error: "Not JSON" }, 400);
  }
  const emailId = report.data?.email_id;
  if (!report.type || !emailId) return json({ ok: true, ignored: true });

  // Mail from outside for this school (supabase/238). A failure answers 500
  // so Resend tries again; a second delivery is recognised and skipped.
  if (report.type === "email.received") {
    if (!settings?.api_key) return json({ error: "The school's Resend account is not connected" }, 404);
    const work = receive(admin, school, settings.api_key as string, settings.domain, settings.sending_enabled, emailId);
    // Resend waits about 15 seconds for an answer. Most mail is taken well
    // within that, and a failure answers 500 so Resend tries again. Mail
    // with large files that is still going after 10 seconds carries on after
    // the answer, so it is never cut off halfway.
    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    const slow = Symbol("slow");
    try {
      const r = await Promise.race([work, new Promise((resolve) => setTimeout(() => resolve(slow), 10000))]);
      if (r === slow) {
        runtime?.waitUntil?.(work.catch((err: Error) => console.error("receive", err.message)));
        return json({ ok: true, queued: true });
      }
      return json({ ok: true, ...(r as Record<string, unknown>) });
    } catch (err) {
      console.error("receive", (err as Error).message);
      return json({ error: "Could not take that message" }, 500);
    }
  }

  const { data: changed, error } = await admin.rpc("mail_delivery_event", {
    target_school: school,
    provider_id_in: emailId,
    event_in: report.type,
    detail_in: detailFor(report),
    recipients_in: null,
  });
  if (error) {
    console.error("mail_delivery_event", error.message);
    return json({ error: "Could not record it" }, 500);
  }
  return json({ ok: true, changed });
});
