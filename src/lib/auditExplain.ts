// The audit log in plain words: who did what, to which record, and when,
// as a sentence anyone at the school can read, and the record's details as
// labelled values instead of raw JSON. "Prop Mighty (Proprietor) changed
// ticket #5's status from Open to Resolved", not "UPDATE tickets".

export interface AuditRow {
  id: string;
  table_name: string;
  record_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE" | string;
  actor_id: string | null;
  actor_label: string | null;
  actor_role: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  ip_address: string | null;
  country: string | null;
  user_agent: string | null;
  created_at: string;
}

/** user_id → name, for turning ids into people. */
export type People = Map<string, string>;

// What each table holds, in everyday words (singular).
const NOUN: Record<string, string> = {
  account_security: "account security action",
  applications: "admission application",
  admission_offers: "admission offer",
  student_registrations: "student registration",
  clearance_departments: "clearance department",
  clearance_checklists: "clearance checklist item",
  original_verifications: "original-document check",
  application_events: "application history entry",
  application_reviews: "application review",
  application_interviews: "admission interview",
  application_screening_items: "screening item",
  applicant_documents: "applicant's document",
  application_documents: "uploaded application document",
  admission_config: "admissions settings",
  admission_programmes: "admission programme",
  applicant_accounts: "applicant account",
  document_requirements: "required document",
  screening_requirements: "screening requirement",
  payments: "payment",
  invoices: "invoice (fee bill)",
  invoice_items: "invoice line",
  fee_structures: "fee structure",
  fee_items: "fee item",
  fee_catalogue: "fee in the catalogue",
  discount_rules: "discount rule",
  courses: "course",
  assignments: "assignment",
  submissions: "assignment submission",
  materials: "course material",
  exams: "exam",
  exam_questions: "exam question",
  exam_options: "exam answer option",
  exam_attempts: "exam attempt",
  exam_answers: "exam answer",
  exam_events: "exam proctoring event",
  messages: "class message",
  message_comments: "message comment",
  message_reactions: "message reaction",
  notices: "news post",
  notice_replies: "news reply",
  notice_reactions: "news reaction",
  notifications: "notification",
  school_members: "school membership (person's role)",
  schools: "school settings",
  sessions: "academic session",
  terms: "term",
  classes: "class",
  class_students: "pupil's class placement",
  class_subjects: "class subject",
  subjects: "subject",
  levels: "class level",
  enrollments: "course enrolment",
  guardian_students: "parent–child link",
  result_sheets: "result sheet",
  result_entries: "result entry",
  result_events: "result sheet history entry",
  tickets: "help desk ticket",
  ticket_groups: "help desk group",
  ticket_messages: "help desk reply",
  ticket_mailboxes: "mailbox",
  member_module_access: "module access setting",
  payroll_settings: "payroll settings",
  payroll_staff: "payroll staff record",
  payroll_runs: "monthly payroll",
  payslips: "payslip",
  payroll_deduction_types: "payroll deduction type",
  payroll_staff_deductions: "staff deduction",
  payees: "consultant or vendor",
  payee_payments: "consultant or vendor payment",
  store_products: "store product",
  store_sales: "store sale",
  store_sale_items: "store sale item",
  chart_of_accounts: "account in the chart of accounts",
  journal_entries: "accounting journal entry",
  journal_lines: "journal line",
  timetable_entries: "timetable lesson",
  timetable_periods: "timetable period",
  attendance_records: "attendance record",
  attendance: "attendance record",
  subscription_payments: "Schoolivio subscription payment",
  billing_records: "Schoolivio billing record",
  payment_gateways: "online payment setting",
  profiles: "person's profile",
};

const ROLE_NAME: Record<string, string> = {
  owner: "Proprietor",
  admin: "Administrator",
  principal: "Principal",
  bursar: "Bursar",
  admissions: "Admissions Officer",
  teacher: "Teacher",
  parent: "Parent",
  student: "Student",
};

// Field names in words, where a plain prettifying would read oddly.
const FIELD: Record<string, string> = {
  is_active: "Active",
  role: "Role",
  name: "Name",
  first_name: "First name",
  middle_name: "Middle name",
  surname: "Surname",
  email: "Email",
  guardian_email: "Parent's email",
  guardian_name: "Parent's name",
  guardian_phone: "Parent's phone",
  status: "Status",
  priority: "Priority",
  amount: "Amount",
  currency: "Currency",
  reference: "Reference",
  number: "Number",
  subject: "Subject",
  description: "Description",
  body: "Message",
  level: "Access level",
  module: "Module",
  position: "Order in the list",
  job_title: "Job title",
  manager_id: "Manager",
  assigned_to: "Assigned to",
  group_id: "Group",
  user_id: "Person",
  student_id: "Pupil",
  guardian_id: "Parent",
  requester_id: "Raised by",
  decided_by: "Decided by",
  plan: "Plan",
  trial_ends_at: "Trial ends",
  paid_until: "Paid until",
  disabled_modules: "Switched-off modules",
  theme_color: "Theme colour",
  logo_url: "Logo",
  due_at: "Due",
  starts_at: "Starts",
  ends_at: "Ends",
};

// Housekeeping columns nobody needs to read.
const HIDDEN = new Set([
  "id", "school_id", "created_at", "updated_at", "search", "tsv", "seq", "body_format", "description_format",
  "email_message_id", "in_reply_to", "origin_message_id", "mailbox_id", "file_path", "granted_by", "session_id",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?)?$/;

const pretty = (s: string) => {
  const t = s.replace(/_id$/, "").replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const nounFor = (table: string) => NOUN[table] || pretty(table).toLowerCase().replace(/s$/, "");

const withArticle = (noun: string) => (/^(the |school settings|admissions settings|payroll settings)/.test(noun) ? `the ${noun.replace(/^the /, "")}` : `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`);

const fieldLabel = (key: string) => FIELD[key] || pretty(key);

const when = (iso: string, withTime = true) => {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime && iso.length > 10 ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};

/** A value as a person reads it. */
export const readable = (value: unknown, key: string, people: People): string => {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (Array.isArray(value)) return value.length ? value.map((v) => readable(v, key, people)).join(", ") : "none";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => !HIDDEN.has(k));
    return entries.length ? entries.map(([k, v]) => `${fieldLabel(k)}: ${readable(v, k, people)}`).join("; ") : "empty";
  }
  const s = String(value);
  if (UUID.test(s)) return people.get(s) || "another record";
  if (ISO.test(s)) return when(s, s.length > 10);
  if (key === "role" || key === "actor_role") return ROLE_NAME[s] || s;
  if (key === "level") return s === "none" ? "No access" : s === "read" ? "View only" : s === "edit" ? "Can edit" : s;
  if (key.endsWith("_url")) return "a picture or link";
  if (/^[a-z_]+$/.test(s) && s.includes("_")) return s.replace(/_/g, " ");
  return s;
};

/** The record's own name, to say which one it was. */
export const recordName = (row: AuditRow, people: People): string => {
  const d = (row.new_data || row.old_data || {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => d[k]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const person = [d.first_name, d.surname].filter((v) => typeof v === "string" && v).join(" ");
  if (row.table_name === "tickets" && d.number) return `#${d.number}${d.subject ? ` “${d.subject}”` : ""}`;
  const named = pick("name", "title", "subject", "label", "reference", "full_name", "file_name") || person;
  if (named) return `“${named}”`;
  if (typeof d.user_id === "string" && people.get(d.user_id)) {
    const who = people.get(d.user_id);
    if (row.table_name === "school_members") return `for ${who}${d.role ? ` (${ROLE_NAME[String(d.role)] || d.role})` : ""}`;
    if (row.table_name === "member_module_access") return `for ${who}${d.module ? ` — ${pretty(String(d.module))}` : ""}`;
    return `for ${who}`;
  }
  if (typeof d.number === "number" || typeof d.number === "string") return `#${d.number}`;
  return "";
};

const VERB: Record<string, string> = { INSERT: "created", UPDATE: "changed", DELETE: "deleted" };

const isSystem = (row: AuditRow) => !row.actor_id;
export const actorName = (row: AuditRow) =>
  isSystem(row) ? "Schoolivio (automatic)" : row.actor_label || "Someone";
export const actorRole = (row: AuditRow) =>
  (row.actor_role || "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((r) => ROLE_NAME[r] || r)
    .join(", ");

const countryName = (code: string | null) => {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
};

const device = (ua: string | null) => {
  if (!ua) return "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? "an iPad" : "an iPhone") : /Android/.test(ua) ? "an Android phone" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "a Mac" : /Linux/.test(ua) ? "Linux" : "";
  if (!browser && !os) return "";
  return `using ${[browser, os].filter(Boolean).join(" on ")}`;
};

/** One line for the list: "Prop Mighty changed the help desk ticket #5". */
export const headline = (row: AuditRow, people: People) => {
  const noun = nounFor(row.table_name);
  const name = recordName(row, people);
  const verb = VERB[row.action] || row.action.toLowerCase();
  return name ? `${actorName(row)} ${verb} the ${noun} ${name}` : `${actorName(row)} ${verb} ${withArticle(noun)}`;
};

export interface Change {
  field: string;
  before: string;
  after: string;
}

/** The full explanation, for the detail view. */
export const explain = (row: AuditRow, people: People) => {
  const who = isSystem(row)
    ? "Schoolivio did this automatically, not a person signed in to the app (for example while applying an update to the system or running a scheduled task)."
    : `${row.actor_label || "Someone"}${actorRole(row) ? `, ${actorRole(row)},` : ""} did this while signed in to the school's portal.`;
  const where = [
    row.ip_address ? `from internet address ${row.ip_address}` : "",
    row.country ? `in ${countryName(row.country)}` : "",
    device(row.user_agent),
  ].filter(Boolean).join(" ");
  const noun = nounFor(row.table_name);
  const name = recordName(row, people);
  const what =
    row.action === "INSERT"
      ? `A new ${noun}${name ? ` ${name}` : ""} was created.`
      : row.action === "DELETE"
        ? `The ${noun}${name ? ` ${name}` : ""} was deleted. What it held is listed below.`
        : `The ${noun}${name ? ` ${name}` : ""} was changed: ${(row.changed_fields || []).filter((f) => !HIDDEN.has(f)).map(fieldLabel).join(", ") || "details"}.`;

  const data = (row.action === "DELETE" ? row.old_data : row.new_data) || {};
  const changes: Change[] =
    row.action === "UPDATE"
      ? (row.changed_fields || [])
          .filter((f) => !HIDDEN.has(f))
          .map((f) => ({
            field: fieldLabel(f),
            before: readable(row.old_data?.[f], f, people),
            after: readable(row.new_data?.[f], f, people),
          }))
      : [];
  const facts =
    row.action === "UPDATE"
      ? []
      : Object.entries(data)
          .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => ({ field: fieldLabel(k), value: readable(v, k, people) }));

  return {
    when: `${when(row.created_at)}`,
    who,
    where: where ? `It was done ${where}.` : "",
    what,
    changes,
    facts,
  };
};
