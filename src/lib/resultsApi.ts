import { db, fail } from "./db";

// Term results (supabase/024, 258): one sheet per class subject (or course)
// per term, CA + exam per pupil, draft → submitted → approved → released.
// Families read only released results (RLS, not this file).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rpc = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
// Called on the client itself, never detached (a detached db.rpc loses it).
const rpc: Rpc = (f, a) => (db as unknown as { rpc: Rpc }).rpc(f, a);
const from = (t: string) => (db as unknown as { from: (t: string) => any }).from(t);

export type Status = "draft" | "submitted" | "approved" | "released" | "returned";
export const STATUS_LABEL: Record<Status, string> = {
  draft: "Being marked",
  returned: "Sent back to teacher",
  submitted: "Waiting for approval",
  approved: "Approved, not released",
  released: "Released to families",
};

export interface Person {
  id: string;
  first_name: string | null;
  surname: string | null;
  username?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}
export interface Term {
  id: string;
  name: string;
  is_current: boolean;
  starts_on: string | null;
  sessions: { name: string } | null;
}
export interface Sheet {
  id: string;
  school_id: string;
  course_id: string | null;
  class_subject_id: string | null;
  term_id: string;
  status: Status;
  ca_max: number;
  exam_max: number;
  submitted_at: string | null;
  approved_at: string | null;
  released_at: string | null;
  updated_at: string;
}
/** Something results are kept for: a class's subject, or a course. */
export interface Unit {
  key: string;
  kind: "subject" | "course";
  id: string;
  title: string; // "Mathematics"
  where: string; // "JSS 1A" or the course code
  teacher: Person | null;
  teacherId: string | null;
  formTeacherId: string | null;
  pupils: number;
}
export interface Entry {
  id: string;
  student_id: string;
  ca_score: number | null;
  exam_score: number | null;
  total: number;
  remark: string | null;
  student: Person | null;
}
export interface Event {
  id: string;
  actor_id: string | null;
  status_from: Status | null;
  status_to: Status;
  actor_label: string | null;
  note: string | null;
  created_at: string;
}

export const gradeFor = (pct: number | null) =>
  pct === null ? "" : pct >= 70 ? "A" : pct >= 60 ? "B" : pct >= 50 ? "C" : pct >= 45 ? "D" : pct >= 40 ? "E" : "F";

const PERSON = "id, first_name, surname, username, email, avatar_url";

export const fetchTerms = async (schoolId: string): Promise<Term[]> => {
  const { data, error } = await from("terms")
    .select("id, name, is_current, starts_on, sessions ( name )")
    .eq("school_id", schoolId)
    .order("starts_on", { ascending: false });
  if (error) fail(error, "Could not load the terms.");
  return (data || []) as Term[];
};

/** Every class subject and course with pupils, as units results are kept for. */
export const fetchUnits = async (schoolId: string): Promise<Unit[]> => {
  const [subs, roster, courses, enrol] = await Promise.all([
    from("class_subjects")
      .select(`id, class_id, teacher_id, subject:subjects ( name ), class:classes ( name, form_teacher_id, level_year ), teacher:profiles!class_subjects_teacher_id_fkey ( ${PERSON} )`)
      .eq("school_id", schoolId),
    from("class_students").select("class_id, classes!inner ( school_id )").eq("classes.school_id", schoolId),
    from("courses").select(`id, code, title, owner_id, owner:profiles!courses_owner_id_fkey ( ${PERSON} )`).eq("school_id", schoolId),
    from("enrollments").select("course_id, courses!inner ( school_id )").eq("courses.school_id", schoolId).eq("status", "approved"),
  ]);
  for (const r of [subs, roster, courses, enrol]) if (r.error) fail(r.error, "Could not load the subjects.");
  const perClass = new Map<string, number>();
  (roster.data || []).forEach((r: any) => perClass.set(r.class_id, (perClass.get(r.class_id) || 0) + 1));
  const perCourse = new Map<string, number>();
  (enrol.data || []).forEach((r: any) => perCourse.set(r.course_id, (perCourse.get(r.course_id) || 0) + 1));

  const units: Unit[] = [
    ...(subs.data || []).map((s: any) => ({
      key: `s:${s.id}`,
      kind: "subject" as const,
      id: s.id,
      title: s.subject?.name || "Subject",
      where: s.class?.name || "Class",
      teacher: s.teacher || null,
      teacherId: s.teacher_id,
      formTeacherId: s.class?.form_teacher_id || null,
      pupils: perClass.get(s.class_id) || 0,
      _level: s.class?.level_year ?? 99,
    })),
    ...(courses.data || [])
      .filter((c: any) => (perCourse.get(c.id) || 0) > 0)
      .map((c: any) => ({
        key: `c:${c.id}`,
        kind: "course" as const,
        id: c.id,
        title: c.title || c.code || "Course",
        where: c.code || "Course",
        teacher: c.owner || null,
        teacherId: c.owner_id,
        formTeacherId: null,
        pupils: perCourse.get(c.id) || 0,
        _level: 100,
      })),
  ];
  return units.sort((a: any, b: any) => a._level - b._level || a.where.localeCompare(b.where) || a.title.localeCompare(b.title));
};

export const fetchSheets = async (schoolId: string, termId: string): Promise<Sheet[]> => {
  const { data, error } = await from("result_sheets").select("*").eq("school_id", schoolId).eq("term_id", termId);
  if (error) fail(error, "Could not load the result sheets.");
  return (data || []) as Sheet[];
};

export const openSheet = async (unit: Unit, termId: string): Promise<Sheet> => {
  const { data, error } =
    unit.kind === "subject"
      ? await rpc("open_subject_result_sheet", { target_class_subject: unit.id, target_term: termId, ca_max: 40, exam_max: 60 })
      : await rpc("open_result_sheet", { target_course: unit.id, target_term: termId, ca_max: 40, exam_max: 60 });
  if (error) fail(error, "Could not open the result sheet.");
  return data as Sheet;
};

export interface SheetDetail {
  sheet: Sheet;
  unit: { title: string; where: string; termName: string; teacherId: string | null; formTeacherId: string | null; courseOwnerId: string | null; kind: "subject" | "course" };
  entries: Entry[];
  events: Event[];
}

export const fetchSheet = async (sheetId: string): Promise<SheetDetail> => {
  const [s, e, ev] = await Promise.all([
    from("result_sheets")
      .select("*, term:terms ( name, sessions ( name ) ), course:courses ( code, title, owner_id ), cs:class_subjects ( teacher_id, subject:subjects ( name ), class:classes ( name, form_teacher_id ) )")
      .eq("id", sheetId)
      .maybeSingle(),
    from("result_entries").select(`id, student_id, ca_score, exam_score, total, remark, student:profiles!result_entries_student_id_fkey ( ${PERSON} )`).eq("sheet_id", sheetId),
    from("result_events").select("id, status_from, status_to, actor_id, actor_label, note, created_at").eq("sheet_id", sheetId).order("created_at", { ascending: false }),
  ]);
  if (s.error || !s.data) fail(s.error, "That result sheet is not available to you.");
  if (e.error) fail(e.error, "Could not load the marks.");
  const d = s.data as any;
  const nameOf = (p: Person | null) => `${p?.surname || ""} ${p?.first_name || ""}`.trim().toLowerCase();
  return {
    sheet: d as Sheet,
    unit: {
      title: d.cs?.subject?.name || d.course?.title || d.course?.code || "Results",
      where: d.cs?.class?.name || d.course?.code || "",
      termName: [d.term?.name, d.term?.sessions?.name].filter(Boolean).join(" · "),
      teacherId: d.cs?.teacher_id ?? null,
      formTeacherId: d.cs?.class?.form_teacher_id ?? null,
      courseOwnerId: d.course?.owner_id ?? null,
      kind: d.class_subject_id ? "subject" : "course",
    },
    entries: ((e.data || []) as Entry[]).sort((a, b) => nameOf(a.student).localeCompare(nameOf(b.student))),
    events: (ev.data || []) as Event[],
  };
};

export const saveEntry = async (entryId: string, patch: Partial<Pick<Entry, "ca_score" | "exam_score" | "remark">>) => {
  const { data, error } = await from("result_entries").update(patch).eq("id", entryId).select("id");
  if (error) fail(error, "Could not save that mark.");
  if (!data?.length) throw new Error("This sheet can no longer be changed.");
};

const transition = async (fn: string, args: Record<string, unknown>, fallback: string): Promise<Sheet> => {
  const { data, error } = await rpc(fn, args);
  if (error) fail(error, fallback);
  return data as Sheet;
};
export const submitSheet = (id: string, note?: string) => transition("submit_result_sheet", { target_sheet: id, note: note || null }, "Could not submit the results.");
export const approveSheet = (id: string, note?: string) => transition("approve_result_sheet", { target_sheet: id, note: note || null }, "Could not approve the results.");
export const returnSheet = (id: string, note: string) => transition("return_result_sheet", { target_sheet: id, note }, "Could not send the results back.");
export const releaseSheet = (id: string, note?: string) => transition("release_result_sheet", { target_sheet: id, note: note || null }, "Could not release the results.");
export const withdrawSheet = (id: string, note: string) => transition("unrelease_result_sheet", { target_sheet: id, note }, "Could not withdraw the results.");
export const setSplit = (id: string, ca: number, exam: number) => transition("set_result_sheet_split", { target_sheet: id, ca_max_in: ca, exam_max_in: exam }, "Could not change the split.");

/** A pupil's released results, for their report (families see only these). */
export interface Slip {
  entry_id: string;
  term_id: string;
  term_name: string;
  session_name: string | null;
  course_title: string | null;
  class_name: string | null;
  ca_max: number;
  exam_max: number;
  ca_score: number | null;
  exam_score: number | null;
  total: number;
  percentage: number | null;
  grade: string | null;
  remark: string | null;
  released_at: string | null;
}
export const fetchReleasedResults = async (studentId: string): Promise<Slip[]> => {
  const { data, error } = await from("result_slips").select("*").eq("student_id", studentId).eq("status", "released");
  if (error) fail(error, "Could not load the results.");
  return (data || []) as Slip[];
};
