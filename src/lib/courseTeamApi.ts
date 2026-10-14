import { db, fail } from "./db";

// A course's teachers (supabase/260): its lead, its co-teachers and, for a
// course of a class's subject, that subject's teacher. All of them run the
// course with the same rights.

type Rpc = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
// Called on the client itself, never detached.
const rpc: Rpc = (f, a) => (db as unknown as { rpc: Rpc }).rpc(f, a);
/* eslint-disable @typescript-eslint/no-explicit-any */
const from = (t: string) => (db as unknown as { from: (t: string) => any }).from(t);

export interface TeacherPerson {
  id: string;
  first_name: string | null;
  surname: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  lead?: boolean;
  /** Teaches it because they teach the class's subject (not removable here). */
  via_subject?: boolean;
  role?: string;
}

export const courseStaff = async (courseId: string): Promise<{ can_manage: boolean; teachers: TeacherPerson[] }> => {
  const { data, error } = await rpc("course_staff", { target_course: courseId });
  if (error) fail(error, "Could not load the course's teachers.");
  return (data as { can_manage: boolean; teachers: TeacherPerson[] }) || { can_manage: false, teachers: [] };
};

export const addCourseTeacher = async (courseId: string, userId: string) => {
  const { error } = await rpc("add_course_teacher", { target_course: courseId, target_user: userId });
  if (error) fail(error, "Could not add that teacher.");
};
export const removeCourseTeacher = async (courseId: string, userId: string) => {
  const { error } = await rpc("remove_course_teacher", { target_course: courseId, target_user: userId });
  if (error) fail(error, "Could not remove that teacher.");
};
export const makeCourseLead = async (courseId: string, userId: string) => {
  const { error } = await rpc("make_course_lead", { target_course: courseId, target_user: userId });
  if (error) fail(error, "Could not change the lead teacher.");
};

/** Staff who teach, for the "Add a teacher" list. */
export const schoolTeachingStaff = async (schoolId: string): Promise<TeacherPerson[]> => {
  const { data, error } = await from("school_members")
    .select("role, profiles!inner ( id, first_name, surname, username, email, avatar_url )")
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .in("role", ["teacher", "principal", "admin", "owner"]);
  if (error) fail(error, "Could not load the school's teachers.");
  const seen = new Map<string, TeacherPerson>();
  (data || []).forEach((r: any) => {
    if (r.profiles && !seen.has(r.profiles.id)) seen.set(r.profiles.id, { ...r.profiles, role: r.role });
  });
  return [...seen.values()];
};

/** The ids of every course this person teaches here (lead, co-teacher or subject teacher). */
export const myTaughtCourseIds = async (schoolId: string): Promise<string[]> => {
  const { data, error } = await rpc("my_taught_course_ids", { target_school: schoolId });
  if (error) fail(error, "Could not load your courses.");
  return ((data as (string | { my_taught_course_ids: string })[] | null) || []).map((r) => (typeof r === "string" ? r : r.my_taught_course_ids));
};
