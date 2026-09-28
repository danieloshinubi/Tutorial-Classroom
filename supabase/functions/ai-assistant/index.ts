// The AI assistant, one endpoint for every tenant.
//
// Phase 0 is the spine: tenancy, metering and the monthly ceiling, with a
// deliberately narrow first surface (the public admissions assistant on
// /Apply, which reads only what a school has written about itself). Later
// phases add RLS-scoped tools for signed-in users; the structure below is
// what makes those safe to add.
//
// Same two-client shape as admissions-notify. The distinction is the entire
// security model, so it is worth stating plainly:
//
//   caller  — built from the visitor's own Authorization header, so Postgres
//             RLS decides what it can read, exactly as it does for the React
//             app. Every future tool that touches school data runs through
//             THIS client. A parent asking about another family's child gets
//             nothing back because the database returned nothing, not because
//             a prompt declined.
//   admin   — service role. Used only for metering and for reading the
//             school's own public profile on the anonymous path. It must
//             never be used to answer a question about a person.
//
// Getting that backwards — querying as admin and filtering in the prompt —
// would put every school's data one crafted message away from exposure.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.128.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = "claude-opus-5";

// Bundled means nobody is billed per call, which is exactly why there has to
// be a stop. Without it one school's traffic is invisible until the invoice.
// Generous enough that no ordinary school will meet it; low enough that a
// runaway loop or a scripted abuser cannot spend the month's budget.
const MONTHLY_TOKEN_CEILING = 2_000_000;

// A school answering questions about itself, and nothing else. The refusal
// instruction matters more than it looks: a school that has not filled in its
// knowledge yet must produce "I don't know, here's who to ask" rather than a
// confident invention about fees.
const admissionsSystem = (school: Record<string, unknown>, knowledge: string) =>
  [
    `You are the admissions assistant for ${school.name}, a school using Schoolivio.`,
    `You are speaking to a prospective parent or guardian who is not signed in.`,
    ``,
    `Answer ONLY from the school information below. It is the school's own words.`,
    `If the answer is not there, say you don't have that detail and point them to`,
    `the school's contact details or the application form — never guess, and never`,
    `invent a fee, a date, a requirement or a policy.`,
    ``,
    `You have no access to any applicant's or student's records, so you cannot`,
    `look up an individual application. If asked, explain that they can track an`,
    `application with its reference on the "Track your application" page.`,
    ``,
    `Be brief and plain. This is often read on a phone.`,
    ``,
    `--- School information ---`,
    knowledge.trim() || "(The school has not added any information yet.)",
    school.email ? `Contact email: ${school.email}` : "",
    school.phone ? `Contact phone: ${school.phone}` : "",
    school.address ? `Address: ${school.address}` : "",
  ]
    .filter(Boolean)
    .join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let schoolId: string | null = null;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "classroom" } },
  );

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "The assistant is not configured yet." }, 503);

    const { slug, messages } = await req.json();
    if (!slug) return json({ error: "Missing slug." }, 400);
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "Missing messages." }, 400);
    }
    // Only the two roles the Messages API takes from a client, and only text.
    // Whatever the browser posts is untrusted input, not a free hand over the
    // request shape.
    const clean = messages
      .filter((m: { role?: string; content?: unknown }) =>
        (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim()
      )
      .slice(-20)
      .map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content.slice(0, 4000),
      }));
    if (clean.length === 0) return json({ error: "Missing messages." }, 400);

    // public_school() is the same anon-callable RPC /Apply already uses to
    // resolve a tenant, so this path exposes nothing the page does not.
    const { data: school, error: schoolError } = await admin.rpc("public_school", { target_slug: slug });
    const row = Array.isArray(school) ? school[0] : school;
    if (schoolError || !row?.id) return json({ error: "Unknown school." }, 404);
    schoolId = row.id;

    // public_school() returns only (id, name, slug, logo_url, theme_color), so
    // the contact details the prompt tells the assistant to fall back on have
    // to be read separately. This is the one admin read on the anonymous path
    // and it is deliberately narrow: three columns the school already prints
    // on its own letters and application page, for the single school the slug
    // resolved to. No personal data, no other tenant — anything about a person
    // must come from the caller-scoped client in a later phase, never here.
    const { data: contact } = await admin
      .from("schools")
      .select("email, phone, address")
      .eq("id", schoolId)
      .maybeSingle();

    const { data: used } = await admin.rpc("ai_tokens_this_month", { target_school: schoolId });
    if (Number(used || 0) >= MONTHLY_TOKEN_CEILING) {
      return json({ error: "The assistant has reached this school's limit for this month." }, 429);
    }

    // The knowledge fields land in Phase 1; until then the assistant runs on
    // the school's contact details alone and says so when it doesn't know.
    const knowledge = "";

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: admissionsSystem({ ...row, ...(contact || {}) }, knowledge),
      messages: clean,
    });

    await admin.rpc("record_ai_usage", {
      target_school: schoolId,
      surface_in: "admissions",
      model_in: MODEL,
      input_tokens_in: response.usage?.input_tokens ?? 0,
      output_tokens_in: response.usage?.output_tokens ?? 0,
      user_in: null,
      error_in: null,
    });

    // stop_reason is checked before the content is read: a refusal comes back
    // as a normal 200 with no usable answer.
    if (response.stop_reason === "refusal") {
      return json({ error: "The assistant could not answer that one." }, 200);
    }

    const reply = response.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();

    return json({ reply });
  } catch (err) {
    // A failed call still cost something and still belongs to a school, so it
    // is recorded rather than vanishing from the month's picture.
    if (schoolId) {
      await admin
        .rpc("record_ai_usage", {
          target_school: schoolId,
          surface_in: "admissions",
          model_in: MODEL,
          input_tokens_in: 0,
          output_tokens_in: 0,
          user_in: null,
          error_in: (err as Error).message?.slice(0, 500) ?? "unknown",
        })
        .catch(() => {});
    }
    return json({ error: (err as Error).message || "The assistant could not answer that one." }, 500);
  }
});
