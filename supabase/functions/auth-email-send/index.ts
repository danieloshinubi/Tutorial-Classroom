// Branded password-reset and new-member "activate your account" emails,
// sent through the SAME school mailbox Tickets already uses — replacing
// Supabase Auth's own built-in mailer (one fixed template, unbranded, the
// same for every school) for schools that have one connected. A school
// with no mailbox connected falls back to Supabase's own default email
// exactly as before, so this can never leave anyone unable to reset a
// password — it only makes the branded path available where it can be.
//
// "reset" is reachable pre-auth (the Forgot Password page) — same trust
// boundary as Supabase's own resetPasswordForEmail: never reveals whether
// the address has an account. "invite" is a school admin activating a new
// member's account and requires the caller to actually be one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildEmail } from "../_shared/email/render.ts";
import { sendViaSchoolMailbox } from "../_shared/mailbox/send.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Always the same shape regardless of what actually happened — an
// enumeration attack learns nothing from the response either way.
const GENERIC_OK = { ok: true };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { schoolId, email, kind } = await req.json();
    if (!schoolId || !email || !["reset", "invite"].includes(kind)) {
      return json({ error: "Missing schoolId, email or kind." }, 400);
    }
    const cleanEmail = String(email).trim().toLowerCase();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    if (kind === "invite") {
      // Only a real owner/admin at this school may trigger an activation
      // email — this is provisioning.js's invitePasswordSetup path, always
      // called right after an admin adds a member.
      const authorization = req.headers.get("Authorization") ?? "";
      if (!authorization) return json({ error: "Sign in first." }, 401);
      const caller = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { db: { schema: "classroom" }, global: { headers: { Authorization: authorization } } },
      );
      const { data: authUser } = await caller.auth.getUser();
      if (!authUser?.user) return json({ error: "Sign in first." }, 401);
      const { data: isAdmin, error: adminError } = await caller.rpc("has_role_in", {
        target_school: schoolId,
        roles: ["owner", "admin"],
      });
      if (adminError) return json({ error: adminError.message }, 400);
      if (!isAdmin) return json({ error: "Only an owner or administrator can send that." }, 403);
    }

    const { data: schoolRows } = await admin.rpc("get_school_for_mail", { target_school: schoolId });
    const school = schoolRows?.[0];

    const redirectTo = school ? `https://${school.slug}.schoolivio.com/Reset-Password` : undefined;

    // generateLink both confirms the address has an account AND hands back
    // the action link WITHOUT triggering Supabase's own email — exactly the
    // split needed to send our own branded one instead.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: cleanEmail,
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (linkError || !linkData?.properties?.action_link || !school) {
      // No account, no school, or generateLink failed for some other
      // reason — fall back to Supabase's own flow so a genuine account
      // still gets a (generic, unbranded) reset email rather than nothing.
      if (kind === "reset") {
        const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
        await anon.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: redirectTo || `${new URL(req.url).origin}/Reset-Password`,
        }).catch(() => null);
      }
      return json(GENERIC_OK);
    }

    const actionLink = linkData.properties.action_link;

    const copy = kind === "reset"
      ? {
          subject: `Reset your ${school.name} password`,
          badge: "Account security",
          heading: "Reset your password",
          bodyHtml: `<p style="margin:0 0 12px;">We received a request to reset the password for your account at <strong>${escapeName(school.name)}</strong>. This link is valid for 60 minutes and can only be used once.</p><p style="margin:0;">If you didn't ask for this, you can ignore this email — your password won't change.</p>`,
          cta: "Reset password",
          preheader: `A password reset was requested for your ${school.name} account.`,
          foot: "For your security, we never ask for your password by email.",
        }
      : {
          subject: `Confirm your email for ${school.name}`,
          badge: "Verify your email",
          heading: "One more step to finish setting up",
          bodyHtml: `<p style="margin:0;">You're being added to <strong>${escapeName(school.name)}</strong>. Confirm this is your email address and set a password to activate your account.</p>`,
          cta: "Verify email address",
          preheader: `Confirm your email to activate your ${school.name} account.`,
          foot: "If you weren't expecting this, you can safely ignore it.",
        };

    const { html, text } = buildEmail({
      school: { name: school.name, slug: school.slug, logoUrl: school.logo_url, themeColor: school.theme_color },
      preheader: copy.preheader,
      badge: copy.badge,
      heading: copy.heading,
      bodyHtml: copy.bodyHtml,
      ctaLabel: copy.cta,
      ctaUrl: actionLink,
      footNote: copy.foot,
    });

    const result = await sendViaSchoolMailbox(admin, {
      schoolId,
      to: [cleanEmail],
      subject: copy.subject,
      html,
      text,
    });

    if (!result.ok) {
      // Connected mailbox exists but the send itself failed, or none is
      // connected — either way, fall back rather than strand the user with
      // a generated link nobody ever saw.
      const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
      if (kind === "reset") {
        await anon.auth.resetPasswordForEmail(cleanEmail, { redirectTo: redirectTo || undefined }).catch(() => null);
      }
    }

    return json(GENERIC_OK);
  } catch (_err) {
    // Never leak internals from an unauthenticated endpoint's error path.
    return json(GENERIC_OK);
  }
});

function escapeName(value: string) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
