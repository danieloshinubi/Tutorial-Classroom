// The AI assistant, one endpoint for every tenant.
//
// Two surfaces:
//
//   admissions  the public assistant on /Apply. Not signed in; reads only what
//               the school has written about itself.
//   assistant   the in-app assistant for signed-in staff, parents and
//               students (192). It looks things up, analyses them, draws
//               charts and points people to the right page.
//
// Same two-client shape as admissions-notify. The distinction is the entire
// security model, so it is worth stating plainly:
//
//   caller  built from the visitor's own Authorization header, so Postgres row
//           level security decides what it can read, exactly as it does for
//           the React app. EVERY lookup about school data runs through this
//           client. A parent asking about another family gets nothing back
//           because the database returned nothing, not because a prompt
//           declined.
//   admin   service role. Used only for metering, the table catalogue, and
//           the school's own public profile. Never to answer a question
//           about a person.
//
// Lookups are structured (table, columns, filters, grouping) and go through
// the same API gateway as the app. The model is never given raw SQL: run as
// the caller, SQL could reset the session role to the connection's own login
// and step from there into the service role, past row level security.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = "claude-opus-5-5";

// Which AI answers. Claude when ANTHROPIC_API_KEY is set; Groq (free tier,
// open models) when only GROQ_API_KEY is, or when AI_PROVIDER says so.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const provider = () => {
  const chosen = (Deno.env.get("AI_PROVIDER") || "").toLowerCase();
  if (chosen === "groq" || chosen === "anthropic") return chosen;
  if (Deno.env.get("ANTHROPIC_API_KEY")) return "anthropic";
  if (Deno.env.get("GROQ_API_KEY")) return "groq";
  return null;
};

// Speed on Groq's free tier comes down to one fact: each model has its OWN
// per-minute token allowance (about 8,000). Waiting out one model's limit
// took most of a minute; switching to the next model is instant. So a busy
// model is skipped until its cool-down ends, best model first. GROQ_MODELS
// (comma separated) overrides the list.
const groqModels = () =>
  (Deno.env.get("GROQ_MODELS") || Deno.env.get("GROQ_MODEL") ||
    "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b,llama-3.3-70b-versatile,llama-3.1-8b-instant,minimaxai/minimax-m2.7")
    .split(",").map((m) => m.trim()).filter(Boolean);
const groqModel = () => groqModels()[0];
const coolingUntil = new Map<string, number>();
// Models that turned down their extra settings once are sent without them.
const plainModels = new Set<string>();

// Extra settings a model family needs: short reasoning (fewer tokens, faster
// first word) and reasoning kept out of the visible text.
const groqExtras = (model: string): Record<string, unknown> => {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low" };
  if (model.startsWith("qwen/")) return { reasoning_format: "hidden" };
  return {};
};

// Some open models think out loud in <think> tags; that never reaches the
// person, even while streaming.
const thinkFilter = () => {
  let inside = false;
  let carry = "";
  return (chunk: string) => {
    let text = carry + chunk;
    carry = "";
    let out = "";
    while (text) {
      if (inside) {
        const end = text.indexOf("</think>");
        if (end < 0) { if (text.length > 8) carry = text.slice(-8); return out; }
        inside = false;
        text = text.slice(end + 8);
      } else {
        const start = text.indexOf("<think>");
        if (start < 0) {
          // Hold back a possible partial tag at the end.
          const tail = text.lastIndexOf("<");
          if (tail >= 0 && text.length - tail < 7) { out += text.slice(0, tail); carry = text.slice(tail); }
          else out += text;
          return out;
        }
        out += text.slice(0, start);
        inside = true;
        text = text.slice(start + 7);
      }
    }
    return out;
  };
};

// One Groq chat completion, streamed, on the first model that is not busy.
// Text arrives through onText; the finished message (text and any tool
// calls), its token use and the model that answered come back.
// deno-lint-ignore no-explicit-any
const groqComplete = async (body: Record<string, unknown>, onText: (t: string) => void, onWait: (seconds: number) => void, deadline = Date.now() + 60_000): Promise<any> => {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY is not set.");
  const models = groqModels();
  let waitedMs = 0;
  const tried: string[] = [];

  for (let attempt = 0; attempt < models.length * 6 + 6; attempt++) {
    const now = Date.now();
    const model = models.find((m) => (coolingUntil.get(m) || 0) <= now);
    if (!model) {
      // Every model is busy. Their waits are short (usually under 15
      // seconds), so wait for the soonest rather than give up, up to about
      // 40 seconds in all for one reply.
      const soonest = Math.max(500, Math.min(...models.map((m) => coolingUntil.get(m) || 0)) - now);
      if (waitedMs + soonest > 25_000 || Date.now() + soonest > deadline) throw new GroqLimitError(tried);
      waitedMs += soonest;
      onWait(Math.ceil(soonest / 1000));
      await new Promise((r) => setTimeout(r, soonest));
      continue;
    }

    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(plainModels.has(model) ? {} : groqExtras(model)), model, stream: true }),
    });
    if (response.status === 429 || response.status === 503 || response.status === 404) {
      const wait = Number(response.headers.get("retry-after") || "") || (response.status === 404 ? 3600 : 20);
      tried.push(`${model} ${response.status} wait ${wait}s`);
      coolingUntil.set(model, Date.now() + wait * 1000);
      await response.body?.cancel().catch(() => {});
      continue;
    }
    if (response.status === 400) {
      // A model that rejects a setting or the tool format: skip it for this
      // instance rather than fail the question.
      const detail = await response.text().catch(() => "");
      console.error("groq 400", model, detail.slice(0, 300));
      tried.push(`${model} 400 ${detail.slice(0, 160)}`);
      if (!plainModels.has(model) && Object.keys(groqExtras(model)).length) plainModels.add(model);
      else coolingUntil.set(model, Date.now() + 10 * 60 * 1000);
      continue;
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Groq ${response.status}: ${detail.slice(0, 300)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const clean = thinkFilter();
    let buffer = "";
    let text = "";
    let finish = "";
    // deno-lint-ignore no-explicit-any
    let usage: any = null;
    const calls: { id: string; name: string; args: string }[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        // deno-lint-ignore no-explicit-any
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        usage = chunk.usage || chunk.x_groq?.usage || usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (typeof delta.content === "string" && delta.content) {
          const visible = clean(delta.content);
          if (visible) {
            text += visible;
            onText(visible);
          }
        }
        for (const tc of delta.tool_calls || []) {
          const i = typeof tc.index === "number" ? tc.index : calls.length;
          calls[i] = calls[i] || { id: "", name: "", args: "" };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) calls[i].name += tc.function.name;
          if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    }
    return { text, calls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` })), finish, usage, model };
  }
  throw new GroqLimitError(tried);
};

class GroqLimitError extends Error {
  tried: string[];
  constructor(tried: string[] = []) {
    super("The free AI is too busy to answer right now. Wait a minute and ask again.");
    this.tried = tried;
  }
}

// The public surface's cap. The signed-in assistant uses each school's own
// schools.ai_token_limit (192).
const ADMISSIONS_MONTHLY_CEILING = 2_000_000;

// ---------------------------------------------------------------- admissions

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

type Turn = { role: "user" | "assistant"; content: string };

// Only the two roles the Messages API takes from a client, and only text.
// Whatever the browser posts is untrusted input, not a free hand over the
// request shape.
const cleanTurns = (messages: unknown, keep: number, chars: number): Turn[] => {
  if (!Array.isArray(messages)) return [];
  const turns = messages
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim())
    .slice(-keep)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, chars) })) as Turn[];
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
};

const admissions = async (admin: SupabaseClient, body: Record<string, unknown>, apiKey: string) => {
  let schoolId: string | null = null;
  try {
    const slug = body.slug;
    if (!slug) return json({ error: "Missing slug." }, 400);
    const clean = cleanTurns(body.messages, 20, 4000);
    if (clean.length === 0) return json({ error: "Missing messages." }, 400);

    const { data: school, error: schoolError } = await admin.rpc("public_school", { target_slug: slug });
    const row = Array.isArray(school) ? school[0] : school;
    if (schoolError || !row?.id) return json({ error: "Unknown school." }, 404);
    schoolId = row.id;

    const { data: contact } = await admin.from("schools").select("email, phone, address").eq("id", schoolId).maybeSingle();

    const { data: used } = await admin.rpc("ai_tokens_this_month", { target_school: schoolId });
    if (Number(used || 0) >= ADMISSIONS_MONTHLY_CEILING) {
      return json({ error: "The assistant has reached this school's limit for this month." }, 429);
    }

    const systemText = admissionsSystem({ ...row, ...(contact || {}) }, "");
    if (provider() === "groq") {
      const result = await groqComplete(
        { model: groqModel(), max_tokens: 1024, messages: [{ role: "system", content: systemText }, ...clean] },
        () => {},
        () => {},
      );
      await admin.rpc("record_ai_usage", {
        target_school: schoolId,
        surface_in: "admissions",
        model_in: `groq:${groqModel()}`,
        input_tokens_in: result.usage?.prompt_tokens ?? 0,
        output_tokens_in: result.usage?.completion_tokens ?? 0,
        user_in: null,
        error_in: null,
      });
      return json({ reply: result.text.trim() });
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: "low" },
      system: systemText,
      messages: clean,
    } as Anthropic.MessageCreateParamsNonStreaming);

    await admin.rpc("record_ai_usage", {
      target_school: schoolId,
      surface_in: "admissions",
      model_in: MODEL,
      input_tokens_in: response.usage?.input_tokens ?? 0,
      output_tokens_in: response.usage?.output_tokens ?? 0,
      user_in: null,
      error_in: null,
    });

    if (response.stop_reason === "refusal") return json({ error: "The assistant could not answer that one." }, 200);

    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("")
      .trim();
    return json({ reply });
  } catch (err) {
    if (schoolId) {
      await admin
        .rpc("record_ai_usage", {
          target_school: schoolId,
          surface_in: "admissions",
          model_in: MODEL,
          user_in: null,
          error_in: (err as Error).message?.slice(0, 500) ?? "unknown",
        })
        .then(() => {}, () => {});
    }
    return json({ error: "The assistant could not answer that one." }, 500);
  }
};

// ---------------------------------------------------------------- assistant

type CatalogEntry = { table: string; view: boolean; columns: string[]; links_to: string[]; has_school_id?: boolean; writable?: boolean };

// The school's own database functions a signed-in person may call (202),
// with the names of their inputs parsed from the signature.
type FunctionEntry = { name: string; args: string; returns: string; reads_only: boolean; about: string; inputs: string[] };
let functionsCache: { at: number; entries: FunctionEntry[] } | null = null;
const loadFunctions = async (admin: SupabaseClient) => {
  if (functionsCache && Date.now() - functionsCache.at < 10 * 60 * 1000) return functionsCache.entries;
  const { data, error } = await admin.rpc("ai_functions");
  if (error) throw new Error(`Could not read the function list: ${error.message}`);
  // deno-lint-ignore no-explicit-any
  const entries = ((data || []) as any[]).map((f) => ({
    ...f,
    inputs: String(f.args || "")
      .split(/,(?![^(]*\))/)
      .map((a: string) => a.trim().replace(/^(IN|INOUT|VARIADIC)\s+/i, "").split(/\s+/)[0])
      .filter(Boolean),
  })) as FunctionEntry[];
  functionsCache = { at: Date.now(), entries };
  return entries;
};

// The catalogue is the live schema, so it is fetched, not typed out, and held
// for ten minutes per warm instance.
let catalogCache: { at: number; entries: CatalogEntry[] } | null = null;
const loadCatalog = async (admin: SupabaseClient) => {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60 * 1000) return catalogCache.entries;
  const { data, error } = await admin.rpc("ai_catalog");
  if (error) throw new Error(`Could not read the catalogue: ${error.message}`);
  catalogCache = { at: Date.now(), entries: (data || []) as CatalogEntry[] };
  return catalogCache.entries;
};

// Anything that names a hidden table or a secret-looking column is refused
// outright, wherever it appears (select list, embed, filter, grouping). Row
// level security is the real guard; this keeps credentials out of the
// model's context even for the people allowed to read them.
const HIDDEN_TABLES = new Set([
  "payment_gateways", "ticket_mailboxes", "push_subscriptions", "attendance_devices",
  "platform_admins", "ai_usage", "original_verifications",
]);
const SECRET_COLUMN = /(secret|token|password|passcode|api_key|private_key|p256dh|refresh|access_key|signing|account_number|rsa_pin|^tin$)/i;

const forbiddenIn = (text: string) => {
  const words = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  return words.find((w) => HIDDEN_TABLES.has(w.toLowerCase()) || SECRET_COLUMN.test(w));
};

// Pages the assistant can send someone to. Only paths, never data: the page
// itself decides what that person may see there.
const APP_PAGES = `
/Dashboard  home
/News  school notices
/Chat  messages; /Chat/<channel id> opens one conversation
/Courses  courses; /Teach  teaching tools (teachers)
/Attendance  attendance
/Reports  report cards and results; /Reports/<student id>
/Fees  a family's own bills and payments (parents, students)
/Bursary  fee structures, invoices, payments (bursary, owner, admin)
/Store  the school store (bursary)
/Accounts  the school's books (bursary, owner)
/Admissions  applications (staff); /AdmissionsWorkspace  the admissions desk
/Support  help desk tickets
/Tutors  tutors
/Profile  the person's own account settings, including notifications
/Payslips  the person's own payslips (staff)
/Payroll  staff pay, PAYE, pension (owner, admin, bursar)
/School  school administration (owner, admin). Sections by ?tab=: people, organogram, students, guardians, academic, levels, classes, admissions, fees, payments, mailboxes, modules, settings
/AuditLog  who changed what (leadership)`.trim();

// What the assistant can DO (phase 2). It never does anything itself: it
// proposes one action with propose_action, the person sees exactly what will
// happen on a card and taps Confirm, and the page then runs the app's own
// function for it, as that person (src/lib/assistantActions.js). Row level
// security and each function's own checks apply exactly as when they click
// the button themselves. The list here is what the model may propose; the
// page runs only names it knows.
const ACTIONS: Record<string, { params: string; required: string[] }> = {
  add_person: { params: "first_name, surname, email, role (teacher|bursar|admissions|principal|admin|student|parent). Creates their login and adds them to the school.", required: ["first_name", "surname", "email", "role"] },
  set_role: { params: "member_id (school_members.id), role", required: ["member_id", "role"] },
  set_active: { params: "member_id (school_members.id), active (true|false)", required: ["member_id", "active"] },
  link_parent: { params: "parent_user_id, student_user_id, relationship? (e.g. Mother)", required: ["parent_user_id", "student_user_id"] },
  place_in_class: { params: "student_user_id, class_id", required: ["student_user_id", "class_id"] },
  post_news: { params: "title, body, audience (everyone|parents|students|staff), pinned?, email? (true also emails it)", required: ["title", "body", "audience"] },
  send_message: { params: "to_user_id, text. A private chat message from this person.", required: ["to_user_id", "text"] },
  create_group_chat: { params: "name, member_user_ids[]", required: ["name", "member_user_ids"] },
  create_course: { params: "code, title, description?, level_year?", required: ["code", "title"] },
  create_exam: { params: "course_id, title, kind (exam|midterm), instructions?, duration_mins?, closes_at? (ISO), publish? (default false = draft), questions[] of { kind (multiple_choice|true_false|short_answer), prompt, points?, options? [{ text, correct }], answer? (short_answer), image_ref? (an attached image for this question) }", required: ["course_id", "title", "questions"] },
  add_exam_questions: { params: "exam_id, questions[] (as in create_exam)", required: ["exam_id", "questions"] },
  create_assignment: { params: "course_id, title, description?, points?, due_at? (ISO)", required: ["course_id", "title"] },
  mark_attendance: { params: "class_id, date (YYYY-MM-DD), time? (HH:MM, default 08:00), absent_student_ids[] (everyone else in the class is marked present)", required: ["class_id", "date"] },
  create_level: { params: "year (number), label (e.g. JS1)", required: ["year", "label"] },
  create_class: { params: "session_id, level_year, name, form_teacher_user_id?", required: ["session_id", "level_year", "name"] },
  create_term: { params: "session_id, name, position (1-3), starts_on, ends_on (YYYY-MM-DD)", required: ["session_id", "name", "position", "starts_on", "ends_on"] },
  set_current_term: { params: "term_id", required: ["term_id"] },
  decide_application: { params: "application_id, status (screening|under_review|document_review|interview_required|offered|waitlisted|deferred|rejected|enrolled), note?, offer_expires? (YYYY-MM-DD), conditions?", required: ["application_id", "status"] },
  schedule_interview: { params: "application_id, when (ISO date-time), location?, meeting_link?, interviewer_user_id?", required: ["application_id", "when"] },
  record_interview_outcome: { params: "interview_id, status (completed|no_show|cancelled), outcome? (e.g. passed|failed), notes?", required: ["interview_id", "status"] },
  verify_document: { params: "document_id (application_documents.id), note?", required: ["document_id"] },
  reject_document: { params: "document_id, reason", required: ["document_id", "reason"] },
  request_correction: { params: "application_id, sections[] (names of form sections), reason", required: ["application_id", "sections", "reason"] },
  record_review: { params: "application_id, recommendation (e.g. offer|reject|interview|waitlist), notes?, academic_score?, interview_score?", required: ["application_id", "recommendation"] },
  message_applicant: { params: "application_id, message. Emails the applicant from the school.", required: ["application_id", "message"] },
  open_applications: { params: "session_id, open (true|false)", required: ["session_id", "open"] },
  raise_invoices: { params: "structure_id. Raises draft bills for everyone the fee structure covers.", required: ["structure_id"] },
  issue_invoice: { params: "invoice_id. Sends a draft bill to the family.", required: ["invoice_id"] },
  record_payment: { params: "invoice_id, amount, method (cash|transfer|pos|cheque), reference?, paid_on? (YYYY-MM-DD)", required: ["invoice_id", "amount", "method"] },
  approve_payment: { params: "payment_id, note?", required: ["payment_id"] },
  reject_payment: { params: "payment_id, note (why; the family is told)", required: ["payment_id", "note"] },
  apply_discount: { params: "invoice_id, rule_id (discount_rules.id; the bill must be a draft)", required: ["invoice_id", "rule_id"] },
  bring_forward_balances: { params: "term_id. Moves unpaid earlier balances onto that term's draft bills.", required: ["term_id"] },
  restock: { params: "product_id, qty, unit_cost", required: ["product_id", "qty", "unit_cost"] },
  create_ticket: { params: "subject, description, priority? (low|medium|high|urgent)", required: ["subject", "description"] },
  prepare_payroll: { params: "month (YYYY-MM). Prepares a draft payroll.", required: ["month"] },
  add_store_item: { params: "name, category (uniform|book|notebook|stationery|casual), size?, supplier?, cost_price, sell_price, trade_discount? (the vendor's discount per item, in money), reorder_level?, opening_stock? (how many are on the shelf now)", required: ["name", "category", "cost_price", "sell_price"] },
  count_stock: { params: "product_id, qty_change (e.g. -2 for two missing, 5 for five found), reason", required: ["product_id", "qty_change", "reason"] },
  set_question_image: { params: "question_id, file_ref (an attached image). Puts the picture on an exam question.", required: ["question_id", "file_ref"] },
  add_application_document: { params: "application_id, file_ref, kind? (e.g. birth_certificate, passport_photo, last_result, transfer_letter, other)", required: ["application_id", "file_ref"] },
  send_file: { params: "to_user_id, file_ref, text? . Sends an attached file in a private chat.", required: ["to_user_id", "file_ref"] },
  add_course_material: { params: "course_id, title, description?, file_ref? , url? . Adds a file or link to a course's materials.", required: ["course_id", "title"] },
  set_school_logo: { params: "file_ref (an attached image). Replaces the school's logo.", required: ["file_ref"] },
  set_profile_photo: { params: "file_ref (an attached image). The person's own profile picture.", required: ["file_ref"] },
  call_function: { params: "function, args {input_name: value}. Runs one of the school's own database functions that changes something (find it with find_functions); use when no named action fits.", required: ["function"] },
  create_record: { params: "table, values {column: value}. For anything the actions above do not cover: adds a row to one of the school's tables, as the person. Use only columns from the catalogue, and only values a column accepts.", required: ["table", "values"] },
  update_record: { params: "table, id, changes {column: value}. Changes one row.", required: ["table", "id", "changes"] },
  delete_record: { params: "table, id, what (a plain description of the row, e.g. 'the JS1 Maths course'). Removes one row for good; propose it only when the person clearly asked to delete it.", required: ["table", "id", "what"] },
};
const ACTION_NAMES = Object.keys(ACTIONS);
const ACTIONS_DOC = ACTION_NAMES.map((n) => `- ${n}: ${ACTIONS[n].params}`).join("\n");

const STATIC_SYSTEM = `You are the Schoolivio assistant, built into Schoolivio, a school management system used by schools in Nigeria and elsewhere. You help the person who is signed in with anything about their school: finding records, answering questions, analysing figures, explaining how Schoolivio works, and pointing them to the right page. You are sharp, accurate and quick, like a very capable colleague who knows the school's data inside out.

# How you see the school's data
You read the school's database through tools, signed in as the person you are talking to. Row level security in the database decides what they may see: staff see what their role allows, a parent sees only their own children, a student only themselves. You never see more than they could see in the app. If a lookup returns nothing, it can mean there is no such data OR that this person is not allowed to see it. Say so plainly; never suggest ways around it.

Tools:
- find_records: rows from one table, with columns, filters, related tables and ordering. Use it for "who", "which", "show me", "find".
- summarize_records: counts, totals, averages, minimums and maximums, grouped by columns and/or by day, week, month or year. Use it for any "how many", "how much", "total", "average", "trend", "compare". Always prefer it over fetching many rows and adding them up yourself.
- show_chart: draws a chart in the chat. Use it when a trend, a comparison or a breakdown is easier seen than read, after you have the numbers.
- open_page: shows a button that opens a page in Schoolivio. Use it whenever the person needs to do something themselves, or would benefit from seeing the full screen.
- web_search: for general knowledge that is not in the school's data (tax rules, exam boards, education policy, how-to questions). Never for questions about the school's own records.

Work like an analyst. Plan the lookups you need, run independent ones together, check that the result answers the question, and look again if it does not. Join through foreign keys (the catalogue lists which tables each table links to) to turn ids into names. Columns named *_id point at the table of that name. People's names are in profiles (first_name, surname; id matches user_id / student_id / guardian_id etc.); their role in a school is school_members.role. Foreign keys are named <table>_<column>_fkey. What a bill owes is in the invoice_balances view (payable, paid, balance, standing); prefer it to adding up invoice_items and payments yourself. A person's own pay is in payslips (user_id = them; only approved months are visible to them; gross, paye, pension_employee, nhf, net, earnings, deductions); payroll_runs.period is the month but staff cannot read runs, so use payslips.created_at or ask. If a profile has no first_name, call them by username or the part of their email before @. Pupils are placed in classes through class_students; parents are linked to children through guardian_students. The current session and term are given below; use them when the person says "this term" or "this session".

Official figures: use run_report with the school's own functions, exactly as the app's pages do, and never recount them yourself:
- Admissions queues (Payment verification, Documents to verify, Screening, Decision, Clearance, Awaiting applicant, Reviews, Interviews): admissions_queues(target_school). One row per application per queue; count by bucket, list by applicant and reference.
- Applications by status: admissions_summary(target_school). One application: application_workspace(target_application, target_school).
- Fees invoiced, collected, still owed, collection rate: collection_summary(target_school, target_term). Only ISSUED bills are owed; drafts are not.
- Who owes and how much: debtors(target_school, target_term).
- A pupil's courses and progress: student_report(target_student, target_school); the reports overview: report_overview(target_school).
If a lookup returns nothing for someone who runs the school (owner, admin), do not say they lack permission: check the right function or table first.

Accuracy rules (these matter more than anything else):
- Every name, number and date you state must come from a tool result in this conversation. If you do not have it, look it up or say you do not know. Never estimate, pad or invent a figure or a person.
- Counts come from summarize_records or the school's own functions, never from counting a list you fetched (lists stop at a limit). Staff by role: summarize_records on school_members with filters school_id = this school and is_active = true, grouped by role (staff are every role except student and parent).
- Admissions queues: report every queue by its name on the page, including those at 0, from admissions_queues buckets: payment = Payment verification, documents = Documents to verify, screening = Screening, decision = Decision queue, clearance = Clearance in progress, action = Awaiting applicant, review = Reviews in progress, interview = Interviews scheduled.
- Who owes: only the people and amounts debtors() returns, largest first.
- Never mention table, column or function names to the person (no "admissions_queues", "store_sales"...). Say what the page calls it.
- Money in the school's own currency (given below) with commas, e.g. 10,228,000 with its symbol, never spaces.

# Doing things for the person
You can also act, through propose_action. You never act on your own: you propose ONE action, the person sees a card saying exactly what will happen and taps Confirm or Cancel, and the app then does it as them, with their permissions. So:
- Look up every id first (find_records), then propose with real ids and a plain one-sentence summary of the effect ("Post 'PTA meeting on Friday' to all parents and email it").
- One action per propose_action call. For several steps, propose the first; after the person confirms, you will see "[Done] ..." or "[Failed] ..." and can propose the next.
- After proposing, stop and let them decide. Never say it is done until you see [Done].
- If they only asked a question, answer it; do not propose actions they did not ask for.
- For anything else the app does (results sheets, voiding a sale, recalculating an exam, waiving a document...), find_functions finds the school's own database function for it: run_report runs the read-only ones straight away; propose call_function for the ones that change something.
- Attached files appear in the person's message as [Attached: file-1 name (type, size)]. Use those refs (file_ref / image_ref) in actions to put them where they belong: an exam question's picture, an application's documents, a chat message, course materials, the logo, a profile photo. Never invent a ref.
- Prefer a named action when one fits; it runs the app's own steps (notifications, stock records, the books). Use create_record / update_record / delete_record for anything else in the school's data, with columns and allowed values from the catalogue.
- Never refuse something the person is allowed to do: if no named action fits, use the record actions. The database still checks their permission when they confirm.
Actions and their params:
${ACTIONS_DOC}

# How to answer
- Lead with the answer. Short sentences. No preamble, no restating the question.
- Money in the school's currency with thousands separators, e.g. 117,500 with its symbol. Dates like 3 Oct 2026.
- Lists of records as a compact markdown table, most useful columns only, at most about 20 rows; say how many there are in total if more.
- Never show raw ids (uuids) to the person. Use names, references and dates.
- Charts and page buttons appear by themselves under your answer. Never write image placeholders, chart markdown or links for them, and never write a tool call or tag as text: call the tool.
- Look before you answer. Never say someone lacks permission without running the lookup first; answer from what it returns.
- Only offer pages this person's role can open (see the roles next to each page below).
- A person's role in this school is school_members.role, not profiles.role.
- When the data is ambiguous (two pupils with the same name, a class that does not exist), say what you found and ask one precise question.
- If you are not sure a figure is right, say what it is based on.
- Privacy: only discuss the data this person can see. Do not repeat phone numbers, emails or addresses unless they asked for them.
- Students: help them learn. Explain, give hints, check their reasoning, but do not write their graded work for them, and never reveal exam or test answers.
- Stay on the school, education and the person's work. Politely decline anything unrelated to that.

# Pages in Schoolivio (for open_page)
${APP_PAGES}

# The school's tables
Each entry: table, columns as name:type, and the tables it links to. Views are marked. Only these may be used.
`;

const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "not_is"] as const;

const filterSchema = {
  type: "array",
  description: "Conditions, all of which must hold. Use a dotted column (e.g. classes.level_year) to filter on a related table named in select.",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      op: { type: "string", enum: FILTER_OPS },
      value: {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
          { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
        ],
        description: "For in: an array. For is / not_is: null, true or false. For like / ilike: a pattern with %.",
      },
    },
    required: ["column", "op"],
  },
};

const TOOLS = [
  {
    name: "find_records",
    description:
      "Fetch rows from one table of the school's database, as the signed-in person (row level security applies). Returns the rows, how many matched in total, and whether the list was cut short.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "A table or view from the catalogue." },
        select: {
          type: "string",
          description:
            "Columns in PostgREST syntax. Related tables through foreign keys, naming the key when a table links to the same table twice: e.g. \"reference, status, student:profiles!invoices_student_id_fkey(first_name, surname), classes(name)\". Views cannot embed; look names up in a second call with an in filter. Default *.",
        },
        filters: filterSchema,
        order: {
          type: "array",
          items: {
            type: "object",
            properties: { column: { type: "string" }, descending: { type: "boolean" } },
            required: ["column"],
          },
        },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
      },
      required: ["table"],
    },
    eager_input_streaming: true,
  },
  {
    name: "summarize_records",
    description:
      "Count, total, average, min or max over a table's rows (up to 20,000), grouped by columns and/or a date bucket, as the signed-in person. Returns one row per group.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        filters: filterSchema,
        group_by: { type: "array", items: { type: "string" }, maxItems: 3, description: "Columns of this table to group by." },
        date_bucket: {
          type: "object",
          properties: {
            column: { type: "string" },
            unit: { type: "string", enum: ["day", "week", "month", "year"] },
          },
          required: ["column", "unit"],
        },
        metrics: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              fn: { type: "string", enum: ["count", "count_distinct", "sum", "avg", "min", "max"] },
              column: { type: "string", description: "Required except for count." },
            },
            required: ["fn"],
          },
        },
        order_by_metric: { type: "integer", description: "Index of the metric to sort groups by, largest first." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Most groups to return. Default 100." },
      },
      required: ["table", "metrics"],
    },
    eager_input_streaming: true,
  },
  {
    name: "show_chart",
    description: "Draw a chart in the conversation from numbers you already have.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bar", "line", "pie"] },
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" }, maxItems: 60 },
        series: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } },
            required: ["name", "values"],
          },
        },
        unit: { type: "string", description: "The school's currency symbol (e.g. ₦, $, KSh) or %, shown with the values." },
      },
      required: ["type", "title", "labels", "series"],
    },
    eager_input_streaming: true,
  },
  {
    name: "open_page",
    description: "Show a button that opens a page in Schoolivio.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "A path from the page list, e.g. /Bursary or /School?tab=fees." },
        label: { type: "string", description: "Button text, e.g. Open Bursary." },
      },
      required: ["path", "label"],
    },
    eager_input_streaming: true,
  },
  {
    name: "find_functions",
    description: "Search the school's own database functions by what they do (e.g. 'result sheet', 'void sale', 'report'). Returns names, inputs, what they return, and whether they only read.",
    input_schema: { type: "object", properties: { search: { type: "string" } }, required: ["search"] },
    eager_input_streaming: true,
  },
  {
    name: "run_report",
    description: "Run a read-only database function (reads_only: true from find_functions) as the person, e.g. a student's report, debtors, a collection summary, account balances.",
    input_schema: { type: "object", properties: { function: { type: "string" }, args: { type: "object" } }, required: ["function"] },
    eager_input_streaming: true,
  },
  {
    name: "propose_action",
    description: "Propose one action for the person to confirm. Nothing happens until they tap Confirm; the app then runs it as them.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ACTION_NAMES },
        params: { type: "object", description: "The action's params, as listed in the prompt, with real ids from lookups." },
        summary: { type: "string", description: "One plain sentence saying exactly what will happen." },
      },
      required: ["action", "params", "summary"],
    },
    eager_input_streaming: true,
  },
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
];

const STATUS: Record<string, (input: Record<string, unknown>) => string> = {
  find_records: (i) => `Looking in ${String(i.table || "the records").replace(/_/g, " ")}`,
  summarize_records: (i) => `Working out figures from ${String(i.table || "the records").replace(/_/g, " ")}`,
  show_chart: () => "Drawing a chart",
  describe_tables: () => "Checking where that is kept",
  open_page: () => "Finding the page",
  propose_action: () => "Preparing that for you to confirm",
  describe_action: () => "Checking how to do that",
  find_functions: (i) => `Looking for how to ${String(i.search || "do that")}`,
  run_report: (i) => `Running ${String(i.function || "the report").replace(/_/g, " ")}`,
};

class ToolError extends Error {}

// deno-lint-ignore no-explicit-any
const applyFilters = (query: any, filters: unknown) => {
  if (filters == null) return query;
  if (!Array.isArray(filters)) throw new ToolError("filters must be a list.");
  for (const f of filters) {
    const column = String(f?.column || "");
    const op = String(f?.op || "");
    if (!column || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(column)) throw new ToolError(`Bad filter column: ${column}`);
    if (forbiddenIn(column)) throw new ToolError(`That column is not available: ${column}`);
    const value = f?.value;
    switch (op) {
      case "eq": case "neq": case "gt": case "gte": case "lt": case "lte": case "like": case "ilike":
        query = query[op](column, value);
        break;
      case "in":
        if (!Array.isArray(value)) throw new ToolError("in needs an array value.");
        query = query.in(column, value.slice(0, 500));
        break;
      case "is":
        query = query.is(column, value ?? null);
        break;
      case "not_is":
        query = query.not(column, "is", value ?? null);
        break;
      default:
        throw new ToolError(`Unknown filter op: ${op}`);
    }
  }
  return query;
};

const checkTable = (table: unknown, known: Set<string>) => {
  const name = String(table || "");
  if (!known.has(name)) throw new ToolError(`No such table in the catalogue: ${name}`);
  return name;
};

const clipJson = (value: unknown, max = 60_000) => {
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}… [cut short: ask for fewer columns or rows]` : text;
};

// deno-lint-ignore no-explicit-any
const findRecords = async (caller: SupabaseClient, known: Set<string>, input: any, maxChars = 60_000) => {
  const table = checkTable(input.table, known);
  const select = String(input.select || "*").slice(0, 2000);
  const bad = forbiddenIn(select);
  if (bad) throw new ToolError(`Not available: ${bad}`);
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  let query = caller.from(table).select(select, { count: "exact" });
  query = applyFilters(query, input.filters);
  for (const o of Array.isArray(input.order) ? input.order : []) {
    const column = String(o?.column || "");
    if (!column || forbiddenIn(column)) throw new ToolError(`Bad order column: ${column}`);
    const [first, ...rest] = column.split(".");
    query = rest.length
      ? query.order(rest.join("."), { ascending: !o.descending, referencedTable: first })
      : query.order(column, { ascending: !o.descending });
  }
  const { data, error, count } = await query.range(0, limit - 1);
  if (error) throw new ToolError(error.message);
  const rows = data || [];
  return clipJson({ rows, returned: rows.length, total_matching: count ?? rows.length, cut_short: (count ?? 0) > rows.length }, maxChars);
};

const bucketOf = (value: unknown, unit: string) => {
  if (!value) return "(none)";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const iso = d.toISOString();
  if (unit === "year") return iso.slice(0, 4);
  if (unit === "month") return iso.slice(0, 7);
  if (unit === "day") return iso.slice(0, 10);
  // ISO week starts Monday.
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return `week of ${monday.toISOString().slice(0, 10)}`;
};

// deno-lint-ignore no-explicit-any
const summarizeRecords = async (caller: SupabaseClient, known: Set<string>, input: any, maxChars = 60_000) => {
  const table = checkTable(input.table, known);
  const groupBy: string[] = (Array.isArray(input.group_by) ? input.group_by : []).map(String).slice(0, 3);
  const metrics: { fn: string; column?: string }[] = Array.isArray(input.metrics) ? input.metrics.slice(0, 8) : [];
  if (!metrics.length) throw new ToolError("Give at least one metric.");
  const bucket = input.date_bucket?.column ? { column: String(input.date_bucket.column), unit: String(input.date_bucket.unit || "month") } : null;

  const needed = new Set<string>(groupBy);
  if (bucket) needed.add(bucket.column);
  for (const m of metrics) {
    if (m.fn !== "count") {
      if (!m.column) throw new ToolError(`${m.fn} needs a column.`);
      needed.add(String(m.column));
    }
  }
  for (const c of needed) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c) || forbiddenIn(c)) throw new ToolError(`Not available: ${c}`);
  }
  const select = needed.size ? [...needed].join(",") : "*";

  const PAGE = 1000;
  const MAX = 20_000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    let query = caller.from(table).select(select);
    query = applyFilters(query, input.filters);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new ToolError(error.message);
    rows.push(...((data || []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }

  const groups = new Map<string, { key: Record<string, unknown>; acc: { n: number; sum: number; nums: number; min: unknown; max: unknown; set: Set<string> }[] }>();
  for (const row of rows) {
    const key: Record<string, unknown> = {};
    for (const g of groupBy) key[g] = row[g] ?? null;
    if (bucket) key[`${bucket.column}_${bucket.unit}`] = bucketOf(row[bucket.column], bucket.unit);
    const id = JSON.stringify(key);
    let group = groups.get(id);
    if (!group) {
      group = { key, acc: metrics.map(() => ({ n: 0, sum: 0, nums: 0, min: null, max: null, set: new Set<string>() })) };
      groups.set(id, group);
    }
    metrics.forEach((m, i) => {
      const a = group!.acc[i];
      a.n += 1;
      if (m.fn === "count") return;
      const v = row[String(m.column)];
      if (v == null) return;
      if (m.fn === "count_distinct") { a.set.add(JSON.stringify(v)); return; }
      const num = Number(v);
      if (!Number.isNaN(num) && (m.fn === "sum" || m.fn === "avg")) { a.sum += num; a.nums += 1; }
      if (m.fn === "min" && (a.min == null || (v as number) < (a.min as number))) a.min = v;
      if (m.fn === "max" && (a.max == null || (v as number) > (a.max as number))) a.max = v;
    });
  }

  const label = (m: { fn: string; column?: string }) => (m.fn === "count" ? "count" : `${m.fn}_${m.column}`);
  let out = [...groups.values()].map((g) => {
    const r: Record<string, unknown> = { ...g.key };
    metrics.forEach((m, i) => {
      const a = g.acc[i];
      r[label(m)] =
        m.fn === "count" ? a.n
        : m.fn === "count_distinct" ? a.set.size
        : m.fn === "sum" ? Math.round(a.sum * 100) / 100
        : m.fn === "avg" ? (a.nums ? Math.round((a.sum / a.nums) * 100) / 100 : null)
        : m.fn === "min" ? a.min
        : a.max;
    });
    return r;
  });
  const sortIndex = Number.isInteger(input.order_by_metric) ? input.order_by_metric : null;
  if (sortIndex != null && metrics[sortIndex]) {
    const k = label(metrics[sortIndex]);
    out.sort((a, b) => Number(b[k] ?? -Infinity) - Number(a[k] ?? -Infinity));
  } else if (bucket) {
    const k = `${bucket.column}_${bucket.unit}`;
    out.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
  }
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 100));
  const totalGroups = out.length;
  out = out.slice(0, limit);
  return clipJson({
    groups: out,
    group_count: totalGroups,
    rows_scanned: rows.length,
    scan_cut_short: rows.length >= MAX,
  }, maxChars);
};

const assistant = async (
  req: Request,
  admin: SupabaseClient,
  body: Record<string, unknown>,
  apiKey: string,
) => {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in to use the assistant." }, 401);

  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    db: { schema: "classroom" },
    auth: { persistSession: false },
  });
  // Asked of the database, which checks the token's signature as every page
  // does. The Auth server's /user answered "not signed in" for a session it
  // had retired while the token was still valid and the app kept working.
  const { data: uid, error: whoError } = await caller.rpc("ai_whoami");
  if (whoError || !uid) return json({ error: "Your sign-in has expired. Refresh the page and sign in again." }, 401);
  const { data: account } = await admin.auth.admin.getUserById(String(uid));
  const user = account?.user || { id: String(uid), email: "", user_metadata: {} };

  const schoolId = String(body.schoolId || "");
  if (!schoolId) return json({ error: "Missing school." }, 400);

  // Membership read as the caller: if they are not in this school, row level
  // security returns nothing and the request stops here.
  const { data: membership } = await caller
    .from("school_members")
    .select("role, is_active")
    .eq("school_id", schoolId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership?.is_active) return json({ error: "You are not a member of this school." }, 403);

  const { data: school } = await admin
    .from("schools")
    .select("id, name, slug, currency, ai_token_limit, disabled_modules")
    .eq("id", schoolId)
    .maybeSingle();
  if (!school) return json({ error: "Unknown school." }, 404);

  const limit = Number(school.ai_token_limit ?? 0);
  const { data: used } = await admin.rpc("ai_tokens_this_month", { target_school: schoolId });
  if (limit <= 0) return json({ error: "The assistant is switched off for this school." }, 403);
  if (Number(used || 0) >= limit) {
    return json({ error: "The assistant has reached this school's limit for this month. It resets on the 1st." }, 429);
  }

  const turns = cleanTurns(body.messages, 30, 8000);
  // Pictures and PDFs attached to the latest question, for a model that can
  // see them. Checked here, never trusted: kinds, count and size are capped.
  const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
  const media = (Array.isArray(body.media) ? body.media : [])
    // deno-lint-ignore no-explicit-any
    .filter((m: any) => ALLOWED_MEDIA.has(String(m?.media_type)) && typeof m?.data === "string" && m.data.length < 7_000_000)
    .slice(0, 5)
    // deno-lint-ignore no-explicit-any
    .map((m: any) => ({ media_type: String(m.media_type), data: String(m.data), ref: String(m.ref || "") }));
  if (!turns.length || turns[turns.length - 1].role !== "user") return json({ error: "Missing question." }, 400);

  const [catalog, sessionRow, termRow] = await Promise.all([
    loadCatalog(admin),
    caller.from("sessions").select("name, starts_on, ends_on").eq("school_id", schoolId).eq("is_current", true).maybeSingle(),
    caller.from("terms").select("name, starts_on, ends_on").eq("school_id", schoolId).eq("is_current", true).maybeSingle(),
  ]);
  const known = new Set(catalog.map((c) => c.table));

  const meta = (user.user_metadata || {}) as Record<string, string>;
  const name = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || meta.full_name || user.email || "this person";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
  const context = [
    `# Right now`,
    `School: ${school.name} (school_id ${school.id}). Currency: ${school.currency || "NGN"}.`,
    `Signed in: ${name}, role ${membership.role} (user_id ${user.id}). Address them by first name only if natural.`,
    `Today: ${today}.`,
    `Current session: ${sessionRow.data ? `${sessionRow.data.name} (${sessionRow.data.starts_on} to ${sessionRow.data.ends_on})` : "none set"}.`,
    `Current term: ${termRow.data ? `${termRow.data.name} (${termRow.data.starts_on} to ${termRow.data.ends_on})` : "none set"}.`,
    `Always filter by school_id = ${school.id} on tables that have it; a person can belong to more than one school.`,
    `Switched off at this school: ${(school.disabled_modules || []).length ? (school.disabled_modules || []).join(", ") : "nothing"}. If asked about a switched-off part (e.g. the store), say it is switched off and an owner or admin can turn it on under School > Modules; do not suggest entering data into it.`,
  ].join("\n");

  // Tools, then the static prompt with the catalogue (the same for every
  // school, so it caches across all of them), then this person's context,
  // which changes and so sits after the cache breakpoint.
  const system = [
    { type: "text", text: STATIC_SYSTEM + JSON.stringify(catalog), cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: context },
  ];

  const useGroq = provider() === "groq";
  const modelName = useGroq ? `groq:${groqModel()}` : MODEL;
  const anthropic = useGroq ? null : new Anthropic({ apiKey: apiKey! });
  const encoder = new TextEncoder();

  // One tool call, the same for either AI. Returns what goes back to the
  // model; events for the page (charts, buttons) are sent from here.
  // deno-lint-ignore no-explicit-any
  const executeTool = async (name: string, args: any, send: (e: Record<string, unknown>) => void) => {
    if (!args || typeof args !== "object") return { error: true, content: "INVALID_JSON: send the arguments again as a complete object." };
    send({ type: "status", text: (STATUS[name] || (() => "Working"))(args) });
    try {
      if (name === "describe_tables") {
        const wanted = new Set((Array.isArray(args.tables) ? args.tables : []).map(String).slice(0, 8));
        const found = catalog.filter((c) => wanted.has(c.table));
        if (!found.length) throw new ToolError("None of those tables exist. Pick names from the table list.");
        return { error: false, content: JSON.stringify(found) };
      }
      if (name === "find_records") return { error: false, content: await findRecords(caller, known, useGroq ? { ...args, limit: Math.min(Number(args.limit) || 20, 40) } : args, useGroq ? 3_500 : 60_000) };
      if (name === "summarize_records") return { error: false, content: await summarizeRecords(caller, known, useGroq ? { ...args, limit: Math.min(Number(args.limit) || 40, 60) } : args, useGroq ? 3_500 : 60_000) };
      if (name === "show_chart") {
        const labels = Array.isArray(args.labels) ? args.labels.slice(0, 60).map(String) : [];
        const series = Array.isArray(args.series)
          // deno-lint-ignore no-explicit-any
          ? args.series.slice(0, 4).map((s: any) => ({ name: String(s?.name || ""), values: (Array.isArray(s?.values) ? s.values : []).slice(0, 60).map(Number) }))
          : [];
        if (!labels.length || !series.length) throw new ToolError("A chart needs labels and at least one series.");
        send({ type: "chart", chart: { type: ["bar", "line", "pie"].includes(args.type) ? args.type : "bar", title: String(args.title || ""), labels, series, unit: args.unit ? String(args.unit) : "" } });
        return { error: false, content: "Chart shown to the person." };
      }
      if (name === "describe_action") {
        const spec = ACTIONS[String(args.action || "")];
        if (!spec) throw new ToolError(`No such action. Actions: ${ACTION_NAMES.join(", ")}`);
        return { error: false, content: `${args.action}: ${spec.params}. Required: ${spec.required.join(", ")}.` };
      }
      if (name === "find_functions") {
        const words = String(args.search || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
        const fns = await loadFunctions(admin);
        const scored = fns
          .map((f) => {
            const hay = `${f.name.replace(/_/g, " ")} ${f.about} ${f.args}`.toLowerCase();
            return { f, score: words.reduce((t, w) => t + (hay.includes(w) ? 1 : 0), 0) };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
          .map(({ f }) => ({ name: f.name, inputs: f.args, returns: f.returns.slice(0, 160), reads_only: f.reads_only, about: f.about || undefined }));
        return { error: false, content: scored.length ? JSON.stringify(scored) : "Nothing matched. Try other words, or use the record actions." };
      }
      if (name === "run_report") {
        const fns = await loadFunctions(admin);
        const f = fns.find((x) => x.name === String(args.function || ""));
        if (!f) throw new ToolError("No such function. Use find_functions first.");
        if (!f.reads_only) throw new ToolError(`${f.name} changes things, so propose it with call_function instead.`);
        const callArgs = args.args && typeof args.args === "object" ? args.args : {};
        const unknown = Object.keys(callArgs).filter((k) => !f.inputs.includes(k));
        if (unknown.length) throw new ToolError(`${f.name} takes: ${f.args || "nothing"}. Not: ${unknown.join(", ")}.`);
        const { data, error } = await caller.rpc(f.name, callArgs);
        if (error) throw new ToolError(error.message);
        // The admissions page's queues, counted and named exactly as the page
        // shows them (AdmissionsQueues.jsx), with zeros and the total. Left
        // to count raw rows, a model reported "Awaiting applicant 0" when the
        // page showed 1.
        if (f.name === "admissions_queues" && Array.isArray(data)) {
          const LABELS: Record<string, string> = {
            payment: "Payment verification", documents: "Documents to verify", screening: "Screening",
            decision: "Decision queue", clearance: "Clearance in progress", action: "Awaiting applicant",
            review: "Reviews in progress", interview: "Interviews scheduled",
          };
          const { data: summary } = await caller.rpc("admissions_summary", { target_school: callArgs.target_school || school.id });
          // deno-lint-ignore no-explicit-any
          const total = Array.isArray(summary) ? summary.reduce((t: number, r: any) => t + Number(r.count || 0), 0) : null;
          const queues = Object.entries(LABELS).map(([bucket, label]) => {
            // deno-lint-ignore no-explicit-any
            const rows = data.filter((r: any) => r.bucket === bucket);
            // deno-lint-ignore no-explicit-any
            return { queue: label, count: rows.length, applications: rows.map((r: any) => `${r.applicant} (${r.reference})`) };
          });
          return { error: false, content: clipJson({ queues, all_applications: total, note: "Report each queue by this exact name and count, including zeros, then All applications." }, useGroq ? 3_500 : 60_000) };
        }
        return { error: false, content: clipJson(data, useGroq ? 3_500 : 60_000) };
      }
      if (name === "propose_action") {
        const action = String(args.action || "");
        const spec = ACTIONS[action];
        if (!spec) throw new ToolError(`Unknown action ${action}. Use one from the list.`);
        // "email?" in the list means optional; a model sometimes copies the
        // question mark into the name.
        const params = Object.fromEntries(
          Object.entries(args.params && typeof args.params === "object" ? args.params : {}).map(([k, v]) => [k.replace(/\?$/, ""), v]),
        );
        const missing = spec.required.filter((k) => params[k] === undefined || params[k] === null || params[k] === "");
        if (missing.length) throw new ToolError(`Missing ${missing.join(", ")} for ${action}. Look them up and propose again.`);
        if (action === "call_function") {
          const fns = await loadFunctions(admin);
          const f = fns.find((x) => x.name === String(params.function || ""));
          if (!f) throw new ToolError("No such function. Use find_functions first.");
          if (f.reads_only) throw new ToolError(`${f.name} only reads; use run_report for it.`);
          const callArgs = params.args && typeof params.args === "object" ? params.args : {};
          const unknown = Object.keys(callArgs).filter((k) => !f.inputs.includes(k));
          if (unknown.length) throw new ToolError(`${f.name} takes: ${f.args || "nothing"}. Not: ${unknown.join(", ")}.`);
          params.args = callArgs;
        }
        if (["create_record", "update_record", "delete_record"].includes(action)) {
          const entry = catalog.find((c) => c.table === String(params.table || ""));
          // deno-lint-ignore no-explicit-any
          if (!entry || entry.view || (entry as any).writable === false) throw new ToolError(`${params.table} is not a table that can be changed. Pick one from the catalogue.`);
          const names = new Set(entry.columns.map((c) => c.split(":")[0]));
          const data = action === "create_record" ? params.values : action === "update_record" ? params.changes : {};
          if (action !== "delete_record") {
            if (!data || typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length) throw new ToolError("Give the column values as an object.");
            const unknown = Object.keys(data).filter((k) => !names.has(k) || SECRET_COLUMN.test(k));
            if (unknown.length) throw new ToolError(`Not columns of ${entry.table}: ${unknown.join(", ")}. Check describe_tables.`);
            for (const k of ["id", "created_at", "updated_at"]) delete (data as Record<string, unknown>)[k];
          }
          // Always this school, never another.
          // deno-lint-ignore no-explicit-any
          if ((entry as any).has_school_id) {
            if (action === "create_record") (data as Record<string, unknown>).school_id = school.id;
            if (action === "update_record") delete (data as Record<string, unknown>).school_id;
            params.scope_school = true;
          }
        }
        const summary = String(args.summary || "").slice(0, 400);
        if (!summary) throw new ToolError("Add a one-sentence summary of what will happen.");
        send({ type: "action", id: crypto.randomUUID(), action, params, summary });
        return { error: false, content: "Shown to the person as a card with Confirm and Cancel. Stop here and wait: their next message will say [Done] or [Failed] with the result." };
      }
      if (name === "open_page") {
        const path = String(args.path || "");
        if (!path.startsWith("/") || path.startsWith("//")) throw new ToolError("path must be a Schoolivio path starting with /.");
        send({ type: "link", path, label: String(args.label || "Open").slice(0, 60) });
        return { error: false, content: "Button shown to the person." };
      }
      throw new ToolError(`Unknown tool: ${name}`);
    } catch (err) {
      return { error: true, content: err instanceof ToolError ? err.message : "That lookup failed." };
    }
  };

  // Groq: every token counts against a small per-minute allowance, and every
  // round resends the whole prompt, so this is the short version: brief
  // rules, the tables most questions need built in (so no lookup round
  // first), other tables by name only. Row level security applies exactly
  // as above: the tools are the same functions, run as the caller.
  const filterItem = {
    type: "object",
    properties: {
      column: { type: "string" },
      op: { type: "string", enum: FILTER_OPS },
      value: { description: "array for in; null/true/false for is" },
    },
    required: ["column", "op"],
  };
  const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });
  const groqTools = [
    fn("find_records", "Rows from one table (max 50). PostgREST select, e.g. \"reference, balance, student:profiles!invoice_balances_student_id_fkey(first_name,surname)\".", {
      table: { type: "string" },
      select: { type: "string" },
      filters: { type: "array", items: filterItem },
      order: { type: "array", items: { type: "object", properties: { column: { type: "string" }, descending: { type: "boolean" } }, required: ["column"] } },
      limit: { type: "integer" },
    }, ["table"]),
    fn("summarize_records", "count/count_distinct/sum/avg/min/max over a table, grouped by columns and/or a date bucket (day/week/month/year). Use for any how many / total / trend.", {
      table: { type: "string" },
      filters: { type: "array", items: filterItem },
      group_by: { type: "array", items: { type: "string" } },
      date_bucket: { type: "object", properties: { column: { type: "string" }, unit: { type: "string", enum: ["day", "week", "month", "year"] } }, required: ["column", "unit"] },
      metrics: { type: "array", items: { type: "object", properties: { fn: { type: "string", enum: ["count", "count_distinct", "sum", "avg", "min", "max"] }, column: { type: "string" } }, required: ["fn"] } },
      order_by_metric: { type: "integer" },
    }, ["table", "metrics"]),
    fn("describe_tables", "Columns of tables not listed with columns below.", { tables: { type: "array", items: { type: "string" } } }, ["tables"]),
    fn("show_chart", "Draw a chart from numbers you have.", {
      type: { type: "string", enum: ["bar", "line", "pie"] },
      title: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } },
      unit: { type: "string" },
    }, ["type", "title", "labels", "series"]),
    fn("open_page", "Show a button opening a Schoolivio page.", { path: { type: "string" }, label: { type: "string" } }, ["path", "label"]),
    fn("describe_action", "The params an action takes.", { action: { type: "string", enum: ACTION_NAMES } }, ["action"]),
    fn("find_functions", "Search the school's database functions by what they do.", { search: { type: "string" } }, ["search"]),
    fn("run_report", "Run a read-only function (reads_only: true) as the person.", { function: { type: "string" }, args: { type: "object" } }, ["function"]),
    fn("propose_action", "Propose ONE action; the person confirms before anything happens.", {
      action: { type: "string", enum: ACTION_NAMES },
      params: { type: "object" },
      summary: { type: "string" },
    }, ["action", "params", "summary"]),
  ];

  // The tables behind most questions, with their columns (no types).
  const CORE = ["profiles", "school_members", "classes", "class_students", "guardian_students", "terms", "invoice_balances", "payments", "payslips"];
  const core = catalog
    .filter((c) => CORE.includes(c.table))
    .map((c) => `${c.table}(${c.columns.map((col) => col.split(":")[0]).join(",")})`)
    .join("\n");
  const others = catalog.filter((c) => !CORE.includes(c.table)).map((c) => c.table).join(", ");

  const groqSystem = `You are the Schoolivio assistant inside a school management app. Answer the signed-in person's questions about their school using the tools. You read the database AS them: row level security limits what you see, so an empty result may mean no data or no permission; say so, never suggest workarounds.

Rules:
- Use tools before answering data questions. Run independent lookups together in one turn. Prefer summarize_records for counts/totals/trends.
- Resolve ids to names (profiles.first_name, surname via *_id foreign keys named <table>_<column>_fkey). Never show uuids.
- A person's role in the school is school_members.role. Balances owed: invoice_balances (payable, paid, balance, standing).
- Official figures: use run_report with the school's own functions, exactly as the app's pages do, and never recount them yourself:
  - Admissions queues (Payment verification, Documents to verify, Screening, Decision, Clearance, Awaiting applicant, Reviews, Interviews): admissions_queues(target_school). One row per application per queue; count by bucket, list by applicant and reference.
  - Applications by status: admissions_summary(target_school). One application: application_workspace(target_application, target_school).
  - Fees invoiced, collected, still owed, collection rate: collection_summary(target_school, target_term). Only ISSUED bills are owed; drafts are not.
  - Who owes and how much: debtors(target_school, target_term).
  - A pupil's courses and progress: student_report(target_student, target_school); the reports overview: report_overview(target_school).
  If a lookup returns nothing for someone who runs the school (owner, admin), do not say they lack permission: check the right function or table first.
- A person's own pay: payslips where user_id = their user_id (only approved months show; net, gross, paye, pension_employee, nhf). Never look for salaries anywhere else.
- No first_name? Use username, or the part of the email before @.
- Only offer pages this person's role can open. Charts: unit is a currency symbol or %, or empty.
- Attached files show as [Attached: file-1 name (type)]; pass that ref as file_ref / image_ref in actions (question picture, application document, chat file, course material, logo, profile photo). You cannot see the files' contents on this plan; if asked what an image shows, say the free AI cannot view images and ask them to describe it.
- To DO something (add a person, post news, set an exam, admissions steps, bills, payments, store items...), look up the ids, then call propose_action once with a one-sentence summary. If no named action fits, find_functions for the school's own function (run_report if it only reads, else propose call_function), or use create_record / update_record / delete_record on the table (describe_tables first); never refuse what the person may do. The person confirms on a card; then stop and wait for "[Done]" or "[Failed]". Never claim it is done before that. Action names: ${ACTION_NAMES.join(", ")}. Call describe_action for an action's params before proposing it.
- Accuracy rules (these matter more than anything else):
  - Every name, number and date you state must come from a tool result in this conversation. If you do not have it, look it up or say you do not know. Never estimate, pad or invent a figure or a person.
  - Counts come from summarize_records or the school's own functions, never from counting a list you fetched (lists stop at a limit). Staff by role: summarize_records on school_members with filters school_id = this school and is_active = true, grouped by role (staff are every role except student and parent).
  - Admissions queues: report every queue by its name on the page, including those at 0, from admissions_queues buckets: payment = Payment verification, documents = Documents to verify, screening = Screening, decision = Decision queue, clearance = Clearance in progress, action = Awaiting applicant, review = Reviews in progress, interview = Interviews scheduled.
  - Who owes: only the people and amounts debtors() returns, largest first.
  - Never mention table, column or function names to the person (no "admissions_queues", "store_sales"...). Say what the page calls it.
  - Money in the school's own currency (given below) with commas, e.g. 10,228,000 with its symbol, never spaces.
- Answer first, briefly. Money in the school's currency, like 117,500 with its symbol; dates like 3 Oct 2026. Lists as a short markdown table.
- Charts and buttons appear by themselves: never write chart markdown, image placeholders or tool calls as text.
- Students: coach, don't do graded work; never reveal exam answers. Stay on school topics.

Pages: /Dashboard /News /Chat /Courses /Teach /Attendance /Reports /Fees(family bills) /Payslips(own payslips, staff) /Bursary /Store /Accounts /Payroll (these four: owner, admin, bursar only) /Admissions /Support /Profile /School?tab=people|students|guardians|academic|levels|classes|fees|settings (owner/admin only)

Tables with columns:
${core}
Other tables (use describe_tables first): ${others}

${context}`;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The browser went away; the loop below notices on its next send.
        }
      };

      let input = 0;
      let output = 0;
      let failure: string | null = null;
      let useFallbacks = true;
      let answeredBy = modelName;
      // deno-lint-ignore no-explicit-any
      const messages: any[] = turns.map((t) => ({ role: t.role, content: t.content }));
      if (media.length && messages.length && messages[messages.length - 1].role === "user") {
        const last = messages[messages.length - 1];
        last.content = [
          ...media.map((m) =>
            m.media_type === "application/pdf"
              ? { type: "document", source: { type: "base64", media_type: m.media_type, data: m.data }, title: m.ref || undefined }
              : { type: "image", source: { type: "base64", media_type: m.media_type, data: m.data } }
          ),
          { type: "text", text: last.content },
        ];
      }

      try {
        if (useGroq) {
          // deno-lint-ignore no-explicit-any
          const chat: any[] = [
            { role: "system", content: groqSystem },
            ...turns.slice(-6).map((t) => ({ role: t.role, content: t.content.slice(0, 1500) })),
          ];
          let nudged = false;
          // The platform stops a request at 150 seconds; answer well before.
          const deadline = Date.now() + 100_000;
          for (let round = 0; round < 10; round++) {
            if (req.signal.aborted) break;
            const result = await groqComplete(
              { max_tokens: 2048, temperature: 0.2, tools: groqTools, tool_choice: "auto", parallel_tool_calls: true, messages: chat },
              (t) => send({ type: "text", text: t }),
              (seconds) => send({ type: "status", text: `Free AI is busy, answering in about ${seconds}s` }),
              deadline,
            );
            answeredBy = result.model || answeredBy;
            input += result.usage?.prompt_tokens || 0;
            output += result.usage?.completion_tokens || 0;
            if (!result.calls.length) {
              if (result.finish === "length") send({ type: "text", text: "\n\n(That answer was cut short. Ask me to continue.)" });
              // Smaller open models sometimes stop with nothing to say after
              // an empty lookup. Once, ask for the answer from what it found.
              if (!result.text.trim() && !nudged) {
                nudged = true;
                chat.push({ role: "user", content: "Answer my question now in plain words from what you found. If the lookups returned nothing, say there is no such data you can see yet." });
                continue;
              }
              break;
            }
            chat.push({
              role: "assistant",
              content: result.text || null,
              tool_calls: result.calls.map((c: { id: string; name: string; args: string }) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: c.args || "{}" },
              })),
            });
            const outs = await Promise.all((result.calls as { id: string; name: string; args: string }[]).map(async (c) => {
              let args: unknown = null;
              try {
                args = JSON.parse(c.args || "{}");
              } catch {
                args = null;
              }
              return { c, out: await executeTool(c.name, args, send) };
            }));
            for (const { c, out } of outs) {
              chat.push({ role: "tool", tool_call_id: c.id, name: c.name, content: out.error ? `Error: ${out.content}` : out.content });
            }
            send({ type: "status", text: "" });
            // A proposal ends the turn: the person decides next. Letting the
            // model carry on, it said "I've sent it" before anyone confirmed.
            if (outs.some(({ c, out }) => c.name === "propose_action" && !out.error)) break;
          }
        } else
        for (let round = 0; round < 12; round++) {
          if (req.signal.aborted) break;
          // deno-lint-ignore no-explicit-any
          const params: any = {
            model: MODEL,
            max_tokens: 32000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            system,
            tools: TOOLS,
            messages,
          };
          if (useFallbacks) {
            params.betas = ["server-side-fallback-2026-07-01"];
            params.fallbacks = "default";
          }

          // deno-lint-ignore no-explicit-any
          let final: any;
          try {
            const s = anthropic!.beta.messages.stream(params);
            s.on("text", (delta: string) => send({ type: "text", text: delta }));
            final = await s.finalMessage();
          } catch (err) {
            // Opted into fallbacks by default; if this account or model does
            // not take them, carry on without rather than failing the chat.
            if (useFallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
              useFallbacks = false;
              round -= 1;
              continue;
            }
            throw err;
          }

          const u = final.usage || {};
          input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) / 10);
          output += u.output_tokens || 0;

          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason === "refusal") {
            send({ type: "text", text: "\n\nI can't help with that one." });
            break;
          }
          if (final.stop_reason === "max_tokens") {
            send({ type: "text", text: "\n\n(That answer ran long and was cut short. Ask me to continue.)" });
            break;
          }
          if (final.stop_reason === "pause_turn") continue;
          if (final.stop_reason !== "tool_use") break;

          // deno-lint-ignore no-explicit-any
          const calls = final.content.filter((b: any) => b.type === "tool_use");
          // deno-lint-ignore no-explicit-any
          const results = await Promise.all(calls.map(async (call: any) => {
            const out = await executeTool(call.name, call.input && typeof call.input === "object" ? call.input : null, send);
            return { type: "tool_result", tool_use_id: call.id, content: out.content, ...(out.error ? { is_error: true } : {}) };
          }));
          messages.push({ role: "user", content: results });
          send({ type: "status", text: "" });
          // A proposal ends the turn: the person decides next.
          // deno-lint-ignore no-explicit-any
          if (calls.some((c: any, i: number) => c.name === "propose_action" && !(results[i] as any).is_error)) break;
        }
      } catch (err) {
        failure = (err as Error).message?.slice(0, 500) || "unknown";
        const friendly =
          err instanceof GroqLimitError ? err.message
          : err instanceof Anthropic.RateLimitError ? "The assistant is busy right now. Try again in a minute."
          : err instanceof Anthropic.APIError ? "The assistant could not answer just now. Try again."
          : "Something went wrong. Try again.";
        if (err instanceof GroqLimitError) console.error("groq busy", err.tried.join(" | "));
        send({ type: "error", message: friendly, ...(err instanceof GroqLimitError ? { detail: err.tried.join(" | ").slice(0, 900) } : {}) });
      } finally {
        await admin
          .rpc("record_ai_usage", {
            target_school: schoolId,
            surface_in: "assistant",
            model_in: useGroq ? `groq:${answeredBy.replace(/^groq:/, "")}` : modelName,
            input_tokens_in: input,
            output_tokens_in: output,
            user_in: user.id,
            error_in: failure,
          })
          .then(() => {}, () => {});
        send({ type: "done" });
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
};

// ------------------------------------------------------------------ compose
//
// The writing helper on every note and message box (src/Components/
// ComposeAssist.tsx, supabase/228): a short piece of text for the box the
// person is in — a correction reason, a message to a parent, a ticket reply,
// a remark on a report card. It writes from what they say they want and
// whatever they have already typed, and returns only the text to put in the
// box. Signed in, counted against the school's monthly AI allowance like
// the assistant, and recorded under its own "compose" surface.

const COMPOSE_ACTIONS: Record<string, string> = {
  write: "Write the text for this box from the request below.",
  improve: "Rewrite the current text so it is clear, correct and well put. Keep its meaning and roughly its length.",
  shorter: "Make the current text shorter and plainer, keeping everything that matters.",
  formal: "Rewrite the current text in a more formal, professional tone.",
  friendly: "Rewrite the current text in a warmer, friendlier tone, still professional.",
  fix: "Correct the spelling, grammar and punctuation of the current text. Change nothing else.",
};

const ROLE_NAME: Record<string, string> = {
  owner: "Proprietor", admin: "Administrator", principal: "Principal", bursar: "Bursar",
  admissions: "Admissions Officer", teacher: "Teacher", parent: "Parent", student: "Student",
};

interface Writer {
  name: string;
  title: string;
  email: string;
}

const composeSystem = (school: Record<string, unknown>, writer: Writer) =>
  [
    `You help staff and families at ${school.name}, a school using Schoolivio, write short pieces of text:`,
    `notes, reasons, messages, replies and remarks typed into a box in the app.`,
    ``,
    `The person writing (the sender) is ${writer.name || "a member of the school"}${writer.title ? `, ${writer.title}` : ""}, at ${school.name}.`,
    `When a message needs a sign-off, sign it with exactly: ${[writer.name, writer.title, school.name].filter(Boolean).join(", ")}.`,
    school.email || school.phone ? `The school's contact details, if the message needs them: ${[school.email, school.phone].filter(Boolean).join(", ")}.` : "",
    ``,
    `Use the page details you are given to get the facts right: the recipient's name (greet them by name),`,
    `references, dates, statuses, classes, amounts and what has happened so far. Read them carefully and use`,
    `them; that is what makes the text ready to send without editing.`,
    ``,
    `Rules:`,
    `- Return ONLY the text that goes in the box: no preamble, no quotation marks, no "Here is", no notes to the`,
    `  writer, no subject line unless asked, no markdown. Plain sentences.`,
    `- NEVER write a placeholder: no square brackets, no "[Your Name]", "[date]", "XXX", "insert ...". The text`,
    `  must be complete and ready to send as it stands. If a detail is not known, write naturally without it`,
    `  (say "at a time that suits you" rather than inventing a time).`,
    `- Never invent facts, names, dates, amounts or grades that are not in the page details, the request or`,
    `  the current text.`,
    `- Match the box: a reason, note or remark is one to three sentences with no greeting or sign-off; a`,
    `  message or email to a person has a greeting by name, a short body and the sign-off above.`,
    `- British English spelling. Courteous, warm where it suits, clear and specific.`,
  ].filter((line) => line !== "").join("\n");

// Belt and braces: whatever placeholder still slips through is filled from
// what is known or removed, so the box never receives "[Your Name]".
const unplaceholder = (text: string, writer: Writer, schoolName: string) => {
  let out = text
    .replace(/\[\s*(your|my|sender'?s?)\s*(full\s*)?name\s*\]/gi, writer.name || "")
    .replace(/\[\s*(your|my)\s*(job\s*)?(title|position|role)\s*\]/gi, writer.title || "")
    .replace(/\[\s*(school|school'?s)\s*name\s*\]/gi, schoolName)
    .replace(/\[\s*(your|my)\s*email\s*\]/gi, writer.email || "");
  // Any other bracketed placeholder: drop a line that is only that, else the token.
  out = out
    .split("\n")
    .filter((line) => !/^\s*\[[^\]\n]{1,60}\]\s*,?\s*$/.test(line))
    .map((line) => line.replace(/\s*\[[^\]\n]{1,60}\]/g, "").replace(/\s+([,.;:!?])/g, "$1"))
    .join("\n");
  return out.replace(/\n{3,}/g, "\n\n").trim();
};

const compose = async (req: Request, admin: SupabaseClient, body: Record<string, unknown>, apiKey: string) => {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in to use the writing helper." }, 401);
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    db: { schema: "classroom" },
    auth: { persistSession: false },
  });
  const { data: uid, error: whoError } = await caller.rpc("ai_whoami");
  if (whoError || !uid) return json({ error: "Your sign-in has expired. Refresh the page and sign in again." }, 401);

  const schoolId = String(body.schoolId || "");
  if (!schoolId) return json({ error: "Missing school." }, 400);
  const { data: memberships } = await caller
    .from("school_members").select("role, is_active, job_title").eq("school_id", schoolId).eq("user_id", String(uid));
  // deno-lint-ignore no-explicit-any
  const active = ((memberships || []) as any[]).filter((m) => m.is_active);
  if (!active.length) return json({ error: "You are not a member of this school." }, 403);

  // Who is writing, from their own account: the full name and the job title
  // the school gave them (else their role), so a message is signed properly.
  // An account with no name saved still signs as someone: its username, else
  // the part of its email before the @ ("danieloshinubi"), never a blank.
  const { data: profile } = await admin.from("profiles").select("first_name, surname, username, email").eq("id", String(uid)).maybeSingle();
  const rank = ["owner", "principal", "admin", "bursar", "admissions", "teacher", "parent", "student"];
  const main = [...active].sort((a, b) => rank.indexOf(a.role) - rank.indexOf(b.role))[0];
  const fullName = [profile?.first_name, profile?.surname].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  const writer: Writer = {
    name: fullName || String(profile?.username || "").trim() || String(profile?.email || "").split("@")[0],
    title: String(active.find((m) => m.job_title)?.job_title || ROLE_NAME[main.role] || "").trim(),
    email: String(profile?.email || ""),
  };

  const { data: school } = await admin.from("schools").select("id, name, email, phone, ai_token_limit").eq("id", schoolId).maybeSingle();
  if (!school) return json({ error: "Unknown school." }, 404);
  const limit = Number(school.ai_token_limit ?? 0);
  if (limit <= 0) return json({ error: "AI is switched off for this school." }, 403);
  const { data: used } = await admin.rpc("ai_tokens_this_month", { target_school: schoolId });
  if (Number(used || 0) >= limit) return json({ error: "AI has reached this school's limit for this month. It resets on the 1st." }, 429);

  const action = COMPOSE_ACTIONS[String(body.action)] ? String(body.action) : "write";
  const field = String(body.field || "").slice(0, 200);
  const page = String(body.page || "").slice(0, 200);
  const context = String(body.context || "").slice(0, 1500);
  const draft = String(body.draft || "").slice(0, 6000);
  const request = String(body.request || "").slice(0, 1500);
  // What the person can see around the box: the record's name and reference,
  // statuses, dates, who it goes to. The same school data already on their
  // screen, capped.
  const details = String(body.details || "").replace(/\s+\n/g, "\n").slice(0, 5000);
  if (action === "write" && !request.trim() && !draft.trim()) return json({ error: "Say what you would like it to say." }, 400);
  if (action !== "write" && !draft.trim()) return json({ error: "Type something first, then ask to improve it." }, 400);

  const prompt = [
    COMPOSE_ACTIONS[action],
    page ? `Page: ${page}` : "",
    field ? `Box: ${field}` : "",
    context ? `About: ${context}` : "",
    details ? `Page details (what the writer can see):\n${details}` : "",
    request ? `What they want: ${request}` : "",
    draft ? `Current text:\n${draft}` : "Current text: (empty)",
  ].filter(Boolean).join("\n\n");
  const system = composeSystem(school, writer);

  let input = 0;
  let output = 0;
  let model = MODEL;
  let failure: string | null = null;
  try {
    let text = "";
    if (provider() === "groq") {
      const result = await groqComplete(
        { model: groqModel(), max_tokens: 900, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] },
        () => {},
        () => {},
        Date.now() + 40_000,
      );
      text = result.text;
      input = result.usage?.prompt_tokens ?? 0;
      output = result.usage?.completion_tokens ?? 0;
      model = `groq:${result.model}`;
    } else {
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        output_config: { effort: "low" },
        system,
        messages: [{ role: "user", content: prompt }],
      } as Anthropic.MessageCreateParamsNonStreaming);
      input = response.usage?.input_tokens ?? 0;
      output = response.usage?.output_tokens ?? 0;
      if (response.stop_reason === "refusal") return json({ error: "It could not write that one." }, 200);
      text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
    }
    // Whatever the model wraps round the text, the box only gets the text.
    text = unplaceholder(text.trim().replace(/^["“]([\s\S]*)["”]$/, "$1").trim(), writer, String(school.name || ""));
    return json({ text });
  } catch (err) {
    failure = (err as Error).message?.slice(0, 500) || "unknown";
    const friendly = err instanceof GroqLimitError ? err.message
      : err instanceof Anthropic.RateLimitError ? "AI is busy right now. Try again in a minute."
      : "It could not write that just now. Try again.";
    return json({ error: friendly }, 502);
  } finally {
    await admin
      .rpc("record_ai_usage", {
        target_school: schoolId, surface_in: "compose", model_in: model,
        input_tokens_in: input, output_tokens_in: output, user_in: String(uid), error_in: failure,
      })
      .then(() => {}, () => {});
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "classroom" },
  });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!provider()) return json({ error: "The assistant is not configured yet." }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Unreadable request." }, 400);
  }

  if (body.surface === "assistant") return assistant(req, admin, body, apiKey);
  if (body.surface === "compose") return compose(req, admin, body, apiKey);
  return admissions(admin, body, apiKey);
});
