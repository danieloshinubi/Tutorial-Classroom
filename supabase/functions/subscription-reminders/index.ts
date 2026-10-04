// Trial and renewal reminders (supabase/225), once a day by pg_cron at
// 08:00 Lagos time. 5, 3 and 1 day(s) before a school's free trial or paid
// month ends, and on the day itself, each owner and admin gets one gentle
// email from Schoolivio's own sender (Console → Settings) with a link to pay
// online and an address to write to. The same reminder appears in the app.
//
// A step is only marked sent once its email has gone, so a run with no
// sender set up, or a mail server that is down, simply tries again the next
// day. Called by the scheduler only, with the shared cron secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildEmail, escapeHtml } from "../_shared/email/render.ts";
import { platformSettings, platformTransport } from "../_shared/platform/settings.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differences === 0;
};

interface Due {
  school_id: string;
  school_name: string;
  slug: string;
  kind: "trial" | "renewal";
  ends_on: string;
  days_before: number;
  days_left: number;
  recipients: { email: string; name: string | null; user_id: string }[];
  plan_name: string;
  amount: number | null;
  /** The currency Schoolivio prices this school in (supabase/227). */
  currency: string;
}

// In the currency the school is priced in: ₦450,000, CA$450.
const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n));
  } catch {
    return `${currency} ${Number(n).toLocaleString("en")}`;
  }
};
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function compose(d: Due, contact: string) {
  const when = d.days_left === 0 ? "today" : d.days_left === 1 ? "tomorrow" : `in ${d.days_left} days`;
  const what = d.kind === "trial" ? "free trial" : "Schoolivio plan";
  const subject = `Your ${what} for ${d.school_name} ends ${when}`;
  const price = d.amount
    ? `Your plan is <strong>${escapeHtml(d.plan_name)}</strong>, at <strong>${money(d.amount, d.currency)} a month</strong>, based on your number of students.`
    : `With more than 800 students, ${escapeHtml(d.school_name)} is on <strong>Enterprise</strong>, which we price with you directly.`;
  const ask = d.kind === "trial"
    ? "To keep everything running without a break, please start your monthly payment."
    : "To keep everything running without a break, please renew for the next month.";
  const after = d.kind === "trial"
    ? "When the trial ends without payment, staff, students and parents can no longer use the app until it is paid. Nothing is deleted."
    : "If the month runs out without payment, the app is paused for everyone after 3 days' grace until it is paid. Nothing is deleted.";
  const mail = escapeHtml(contact);
  const subjectLine = encodeURIComponent(`Schoolivio subscription: ${d.school_name}`);
  const bodyHtml = [
    `<p>Hello,</p>`,
    `<p>A friendly reminder: the ${what} for <strong>${escapeHtml(d.school_name)}</strong> ends <strong>${when}</strong> (${longDate(d.ends_on)}).</p>`,
    `<p>${ask} ${price}</p>`,
    d.amount ? `<p>You can pay securely online with Paystack using the button below.</p>` : "",
    `<p>${after}</p>`,
    `<p>Questions, or prefer to pay another way? Write to us at <a href="mailto:${mail}?subject=${subjectLine}">${mail}</a>.</p>`,
  ].join("");
  const { html, text } = buildEmail({
    school: { name: "Schoolivio", slug: d.slug, themeColor: "#6d3fc4" },
    preheader: `${d.school_name}: ${what} ends ${when}`,
    badge: d.days_left === 0 ? "Ends today" : `${d.days_left} day${d.days_left === 1 ? "" : "s"} left`,
    heading: `Your ${what} ends ${when}`,
    bodyHtml,
    ctaLabel: d.amount ? `Pay ${money(d.amount, d.currency)} now` : "Contact us",
    ctaUrl: d.amount ? `https://${d.slug}.schoolivio.com/School?tab=billing` : `mailto:${contact}?subject=${subjectLine}`,
    footNote: "You receive this because you are an owner or administrator of this school on Schoolivio.",
  });
  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const cronSecret = Deno.env.get("TICKET_MAIL_CRON_SECRET");
  if (!cronSecret) return json({ error: "Not configured" }, 503);
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", cronSecret)) return json({ error: "Not authorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "classroom" },
    auth: { persistSession: false },
  });

  const { data: due, error } = await admin.rpc("due_subscription_reminders");
  if (error) return json({ error: error.message }, 500);
  if (!due?.length) return json({ sent: 0 });

  const settings = await platformSettings(admin);
  const mail = await platformTransport(admin, settings);
  if (!mail) return json({ error: "Schoolivio's sender is not set up in Console → Settings yet.", due: due.length }, 503);

  let sent = 0;
  const failures: string[] = [];
  for (const d of due as Due[]) {
    const message = compose(d, settings.contact_email);
    let delivered = 0;
    for (const r of d.recipients) {
      try {
        await mail.transport.sendMail({
          from: mail.from,
          to: r.name ? `"${r.name.replace(/"/g, "")}" <${r.email}>` : r.email,
          replyTo: settings.contact_email,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        delivered += 1;
      } catch (err) {
        failures.push(`${d.slug}: ${(err as Error).message}`);
      }
    }
    // Marked sent (and shown in the app) once at least one owner or admin
    // has the email, so one bad address cannot hold up the rest every day.
    if (delivered > 0 || d.recipients.length === 0) {
      const { error: recordError } = await admin.rpc("record_subscription_reminder", {
        target_school: d.school_id,
        kind_in: d.kind,
        ends_on_in: d.ends_on,
        days_in: d.days_before,
      });
      if (recordError) failures.push(`${d.slug}: ${recordError.message}`);
      else sent += 1;
    }
  }
  return json({ sent, failures });
});
