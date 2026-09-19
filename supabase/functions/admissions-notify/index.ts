// Emails an applicant's guardian about their application — a decision
// (offer/enrolled/rejected) or a free-form message from admissions staff.
// Nothing in the app sent applicants any email before this; the only
// artifact was AdmissionLetter.jsx's print-only in-app letter.
//
// Same shape as ticket-mail-send: a caller-scoped client proves the caller
// is signed in and actually admissions staff at THIS application's real
// school, then a service-role client does the privileged parts (reading
// the mailbox's secret, sending, and logging the outcome) — the client
// never sees the mailbox password or touches admission_messages directly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildEmail, escapeHtml } from "../_shared/email/render.ts";
import { fillMergeTags } from "../_shared/email/mergeTags.ts";
import { sendViaSchoolMailbox } from "../_shared/mailbox/send.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Kind = "offered" | "enrolled" | "rejected" | "message";

const KIND_COPY: Record<Exclude<Kind, "message">, { badge: string; heading: string; cta: string }> = {
  offered: { badge: "Offer of admission", heading: "Congratulations — you're in", cta: "Track your application" },
  enrolled: { badge: "Enrollment confirmed", heading: "Welcome!", cta: "Sign in to the portal" },
  rejected: { badge: "Application update", heading: "An update on your application", cta: "" },
};

const LETTER_FIELD: Record<Exclude<Kind, "message">, string> = {
  offered: "admission_letter_offer_intro",
  enrolled: "admission_letter_enrolled_intro",
  rejected: "admission_letter_closing",
};

const paragraphs = (text: string) =>
  escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { applicationId, schoolId, kind, message } = await req.json();
    if (!applicationId || !schoolId || !kind) return json({ error: "Missing applicationId, schoolId or kind." }, 400);
    if (!["offered", "enrolled", "rejected", "message"].includes(kind)) {
      return json({ error: "Unknown message kind." }, 400);
    }
    if (kind === "message" && !String(message || "").trim()) {
      return json({ error: "A message is required." }, 400);
    }

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { db: { schema: "classroom" }, global: { headers: { Authorization: authorization } } },
    );

    const { data: authUser } = await caller.auth.getUser();
    if (!authUser?.user) return json({ error: "Sign in first." }, 401);

    const { data: app, error: appError } = await caller
      .from("applications")
      .select("id, school_id, reference, first_name, middle_name, surname, guardian_name, guardian_email, session_id, class_id, sessions(name), classes(name)")
      .eq("id", applicationId)
      .single();
    if (appError || !app) return json({ error: "That application could not be found." }, 404);
    if (!schoolId || app.school_id !== schoolId) return json({ error: "That application could not be found." }, 404);
    if (!app.guardian_email) return json({ error: "This application has no guardian email on file." }, 400);

    const { data: isStaff, error: staffError } = await caller.rpc("can_do_admissions", { target_school: app.school_id });
    if (staffError) return json({ error: staffError.message }, 400);
    if (!isStaff) return json({ error: "Only admissions staff can message an applicant." }, 403);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    const { data: schoolRows, error: schoolError } = await admin.rpc("get_school_for_mail", { target_school: app.school_id });
    const school = schoolRows?.[0];
    if (schoolError || !school) return json({ error: "That school could not be found." }, 404);

    const applicantName = [app.first_name, app.middle_name, app.surname].filter(Boolean).join(" ");
    const mergeVars = {
      applicant_name: applicantName,
      school_name: school.name,
      guardian_name: app.guardian_name,
      session_name: app.sessions?.name,
      class_name: app.classes?.name,
      reference: app.reference,
    };

    const portalUrl = `https://${school.slug}.schoolivio.com`;
    const signOff = school.signatory_name
      ? `${school.signatory_name}${school.signatory_title ? ` · ${school.signatory_title}` : ""}`
      : undefined;

    let subject: string;
    let badge: string;
    let badgeTone: "brand" | "muted" = "brand";
    let heading: string;
    let bodyHtml: string;
    let ctaLabel: string | null = null;
    let ctaUrl: string | null = null;
    let preheader: string;

    if (kind === "message") {
      subject = `A message from ${school.name} Admissions`;
      badge = "Message from admissions";
      heading = "A note from our admissions team";
      bodyHtml = paragraphs(String(message).trim());
      ctaLabel = "Open your application";
      ctaUrl = `${portalUrl}/Apply/Status`;
      preheader = `${school.signatory_name || "Admissions"} sent you a message about your application.`;
    } else {
      const copy = KIND_COPY[kind];
      const letterField = school[LETTER_FIELD[kind] as keyof typeof school] as string | null;
      subject =
        kind === "offered" ? `You've been offered admission to ${school.name}` :
        kind === "enrolled" ? `Welcome to ${school.name}` :
        `An update on your application — ${school.name}`;
      badge = copy.badge;
      badgeTone = kind === "rejected" ? "muted" : "brand";
      heading = copy.heading;
      bodyHtml = letterField && letterField.trim()
        ? paragraphs(fillMergeTags(letterField, mergeVars as Record<string, string>))
        : paragraphs(defaultCopy(kind, mergeVars.applicant_name, school.name));
      ctaLabel = kind === "rejected" ? null : copy.cta;
      ctaUrl = kind === "rejected" ? null : (kind === "enrolled" ? `${portalUrl}/Login` : `${portalUrl}/Apply/Status`);
      preheader =
        kind === "offered" ? `${school.name} has offered you admission.` :
        kind === "enrolled" ? `You're officially enrolled at ${school.name}.` :
        `An update on your ${school.name} application.`;
    }

    const { html, text } = buildEmail({
      school: { name: school.name, slug: school.slug, logoUrl: school.logo_url, themeColor: school.theme_color },
      preheader,
      badge,
      badgeTone,
      heading,
      bodyHtml,
      ctaLabel,
      ctaUrl,
      footNote: signOff,
    });

    const result = await sendViaSchoolMailbox(admin, {
      schoolId: app.school_id,
      to: [app.guardian_email],
      subject,
      html,
      text,
    });

    await admin.rpc("record_admission_message", {
      target_application: applicationId,
      target_school: app.school_id,
      kind_in: kind,
      subject_in: subject,
      sent_to_in: app.guardian_email,
      status_in: result.ok ? "sent" : (result.reason === "no_mailbox" || result.reason === "inactive" ? "skipped" : "failed"),
      error_in: result.ok ? null : (result as { error?: string }).error || result.reason,
      sent_by_in: authUser.user.id,
    });

    if (!result.ok) {
      if (result.reason === "no_mailbox" || result.reason === "inactive") {
        return json({ sent: false, reason: "no_mailbox" });
      }
      return json({ sent: false, reason: result.reason, error: (result as { error?: string }).error }, 502);
    }

    return json({ sent: true });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not message that applicant." }, 500);
  }
});

function defaultCopy(kind: Exclude<Kind, "message">, applicantName: string, schoolName: string) {
  if (kind === "offered") {
    return `Dear ${applicantName || "Applicant"},\n\nOn behalf of ${schoolName}, we're delighted to offer you a place for the coming session. Please sign in to track your application for full details on accepting your place.`;
  }
  if (kind === "enrolled") {
    return `Dear ${applicantName || "Applicant"},\n\nYour enrollment at ${schoolName} is now confirmed. We're genuinely excited to have you join us — sign in to the portal for your class placement and resumption details.`;
  }
  return `Dear ${applicantName || "Applicant"},\n\nThank you for the time and care you put into your application to ${schoolName}. After careful review, we're unable to offer you a place for this admission cycle. This isn't a reflection of your potential — we'd welcome an application in a future cycle.`;
}
