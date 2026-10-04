// IT creates a newly admitted pupil's school account and their parent's, from
// the "New pupil account" ticket admissions raised (supabase/228, 229).
//
//   pupil   a fresh login with a username (firstname.surname) and a temporary
//           password. It uses the pupil's own email when IT gives one, else
//           a school-only address that nothing is ever sent to; the pupil
//           signs in with the username either way.
//   parent  the email they applied with as the guardian. A new login with a
//           temporary password, or, when that address already has a
//           Schoolivio login, the same login made a parent here.
//   then    parent linked to pupil, the family emailed both sets of sign-in
//           details and the portal address (to the address they applied
//           with, and the guardian's if different), the ticket noted and
//           resolved, and admissions told the pupil can be registered.
//
// The email goes from the school's own mailbox, else Schoolivio's sender. If
// neither can send, the details come back to IT once to pass on by hand.
// Temporary passwords are never stored or written on the ticket, and both
// must be changed at first sign-in. Only the school's admins and owners (IT)
// may do this; the database checks that again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildEmail, escapeHtml } from "../_shared/email/render.ts";
import { sendViaSchoolMailbox } from "../_shared/mailbox/send.ts";
import { platformSettings, platformTransport } from "../_shared/platform/settings.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const pick = (chars: string, n: number) =>
  Array.from(crypto.getRandomValues(new Uint32Array(n)), (b) => chars[b % chars.length]).join("");
const temporaryPassword = () => `${pick(UPPER, 3)}-${pick(LOWER, 4)}-${pick(DIGITS, 3)}`;

const slugPart = (s: string) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

interface Ctx {
  application_id: string;
  reference: string;
  status: string;
  school_id: string;
  school_name: string;
  slug: string;
  first_name: string;
  middle_name: string | null;
  surname: string;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_relation: string | null;
  applied_with: string | null;
  student_account_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const created: string[] = [];
  // deno-lint-ignore no-explicit-any
  let admin: any = null;
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      db: { schema: "classroom" },
      global: { headers: { Authorization: authorization } },
    });
    const { data: me } = await caller.auth.getUser();
    if (!me?.user) return json({ error: "Sign in first." }, 401);

    const body = await req.json().catch(() => ({}));
    const ticketId = String(body.ticketId || "");
    if (!ticketId) return json({ error: "Which ticket?" }, 400);

    // As the caller: only the school's admins and owners get an answer.
    const { data: ctxData, error: ctxError } = await caller.rpc("family_accounts_request", { target_ticket: ticketId });
    if (ctxError) return json({ error: ctxError.message }, 403);
    const ctx = ctxData as Ctx | null;
    if (!ctx) return json({ error: "This ticket is not a pupil account request." }, 404);
    if (ctx.student_account_id) return json({ error: "The accounts for this pupil were already created." }, 409);
    if (ctx.status !== "accepted") return json({ error: "The applicant is no longer an accepted applicant." }, 409);
    const parentEmail = String(ctx.guardian_email || "").trim().toLowerCase();
    if (!EMAIL.test(parentEmail)) return json({ error: "The application has no valid parent email. Ask admissions to correct it." }, 400);

    admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "classroom" },
      auth: { persistSession: false },
    });

    // The pupil's username: firstname.surname, made unique.
    const base = [slugPart(ctx.first_name), slugPart(ctx.surname)].filter(Boolean).join(".") || "pupil";
    const wanted = String(body.username || "").trim().toLowerCase();
    if (wanted && !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(wanted)) {
      return json({ error: "A username is 3 to 40 letters, numbers, dots, dashes or underscores." }, 400);
    }
    let username = wanted || base;
    for (let n = 2; n < 200; n += 1) {
      const { data: taken } = await admin.from("profiles").select("id").ilike("username", username).maybeSingle();
      if (!taken) break;
      if (wanted) return json({ error: `The username ${wanted} is taken. Choose another.` }, 409);
      username = `${base}${n}`;
    }

    // The pupil's sign-in address: their own, or a school-only one.
    const ownEmail = String(body.pupilEmail || "").trim().toLowerCase();
    if (ownEmail && !EMAIL.test(ownEmail)) return json({ error: "Enter a valid email for the pupil, or leave it empty." }, 400);
    if (ownEmail && ownEmail === parentEmail) {
      return json({ error: "The pupil needs a different email from the parent's. Leave it empty to give them a username only." }, 400);
    }
    const pupilEmail = ownEmail || `${username}@${ctx.slug}.schoolivio.com`;
    const { data: pupilExists } = await admin.rpc("platform_user_by_email", { target_email: pupilEmail });
    if (pupilExists) return json({ error: `${pupilEmail} already has a Schoolivio login. Use another email.` }, 409);

    const pupilPassword = temporaryPassword();
    const { data: pupil, error: pupilError } = await admin.auth.admin.createUser({
      email: pupilEmail,
      password: pupilPassword,
      email_confirm: true,
      user_metadata: { first_name: ctx.first_name, surname: ctx.surname, username },
    });
    if (pupilError || !pupil?.user) return json({ error: pupilError?.message || "Could not create the pupil's account." }, 500);
    created.push(pupil.user.id);

    // The parent: their existing login, or a new one.
    const { data: parentExisting } = await admin.rpc("platform_user_by_email", { target_email: parentEmail });
    let parentId = parentExisting as string | null;
    let parentPassword: string | null = null;
    if (!parentId) {
      parentPassword = temporaryPassword();
      const [first, ...rest] = String(ctx.guardian_name || "").trim().split(/\s+/);
      const { data: parent, error: parentError } = await admin.auth.admin.createUser({
        email: parentEmail,
        password: parentPassword,
        email_confirm: true,
        user_metadata: { first_name: first || "", surname: rest.join(" ") },
      });
      if (parentError || !parent?.user) throw new Error(parentError?.message || "Could not create the parent's account.");
      parentId = parent.user.id as string;
      created.push(parent.user.id);
    }

    // The email to the family.
    const portal = `https://${ctx.slug}.schoolivio.com`;
    const pupilName = [ctx.first_name, ctx.surname].filter(Boolean).join(" ");
    const recipients = Array.from(new Set([ctx.applied_with, parentEmail].filter(Boolean).map((e) => String(e).toLowerCase())));
    const { data: schoolRows } = await admin.rpc("get_school_for_mail", { target_school: ctx.school_id });
    const school = schoolRows?.[0] || { name: ctx.school_name, slug: ctx.slug };
    const row = (label: string, value: string) =>
      `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;">${escapeHtml(label)}</td><td style="padding:4px 0;font-family:monospace;font-size:15px;"><strong>${escapeHtml(value)}</strong></td></tr>`;
    const bodyHtml = [
      `<p>Dear ${escapeHtml(ctx.guardian_name || "Parent")},</p>`,
      `<p>${escapeHtml(pupilName)}'s school accounts at <strong>${escapeHtml(ctx.school_name)}</strong> are ready, one for ${escapeHtml(ctx.first_name)} and one for you as their parent.</p>`,
      `<p><strong>${escapeHtml(ctx.first_name)}'s sign-in</strong></p>`,
      `<table role="presentation" style="border-collapse:collapse;">${row("Username", username)}${ownEmail ? row("or email", ownEmail) : ""}${row("Temporary password", pupilPassword)}</table>`,
      `<p style="margin-top:16px;"><strong>Your sign-in as parent</strong></p>`,
      parentPassword
        ? `<table role="presentation" style="border-collapse:collapse;">${row("Email", parentEmail)}${row("Temporary password", parentPassword)}</table>`
        : `<table role="presentation" style="border-collapse:collapse;">${row("Email", parentEmail)}</table><p>You already have a Schoolivio sign-in with this address, so use your existing password.</p>`,
      `<p style="margin-top:16px;">Sign in at <a href="${portal}/Login">${portal.replace("https://", "")}</a>. A temporary password must be changed the first time it is used. Please keep these details private.</p>`,
    ].join("");
    const { html, text } = buildEmail({
      school: { name: school.name, slug: school.slug, logoUrl: school.logo_url, themeColor: school.theme_color },
      preheader: `${pupilName}'s school account is ready`,
      badge: "Accounts ready",
      heading: `Welcome to ${ctx.school_name}`,
      bodyHtml,
      ctaLabel: "Sign in to the portal",
      ctaUrl: `${portal}/Login`,
      footNote: `Sent by ${ctx.school_name} because ${pupilName} has been admitted.`,
    });
    const subject = `${pupilName}'s school account at ${ctx.school_name}`;

    let emailedTo: string | null = null;
    const viaSchool = await sendViaSchoolMailbox(admin, { schoolId: ctx.school_id, to: recipients, subject, html, text });
    if (viaSchool.ok) {
      emailedTo = recipients.join(" and ");
    } else {
      const settings = await platformSettings(admin).catch(() => null);
      const mail = settings ? await platformTransport(admin, settings).catch(() => null) : null;
      if (mail) {
        try {
          await mail.transport.sendMail({ from: mail.from, to: recipients.join(", "), subject, html, text });
          emailedTo = recipients.join(" and ");
        } catch {
          emailedTo = null;
        }
      }
    }

    const { error: finishError } = await admin.rpc("finish_family_accounts", {
      target_application: ctx.application_id,
      target_ticket: ticketId,
      actor: me.user.id,
      student_user: pupil.user.id,
      parent_user: parentId,
      student_username: username,
      parent_new: Boolean(parentPassword),
      emailed_to: emailedTo,
    });
    if (finishError) throw new Error(finishError.message);
    created.length = 0;

    return json({
      username,
      pupilEmail: ownEmail || null,
      parentEmail,
      parentNew: Boolean(parentPassword),
      emailedTo,
      // Only when nobody could be emailed: shown to IT once, to pass on.
      credentials: emailedTo ? null : { pupilPassword, parentPassword },
    });
  } catch (err) {
    // Nothing half-made: logins created in this run are removed again.
    for (const id of created) await admin?.auth.admin.deleteUser(id).catch(() => {});
    return json({ error: (err as Error).message || "Could not create the accounts." }, 500);
  }
});
