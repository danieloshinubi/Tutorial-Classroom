import { db, fail, type Row } from "./db";

// The Timetable module's data (supabase/222). Reads go straight to the
// tables (row-level security lets every member of the school read them);
// every change to a cell goes through set_timetable_slot / clear_timetable_slot,
// which refuse clashes with a sentence naming them.

export type Period = Row<"timetable_periods">;
export type Slot = Row<"timetable_slots">;
export type Term = Pick<Row<"terms">, "id" | "name" | "position" | "is_current" | "starts_on" | "session_id"> & {
  sessions: { name: string } | null;
};
export type SchoolClass = Pick<Row<"classes">, "id" | "name" | "level_year" | "session_id">;

export interface ClassSubject {
  id: string;
  class_id: string;
  teacher_id: string | null;
  subject: { id: string; name: string; code: string | null } | null;
  teacher: { id: string; first_name: string | null; surname: string | null; email: string | null } | null;
}

export interface SchoolSubject {
  id: string;
  name: string;
  code: string | null;
}

export interface TimetableSetup {
  days: number[];
  periods: Period[];
  terms: Term[];
  classes: SchoolClass[];
  classSubjects: ClassSubject[];
  /** Every subject the school teaches (supabase/246): any can go in a period. */
  subjects: SchoolSubject[];
}

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const fetchTimetableSetup = async (schoolId: string): Promise<TimetableSetup> => {
  const [settings, periods, terms, classes, classSubjects, subjects] = await Promise.all([
    db.from("timetable_settings").select("days").eq("school_id", schoolId).maybeSingle(),
    db.from("timetable_periods").select("*").eq("school_id", schoolId).order("starts_at").order("position"),
    db
      .from("terms")
      .select("id, name, position, is_current, starts_on, session_id, sessions ( name )")
      .eq("school_id", schoolId)
      .order("starts_on", { ascending: false }),
    db.from("classes").select("id, name, level_year, session_id").eq("school_id", schoolId).order("level_year").order("name"),
    db
      .from("class_subjects")
      .select(
        "id, class_id, teacher_id, subject:subjects ( id, name, code ), teacher:profiles!class_subjects_teacher_id_fkey ( id, first_name, surname, email )"
      )
      .eq("school_id", schoolId),
    db.from("subjects").select("id, name, code").eq("school_id", schoolId).order("name"),
  ]);
  for (const r of [settings, periods, terms, classes, classSubjects, subjects]) if (r.error) fail(r.error, "Could not load the timetable.");
  return {
    days: (settings.data?.days as number[] | undefined)?.slice().sort((a, b) => a - b) || [1, 2, 3, 4, 5],
    periods: periods.data || [],
    terms: (terms.data || []) as unknown as Term[],
    classes: classes.data || [],
    classSubjects: (classSubjects.data || []) as unknown as ClassSubject[],
    subjects: (subjects.data || []) as SchoolSubject[],
  };
};

/** Gives a school subject to a class (if it hasn't got it) and returns the class's subject id (supabase/246). */
export const classSubjectFor = async (classId: string, subjectId: string): Promise<string> => {
  const { data, error } = await (db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "timetable_class_subject",
    { target_class: classId, target_subject: subjectId },
  );
  if (error) fail(error as never, "Could not add that subject to the class.");
  return data as string;
};

export const fetchSlots = async (schoolId: string, termId: string): Promise<Slot[]> => {
  const { data, error } = await db.from("timetable_slots").select("*").eq("school_id", schoolId).eq("term_id", termId);
  if (error) fail(error, "Could not load the timetable.");
  return data || [];
};

export interface SlotInput {
  termId: string;
  classId: string;
  day: number;
  periodId: string;
  classSubjectId: string | null;
  label: string | null;
  room: string | null;
}

export const setSlot = async (input: SlotInput): Promise<Slot> => {
  const args = {
    target_term: input.termId,
    target_class: input.classId,
    target_day: input.day,
    target_period: input.periodId,
    subject_in: input.classSubjectId,
    label_in: input.label,
    room_in: input.room,
  };
  // The generated types mark SQL parameters as non-null; these two are
  // genuinely optional (one of subject or label).
  const { data, error } = await db.rpc("set_timetable_slot", args as unknown as Parameters<typeof db.rpc<"set_timetable_slot">>[1]);
  if (error) fail(error, "Could not save that.");
  return data as Slot;
};

export const clearSlot = async (termId: string, classId: string, day: number, periodId: string): Promise<void> => {
  const { error } = await db.rpc("clear_timetable_slot", {
    target_term: termId,
    target_class: classId,
    target_day: day,
    target_period: periodId,
  });
  if (error) fail(error, "Could not clear that.");
};

export const copyTimetable = async (fromTerm: string, toTerm: string): Promise<number> => {
  const { data, error } = await db.rpc("copy_timetable", { from_term: fromTerm, to_term: toTerm });
  if (error) fail(error, "Could not copy the timetable.");
  return data || 0;
};

export interface PeriodInput {
  id?: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
  position: number;
}

export const savePeriod = async (schoolId: string, p: PeriodInput): Promise<void> => {
  const row = {
    school_id: schoolId,
    name: p.name.trim(),
    starts_at: p.startsAt,
    ends_at: p.endsAt,
    is_break: p.isBreak,
    position: p.position,
  };
  const { error } = p.id
    ? await db.from("timetable_periods").update(row).eq("id", p.id)
    : await db.from("timetable_periods").insert(row);
  if (error) {
    if (/timetable_period_times/.test(error.message)) fail({ message: "A period has to end after it starts." }, "");
    fail(error, "Could not save that period.");
  }
};

export const deletePeriod = async (id: string): Promise<void> => {
  const { error } = await db.from("timetable_periods").delete().eq("id", id);
  if (error) fail(error, "Could not remove that period.");
};

export const saveDays = async (schoolId: string, days: number[]): Promise<void> => {
  const { error } = await db
    .from("timetable_settings")
    .upsert({ school_id: schoolId, days: [...days].sort((a, b) => a - b), updated_at: new Date().toISOString() });
  if (error) fail(error, "Could not save the school days.");
};

// Whose timetables a family member may see: a student their own, a parent
// each of their children's, by name, with the class each child is in.
export interface FamilyMember {
  studentId: string;
  name: string;
  isSelf: boolean;
  classId: string | null;
}

export const fetchFamilyTimetables = async (userId: string, schoolId: string): Promise<FamilyMember[]> => {
  const children = await db
    .from("guardian_students")
    .select("student_id, student:profiles!guardian_students_student_id_fkey ( first_name, surname, username, email )")
    .eq("guardian_id", userId);
  if (children.error) fail(children.error, "Could not load your children.");
  const people = new Map<string, { name: string; isSelf: boolean }>();
  people.set(userId, { name: "Me", isSelf: true });
  (children.data || []).forEach((row) => {
    const p = row.student as unknown as { first_name: string | null; surname: string | null; username: string | null; email: string | null } | null;
    const name = [p?.first_name, p?.surname].filter(Boolean).join(" ").trim() || p?.username || p?.email || "Your child";
    people.set(row.student_id, { name, isSelf: false });
  });

  const { data, error } = await db
    .from("class_students")
    .select("class_id, student_id, classes!inner ( school_id )")
    .in("student_id", Array.from(people.keys()))
    .eq("classes.school_id", schoolId);
  if (error) fail(error, "Could not load classes.");
  const classOf = new Map((data || []).map((r) => [r.student_id, r.class_id]));

  return Array.from(people.entries())
    .filter(([id, who]) => !who.isSelf || classOf.has(id))
    .map(([id, who]) => ({ studentId: id, name: who.name, isSelf: who.isSelf, classId: classOf.get(id) || null }))
    .sort((a, b) => (a.isSelf === b.isSelf ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.isSelf ? -1 : 1));
};
