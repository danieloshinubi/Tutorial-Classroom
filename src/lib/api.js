import { supabase } from "./supabaseClient";
import {
  createAuthUser,
  temporaryPassword,
  invitePasswordSetup,
} from "./provisioning";

// Fields selected wherever a row carries its author/owner, so names render
// consistently across the app.
const PROFILE_FIELDS = "id, first_name, surname, username, email, role, avatar_url";

/* -------------------------------------------------------------------------- */
/* levels & courses                                                           */
/* -------------------------------------------------------------------------- */

// Every course in the school, newest session first. The session is what
// separates the same course taught in different years.
export const fetchCourses = async ({ schoolId, sessionId = null } = {}) => {
  let query = supabase
    .from("courses")
    .select("id, code, title, level_year, archived, session_id, sessions ( id, name, is_current )")
    .eq("school_id", schoolId)
    .eq("archived", false)
    .order("code");
  if (sessionId) query = query.eq("session_id", sessionId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const fetchAllCourses = async (schoolId) => {
  const { data, error } = await supabase
    .from("courses")
    .select(`id, code, title, level_year, archived, owner_id, owner:profiles!courses_owner_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("school_id", schoolId)
    .order("level_year")
    .order("code");
  if (error) throw error;
  return data;
};

// A code can now belong to several sessions. Without an explicit one, the
// current session wins, then the newest — so a bare /Courses/AZ-900 lands on
// the year being taught rather than an archive.
export const fetchCourseByCode = async ({ schoolId, code, sessionId = null }) => {
  let query = supabase
    .from("courses")
    .select(`id, code, title, description, level_year, archived, owner_id, school_id, session_id, owner:profiles!courses_owner_id_fkey ( ${PROFILE_FIELDS} ), sessions ( id, name, is_current, starts_on )`)
    .eq("school_id", schoolId)
    .eq("code", code);
  if (sessionId) query = query.eq("session_id", sessionId);

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return null;
  if (data.length === 1) return data[0];

  return (
    data.find((row) => row.sessions?.is_current) ||
    [...data].sort((a, b) =>
      String(b.sessions?.starts_on || "").localeCompare(String(a.sessions?.starts_on || ""))
    )[0]
  );
};

// Every session a given code is taught in, so the course page can offer them.
export const fetchCourseSessions = async ({ schoolId, code }) => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, session_id, sessions ( id, name, is_current )")
    .eq("school_id", schoolId)
    .eq("code", code);
  if (error) throw error;
  return data;
};

// Scoped by school_id, not just owner_id — RLS only checks that the caller
// is a member of SOME school that owns a row, not that it's the tenant
// currently open. Someone who teaches at two schools would otherwise see
// both schools' courses merged into whichever one they happen to be on.
export const fetchCoursesOwnedBy = async ({ schoolId, userId }) => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, code, title, level_year, archived, session_id, sessions ( id, name, is_current )")
    .eq("school_id", schoolId)
    .eq("owner_id", userId)
    .order("code");
  if (error) throw error;
  return data;
};

export const createCourse = async (course) => {
  const { data, error } = await supabase
    .from("courses")
    .insert(course)
    .select("id, code, title, level_year, archived, owner_id")
    .single();
  if (error) throw error;
  return data;
};

// schoolId cross-checked against the row, not just the id — otherwise a
// caller who somehow ends up with another tenant's course id (e.g. a stale
// link, or an id typed into the URL) could update/read/delete it as long as
// RLS's ownership/admin check happens to pass for THAT school, regardless of
// which tenant is currently open.
export const updateCourse = async (id, changes, schoolId) => {
  const { data, error } = await supabase
    .from("courses")
    .update(changes)
    .eq("id", id)
    .eq("school_id", schoolId)
    .select("id, code, title, description, level_year, archived, owner_id")
    .single();
  if (error) throw error;
  return data;
};

// The whole row, for the edit form.
//
// fetchAllCourses() deliberately selects a short list of columns for the
// listing pages, and the edit form used to read from it — so description and
// session_id arrived as undefined, became "" in the form, and were written
// back as null over perfectly good data. An edit form has to load every
// column it is going to save.
export const fetchCourseById = async (id, schoolId) => {
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id, code, title, description, level_year, session_id, archived, owner_id, join_policy, school_id"
    )
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const deleteCourse = async (id, schoolId) => {
  const { error } = await supabase
    .from("courses")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* enrollments                                                                */
/* -------------------------------------------------------------------------- */

// Only approved places count as "your courses" — a pending request is not
// membership yet, and is surfaced separately.
// enrollments has no school_id of its own — scoped through its course, with
// !inner so the courses.school_id filter actually restricts which enrollment
// rows come back (see fetchCoursesOwnedBy above for why this matters).
export const fetchMyCourses = async ({ schoolId, userId }) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id, status, courses!inner ( id, code, title, level_year, archived, school_id, sessions ( name ) )")
    .eq("user_id", userId)
    .eq("status", "approved")
    .eq("courses.school_id", schoolId);
  if (error) throw error;
  return data.map((row) => row.courses).filter(Boolean);
};

export const fetchMyPendingRequests = async ({ schoolId, userId }) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id, requested_at, courses!inner ( id, code, title, level_year, school_id )")
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("courses.school_id", schoolId);
  if (error) throw error;
  return data.filter((row) => row.courses);
};

export const isEnrolled = async ({ userId, courseId }) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
};

export const enroll = async ({ userId, courseId }) => {
  const { error } = await supabase
    .from("enrollments")
    .insert({ user_id: userId, course_id: courseId });
  if (error) throw error;
};

// enrollments has no school_id of its own, and PostgREST does not honor an
// embedded-resource filter as a row-selector on DELETE — so the cross-check
// has to be a separate lookup against courses, which does carry it directly.
export const unenroll = async ({ userId, courseId, schoolId }) => {
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (courseError) throw courseError;
  if (!course) throw new Error("This course does not belong to the current school.");

  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("user_id", userId)
    .eq("course_id", courseId);
  if (error) throw error;
};

export const fetchRoster = async (courseId, schoolId) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select(`created_at, profiles!enrollments_user_id_fkey ( ${PROFILE_FIELDS} ), courses!inner ( school_id )`)
    .eq("course_id", courseId)
    .eq("courses.school_id", schoolId);
  if (error) throw error;
  return data.map((row) => row.profiles).filter(Boolean);
};

/* -------------------------------------------------------------------------- */
/* materials                                                                  */
/* -------------------------------------------------------------------------- */

export const fetchMaterials = async (courseId, schoolId) => {
  const { data, error } = await supabase
    .from("materials")
    .select(
      "id, title, description, url, created_at, file_path, file_name, file_size, mime_type, courses!inner ( school_id )"
    )
    .eq("course_id", courseId)
    .eq("courses.school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

// materials has no school_id of its own, so the check has to go through the
// target course before inserting — otherwise a course_id from another
// tenant would be accepted as long as RLS's ownership check happens to pass
// for that other school.
export const createMaterial = async (material, schoolId) => {
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id")
    .eq("id", material.course_id)
    .eq("school_id", schoolId)
    .single();
  if (courseError || !course) {
    throw new Error("That course is not part of your current school.");
  }

  const { data, error } = await supabase
    .from("materials")
    .insert(material)
    .select("id, title, description, url, created_at")
    .single();
  if (error) throw error;
  return data;
};

// courseId here is always one the caller already validated against the
// current tenant (it comes from fetchCourseByCode({ schoolId, code }) two
// hops up), so reusing it as a filter is enough — no extra join needed.
export const deleteMaterial = async (id, courseId) => {
  const { error } = await supabase
    .from("materials")
    .delete()
    .eq("id", id)
    .eq("course_id", courseId);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* assignments                                                                */
/* -------------------------------------------------------------------------- */

export const fetchAssignments = async (courseId) => {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, description, points, due_at, file_path, file_name, file_size, mime_type, link_url, created_at")
    .eq("course_id", courseId)
    .order("due_at", { nullsFirst: false });
  if (error) throw error;
  return data;
};

export const fetchUpcomingAssignments = async (courseId) => {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, due_at")
    .eq("course_id", courseId)
    .gte("due_at", new Date().toISOString())
    .order("due_at")
    .limit(5);
  if (error) throw error;
  return data;
};

export const fetchAssignment = async ({ schoolId, id }) => {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, course_id, title, description, points, due_at, file_path, file_name, file_size, mime_type, link_url, courses!inner ( id, code, title, level_year, owner_id, school_id )")
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// assignments has no school_id of its own, so the target course is checked
// first — otherwise a course_id from another tenant would be accepted as
// long as RLS's ownership check happens to pass for that other school.
export const createAssignment = async ({ schoolId, ...assignment }) => {
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id")
    .eq("id", assignment.course_id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (courseError) throw courseError;
  if (!course) throw new Error("Course not found in this school");

  const { data, error } = await supabase
    .from("assignments")
    .insert(assignment)
    .select("id, title, description, points, due_at, file_path, file_name, file_size, mime_type, link_url, created_at")
    .single();
  if (error) throw error;
  return data;
};

export const deleteAssignment = async ({ id, schoolId }) => {
  const { data: owned, error: checkError } = await supabase
    .from("assignments")
    .select("id, courses!inner ( school_id )")
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .maybeSingle();
  if (checkError) throw checkError;
  if (!owned) throw new Error("Assignment not found in this school.");

  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* submissions                                                                */
/* -------------------------------------------------------------------------- */

export const fetchMySubmission = async ({ assignmentId, userId }) => {
  const { data, error } = await supabase
    .from("submissions")
    .select("id, body, url, file_path, file_name, file_size, submitted_at, grade, feedback, graded_at")
    .eq("assignment_id", assignmentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// One row per student per assignment, so a resubmission updates in place and
// clears any previous grade rather than stacking up duplicates.
export const submitWork = async ({ assignmentId, userId, schoolId, body, url, filePath, fileName, fileSize }) => {
  const { data: scoped, error: scopeError } = await supabase
    .from("assignments")
    .select("id, courses!inner ( school_id )")
    .eq("id", assignmentId)
    .eq("courses.school_id", schoolId)
    .maybeSingle();
  if (scopeError) throw scopeError;
  if (!scoped) throw new Error("That assignment does not belong to this school.");

  const { data, error } = await supabase
    .from("submissions")
    .upsert(
      {
        assignment_id: assignmentId,
        user_id: userId,
        body,
        url,
        file_path: filePath || null,
        file_name: fileName || null,
        file_size: fileSize || null,
        submitted_at: new Date().toISOString(),
        grade: null,
        feedback: null,
        graded_by: null,
        graded_at: null,
      },
      { onConflict: "assignment_id,user_id" }
    )
    .select("id, body, url, file_path, file_name, file_size, submitted_at, grade, feedback, graded_at")
    .single();
  if (error) throw error;
  return data;
};

export const fetchSubmissionsForAssignment = async ({ assignmentId, schoolId }) => {
  const { data, error } = await supabase
    .from("submissions")
    .select(`id, body, url, file_path, file_name, file_size, submitted_at, grade, feedback, graded_at, profiles!submissions_user_id_fkey ( ${PROFILE_FIELDS} ), assignments!inner ( course_id, courses!inner ( school_id ) )`)
    .eq("assignment_id", assignmentId)
    .eq("assignments.courses.school_id", schoolId)
    .order("submitted_at");
  if (error) throw error;
  return data;
};

// Verify this submission's assignment belongs to a course in the current
// tenant before mutating it — RLS's can_manage_assignment/can_manage_course
// checks are keyed to whichever school actually owns the row, not the
// tenant being browsed.
export const gradeSubmission = async ({ id, schoolId, grade, feedback, graderId }) => {
  const { data: owner, error: ownerError } = await supabase
    .from("submissions")
    .select("id, assignments!inner(course_id, courses!inner(school_id))")
    .eq("id", id)
    .eq("assignments.courses.school_id", schoolId)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) throw new Error("Submission not found in this school.");

  const { data, error } = await supabase
    .from("submissions")
    .update({
      grade,
      feedback,
      graded_by: graderId,
      graded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(`id, body, url, file_path, file_name, file_size, submitted_at, grade, feedback, graded_at, profiles!submissions_user_id_fkey ( ${PROFILE_FIELDS} )`)
    .single();
  if (error) throw error;
  return data;
};

/* -------------------------------------------------------------------------- */
/* people                                                                     */
/* -------------------------------------------------------------------------- */

// profiles has no school_id of its own — scoped through school_members
// (which does carry it), the same way fetchSchoolMembers already does.
// Sorted client-side since ordering by an embedded table's column is
// awkward over PostgREST.
export const fetchTutors = async (schoolId) => {
  const { data, error } = await supabase
    .from("school_members")
    .select(`profiles!school_members_user_id_fkey!inner ( ${PROFILE_FIELDS}, bio )`)
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .in("profiles.role", ["tutor", "admin"]);
  if (error) throw error;
  return data
    .map((row) => row.profiles)
    .filter(Boolean)
    .sort((a, b) => a.first_name.localeCompare(b.first_name));
};

export const fetchAllProfiles = async (schoolId) => {
  const { data, error } = await supabase
    .from("school_members")
    .select(`profiles!school_members_user_id_fkey!inner ( ${PROFILE_FIELDS}, level_year, created_at )`)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false, referencedTable: "profiles" });
  if (error) throw error;
  return data.map((row) => row.profiles).filter(Boolean);
};

export const updateProfile = async (id, changes) => {
  const { data, error } = await supabase
    .from("profiles")
    .update(changes)
    .eq("id", id)
    .select(`${PROFILE_FIELDS}, bio, level_year`)
    .single();
  if (error) throw error;
  return data;
};

// Removes the profile row only. The underlying auth user needs the service_role
// key, which must never reach the browser — delete it from the Supabase
// dashboard, or from a server-side function.
export const deleteProfile = async (id) => {
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* class chat                                                                 */
/* -------------------------------------------------------------------------- */

export const fetchMessages = async (courseId) => {
  const { data, error } = await supabase
    .from("messages")
    .select(`id, body, created_at, edited_at, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .eq("course_id", courseId)
    .order("created_at")
    .limit(100);
  if (error) throw error;
  return data;
};

export const postMessage = async ({ courseId, userId, body }) => {
  const { data, error } = await supabase
    .from("messages")
    .insert({ course_id: courseId, user_id: userId, body })
    .select(`id, body, created_at, edited_at, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .single();
  if (error) throw error;
  return data;
};

// Realtime inserts arrive without the joined profile, so the caller refetches
// the single row to get the author's name alongside the message.
export const fetchMessageById = async ({ schoolId, id }) => {
  const { data, error } = await supabase
    .from("messages")
    .select(`id, body, created_at, edited_at, user_id, profiles ( ${PROFILE_FIELDS} ), courses!inner ( school_id )`)
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const subscribeToMessages = (courseId, onInsert) =>
  supabase
    .channel(`messages:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "classroom",
        table: "messages",
        filter: `course_id=eq.${courseId}`,
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe();

/* -------------------------------------------------------------------------- */
/* exams                                                                      */
/* -------------------------------------------------------------------------- */

export const fetchExams = async (courseId, schoolId) => {
  const { data, error } = await supabase
    .from("exams")
    .select("id, title, kind, instructions, duration_mins, opens_at, closes_at, published, show_results, created_at, require_fullscreen, block_copy_paste, shuffle_questions, shuffle_options, max_violations, courses!inner ( school_id )")
    .eq("course_id", courseId)
    .eq("courses.school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const fetchExam = async ({ id, schoolId }) => {
  const { data, error } = await supabase
    .from("exams")
    .select("id, course_id, title, kind, instructions, duration_mins, opens_at, closes_at, published, show_results, require_fullscreen, block_copy_paste, shuffle_questions, shuffle_options, max_violations, grace_seconds, allow_calculator, courses!inner ( id, code, title, level_year, owner_id, school_id )")
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const createExam = async (exam) => {
  const { data, error } = await supabase.from("exams").insert(exam).select("id").single();
  if (error) throw error;
  return data;
};

// exams has no school_id of its own — verify via its course before mutating,
// since RLS's can_manage_course() only checks that the caller manages SOME
// course in SOME school, not that it's the one currently browsed.
export const updateExam = async (id, changes, schoolId) => {
  const { data: owned, error: scopeError } = await supabase
    .from("exams")
    .select("id, courses!inner ( school_id )")
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .maybeSingle();
  if (scopeError) throw scopeError;
  if (!owned) throw new Error("Exam not found in this school.");

  const { data, error } = await supabase
    .from("exams")
    .update(changes)
    .eq("id", id)
    .select("id, title, published")
    .single();
  if (error) throw error;
  return data;
};

export const deleteExam = async (id, schoolId) => {
  const { error } = await supabase
    .from("exams")
    .delete()
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .select("id, courses!inner(school_id)");
  if (error) throw error;
};

// Deliberately omits exam_options.is_correct — students must never receive the
// answer key. Marking happens server-side in submit_exam_attempt().
export const fetchQuestionsForSitting = async ({ examId, schoolId }) => {
  const { data, error } = await supabase
    .from("exam_questions")
    .select("id, kind, prompt, image_path, points, position, exam_options ( id, body, position ), exams!inner ( courses!inner ( school_id ) )")
    .eq("exam_id", examId)
    .eq("exams.courses.school_id", schoolId)
    .order("position");
  if (error) throw error;
  return data.map(({ exams, ...rest }) => rest);
};

// The authoring view, which does include the answer key. RLS restricts this to
// staff who manage the course.
export const fetchQuestionsForEditing = async ({ examId, schoolId }) => {
  const { data, error } = await supabase
    .from("exam_questions")
    .select("id, kind, prompt, image_path, points, position, answer_key, exam_options ( id, body, position, is_correct ), exams!inner ( courses!inner ( school_id ) )")
    .eq("exam_id", examId)
    .eq("exams.courses.school_id", schoolId)
    .order("position");
  if (error) throw error;
  return data.map(({ exams, ...rest }) => rest);
};

export const createQuestion = async (question) => {
  const { data, error } = await supabase
    .from("exam_questions")
    .insert(question)
    .select("id")
    .single();
  if (error) throw error;
  return data;
};

export const createOptions = async (options) => {
  if (!options.length) return;
  const { error } = await supabase.from("exam_options").insert(options);
  if (error) throw error;
};

export const deleteQuestion = async (id, schoolId) => {
  const { data: owned, error: checkError } = await supabase
    .from("exam_questions")
    .select("id, exams!inner ( courses!inner ( school_id ) )")
    .eq("id", id)
    .eq("exams.courses.school_id", schoolId)
    .maybeSingle();
  if (checkError) throw checkError;
  if (!owned) throw new Error("Question not found in this school.");

  const { error } = await supabase.from("exam_questions").delete().eq("id", id);
  if (error) throw error;
};

/* attempts ----------------------------------------------------------------- */

export const fetchMyAttempt = async ({ examId, userId }) => {
  const { data, error } = await supabase
    .from("exam_attempts")
    .select("id, started_at, submitted_at, auto_score, total_score, max_score, graded_at, violations, disqualified, disqualified_reason, auto_submitted, submitted_late")
    .eq("exam_id", examId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// Created server-side so a student cannot pre-create an attempt, restart one
// to reset the clock, or sit an unpublished or closed paper.
export const startAttempt = async ({ examId }) => {
  const { data, error } = await supabase.rpc("start_exam_attempt", {
    target_exam: examId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

// The client reports what it saw; the server decides what it costs, and the
// event is written to an append-only log either way.
export const reportViolation = async ({ attemptId, kind, detail }) => {
  const { data, error } = await supabase.rpc("record_exam_violation", {
    target_attempt: attemptId,
    violation_kind: kind,
    violation_detail: detail ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const fetchExamEvents = async (attemptId, schoolId) => {
  const { data, error } = await supabase
    .from("exam_events")
    .select("id, kind, detail, created_at, exam_attempts!inner ( exam_id, exams!inner ( course_id, courses!inner ( school_id ) ) )")
    .eq("attempt_id", attemptId)
    .eq("exam_attempts.exams.courses.school_id", schoolId)
    .order("created_at");
  if (error) throw error;
  return data;
};

export const saveAnswer = async ({ attemptId, questionId, optionId, text }) => {
  const { error } = await supabase.from("exam_answers").upsert(
    {
      attempt_id: attemptId,
      question_id: questionId,
      selected_option_id: optionId ?? null,
      answer_text: text ?? null,
    },
    { onConflict: "attempt_id,question_id" }
  );
  if (error) throw error;
};

export const fetchAnswers = async ({ attemptId, schoolId }) => {
  const { data, error } = await supabase
    .from("exam_answers")
    .select("question_id, selected_option_id, answer_text, awarded_points, exam_attempts!inner ( exam_id, exams!inner ( course_id, courses!inner ( school_id ) ) )")
    .eq("attempt_id", attemptId)
    .eq("exam_attempts.exams.courses.school_id", schoolId);
  if (error) throw error;
  return data;
};

// Marks the paper inside Postgres so the answer key never reaches the browser.
export const submitAttempt = async (attemptId) => {
  const { data, error } = await supabase.rpc("submit_exam_attempt", {
    target_attempt: attemptId,
  });
  if (error) throw error;
  return data;
};

export const fetchAttemptsForExam = async ({ examId, schoolId }) => {
  const { data, error } = await supabase
    .from("exam_attempts")
    .select(`id, started_at, submitted_at, auto_score, total_score, max_score, graded_at, violations, disqualified, disqualified_reason, auto_submitted, submitted_late, profiles ( ${PROFILE_FIELDS} ), exams!inner ( course_id, courses!inner ( school_id ) )`)
    .eq("exam_id", examId)
    .eq("exams.courses.school_id", schoolId)
    .order("submitted_at", { nullsFirst: false });
  if (error) throw error;
  return data;
};

// exam_answers has no school_id (two joins away), and PostgREST can't filter
// an UPDATE's row set through an embedded resource — so the school + grader
// + question-kind checks all move into a security-definer RPC, the same
// pattern this file already uses for submit_exam_attempt/recalculate_attempt.
export const markAnswer = async ({ id, points, schoolId }) => {
  const { error } = await supabase.rpc("mark_exam_answer", {
    target_answer: id,
    target_school: schoolId,
    points,
  });
  if (error) throw error;
};

export const recalculateAttempt = async (attemptId) => {
  const { data, error } = await supabase.rpc("recalculate_attempt", {
    target_attempt: attemptId,
  });
  if (error) throw error;
  return data;
};

export const fetchAttemptDetail = async ({ attemptId, schoolId }) => {
  const { data, error } = await supabase
    .from("exam_answers")
    .select("id, question_id, selected_option_id, answer_text, awarded_points, exam_questions ( id, kind, prompt, points, answer_key, position ), exam_attempts!inner ( exams!inner ( courses!inner ( school_id ) ) )")
    .eq("attempt_id", attemptId)
    .eq("exam_attempts.exams.courses.school_id", schoolId);
  if (error) throw error;
  return data;
};

/* -------------------------------------------------------------------------- */
/* join requests                                                              */
/* -------------------------------------------------------------------------- */

// Created server-side so a student cannot approve their own place.
export const requestEnrollment = async ({ courseId, note }) => {
  const { data, error } = await supabase.rpc("request_enrollment", {
    target_course: courseId,
    note: note ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const decideEnrollment = async ({ courseId, userId, approve }) => {
  const { data, error } = await supabase.rpc("decide_enrollment", {
    target_course: courseId,
    target_user: userId,
    approve,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const fetchMyEnrollment = async ({ userId, courseId }) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("status, requested_at, decided_at")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchParticipants = async ({ courseId, schoolId }) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select(`status, requested_at, decided_at, message, profiles!enrollments_user_id_fkey ( ${PROFILE_FIELDS} ), courses!inner ( school_id )`)
    .eq("course_id", courseId)
    .eq("courses.school_id", schoolId)
    .order("requested_at");
  if (error) throw error;
  return data.filter((row) => row.profiles);
};

export const removeParticipant = async ({ courseId, userId }) => {
  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("course_id", courseId)
    .eq("user_id", userId);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* notifications                                                              */
/* -------------------------------------------------------------------------- */

// Due and overdue reminders are generated on demand as well as by pg_cron:
// the extension is not available on every plan, and a student who opens the
// app should still be told what is about to close. The function only ever
// writes a reminder once per piece of work, so calling it often is harmless.
export const generateDueReminders = async () => {
  const { error } = await supabase.rpc("generate_due_reminders");
  if (error) throw error;
};

// RLS on notifications only checks auth.uid() = user_id — it has no tenant
// awareness at all (see the 007_tenancy.sql comment above that policy, which
// says the opposite is intended), so the school_id filter here is the only
// thing stopping a person active in two schools from seeing both schools'
// notifications merged into one bell.
// Unread only — once something is read (individually or via "Mark all as
// read"), the bell should stop showing it rather than leaving an
// already-handled item sitting there forever. Read notifications still
// exist in the table (nothing here deletes a row), just never fetched into
// this list again.
export const fetchNotifications = async ({ schoolId, courseId } = {}) => {
  let query = supabase
    .from("notifications")
    .select("id, course_id, kind, title, body, link, read_at, created_at")
    .eq("school_id", schoolId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (courseId) query = query.eq("course_id", courseId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const markNotificationRead = async (id, schoolId) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const markAllNotificationsRead = async (userId, schoolId) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("school_id", schoolId)
    .is("read_at", null);
  if (error) throw error;
};

// A live "something changed here" signal for one application's timeline —
// screening, review, a decision, a payment settling — so whoever has the
// page open (staff or the applicant themselves) sees a "reload" prompt
// instead of having to guess when to refresh. Same channel-per-entity,
// INSERT-only pattern subscribeToNotifications already uses.
export const subscribeToApplicationEvents = (applicationId, onInsert) =>
  supabase
    .channel(`application_events:${applicationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "classroom",
        table: "application_events",
        filter: `application_id=eq.${applicationId}`,
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe();

// Same "something changed here" signal as subscribeToApplicationEvents,
// but for the three surfaces staff watch for OTHER people's changes
// rather than one entity's own timeline: the Tickets list, the Admissions
// queue, and one ticket's own message thread. All three need
// classroom.tickets / classroom.ticket_messages / classroom.applications
// added to the supabase_realtime publication (see
// 122_tickets_and_applications_realtime.sql) — without that, Realtime
// never delivers these events no matter how correct the subscription is.
export const subscribeToTicketsList = (schoolId, onChange) =>
  supabase
    .channel(`tickets_list:${schoolId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "classroom", table: "tickets", filter: `school_id=eq.${schoolId}` },
      (payload) => onChange(payload)
    )
    .subscribe();

export const subscribeToApplicationsList = (schoolId, onChange) =>
  supabase
    .channel(`applications_list:${schoolId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "classroom", table: "applications", filter: `school_id=eq.${schoolId}` },
      (payload) => onChange(payload)
    )
    .subscribe();

// One channel, two listeners: a new message on this ticket's thread, or a
// status/priority/assignment change on the ticket row itself — either one
// is "reload me" from the viewer's point of view.
export const subscribeToTicketThread = (ticketId, onChange) =>
  supabase
    .channel(`ticket_thread:${ticketId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "classroom", table: "ticket_messages", filter: `ticket_id=eq.${ticketId}` },
      (payload) => onChange(payload)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "classroom", table: "tickets", filter: `id=eq.${ticketId}` },
      (payload) => onChange(payload)
    )
    .subscribe();

/* ---------------------------------------------------------------------------
   Schoolivio Chat — tenant-scoped DMs and group channels.
   --------------------------------------------------------------------------- */

export const fetchChatOverview = async (schoolId) => {
  const { data, error } = await supabase.rpc("chat_overview", { target_school: schoolId });
  if (error) throw error;
  return data || [];
};

export const openDirectMessage = async ({ schoolId, otherUserId }) => {
  const { data, error } = await supabase.rpc("open_dm", {
    target_school: schoolId,
    other_user: otherUserId,
  });
  if (error) throw error;
  return data;
};

export const createGroupChannel = async ({ schoolId, name, memberIds }) => {
  const { data, error } = await supabase.rpc("create_group_channel", {
    target_school: schoolId,
    channel_name: name,
    member_ids: memberIds,
  });
  if (error) throw error;
  return data;
};

export const addChatMembers = async ({ channelId, memberIds }) => {
  const { error } = await supabase.rpc("add_chat_members", {
    target_channel: channelId,
    member_ids: memberIds,
  });
  if (error) throw error;
};

export const removeChatMember = async ({ channelId, userId }) => {
  const { error } = await supabase.rpc("remove_chat_member", {
    target_channel: channelId,
    target_user: userId,
  });
  if (error) throw error;
};

// Promote to admin ("owner") or demote back to "member". An RPC rather than a
// direct update because the only update policy on chat_channel_members is
// "user_id = auth.uid()" — editing someone else's row is blocked by design, so
// there is no client-side path to this. See supabase/169_chat_member_roles.sql,
// which also refuses to demote the last remaining admin.
export const setChatMemberRole = async ({ channelId, userId, role }) => {
  const { error } = await supabase.rpc("set_chat_member_role", {
    target_channel: channelId,
    target_user: userId,
    new_role: role,
  });
  if (error) throw error;
};

// author:profiles needs its FK constraint named explicitly — adding
// chat_message_reactions (itself FK'd to both chat_messages and profiles)
// gave PostgREST a second path from chat_messages to profiles to consider
// once a reactions embed sits alongside this one, so the old bare
// "profiles" reference started failing with "more than one relationship
// was found for 'chat_messages' and 'profiles'".
// reply_to is deliberately NOT embedded here — PostgREST couldn't resolve a
// self-referencing chat_messages!chat_messages_reply_to_id_fkey embed
// ("could not find a relationship between 'chat_messages' and
// 'chat_messages'", confirmed live even after a schema reload). Instead
// fetchChatMessages resolves it client-side from the same batch it just
// loaded, and sendChatMessage's caller (ChatPage) already holds the exact
// message object being replied to, so it never needs a lookup at all.
const CHAT_MESSAGE_SELECT = `
  id, channel_id, author_id, body, reply_to_id, edited_at, deleted_at, created_at,
  attachment_path, attachment_name, attachment_size, attachment_mime,
  author:profiles!chat_messages_author_id_fkey ( id, first_name, surname, username, email ),
  reactions:chat_message_reactions ( user_id, emoji )
`;

export const fetchChatMessages = async (channelId, { before, limit = 50 } = {}) => {
  let q = supabase
    .from("chat_messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data || []).reverse();
  const byId = new Map(rows.map((m) => [m.id, m]));
  rows.forEach((m) => { m.reply_to = m.reply_to_id ? byId.get(m.reply_to_id) || null : null; });
  return rows;
};

// Path convention <channel_id>/<uuid>-<filename> — see 162_chat_attachments.sql
// for the storage RLS this scopes to. Uploaded before the message row exists
// (same order TicketDetail's own attachments follow): the composer needs the
// path/name/size to hand to sendChatMessage.
export const uploadChatAttachment = async ({ channelId, file }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `${channelId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from("chat-attachments")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return { path, name: file.name, size: file.size, mime: file.type || null };
};

// Private bucket — same signed-URL-on-demand pattern as signedMaterialUrl.
export const signedChatAttachmentUrl = async (path, seconds = 300) => {
  const { data, error } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
};

// Forwarding a file to another channel needs its own copy under that
// channel's own path prefix — the storage RLS on chat-attachments checks
// path segment [1] against is_chat_member, so a file still living under its
// original channel's prefix would stay unreadable to the new channel's
// members no matter what the forwarded message row itself says.
export const copyChatAttachment = async ({ fromPath, toChannelId, fileName }) => {
  const safeName = fileName.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const toPath = `${toChannelId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage.from("chat-attachments").copy(fromPath, toPath);
  if (error) throw error;
  return toPath;
};

export const sendChatMessage = async ({ channelId, authorId, body, replyToId, attachment }) => {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      channel_id: channelId,
      author_id: authorId,
      body,
      reply_to_id: replyToId || null,
      attachment_path: attachment?.path || null,
      attachment_name: attachment?.name || null,
      attachment_size: attachment?.size || null,
      attachment_mime: attachment?.mime || null,
    })
    .select(CHAT_MESSAGE_SELECT)
    .single();
  if (error) throw error;
  return data;
};

export const editChatMessage = async ({ messageId, body }) => {
  const { data, error } = await supabase
    .from("chat_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .select(CHAT_MESSAGE_SELECT)
    .single();
  if (error) throw error;
  return data;
};

export const deleteChatMessage = async (messageId) => {
  const { error } = await supabase
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) throw error;
};

export const markChannelRead = async ({ channelId, userId }) => {
  const { error } = await supabase
    .from("chat_channel_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw error;
};

// event: "*" (not INSERT-only) is deliberate — an edit or a soft-delete has
// to reach every open thread, not just the author's own screen. Deletes are
// soft (an UPDATE setting deleted_at), so payload.new always arrives
// complete without needing replica identity full on the table.
export const subscribeToChatChannel = (channelId, onChange) =>
  supabase
    .channel(`chat_channel:${channelId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "classroom", table: "chat_messages", filter: `channel_id=eq.${channelId}` },
      (payload) => onChange(payload)
    )
    .subscribe();

// Sidebar-level: which of my channels just got a new message, anywhere.
// Filtered on user_id via the membership table (postgres_changes only
// supports one filter column), same shape subscribeToNotifications uses.
//
// `topic` lets two callers watch the exact same rows without colliding —
// supabase-js keys a channel by its topic string and returns the SAME
// underlying channel object for a repeated one, so ChatPage and Navbar
// both calling this with the default topic would have the second .on()
// land on an already-.subscribe()'d channel and throw. Each caller that
// isn't ChatPage's own thread view should pass its own topic suffix.
export const subscribeToMyChannels = (userId, onChange, topic = "chat_channels") =>
  supabase
    .channel(`${topic}:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "classroom", table: "chat_channel_members", filter: `user_id=eq.${userId}` },
      (payload) => onChange(payload)
    )
    .subscribe();

// The other half of "which of my channels just got a new message,
// anywhere" — subscribeToMyChannels above only fires on a change to MY OWN
// chat_channel_members row (joining/leaving a channel, my own last_read_at
// moving), which a message someone else sends never touches. The signal
// that actually fires on every new message is chat_channels.last_message_at
// (bumped by chat_messages_bump_channel_trg, 158_chat.sql) — this listens
// for that instead. postgres_changes can only filter on one column, and
// chat_channels has no user_id of its own, so this fires for every channel
// change in the school and leaves "is this one of mine" to the caller's own
// onChange (which just re-runs chat_overview(), already scoped to the
// caller) — same "filter broadly, narrow client-side" shape
// subscribeToNotifications uses for school_id.
export const subscribeToSchoolChatActivity = (schoolId, onChange, topic = "chat_channels_activity") =>
  supabase
    .channel(`${topic}:${schoolId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "classroom", table: "chat_channels", filter: `school_id=eq.${schoolId}` },
      (payload) => onChange(payload)
    )
    .subscribe();

// Thread-level: every membership row for the OPEN channel, not just mine —
// this is what tells the sender "seen" once the other member's own
// last_read_at moves past a message's created_at. Same "*, single filter
// column" shape as subscribeToMyChannels above, just filtered by channel
// instead of by user.
export const subscribeToChannelMembers = (channelId, onChange) =>
  supabase
    .channel(`chat_channel_members:${channelId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "classroom", table: "chat_channel_members", filter: `channel_id=eq.${channelId}` },
      (payload) => onChange(payload)
    )
    .subscribe();

export const fetchChannelMembers = async (channelId) => {
  const { data, error } = await supabase
    .from("chat_channel_members")
    // role drives the participants roster (who is an admin, and therefore who
    // may add/remove/promote). Names and avatars are NOT joined here on
    // purpose: the caller already holds the school's member list with profiles
    // attached, so resolving them from that avoids a second join per channel.
    // joined_at is what orders the group-avatar cluster, matching the same
    // ordering chat_overview's member_preview uses, so a group shows the same
    // faces in the thread header as in the list row beside it.
    .select("user_id, role, joined_at, last_read_at")
    .eq("channel_id", channelId);
  if (error) throw error;
  return data || [];
};

export const addReaction = async ({ messageId, userId, emoji }) => {
  const { error } = await supabase
    .from("chat_message_reactions")
    .insert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
};

export const removeReaction = async ({ messageId, userId, emoji }) => {
  const { error } = await supabase
    .from("chat_message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji);
  if (error) throw error;
};

// Reactions have no channel_id of their own to filter postgres_changes on,
// so this listens unfiltered and the caller checks payload.message_id
// against the messages it actually has loaded — the same tradeoff
// subscribeToNotifications' client-side school_id check makes, just for a
// column postgres_changes can't filter on at all rather than one it won't
// combine with another.
export const subscribeToMessageReactions = (onChange) =>
  supabase
    .channel("chat_message_reactions")
    .on(
      "postgres_changes",
      { event: "*", schema: "classroom", table: "chat_message_reactions" },
      (payload) => onChange(payload)
    )
    .subscribe();

// Typing presence is deliberately never written to Postgres — it is stale
// the instant it lands, so it travels as an ephemeral broadcast on its own
// channel instead of a row anything has to clean up. `self: false` means
// the sender never has to filter its own echo back out.
export const subscribeToTyping = (channelId, onTyping) =>
  supabase
    .channel(`chat_typing:${channelId}`, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "typing" }, ({ payload }) => onTyping(payload))
    .subscribe();

export const sendTyping = (channel, userId) => {
  channel?.send({ type: "broadcast", event: "typing", payload: { userId } });
};

// Realtime's postgres_changes filter only reliably supports one column, so
// the school check happens client-side — same reason fetchNotifications
// above needs its own .eq("school_id", ...): RLS/the channel filter only
// scope to this user, not to the tenant currently being viewed.
export const subscribeToNotifications = (userId, schoolId, onInsert) =>
  supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "classroom",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new.school_id === schoolId) onInsert(payload.new);
      }
    )
    .subscribe();

/* -------------------------------------------------------------------------- */
/* material files                                                             */
/* -------------------------------------------------------------------------- */

// A UUID that works everywhere. Prefers the built-in uuidV4()
// where the browser has it, and falls back to crypto.getRandomValues() with
// version 4 formatting where it does not. The last-ditch Math.random() branch
// exists so a very old browser cannot produce a runtime error mid-upload —
// what it hands out is not cryptographically strong, but storage paths do not
// need it to be; RLS decides who may write here.
const uuidV4 = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const MATERIALS_BUCKET = "course-materials";

// Path convention <course_id>/<random>-<name> — the first segment is what the
// storage policy checks to decide who may write here.
export const uploadMaterialFile = async ({ courseId, file, onProgress }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `${courseId}/${uuidV4()}-${safeName}`;

  if (onProgress) onProgress(0);
  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  if (onProgress) onProgress(100);

  return {
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || null,
  };
};

// Path convention exam-questions/<course_id>/<random>-<name> — for a
// diagram, equation or graph a textarea prompt can't express. Scoped by
// course rather than exam id (059) so an image can be attached while
// building a brand-new, not-yet-saved exam, which has no exam id yet.
export const uploadExamQuestionImage = async ({ courseId, file }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `exam-questions/${courseId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
};

export const removeExamQuestionImage = async (path) => {
  await supabase.storage.from(MATERIALS_BUCKET).remove([path]).catch(() => {});
};

// Path convention submissions/<assignment_id>/<user_id>/<random>-<name> — the
// storage policy (057) reads segment [3] (the user id) to decide who may
// write and, together with can_manage_assignment on segment [2], who may
// read it back.
export const uploadSubmissionFile = async ({ assignmentId, userId, file }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `submissions/${assignmentId}/${userId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return { file_path: path, file_name: file.name, file_size: file.size };
};

// The bucket is private, so downloads go through a short-lived signed URL
// rather than a public link anyone could pass around.
export const signedMaterialUrl = async (path, seconds = 300) => {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
};

export const deleteMaterialFile = async (path) => {
  const { error } = await supabase.storage.from(MATERIALS_BUCKET).remove([path]);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* logos & avatars                                                            */
/* -------------------------------------------------------------------------- */

// A public bucket, unlike course-materials — a school logo and a profile
// avatar are meant to be visible wherever they're already rendered (nav bar,
// report cards, tutor listings), so the upload returns a directly-usable
// public URL rather than a path needing a signed URL at render time.
const PUBLIC_MEDIA_BUCKET = "public-media";

const publicMediaUrl = (path) => supabase.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;

// The storage policy only cares about the path, not the DB row — extracting
// it back out of a stored public URL is how "remove" finds what to delete.
const pathFromPublicUrl = (url) => {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/`;
  const at = url.indexOf(marker);
  return at === -1 ? null : url.slice(at + marker.length);
};

// Path convention logos/<school_id>/<random>-<name> — the storage policy
// (073) reads segment [2] to check classroom.is_school_admin.
export const uploadSchoolLogo = async ({ schoolId, file }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `logos/${schoolId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return publicMediaUrl(path);
};

export const removeSchoolLogo = async (logoUrl) => {
  const path = pathFromPublicUrl(logoUrl);
  if (path) await supabase.storage.from(PUBLIC_MEDIA_BUCKET).remove([path]).catch(() => {});
};

// Same shape as the logo, for the signature image that goes on official
// documents like the admission letter — signatures/<school_id>/<random>-
// <name>, guarded by the same storage policy (132_school_admission_
// signature.sql reads segment [2] via classroom.is_school_admin).
export const uploadSchoolSignature = async ({ schoolId, file }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `signatures/${schoolId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return publicMediaUrl(path);
};

export const removeSchoolSignature = async (signatureUrl) => {
  const path = pathFromPublicUrl(signatureUrl);
  if (path) await supabase.storage.from(PUBLIC_MEDIA_BUCKET).remove([path]).catch(() => {});
};

// Path convention avatars/<user_id>/<random>-<name> — the storage policy
// (073) allows the person themselves, or an admin of any school they
// belong to (the same reach the People panel's "Edit" already has).
export const uploadAvatar = async ({ userId, file }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `avatars/${userId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return publicMediaUrl(path);
};

export const removeAvatar = async (avatarUrl) => {
  const path = pathFromPublicUrl(avatarUrl);
  if (path) await supabase.storage.from(PUBLIC_MEDIA_BUCKET).remove([path]).catch(() => {});
};

// One helper for both materials and assignments; the path prefix decides how
// downstream code treats it, and how the storage policy names it in logs.
export const uploadCourseFile = async ({ courseId, file, prefix = "" }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `${courseId}/${prefix}${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return {
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || null,
  };
};

/* -------------------------------------------------------------------------- */
/* exam editing                                                               */
/* -------------------------------------------------------------------------- */

export const updateQuestion = async (id, changes, schoolId) => {
  const { data: owned, error: checkError } = await supabase
    .from("exam_questions")
    .select("id, exams!inner ( courses!inner ( school_id ) )")
    .eq("id", id)
    .eq("exams.courses.school_id", schoolId)
    .maybeSingle();
  if (checkError) throw checkError;
  if (!owned) throw new Error("Question not found in this school.");

  const { error } = await supabase
    .from("exam_questions")
    .update(changes)
    .eq("id", id);
  if (error) throw error;
};

export const deleteOptionsForQuestion = async (questionId, schoolId) => {
  const { data: owned, error: checkError } = await supabase
    .from("exam_questions")
    .select("id, exams!inner ( courses!inner ( school_id ) )")
    .eq("id", questionId)
    .eq("exams.courses.school_id", schoolId)
    .maybeSingle();
  if (checkError) throw checkError;
  if (!owned) throw new Error("Question not found in this school.");

  const { error } = await supabase
    .from("exam_options")
    .delete()
    .eq("question_id", questionId);
  if (error) throw error;
};

// How many students have already sat this paper. Restructuring questions
// after that point would discard their answers, so the editor asks first.
export const countAttempts = async ({ schoolId, examId }) => {
  const { count, error } = await supabase
    .from("exam_attempts")
    .select("id, exams!inner ( course_id, courses!inner ( school_id ) )", { count: "exact", head: true })
    .eq("exam_id", examId)
    .eq("exams.courses.school_id", schoolId);
  if (error) throw error;
  return count || 0;
};

/* -------------------------------------------------------------------------- */
/* tenancy — schools and membership                                           */
/* -------------------------------------------------------------------------- */

export const fetchSchool = async (slug) => {
  const { data, error } = await supabase
    .from("schools")
    .select("id, name, slug, logo_url, theme_color, address, phone, email, timezone, currency, plan, is_active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const updateSchool = async (id, changes) => {
  const { data, error } = await supabase
    .from("schools")
    .update(changes)
    .eq("id", id)
    .select(
      `id, name, slug, logo_url, theme_color, address, phone, email, timezone, currency,
       disabled_modules,
       signature_url, signatory_name, signatory_title,
       admission_letter_offer_intro, admission_letter_enrolled_intro, admission_letter_closing`
    )
    .single();
  if (error) throw error;
  return data;
};

// The school's people. profiles is embedded through the membership's own
// foreign key so the join is unambiguous.
export const fetchSchoolMembers = async (schoolId) => {
  const { data, error } = await supabase
    .from("school_members")
    // user_id is what invoices and payments and every other table joins on;
    // without it the Bursary invoice table falls back to "Student" instead
    // of the child's name.
    .select(`id, user_id, role, is_active, created_at, manager_id, profiles!school_members_user_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.filter((row) => row.profiles);
};

export const updateMemberRole = async ({ schoolId, memberId, role }) => {
  const { error } = await supabase
    .from("school_members")
    .update({ role })
    .eq("id", memberId)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// managerId is a school_members.user_id, or null to clear "reports to".
// The manager_id column itself points at classroom.profiles (shared 1:1
// with auth.users), same convention as every other author/user column —
// the DB trigger (school_members_manager_check) is what actually enforces
// "same school, active, not yourself", not this call.
export const updateMemberManager = async ({ schoolId, memberId, managerId }) => {
  const { error } = await supabase
    .from("school_members")
    .update({ manager_id: managerId || null })
    .eq("id", memberId)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const setMemberActive = async ({ schoolId, memberId, isActive }) => {
  const { error } = await supabase
    .from("school_members")
    .update({ is_active: isActive })
    .eq("id", memberId)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const removeMember = async ({ memberId, schoolId }) => {
  const { error } = await supabase
    .from("school_members")
    .delete()
    .eq("id", memberId)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// Resets someone else's password — not possible from the browser on its own,
// since Supabase only lets a person change their OWN password. The
// admin-reset-password Edge Function checks classroom.can_manage_member_account
// itself before doing anything privileged; this just calls it the same way
// startOnlinePayment calls pay-init.
export const resetMemberPassword = async ({ schoolId, userId }) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");

  const { data, error } = await supabase.functions.invoke("admin-reset-password", {
    body: { schoolId, targetUserId: userId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let detail = "";
    try {
      detail = (await error.context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Could not reset that password.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

// Adds someone to this school and creates their login.
//
// Two routes, because the two kinds of account are genuinely different:
//
//   Staff and students hold school addresses. The administrator creates the
//   account outright and hands over a password the person replaces on first
//   sign-in. No email is involved, which matters when a bursar is setting up
//   three hundred pupils.
//
//   Parents use their own personal address. The administrator has no business
//   issuing them a password, and cannot hand one over in person anyway — so
//   they are emailed a link and choose their own.
export const addSchoolUser = async ({ schoolId, email, firstName, surname, role }) => {
  const address = email.trim().toLowerCase();
  const byInvitation = role === "parent";
  const password = temporaryPassword();

  let userId = null;
  let existed = false;

  try {
    const created = await createAuthUser({
      email: address,
      firstName: firstName.trim(),
      surname: surname.trim(),
      password,
    });
    userId = created.userId;
    existed = created.existed;
  } catch (err) {
    throw new Error(err.message || "Could not create that account.");
  }

  if (!userId) {
    throw new Error(
      existed
        ? `${address} already has an account. Supabase will not reveal its id to the browser, so ask them to sign in here once — then adding them will work.`
        : "The account was created but its id was not returned. Ask them to sign in once, then add them again."
    );
  }

  const { error: memberError } = await supabase
    .from("school_members")
    .upsert(
      { school_id: schoolId, user_id: userId, role, is_active: true },
      { onConflict: "school_id,user_id" }
    );
  if (memberError) throw new Error(memberError.message);

  if (byInvitation) {
    try {
      await invitePasswordSetup(address, schoolId);
      return { user_id: userId, email: address, role, invited: true, emailed: true };
    } catch {
      // The mailer failed — commonly the free-tier hourly limit. The account
      // exists either way, so fall back to handing the password over rather
      // than leaving the parent locked out with no explanation.
      await supabase
        .rpc("require_password_change", { target_user: userId })
        .catch(() => {});
      return {
        user_id: userId,
        email: address,
        role,
        invited: true,
        emailed: false,
        password,
      };
    }
  }

  // Flag the account so the issued password is only good for getting in once.
  let mustChange = true;
  try {
    const { error } = await supabase.rpc("require_password_change", {
      target_user: userId,
    });
    if (error) mustChange = false;
  } catch {
    mustChange = false;
  }

  return { user_id: userId, email: address, role, password, mustChange };
};

// Called by the forced-change screen once the new password has been set.
export const clearPasswordChangeFlag = async () => {
  const { error } = await supabase.rpc("password_changed");
  if (error) throw error;
};


/* -------------------------------------------------------------------------- */
/* class levels — defined by each school, never seeded                        */
/* -------------------------------------------------------------------------- */

export const fetchLevelsForSchool = async (schoolId) => {
  const { data, error } = await supabase
    .from("levels")
    .select("year, label, school_id")
    .eq("school_id", schoolId)
    .order("year");
  if (error) throw error;
  return data;
};

export const createLevel = async ({ schoolId, year, label }) => {
  const { data, error } = await supabase
    .from("levels")
    .insert({ school_id: schoolId, year, label })
    .select("year, label")
    .single();
  if (error) throw error;
  return data;
};

export const renameLevel = async ({ schoolId, year, label }) => {
  const { error } = await supabase
    .from("levels")
    .update({ label })
    .eq("school_id", schoolId)
    .eq("year", year);
  if (error) throw error;
};

export const deleteLevel = async ({ schoolId, year }) => {
  const { error } = await supabase
    .from("levels")
    .delete()
    .eq("school_id", schoolId)
    .eq("year", year);
  if (error) throw error;
};

// How many courses sit on a level. Deleting a level cascades to its courses,
// so the UI has to warn before it happens.
export const countCoursesOnLevel = async ({ schoolId, year }) => {
  const { count, error } = await supabase
    .from("courses")
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId)
    .eq("level_year", year);
  if (error) throw error;
  return count || 0;
};

/* -------------------------------------------------------------------------- */
/* reports and guardians                                                      */
/* -------------------------------------------------------------------------- */

// Computed in Postgres, which checks who is asking before returning anything —
// a parent cannot fetch another child's rows by changing an id in the browser.
export const fetchStudentReport = async (studentId, schoolId) => {
  const { data, error } = await supabase.rpc("student_report", {
    target_student: studentId,
    target_school: schoolId,
  });
  if (error) throw error;
  return data || [];
};

export const fetchStudentMarks = async (studentId, schoolId) => {
  const { data, error } = await supabase.rpc("student_marks", {
    target_student: studentId,
    target_school: schoolId,
  });
  if (error) throw error;
  return data || [];
};

// Students this viewer is entitled to report on: their own children, the
// students in courses they teach, or everyone if they run the school.
export const fetchReportableStudents = async (schoolId) => {
  const { data, error } = await supabase.rpc("reportable_students", {
    target_school: schoolId,
  });
  if (error) throw error;
  return data || [];
};

export const fetchChildren = async (guardianId, schoolId) => {
  const { data, error } = await supabase
    .from("guardian_students")
    .select(`id, relationship, is_primary, student:profiles!guardian_students_student_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("guardian_id", guardianId)
    .eq("school_id", schoolId);
  if (error) throw error;
  return data.filter((row) => row.student);
};

export const fetchGuardiansOf = async (studentId, schoolId) => {
  const { data, error } = await supabase
    .from("guardian_students")
    .select(`id, relationship, guardian:profiles!guardian_students_guardian_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("student_id", studentId)
    .eq("school_id", schoolId);
  if (error) throw error;
  return data.filter((row) => row.guardian);
};

export const linkGuardian = async ({ schoolId, guardianId, studentId, relationship }) => {
  const { error } = await supabase.from("guardian_students").insert({
    school_id: schoolId,
    guardian_id: guardianId,
    student_id: studentId,
    relationship: relationship || null,
  });
  if (error) throw error;
};

export const unlinkGuardian = async (linkId, schoolId) => {
  const { error } = await supabase
    .from("guardian_students")
    .delete()
    .eq("id", linkId)
    .eq("school_id", schoolId);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* platform console                                                           */
/* -------------------------------------------------------------------------- */

export const fetchPlatformSchools = async () => {
  const { data, error } = await supabase.rpc("platform_schools");
  if (error) throw error;
  return data || [];
};

export const createSchool = async ({ name, slug, ownerEmail }) => {
  const { data, error } = await supabase.rpc("create_school", {
    school_name: name,
    school_slug: slug,
    owner_email: ownerEmail || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const setSchoolActive = async ({ id, isActive }) => {
  const { error } = await supabase
    .from("schools")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw error;
};

// Called after signing in on a school's subdomain, so a person who registers
// themselves actually becomes a member of that school.
export const joinSchool = async (slug) => {
  const { data, error } = await supabase.rpc("join_school", { target_slug: slug });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

/* -------------------------------------------------------------------------- */
/* academic structure                                                         */
/* -------------------------------------------------------------------------- */

export const fetchSessions = async (schoolId) => {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, name, starts_on, ends_on, is_current, applications_open")
    .eq("school_id", schoolId)
    .order("name", { ascending: false });
  if (error) throw error;
  return data;
};

// classroom.sessions' own SELECT policy is membership-gated — no use to an
// applicant, who is deliberately never a school_members row. This RPC is
// the non-member-safe read the accounted admissions flow uses instead.
export const fetchPublicAdmissionSessions = async (schoolId) => {
  const { data, error } = await supabase.rpc("public_admission_sessions", { target_school: schoolId });
  if (error) throw error;
  return data || [];
};

export const createSession = async ({ schoolId, name, startsOn, endsOn }) => {
  const { data, error } = await supabase
    .from("sessions")
    .insert({ school_id: schoolId, name, starts_on: startsOn || null, ends_on: endsOn || null })
    .select("id, name, starts_on, ends_on, is_current")
    .single();
  if (error) throw error;
  return data;
};

export const deleteSession = async (id, schoolId) => {
  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const fetchTerms = async (schoolId) => {
  const { data, error } = await supabase
    .from("terms")
    .select("id, session_id, name, position, starts_on, ends_on, is_current, sessions ( name )")
    .eq("school_id", schoolId)
    .order("position");
  if (error) throw error;
  return data;
};

export const createTerm = async ({ schoolId, sessionId, name, position, startsOn, endsOn }) => {
  const { data, error } = await supabase
    .from("terms")
    .insert({
      school_id: schoolId,
      session_id: sessionId,
      name,
      position,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
    })
    .select("id, name, position, is_current")
    .single();
  if (error) throw error;
  return data;
};

export const deleteTerm = async (schoolId, id) => {
  const { error } = await supabase
    .from("terms")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// One statement, so the school is never left with two current terms or none.
export const setCurrentTerm = async (termId, schoolId) => {
  const { data, error } = await supabase.rpc("set_current_term", {
    target_term: termId,
    target_school: schoolId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const fetchClasses = async (schoolId) => {
  const { data, error } = await supabase
    .from("classes")
    .select(`id, name, level_year, session_id, form_teacher_id,
             form_teacher:profiles!classes_form_teacher_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("school_id", schoolId)
    .order("level_year")
    .order("name");
  if (error) throw error;
  return data;
};

export const createClass = async ({ schoolId, sessionId, levelYear, name, formTeacherId }) => {
  const { data, error } = await supabase
    .from("classes")
    .insert({
      school_id: schoolId,
      session_id: sessionId || null,
      level_year: levelYear,
      name,
      form_teacher_id: formTeacherId || null,
    })
    .select("id, name, level_year")
    .single();
  if (error) throw error;
  return data;
};

export const updateClass = async (id, schoolId, changes) => {
  const { error } = await supabase
    .from("classes")
    .update(changes)
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const deleteClass = async (id, schoolId) => {
  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const fetchClassRoster = async (classId, schoolId) => {
  const { data, error } = await supabase
    .from("class_students")
    .select(`id, added_at, student:profiles!class_students_student_id_fkey ( ${PROFILE_FIELDS} ), classes!inner ( school_id )`)
    .eq("class_id", classId)
    .eq("classes.school_id", schoolId);
  if (error) throw error;
  return data.filter((row) => row.student);
};

// class_students has no school_id of its own — verify the target class
// belongs to the caller's current school before inserting.
export const addStudentToClass = async ({ classId, studentId, schoolId }) => {
  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (classError) throw classError;
  if (!classRow) throw new Error("That class does not belong to this school.");

  const { error } = await supabase
    .from("class_students")
    .insert({ class_id: classId, student_id: studentId });
  if (error) throw error;
};

export const removeStudentFromClass = async (rowId, schoolId) => {
  const { data: owned, error: checkError } = await supabase
    .from("class_students")
    .select("id, classes!inner ( school_id )")
    .eq("id", rowId)
    .eq("classes.school_id", schoolId)
    .maybeSingle();
  if (checkError) throw checkError;
  if (!owned) throw new Error("Student not found in this class.");

  const { error } = await supabase.from("class_students").delete().eq("id", rowId);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* attendance                                                                 */
/* -------------------------------------------------------------------------- */

// A bare "YYYY-MM-DD" upper bound compared against a timestamptz column
// means midnight at the START of that day — anything marked later the same
// day would be silently excluded. Stretches a bare date to the last instant
// of that day; a value that already carries a time (or is empty) passes
// through untouched.
const endOfDay = (to) => (to && to.length === 10 ? `${to}T23:59:59.999` : to);

// Every class the signed-in caller may mark today — the server-side rule
// (classroom.can_mark_attendance: form teacher, a subject teacher on that
// class, or owner/admin/principal) decides this, not a role check here.
export const fetchMarkableClasses = async (schoolId) => {
  const { data, error } = await supabase.rpc("markable_classes", { target_school: schoolId });
  if (error) throw error;
  return data || [];
};

// The roster for one class SESSION (a specific date+time, not just a day —
// the same class can be marked more than once a day, once per period) each
// row already carrying that session's mark if one exists. A left join done
// client-side since class_students and attendance_records don't share a
// foreign key to join on directly for a single session.
export const fetchAttendanceForClass = async ({ classId, schoolId, sessionAt }) => {
  const [roster, { data: marks, error }] = await Promise.all([
    fetchClassRoster(classId, schoolId),
    supabase
      .from("attendance_records")
      .select("id, student_id, status, note")
      .eq("class_id", classId)
      .eq("session_at", sessionAt),
  ]);
  if (error) throw error;
  const byStudent = new Map((marks || []).map((m) => [m.student_id, m]));
  return roster.map((row) => ({
    student: row.student,
    mark: byStudent.get(row.student.id) || null,
  }));
};

// records: [{ student_id, status, note }] — one bulk upsert for the whole
// roster's mark for one session. marked_by/updated_at are stamped
// server-side (attendance_records_stamp trigger), never trusted from here.
export const saveAttendance = async ({ schoolId, classId, sessionAt, records }) => {
  const { error } = await supabase
    .from("attendance_records")
    .upsert(
      records.map((r) => ({
        school_id: schoolId,
        class_id: classId,
        session_at: sessionAt,
        student_id: r.student_id,
        status: r.status,
        note: r.note || null,
      })),
      { onConflict: "class_id,student_id,session_at" }
    );
  if (error) throw error;
};

// The Records/report view — a class's marks over a date range, most recent
// first. Omit classId to see every class in the school (staff only; RLS
// still narrows a guardian down to their own child regardless of filters).
export const fetchAttendanceRecords = async ({ schoolId, classId, from, to }) => {
  let query = supabase
    .from("attendance_records")
    .select(
      `id, session_at, status, note,
       student:profiles!attendance_records_student_id_fkey ( ${PROFILE_FIELDS} ),
       classes!inner ( id, name, school_id ),
       marker:profiles!attendance_records_marked_by_fkey ( first_name, surname )`
    )
    .eq("classes.school_id", schoolId)
    .order("session_at", { ascending: false });
  if (classId) query = query.eq("class_id", classId);
  if (from) query = query.gte("session_at", from);
  if (to) query = query.lte("session_at", endOfDay(to));
  const { data, error } = await query;
  if (error) throw error;
  return data.filter((row) => row.student);
};

// A parent's own children's class attendance, across however many of them
// are enrolled at this school — RLS (is_guardian_of) is what actually
// enforces this stays to their own kids regardless of what's asked for here.
export const fetchMyChildrenAttendance = async ({ schoolId, guardianId, from, to }) => {
  const children = await fetchChildren(guardianId, schoolId);
  if (children.length === 0) return [];
  const studentIds = children.map((c) => c.student.id);
  let query = supabase
    .from("attendance_records")
    .select(
      `id, session_at, status, note,
       student:profiles!attendance_records_student_id_fkey ( ${PROFILE_FIELDS} ),
       classes!inner ( name, school_id )`
    )
    .eq("classes.school_id", schoolId)
    .in("student_id", studentIds)
    .order("session_at", { ascending: false });
  if (from) query = query.gte("session_at", from);
  if (to) query = query.lte("session_at", endOfDay(to));
  const { data, error } = await query;
  if (error) throw error;
  return data.filter((row) => row.student);
};

// One student's whole class-attendance history, across every class they've
// been marked in — what the student profile's Attendance card is built
// from. RLS (staff/self/guardian) decides whether the caller may see it.
export const fetchStudentClassAttendance = async (studentId, schoolId) => {
  const { data, error } = await supabase
    .from("attendance_records")
    .select(`id, session_at, status, note, classes!inner ( id, name, school_id )`)
    .eq("student_id", studentId)
    .eq("classes.school_id", schoolId)
    .order("session_at", { ascending: false });
  if (error) throw error;
  return data;
};

/* -------------------------------------------------------------------------- */
/* school attendance — the biometric/card resumption feed                    */
/* -------------------------------------------------------------------------- */

// A manual entry (front-desk sign-in) for one person's arrival — the RLS
// policy "leadership manage school attendance" is what actually restricts
// this to owner/admin/principal, not a role check here.
export const logSchoolAttendance = async ({ schoolId, personId, resumedAt, note }) => {
  const { error } = await supabase.from("school_attendance_records").insert({
    school_id: schoolId,
    person_id: personId,
    resumed_at: resumedAt,
    source: "manual",
    note: note || null,
  });
  if (error) throw error;
};

// Every school member (student or staff) whose resumption can be looked up
// or logged — the same roster a front-desk search box picks a name from.
export const fetchSchoolPeopleForAttendance = async (schoolId) => {
  const rows = await fetchSchoolMembers(schoolId);
  return rows.map((r) => ({ id: r.profiles.id, role: r.role, profile: r.profiles }));
};

export const fetchSchoolAttendanceRecords = async ({ schoolId, personId, from, to }) => {
  let query = supabase
    .from("school_attendance_records")
    .select(
      `id, resumed_at, source, note,
       person:profiles!school_attendance_records_person_id_fkey ( ${PROFILE_FIELDS} )`
    )
    .eq("school_id", schoolId)
    .order("resumed_at", { ascending: false });
  if (personId) query = query.eq("person_id", personId);
  if (from) query = query.gte("resumed_at", from);
  if (to) query = query.lte("resumed_at", endOfDay(to));
  const { data, error } = await query;
  if (error) throw error;
  return data.filter((row) => row.person);
};

// Any signed-in person's own resumption history — a staff member checking
// their own record, or the fallback a parent's "my children" view builds on.
export const fetchMySchoolAttendance = async ({ schoolId, personId, from, to }) =>
  fetchSchoolAttendanceRecords({ schoolId, personId, from, to });

export const fetchMyChildrenSchoolAttendance = async ({ schoolId, guardianId, from, to }) => {
  const children = await fetchChildren(guardianId, schoolId);
  if (children.length === 0) return [];
  const studentIds = children.map((c) => c.student.id);
  let query = supabase
    .from("school_attendance_records")
    .select(
      `id, resumed_at, source, note,
       person:profiles!school_attendance_records_person_id_fkey ( ${PROFILE_FIELDS} )`
    )
    .eq("school_id", schoolId)
    .in("person_id", studentIds)
    .order("resumed_at", { ascending: false });
  if (from) query = query.gte("resumed_at", from);
  if (to) query = query.lte("resumed_at", endOfDay(to));
  const { data, error } = await query;
  if (error) throw error;
  return data.filter((row) => row.person);
};

/* -------------------------------------------------------------------------- */
/* attendance devices — biometric/card reader credentials                    */
/* -------------------------------------------------------------------------- */

export const fetchAttendanceDevices = async (schoolId) => {
  const { data, error } = await supabase
    .from("attendance_devices")
    .select("id, label, is_active, created_at, last_used_at")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
};

// Returns { id, api_key } — api_key is only ever available in this one
// response; classroom.create_attendance_device() stores only its hash.
export const createAttendanceDevice = async ({ schoolId, label }) => {
  const { data, error } = await supabase.rpc("create_attendance_device", {
    target_school: schoolId,
    device_label: label,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const setAttendanceDeviceActive = async ({ deviceId, schoolId, isActive }) => {
  const { error } = await supabase
    .from("attendance_devices")
    .update({ is_active: isActive })
    .eq("id", deviceId)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const fetchSubjects = async (schoolId) => {
  const { data, error } = await supabase
    .from("subjects")
    .select("id, code, name")
    .eq("school_id", schoolId)
    .order("name");
  if (error) throw error;
  return data;
};

export const createSubject = async ({ schoolId, code, name }) => {
  const { data, error } = await supabase
    .from("subjects")
    .insert({ school_id: schoolId, code: code || null, name })
    .select("id, code, name")
    .single();
  if (error) throw error;
  return data;
};

export const deleteSubject = async (id, schoolId) => {
  const { error } = await supabase
    .from("subjects")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const fetchClassSubjects = async (classId, schoolId) => {
  const { data, error } = await supabase
    .from("class_subjects")
    .select(`id, subject_id, teacher_id,
             subjects ( id, code, name ),
             teacher:profiles!class_subjects_teacher_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("class_id", classId)
    .eq("school_id", schoolId);
  if (error) throw error;
  return data;
};

export const assignSubjectToClass = async ({ schoolId, classId, subjectId, teacherId }) => {
  const { error } = await supabase.from("class_subjects").insert({
    school_id: schoolId,
    class_id: classId,
    subject_id: subjectId,
    teacher_id: teacherId || null,
  });
  if (error) throw error;
};

export const updateClassSubject = async (id, schoolId, changes) => {
  const { error } = await supabase
    .from("class_subjects")
    .update(changes)
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const removeClassSubject = async (id, schoolId) => {
  const { error } = await supabase
    .from("class_subjects")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

export const fetchMyTeaching = async (schoolId) => {
  const { data, error } = await supabase.rpc("my_teaching", { target_school: schoolId });
  if (error) throw error;
  return data || [];
};

/* -------------------------------------------------------------------------- */
/* editing what has been published                                            */
/* -------------------------------------------------------------------------- */

export const updateMaterial = async (id, changes, schoolId) => {
  const { data: owner, error: ownerError } = await supabase
    .from("materials")
    .select("id, courses!inner(school_id)")
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) throw new Error("Material not found in this school.");

  const { data, error } = await supabase
    .from("materials")
    .update(changes)
    .eq("id", id)
    .select("id, title, description, url, created_at, file_path, file_name, file_size")
    .single();
  if (error) throw error;
  return data;
};

export const updateAssignment = async (id, changes, courseId) => {
  const { data, error } = await supabase
    .from("assignments")
    .update(changes)
    .eq("id", id)
    .eq("course_id", courseId)
    .select("id, title, description, points, due_at, created_at")
    .single();
  if (error) throw error;
  return data;
};

// Authors may correct their own posts. edited_at is stamped so the class can
// see a message was changed after the fact.
export const updateMessage = async ({ id, body }) => {
  const { data, error } = await supabase
    .from("messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", id)
    .select(`id, body, created_at, edited_at, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .single();
  if (error) throw error;
  return data;
};

export const deleteMessage = async ({ id, schoolId }) => {
  const { data, error } = await supabase
    .from("messages")
    .delete()
    .eq("id", id)
    .eq("courses.school_id", schoolId)
    .select("id, courses!inner(school_id)");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Message not found in this school.");
};

/* -------------------------------------------------------------------------- */
/* comments under a stream post                                               */
/* -------------------------------------------------------------------------- */

const COMMENT_FIELDS = `id, message_id, body, created_at, edited_at, user_id, profiles ( ${PROFILE_FIELDS} )`;

// One request for the whole stream rather than one per post: a course with
// thirty announcements should not fire thirty queries on every render.
export const fetchCommentsFor = async (messageIds) => {
  if (!messageIds || messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from("message_comments")
    .select(COMMENT_FIELDS)
    .in("message_id", messageIds)
    .order("created_at");
  if (error) throw error;

  const byMessage = {};
  for (const row of data) {
    (byMessage[row.message_id] = byMessage[row.message_id] || []).push(row);
  }
  return byMessage;
};

export const postComment = async ({ messageId, userId, body }) => {
  const { data, error } = await supabase
    .from("message_comments")
    .insert({ message_id: messageId, user_id: userId, body })
    .select(COMMENT_FIELDS)
    .single();
  if (error) throw error;
  return data;
};

export const updateComment = async ({ id, body }) => {
  const { data, error } = await supabase
    .from("message_comments")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", id)
    .select(COMMENT_FIELDS)
    .single();
  if (error) throw error;
  return data;
};

export const deleteComment = async ({ id, schoolId }) => {
  const { data: owned, error: checkError } = await supabase
    .from("message_comments")
    .select("id, messages!inner ( course_id, courses!inner ( school_id ) )")
    .eq("id", id)
    .eq("messages.courses.school_id", schoolId)
    .maybeSingle();
  if (checkError) throw checkError;
  if (!owned) throw new Error("Comment not found in this school.");

  const { error } = await supabase.from("message_comments").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* admissions                                                                 */
/* -------------------------------------------------------------------------- */

export const APPLICATION_STATUSES = [
  ["submitted", "Submitted", "warn"],
  ["screening", "Screening", "brand"],
  ["offered", "Offered", "brand"],
  ["accepted", "Accepted", "success"],
  ["enrolled", "Enrolled", "success"],
  ["declined", "Declined", undefined],
  ["rejected", "Rejected", "danger"],
  ["withdrawn", "Withdrawn", undefined],
];

export const STATUS_LABEL = Object.fromEntries(
  APPLICATION_STATUSES.map(([value, label]) => [value, label])
);
export const STATUS_TONE = Object.fromEntries(
  APPLICATION_STATUSES.map(([value, , tone]) => [value, tone])
);

// Which moves the database will accept. Mirrors decide_application() so the
// interface only offers what will actually work — the rule is still enforced
// server-side either way.
export const NEXT_STATUSES = {
  submitted: ["screening", "offered", "rejected", "withdrawn"],
  screening: ["offered", "rejected", "withdrawn"],
  offered: ["accepted", "declined", "rejected", "withdrawn"],
  accepted: ["withdrawn"],
  enrolled: [],
  declined: ["offered"],
  rejected: ["screening"],
  withdrawn: ["screening"],
};

// Public: no account needed.
export const submitApplication = async ({ slug, ...fields }) => {
  const { data, error } = await supabase.rpc("submit_application", {
    target_slug: slug,
    first_name: fields.firstName,
    surname: fields.surname,
    guardian_name: fields.guardianName,
    guardian_email: fields.guardianEmail,
    middle_name: fields.middleName || null,
    date_of_birth: fields.dateOfBirth || null,
    gender: fields.gender || null,
    applying_for_level: fields.applyingForLevel ? Number(fields.applyingForLevel) : null,
    previous_school: fields.previousSchool || null,
    guardian_phone: fields.guardianPhone || null,
    guardian_relation: fields.guardianRelation || null,
    address: fields.address || null,
    notes: fields.notes || null,
    document_links: fields.documentLinks || null,
    document_uploads: fields.documentUploads?.length ? fields.documentUploads : null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

// Uploaded before the application exists — there's no application_id yet,
// so this writes straight to storage under admissions/<schoolId>/<random>-
// <name>. The RLS policy (051) is what actually decides an anonymous caller
// may write there at all; this function does nothing to enforce that itself.
// submitApplication() registers the result into application_documents once
// the application id exists.
export const uploadPublicApplicationDocument = async ({ schoolId, file, kind }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `admissions/${schoolId}/${uuidV4()}-${safeName}`;
  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET_NAME)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return { path, name: file.name, size: file.size, mime_type: file.type || null, kind: kind || "other" };
};

// Lets a family remove an attachment before submitting. Once submitted, the
// same storage policy refuses this — the file is application_documents'
// responsibility from then on, the same as a staff-uploaded one.
export const removePublicApplicationDocument = async (path) => {
  const { error } = await supabase.storage.from(MATERIALS_BUCKET_NAME).remove([path]);
  if (error) throw error;
};

// Public: needs the reference and the guardian's email together, so a
// guessed reference on its own reveals nothing.
export const trackApplication = async ({ reference, email }) => {
  const { data, error } = await supabase.rpc("track_application", {
    target_reference: reference,
    target_email: email,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
};

// Links an application that was submitted without an account (the public
// /Apply form) to the signed-in caller, using the same reference+email pair
// trackApplication() already asked for. From then on it behaves exactly
// like any other accounted application — fetchMyApplications() lists it,
// the dashboard lets its flagged sections be edited and resubmitted.
export const claimApplication = async ({ reference, email }) => {
  const { data, error } = await supabase.rpc("claim_application", {
    target_reference: reference,
    target_email: email,
  });
  if (error) throw error;
  return data;
};

export const fetchApplications = async ({ schoolId, status = null }) => {
  let query = supabase
    .from("applications")
    .select(
      `id, reference, first_name, surname, middle_name, date_of_birth, gender,
       applying_for_level, previous_school, guardian_name, guardian_email,
       guardian_phone, guardian_relation, address, notes, document_links,
       status, offer_expires_at, decided_at, created_at, student_id, class_id,
       sessions ( id, name ), classes ( id, name )`
    )
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });
  if (status && status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const fetchApplication = async (id, schoolId) => {
  const { data, error } = await supabase
    .from("applications")
    .select(
      `id, school_id, reference, first_name, surname, middle_name, date_of_birth,
       gender, applying_for_level, previous_school, guardian_name, guardian_email,
       guardian_phone, guardian_relation, address, notes, document_links, status,
       offer_expires_at, decided_at, created_at, student_id, class_id,
       sessions ( id, name ), classes ( id, name ),
       schools ( id, name, slug, logo_url, address, phone, email,
                 signature_url, signatory_name, signatory_title,
                 admission_letter_offer_intro, admission_letter_enrolled_intro, admission_letter_closing )`
    )
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchApplicationEvents = async (applicationId, schoolId) => {
  const { data, error } = await supabase
    .from("application_events")
    .select("id, status_from, status_to, actor_label, note, created_at, applications!inner ( school_id )")
    .eq("application_id", applicationId)
    .eq("applications.school_id", schoolId)
    .order("created_at");
  if (error) throw error;
  return data;
};

export const fetchAdmissionsSummary = async (schoolId) => {
  const { data, error } = await supabase.rpc("admissions_summary", {
    target_school: schoolId,
  });
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.status, row.count]));
};

// The legal transitions are enforced in the database; a refusal here means
// the move genuinely was not allowed.
export const decideApplication = async ({ id, schoolId, status, note, offerExpires, conditions }) => {
  const { data, error } = await supabase.rpc("decide_application", {
    target_application: id,
    new_status: status,
    current_school: schoolId,
    note: note || null,
    offer_expires: offerExpires || null,
    conditions_in: conditions || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

// Password reset ("reset", pre-auth, no session yet) and new-member
// activation ("invite", sent by a school admin right after adding someone)
// — both routed through the school's own connected mailbox when it has
// one, falling back to Supabase's own default email otherwise. Always
// resolves even for an unknown email/school, by design (see
// auth-email-send's own comment) — never throws, so a caller can show the
// same "if that address has an account..." message either way.
export const sendBrandedAuthEmail = async ({ schoolId, email, kind }) => {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke("auth-email-send", {
    body: { schoolId, email, kind },
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (error) throw error;
  return data;
};

// Emails the applicant's guardian a branded update — a decision (offer/
// enrolled/rejected) or a free-form note from admissions staff. Never
// throws for "no mailbox connected" (that's an expected, common state, not
// a failure) — callers check `sent` and show a different toast for it.
export const notifyApplicant = async ({ applicationId, schoolId, kind, message }) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");

  const { data, error } = await supabase.functions.invoke("admissions-notify", {
    body: { applicationId, schoolId, kind, message },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let detail = "";
    try {
      detail = (await error.context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Could not message that applicant.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

/* -------------------------------------------------------------------------- */
/* admissions — Phase 5: student promotion / matric registration              */
/* -------------------------------------------------------------------------- */

// Supersedes the old enrol_applicant() — see 067_student_registrations.sql.
// Returns the new student_registrations row (including the assigned
// registration number), not the application row.
export const promoteApplicantToStudent = async ({ id, studentId, classId, schoolId }) => {
  const { data, error } = await supabase.rpc("promote_applicant_to_student", {
    target_application: id,
    target_student: studentId,
    target_school: schoolId,
    target_class: classId || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const fetchStudentRegistrationForApplication = async (applicationId, schoolId) => {
  const { data, error } = await supabase
    .from("student_registrations")
    .select("id, registration_number, status, registered_at, class:classes(name)")
    .eq("application_id", applicationId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// The school's own registry — every student ever promoted, searchable and
// with a lifecycle (active/withdrawn/graduated/transferred) staff can move
// through as circumstances change, not just a one-time write.
export const fetchStudentRegistrations = async (schoolId) => {
  const { data, error } = await supabase
    .from("student_registrations")
    .select(`
      id, registration_number, status, registered_at, notes, application_id,
      student:profiles!student_id (id, first_name, surname, email),
      session:sessions (name),
      class:classes (name)
    `)
    .eq("school_id", schoolId)
    .order("registered_at", { ascending: false });
  if (error) throw error;
  return data || [];
};

export const updateStudentRegistration = async ({ id, schoolId, status, notes }) => {
  const { data, error } = await supabase
    .from("student_registrations")
    .update({ status, notes: notes ?? null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("school_id", schoolId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

/* -------------------------------------------------------------------------- */
/* admissions — accounted applicant workflow (Phase 1)                        */
/* -------------------------------------------------------------------------- */

// Best-match admissions configuration for a session, falling back to the
// school default, then to a hard-coded default. The applicant portal reads
// this before showing anything, since fee gating, referees, next-of-kin and
// faculty hierarchy all depend on it.
export const fetchAdmissionConfig = async ({ schoolId, sessionId }) => {
  const { data, error } = await supabase.rpc("effective_admission_config", {
    target_school: schoolId,
    target_session: sessionId,
  });
  if (error) throw error;
  return data || {};
};

export const fetchAdmissionProgrammes = async ({ schoolId, sessionId }) => {
  const { data, error } = await supabase
    .from("admission_programmes")
    .select("id, name, code, faculty, department, study_mode, entry_requirements")
    .eq("school_id", schoolId)
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .order("faculty", { nullsFirst: true })
    .order("name");
  if (error) throw error;
  return data;
};

export const fetchDocumentRequirements = async ({
  schoolId,
  sessionId,
  programmeId,
}) => {
  let query = supabase
    .from("document_requirements")
    .select("id, kind, label, is_required, position, notes, programme_id")
    .eq("school_id", schoolId)
    .order("position");
  if (sessionId) query = query.or(`session_id.eq.${sessionId},session_id.is.null`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter(
    (r) => !r.programme_id || r.programme_id === programmeId
  );
};

/* admissions settings (school admin) — the configurable-protocols surface.
   Every table here already carries a full-CRUD RLS policy for
   owner/admin/principal/admissions (040_admissions_engine.sql); these are
   the write paths nothing in the UI has ever called until now. */

// The actual stored row for one (school, session) — distinct from
// fetchAdmissionConfig's effective_admission_config(), which always returns
// something (merged with defaults) even when nothing has been configured
// yet. The settings editor needs to know which one is true.
export const fetchAdmissionConfigRow = async ({ schoolId, sessionId }) => {
  let query = supabase
    .from("admission_config")
    .select("*")
    .eq("school_id", schoolId);
  query = sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
};

// A plain .upsert() can't be trusted here: the unique(school_id, session_id)
// constraint never fires for two NULL session_ids (standard SQL — NULL is
// never equal to NULL), so the school-wide default row could silently
// duplicate. Check-then-write instead.
export const saveAdmissionConfig = async ({ schoolId, sessionId, ...fields }) => {
  const existing = await fetchAdmissionConfigRow({ schoolId, sessionId });
  const row = { ...fields, school_id: schoolId, session_id: sessionId || null };
  if (existing) {
    const { data, error } = await supabase
      .from("admission_config")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("admission_config")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const createAdmissionProgramme = async ({ schoolId, sessionId, ...fields }) => {
  const { data, error } = await supabase
    .from("admission_programmes")
    .insert({ school_id: schoolId, session_id: sessionId, ...fields })
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const updateAdmissionProgramme = async ({ id, schoolId, ...fields }) => {
  const { data, error } = await supabase
    .from("admission_programmes")
    .update(fields)
    .eq("id", id)
    .eq("school_id", schoolId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const deleteAdmissionProgramme = async (id, schoolId) => {
  const { error } = await supabase
    .from("admission_programmes")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// schoolId is forced onto the payload rather than trusted from `row` — pins
// every write to the caller's own validated current-tenant id regardless of
// what row.school_id happened to carry.
export const upsertDocumentRequirement = async (row, schoolId) => {
  const { data, error } = await supabase
    .from("document_requirements")
    .upsert({ ...row, school_id: schoolId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const deleteDocumentRequirement = async (id, schoolId) => {
  const { error } = await supabase
    .from("document_requirements")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// The applicant's own account for this school. One row per (school, user).
export const createApplicantAccount = async ({
  schoolId,
  firstName,
  surname,
  email,
  phone,
  middleName,
  dateOfBirth,
  nationality,
}) => {
  const { data, error } = await supabase.rpc("create_applicant_account", {
    target_school: schoolId,
    first_name_in: firstName,
    surname_in: surname,
    email_in: email,
    phone_in: phone || null,
    middle_name_in: middleName || null,
    date_of_birth_in: dateOfBirth || null,
    nationality_in: nationality || null,
  });
  if (error) throw error;
  return data;
};

// Staff-facing: look up an applicant's account by id — RLS (can_do_admissions)
// is what makes this safe for someone other than the applicant themselves.
// Used to enrol an accounted applicant straight into their existing login
// rather than colliding with it by trying to create a second one.
export const fetchApplicantAccount = async (id, schoolId) => {
  const { data, error } = await supabase
    .from("applicant_accounts")
    .select("id, user_id, email, first_name, surname")
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// user_id is required, not just left to RLS — "applicant reads own
// account"'s SELECT policy also lets owner/admin/principal/admissions read
// EVERY applicant account at their school (so they can review one), so a
// staff member calling this without the filter got back every applicant's
// row at once. .maybeSingle() then threw "JSON object requested, multiple
// (or no) rows returned" instead of "this staff member has no applicant
// account of their own" (the true, and completely unremarkable, answer) —
// confirmed live, a real admin visiting /Applications hit this exact error.
export const fetchMyApplicantAccount = async (schoolId, userId) => {
  const { data, error } = await supabase
    .from("applicant_accounts")
    .select("*")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// Whether this signed-in person is a real tenant member at this school —
// used by ApplicantLogin.jsx to refuse a staff/student/parent account
// signing in through the applicant-only door. Safe to call for someone
// with no membership at all: "members read the roster"'s own RLS policy
// allows reading your OWN row (user_id = auth.uid()) regardless of whether
// you belong to the school, so this just comes back empty rather than
// erroring for a true applicant.
export const fetchMySchoolMembership = async (schoolId, userId) => {
  const { data, error } = await supabase
    .from("school_members")
    .select("id, role, is_active")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchMyApplications = async (schoolId) => {
  const { data, error } = await supabase.rpc("my_applications", { target_school: schoolId });
  if (error) throw error;
  return data || [];
};

// The applicant's own document checklist — same shape application_
// workspace() gives staff, minus the staff-only gate.
export const fetchMyApplicationDocuments = async (applicationId) => {
  const { data, error } = await supabase.rpc("my_application_documents", {
    target_application: applicationId,
  });
  if (error) throw error;
  return data || [];
};

// Same idea, for screening — the applicant's own read-only view of exactly
// what staff see under "Screening" (Online Interview: passed, Common
// Entrance Exam: pending, ...), instead of just the generic "Under review"
// dot on the Progress tracker.
export const fetchMyApplicationScreening = async (applicationId) => {
  const { data, error } = await supabase.rpc("my_application_screening", {
    target_application: applicationId,
  });
  if (error) throw error;
  return data || [];
};

// The applicant's own read of their admission letter — same joined shape
// fetchApplication() gives staff, gated server-side to only offered/
// accepted/enrolled applications (133_applicant_admission_letter.sql).
export const fetchMyApplicationLetter = async (applicationId) => {
  const { data, error } = await supabase.rpc("my_application_letter", {
    target_application: applicationId,
  });
  if (error) throw error;
  return data;
};

// Uploads straight to storage under the same admissions/<school>/<application>/
// prefix the anonymous pre-submission form already writes to (051's bucket
// policy only checks the school segment, not who's asking), then registers
// it against this checklist entry — application_documents has no
// direct-insert policy, so the RPC is the only legal way to link it.
export const uploadMyApplicationDocument = async ({
  schoolId,
  applicationId,
  requirementId,
  file,
  kind,
}) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `admissions/${schoolId}/${applicationId}/${uuidV4()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("course-materials")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase.rpc("record_applicant_document_upload", {
    target_school: schoolId,
    target_application: applicationId,
    target_requirement: requirementId,
    file_path_in: path,
    file_name_in: file.name,
    file_size_in: file.size,
    mime_type_in: file.type || null,
    kind_in: kind || "other",
  });
  if (error) {
    await supabase.storage.from("course-materials").remove([path]).catch(() => {});
    throw error;
  }
  return data;
};

export const startApplication = async ({ sessionId, programmeId }) => {
  const { data, error } = await supabase.rpc("start_application", {
    target_session: sessionId,
    target_programme: programmeId || null,
  });
  if (error) throw error;
  return data;
};

export const saveApplicationSection = async ({
  applicationId,
  section,
  payload,
}) => {
  const { data, error } = await supabase.rpc("save_application_section", {
    target_application: applicationId,
    section_name: section,
    payload,
  });
  if (error) throw error;
  return data;
};

export const submitMyApplication = async ({
  applicationId,
  declarationAccepted,
}) => {
  const { data, error } = await supabase.rpc("submit_my_application", {
    target_application: applicationId,
    declaration_accepted: declarationAccepted,
  });
  if (error) throw error;
  return data;
};

// A payment attempt is in flight, so the applicant is not asked to pay again
// while the gateway confirms. Handles the "PROCESSING" state end-to-end.
export const markApplicationPaymentInitiated = async (applicationId) => {
  const { data, error } = await supabase.rpc("pay_application_fee_initiated", {
    target_application: applicationId,
  });
  if (error) throw error;
  return data;
};

// Steps a stuck "processing" attempt back to "unpaid" — either automatically,
// right after pay-init itself fails to reach the gateway, or from the
// applicant's own "Cancel and try again" button if they abandoned checkout
// (closed the tab, the bank declined, etc.) and came back later.
export const cancelApplicationPayment = async (applicationId) => {
  const { data, error } = await supabase.rpc("cancel_application_payment_attempt", {
    target_application: applicationId,
  });
  if (error) throw error;
  return data;
};

// "I paid by transfer instead" — the admissions equivalent of Fees.jsx's
// declarePayment, except this one is a real RPC rather than a raw insert:
// it also has to move payment_state to processing, which a client insert
// cannot do atomically. Lands in the same Bursary "Payment queue" a term
// fee's declared payment does.
export const declareAdmissionsPayment = async ({
  invoiceId,
  amount,
  method,
  reference,
  paidOn,
  note,
  proofPath,
}) => {
  const { data, error } = await supabase.rpc("declare_admissions_payment", {
    target_invoice: invoiceId,
    amount,
    method: method || "transfer",
    reference: reference || null,
    paid_on: paidOn || new Date().toISOString().slice(0, 10),
    note: note || null,
    proof_path: proofPath || null,
  });
  if (error) throw error;
  return data;
};

export const setApplicantDocumentStatus = async ({
  docId,
  status,
  note,
  schoolId,
}) => {
  const { data, error } = await supabase.rpc("set_document_status", {
    target_doc: docId,
    new_status: status,
    target_school: schoolId,
    note_in: note || null,
  });
  if (error) throw error;
  return data;
};

export const requestApplicationCorrection = async ({
  applicationId,
  sections,
  reason,
  schoolId,
}) => {
  const { data, error } = await supabase.rpc(
    "request_application_correction",
    {
      target_application: applicationId,
      sections_in: sections,
      reason_in: reason,
      caller_school: schoolId,
    }
  );
  if (error) throw error;
  return data;
};

export const resubmitApplicationCorrection = async (applicationId) => {
  const { data, error } = await supabase.rpc(
    "resubmit_application_correction",
    { target_application: applicationId }
  );
  if (error) throw error;
  return data;
};

// The progress-tracker rows for this application — steps are computed
// server-side against the admission config, so a session with interviews
// disabled never shows the Interview step.
export const fetchApplicationWorkflowSteps = async (applicationId) => {
  const { data, error } = await supabase.rpc("application_workflow_steps", {
    target_application: applicationId,
  });
  if (error) throw error;
  return data || [];
};

// purpose defaults to the application fee; pass 'acceptance_fee' for the
// invoice raised once an offer is accepted — same table, same RLS, only the
// purpose column tells them apart.
export const fetchMyApplicationInvoice = async (applicationId, purpose = "application_fee", schoolId) => {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, reference, status, purpose, application_id, notes, due_on, issued_at")
    .eq("application_id", applicationId)
    .eq("purpose", purpose)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// The applicant's own offer on this application, if one has been issued.
// admission_offers has no school_id of its own — scoped through the
// application, with !inner so the filter actually restricts which rows
// come back (RLS's is_applicant_for/can_do_admissions checks the row's
// real school, not the tenant currently being browsed).
export const fetchMyOffer = async (applicationId, schoolId) => {
  const { data, error } = await supabase
    .from("admission_offers")
    .select(
      "id, status, issued_at, expires_at, accepted_at, declined_at, decline_reason, conditions, applications!inner(school_id)"
    )
    .eq("application_id", applicationId)
    .eq("applications.school_id", schoolId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { applications, ...offer } = data;
  return offer;
};

export const acceptOffer = async (offerId) => {
  const { data, error } = await supabase.rpc("accept_offer", {
    target_offer: offerId,
  });
  if (error) throw error;
  return data;
};

export const declineOffer = async ({ offerId, reason }) => {
  const { data, error } = await supabase.rpc("decline_offer", {
    target_offer: offerId,
    reason_in: reason || null,
  });
  if (error) throw error;
  return data;
};

// Staff recording a response on behalf of an applicant with no account of
// their own (an anonymous /Apply submission) — refused by the database if
// the applicant actually has one; they answer for themselves in that case.
export const recordOfferResponse = async ({ offerId, response, note, schoolId }) => {
  const { data, error } = await supabase.rpc("record_offer_response", {
    target_offer: offerId,
    response,
    current_school: schoolId,
    note_in: note || null,
  });
  if (error) throw error;
  return data;
};

/* -------------------------------------------------------------------------- */
/* admissions — Phase 2 staff workspace                                       */
/* -------------------------------------------------------------------------- */

// Every queue the admissions staff acts on, in one call, so the workspace
// dashboard doesn't have to guess which application belongs where.
export const fetchAdmissionsQueues = async (schoolId) => {
  const { data, error } = await supabase.rpc("admissions_queues", {
    target_school: schoolId,
  });
  if (error) throw error;
  const groups = {};
  for (const row of data || []) {
    (groups[row.bucket] = groups[row.bucket] || []).push(row);
  }
  return groups;
};

// The whole workspace for one application: the row, screening items,
// documents (joined to their requirement and file), reviews, interviews,
// timeline events, and the effective config. Reads through the server-side
// function so an admissions officer sees every child object in one shot.
export const fetchApplicationWorkspace = async (applicationId, schoolId) => {
  const { data, error } = await supabase.rpc("application_workspace", {
    target_application: applicationId,
    target_school: schoolId,
  });
  if (error) throw error;
  return data;
};

/* clearance & original-document verification (staff, Phase 4) */

export const prepareClearanceItems = async (applicationId) => {
  const { data, error } = await supabase.rpc(
    "create_application_clearance_items",
    { target_application: applicationId }
  );
  if (error) throw error;
  return data || [];
};

export const setClearanceStatus = async ({ checklistId, schoolId, status, note }) => {
  const { data, error } = await supabase.rpc("set_clearance_status", {
    target_checklist: checklistId,
    expected_school: schoolId,
    new_status: status,
    note_in: note || null,
  });
  if (error) throw error;
  return data;
};

export const recordOriginalVerification = async ({ applicationId, schoolId, documentKind, remarks }) => {
  const { data, error } = await supabase.rpc("record_original_verification", {
    target_application: applicationId,
    target_school: schoolId,
    document_kind_in: documentKind,
    remarks_in: remarks || null,
  });
  if (error) throw error;
  return data;
};

// The applicant's own read of their clearance progress — RLS
// (is_applicant_for) is what makes this safe, same precedent as
// fetchMyOffer reading admission_offers directly.
export const fetchMyClearance = async (applicationId, schoolId) => {
  const { data, error } = await supabase
    .from("clearance_checklists")
    .select("id, status, decided_at, decision_note, department:clearance_departments(name, position), applications!inner(school_id)")
    .eq("application_id", applicationId)
    .eq("applications.school_id", schoolId);
  if (error) throw error;
  return (data || []).sort((a, b) => (a.department?.position || 0) - (b.department?.position || 0));
};

/* screening */

export const fetchScreeningRequirements = async ({ schoolId, sessionId }) => {
  let query = supabase
    .from("screening_requirements")
    .select("id, school_id, session_id, programme_id, kind, label, is_required, position, notes")
    .eq("school_id", schoolId)
    .order("position");
  if (sessionId) query = query.or(`session_id.eq.${sessionId},session_id.is.null`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

export const upsertScreeningRequirement = async (row, schoolId) => {
  const { data, error } = await supabase
    .from("screening_requirements")
    .upsert({ ...row, school_id: schoolId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const deleteScreeningRequirement = async (id, schoolId) => {
  const { error } = await supabase
    .from("screening_requirements")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

/* clearance departments (admin config, Phase 4) */

export const fetchClearanceDepartments = async (schoolId) => {
  const { data, error } = await supabase
    .from("clearance_departments")
    .select("id, school_id, name, position, is_active, created_at")
    .eq("school_id", schoolId)
    .order("position");
  if (error) throw error;
  return data || [];
};

export const createClearanceDepartment = async ({ schoolId, name, position }) => {
  const { data, error } = await supabase
    .from("clearance_departments")
    .insert({ school_id: schoolId, name, position })
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const renameClearanceDepartment = async ({ id, schoolId, name }) => {
  const { data, error } = await supabase
    .from("clearance_departments")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("school_id", schoolId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const setClearanceDepartmentActive = async ({ id, isActive, schoolId }) => {
  const { data, error } = await supabase
    .from("clearance_departments")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("school_id", schoolId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

export const deleteClearanceDepartment = async ({ id, schoolId }) => {
  const { error } = await supabase
    .from("clearance_departments")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// How many applications already carry a checklist item against this
// department — shown before delete, same "this isn't empty" warning
// LevelsPanel gives before deleting a class level.
export const countClearanceChecklistItems = async (departmentId) => {
  const { count, error } = await supabase
    .from("clearance_checklists")
    .select("id", { count: "exact", head: true })
    .eq("department_id", departmentId);
  if (error) throw error;
  return count || 0;
};

export const prepareScreeningItems = async (applicationId, schoolId) => {
  const { data, error } = await supabase.rpc(
    "create_application_screening_items",
    { target_application: applicationId, target_school: schoolId }
  );
  if (error) throw error;
  return data || [];
};

// Same idea as prepareScreeningItems, for the document checklist.
export const prepareDocumentItems = async (applicationId, schoolId) => {
  const { data, error } = await supabase.rpc(
    "create_application_document_items",
    { target_application: applicationId, target_school: schoolId }
  );
  if (error) throw error;
  return data || [];
};

export const setScreeningItemStatus = async ({ itemId, schoolId, status, note }) => {
  const { data, error } = await supabase.rpc("set_screening_item_status", {
    target_item: itemId,
    target_school: schoolId,
    new_status: status,
    note_in: note || null,
  });
  if (error) throw error;
  return data;
};

/* documents (staff) */

export const verifyDocument = async ({ docId, note, schoolId }) => {
  const { data, error } = await supabase.rpc("verify_document", {
    target_doc: docId,
    target_school: schoolId,
    note_in: note || null,
  });
  if (error) throw error;
  return data;
};

export const rejectDocument = async ({ docId, reason, schoolId }) => {
  const { data, error } = await supabase.rpc("reject_document", {
    target_doc: docId,
    reason_in: reason,
    target_school: schoolId,
  });
  if (error) throw error;
  return data;
};

export const waiveDocument = async ({ docId, reason, schoolId }) => {
  const { data, error } = await supabase.rpc("waive_document", {
    target_doc: docId,
    target_school: schoolId,
    reason_in: reason,
  });
  if (error) throw error;
  return data;
};

/* review */

export const assignReview = async ({ applicationId, reviewerId, schoolId }) => {
  const { data, error } = await supabase.rpc("assign_review", {
    target_application: applicationId,
    target_reviewer: reviewerId,
    target_school: schoolId,
  });
  if (error) throw error;
  return data;
};

export const recordReview = async ({
  applicationId,
  recommendation,
  notes,
  academicScore,
  interviewScore,
}) => {
  const { data, error } = await supabase.rpc("record_review", {
    target_application: applicationId,
    recommendation_in: recommendation,
    notes_in: notes || null,
    academic_score_in: academicScore ?? null,
    interview_score_in: interviewScore ?? null,
  });
  if (error) throw error;
  return data;
};

/* interview */

export const scheduleInterview = async ({
  applicationId,
  schoolId,
  when,
  location,
  meetingLink,
  interviewerId,
}) => {
  const { data, error } = await supabase.rpc("schedule_interview", {
    target_application: applicationId,
    when_at: when,
    target_school: schoolId,
    location_in: location || null,
    meeting_link_in: meetingLink || null,
    interviewer_in: interviewerId || null,
  });
  if (error) throw error;
  return data;
};

export const recordInterviewOutcome = async ({
  interviewId,
  schoolId,
  status,
  outcome,
  notes,
}) => {
  const { data, error } = await supabase.rpc("record_interview_outcome", {
    target_interview: interviewId,
    new_status: status,
    target_school: schoolId,
    outcome_in: outcome || null,
    notes_in: notes || null,
  });
  if (error) throw error;
  return data;
};

/* documents ---------------------------------------------------------------- */

const MATERIALS_BUCKET_NAME = "course-materials";

export const fetchApplicationDocuments = async (applicationId, schoolId) => {
  const { data, error } = await supabase
    .from("application_documents")
    .select("id, kind, file_path, file_name, file_size, mime_type, uploaded_at, applications!inner ( school_id )")
    .eq("application_id", applicationId)
    .eq("applications.school_id", schoolId)
    .order("uploaded_at");
  if (error) throw error;
  return data;
};

// Path is admissions/<school_id>/<application_id>/... — the storage policy
// reads the school out of the second segment to decide who may write here.
// schoolId is also cross-checked against the application's real school
// before anything is written, not just used to build the path.
export const uploadApplicationDocument = async ({
  schoolId,
  applicationId,
  file,
  kind,
  userId,
}) => {
  const { data: app, error: appError } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("school_id", schoolId)
    .single();
  if (appError || !app) throw new Error("Application not found in this school");

  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `admissions/${schoolId}/${applicationId}/${uuidV4()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(MATERIALS_BUCKET_NAME)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;

  const { error } = await supabase.from("application_documents").insert({
    application_id: applicationId,
    kind: kind || "other",
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || null,
    uploaded_by: userId,
  });
  if (error) throw error;
};

export const deleteApplicationDocument = async ({ id, filePath, schoolId }) => {
  const { data: doc, error: lookupError } = await supabase
    .from("application_documents")
    .select("id, applications!inner(school_id)")
    .eq("id", id)
    .eq("applications.school_id", schoolId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!doc) throw new Error("Document not found for this school.");

  await supabase.storage.from(MATERIALS_BUCKET_NAME).remove([filePath]).catch(() => {});
  const { error } = await supabase.from("application_documents").delete().eq("id", id);
  if (error) throw error;
};

export const setSessionApplicationsOpen = async ({ sessionId, schoolId, open }) => {
  const { error } = await supabase
    .from("sessions")
    .update({ applications_open: open })
    .eq("id", sessionId)
    .eq("school_id", schoolId);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* the noticeboard                                                            */
/* -------------------------------------------------------------------------- */

// Who a notice is addressed to. The database enforces this in the SELECT
// policy; these labels only decide what the composer offers.
export const NOTICE_AUDIENCES = [
  ["everyone", "Everyone at the school"],
  ["parents", "Parents only"],
  ["students", "Students only"],
  ["staff", "Staff only"],
];

export const fetchNotices = async (schoolId) => {
  const { data, error } = await supabase
    .from("notice_feed")
    .select("*")
    .eq("school_id", schoolId)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: true })
    .limit(100);
  if (error) throw error;
  return data;
};

export const createNotice = async ({
  schoolId,
  title,
  body,
  audience,
  isEvent,
  eventAt,
  eventPlace,
  pinned,
  authorId,
}) => {
  const { data, error } = await supabase
    .from("notices")
    .insert({
      school_id: schoolId,
      title,
      body,
      audience: audience || "everyone",
      is_event: Boolean(isEvent),
      event_at: isEvent && eventAt ? eventAt : null,
      event_place: isEvent ? eventPlace || null : null,
      pinned: Boolean(pinned),
      author_id: authorId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
};

export const updateNotice = async ({ id, schoolId, ...fields }) => {
  const patch = { updated_at: new Date().toISOString(), edited_at: new Date().toISOString() };
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.body !== undefined) patch.body = fields.body;
  if (fields.audience !== undefined) patch.audience = fields.audience;
  if (fields.pinned !== undefined) patch.pinned = fields.pinned;
  if (fields.isEvent !== undefined) patch.is_event = fields.isEvent;
  if (fields.eventAt !== undefined) patch.event_at = fields.eventAt || null;
  if (fields.eventPlace !== undefined) patch.event_place = fields.eventPlace || null;

  const { error } = await supabase
    .from("notices")
    .update(patch)
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// Publishing is what sends it. Separate from the insert so a draft written on
// Sunday is not announced until Monday.
export const publishNotice = async (id, schoolId) => {
  const { error } = await supabase.rpc("publish_notice", { target_notice: id, target_school: schoolId });
  if (error) throw error;
};

// The email half of "Post and notify" — publish_notice() itself only ever
// raised the in-app bell notification. Never throws for an ordinary
// no-mailbox-connected state; callers check `sent` and show a softer
// message for that than for a real failure.
export const sendNoticeEmail = async ({ noticeId, schoolId }) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");

  const { data, error } = await supabase.functions.invoke("notice-mail-send", {
    body: { noticeId, schoolId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let detail = "";
    try {
      detail = (await error.context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Could not email that notice.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

export const deleteNotice = async (id, schoolId) => {
  const { error } = await supabase
    .from("notices")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

const REPLY_FIELDS = `id, notice_id, body, created_at, edited_at, user_id, profiles ( ${PROFILE_FIELDS} )`;

export const fetchNoticeReplies = async (noticeIds) => {
  if (!noticeIds || noticeIds.length === 0) return {};
  const { data, error } = await supabase
    .from("notice_replies")
    .select(REPLY_FIELDS)
    .in("notice_id", noticeIds)
    .order("created_at");
  if (error) throw error;

  const byNotice = {};
  for (const row of data) {
    (byNotice[row.notice_id] = byNotice[row.notice_id] || []).push(row);
  }
  return byNotice;
};

// notice_replies has no school_id of its own, so the parent notice's school
// is checked first.
export const replyToNotice = async ({ noticeId, schoolId, userId, body }) => {
  const { data: notice, error: noticeErr } = await supabase
    .from("notices")
    .select("id")
    .eq("id", noticeId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (noticeErr) throw noticeErr;
  if (!notice) throw new Error("Notice not found in this school.");

  const { data, error } = await supabase
    .from("notice_replies")
    .insert({ notice_id: noticeId, user_id: userId, body })
    .select(REPLY_FIELDS)
    .single();
  if (error) throw error;
  return data;
};

export const deleteNoticeReply = async (id, schoolId) => {
  const { data: reply, error: fetchError } = await supabase
    .from("notice_replies")
    .select("id, notices!inner(school_id)")
    .eq("id", id)
    .single();
  if (fetchError) throw fetchError;
  if (reply.notices.school_id !== schoolId) {
    throw new Error("This reply does not belong to the current school.");
  }
  const { error } = await supabase.from("notice_replies").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* fees, from the family's side                                               */
/* -------------------------------------------------------------------------- */

export const PAYMENT_METHODS = [
  ["transfer", "Bank transfer"],
  ["cash", "Cash"],
  ["pos", "Card / POS"],
  ["cheque", "Cheque"],
];

// Row level security decides whose invoices come back: a parent gets their
// children's, a student their own, the bursary the whole school.
export const fetchMyInvoices = async (schoolId) => {
  const { data, error } = await supabase
    .from("invoice_balances")
    .select("*")
    .eq("school_id", schoolId)
    .order("due_on", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data;
};

export const fetchInvoiceItems = async (invoiceIds, schoolId) => {
  if (!invoiceIds || invoiceIds.length === 0) return {};
  const { data, error } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, name, amount, position, invoices!inner ( school_id )")
    .in("invoice_id", invoiceIds)
    .eq("invoices.school_id", schoolId)
    .order("position");
  if (error) throw error;

  const byInvoice = {};
  for (const row of data) {
    (byInvoice[row.invoice_id] = byInvoice[row.invoice_id] || []).push(row);
  }
  return byInvoice;
};

export const fetchPaymentsFor = async (invoiceIds, schoolId) => {
  if (!invoiceIds || invoiceIds.length === 0) return {};
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, invoice_id, amount, method, status, reference, paid_on, note, proof_path, submitted_at, decided_at, decision_note, gateway_ref"
    )
    .eq("school_id", schoolId)
    .in("invoice_id", invoiceIds)
    .order("paid_on", { ascending: false });
  if (error) throw error;

  const byInvoice = {};
  for (const row of data) {
    (byInvoice[row.invoice_id] = byInvoice[row.invoice_id] || []).push(row);
  }
  return byInvoice;
};

// The receipt for a transfer. Path shape matters: the storage policy reads
// the invoice id out of the third segment to decide who may write here.
// The bucket itself caps an object at 20MB — a limit Supabase Storage
// enforces regardless of what this checks, and reports back as a bare
// "exceeded the maximum allowed size" (no mention of what the max IS or
// that it's about a file at all). Checked here first so the message a
// parent actually sees says the number, before the upload is even attempted.
const PAYMENT_PROOF_MAX_BYTES = 20 * 1024 * 1024;

export const uploadPaymentProof = async ({ schoolId, invoiceId, file }) => {
  if (file.size > PAYMENT_PROOF_MAX_BYTES) {
    throw new Error("That file is too large — receipts and screenshots must be under 20MB. Try a smaller photo, or compress it first.");
  }

  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `payments/${schoolId}/${invoiceId}/${uuidV4()}-${safeName}`;

  const { error } = await supabase.storage
    .from("course-materials")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
};

// A declaration, not a receipt. It lands as `submitted` and is worth nothing
// against the balance until the bursary approves it — the insert policy will
// not accept any other status.
export const declarePayment = async ({
  schoolId,
  invoiceId,
  userId,
  amount,
  method,
  reference,
  paidOn,
  note,
  proofPath,
}) => {
  const { data, error } = await supabase
    .from("payments")
    .insert({
      school_id: schoolId,
      invoice_id: invoiceId,
      amount,
      method: method || "transfer",
      reference: reference || null,
      paid_on: paidOn || new Date().toISOString().slice(0, 10),
      note: note || null,
      proof_path: proofPath || null,
      submitted_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
};

export const withdrawPayment = async (id) => {
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* what a parent sees about their child, short of results                     */
/* -------------------------------------------------------------------------- */

// Engagement, not marks. Neither of these returns a score, a grade or a
// percentage of anything examined — those wait for the school to release
// results. Both are guarded by can_view_student() in Postgres, so a parent
// cannot reach another family's child by changing an id in the URL.
export const fetchChildCourses = async (studentId, schoolId) => {
  const { data, error } = await supabase.rpc("child_courses", {
    target_student: studentId,
    target_school: schoolId,
  });
  if (error) throw error;
  return data || [];
};

export const fetchChildTeachers = async (studentId, schoolId) => {
  const { data, error } = await supabase.rpc("child_teachers", {
    target_student: studentId,
    target_school: schoolId,
  });
  if (error) throw error;
  return data || [];
};

/* -------------------------------------------------------------------------- */
/* bursary                                                                    */
/* -------------------------------------------------------------------------- */

export const fetchFeeStructures = async (schoolId) => {
  const { data, error } = await supabase
    .from("fee_structures")
    .select(
      "id, name, term_id, session_id, class_id, due_on, notes, is_active, created_at"
    )
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const fetchFeeItems = async (structureIds) => {
  if (!structureIds || structureIds.length === 0) return {};
  const { data, error } = await supabase
    .from("fee_items")
    .select("id, structure_id, name, amount, is_optional, position")
    .in("structure_id", structureIds)
    .order("position");
  if (error) throw error;

  const byStructure = {};
  for (const row of data) {
    (byStructure[row.structure_id] = byStructure[row.structure_id] || []).push(row);
  }
  return byStructure;
};

export const createFeeStructure = async ({
  schoolId,
  sessionId,
  termId,
  classId,
  name,
  dueOn,
  notes,
  userId,
}) => {
  const { data, error } = await supabase
    .from("fee_structures")
    .insert({
      school_id: schoolId,
      session_id: sessionId,
      term_id: termId,
      class_id: classId || null,
      name,
      due_on: dueOn || null,
      notes: notes || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
};

export const deleteFeeStructure = async (id, schoolId) => {
  const { error } = await supabase
    .from("fee_structures")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// fee_items has no school_id of its own — verify the target structure
// belongs to the caller's current school before inserting.
export const addFeeItem = async ({ schoolId, structureId, name, amount, isOptional, position }) => {
  const { data: structure, error: structureError } = await supabase
    .from("fee_structures")
    .select("id")
    .eq("id", structureId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (structureError) throw structureError;
  if (!structure) throw new Error("That fee structure does not belong to this school.");

  const { data, error } = await supabase
    .from("fee_items")
    .insert({
      structure_id: structureId,
      name,
      amount,
      is_optional: Boolean(isOptional),
      position: position || 0,
    })
    .select("id, structure_id, name, amount, is_optional, position")
    .single();
  if (error) throw error;
  return data;
};

export const updateFeeItem = async ({ id, schoolId, name, amount, isOptional }) => {
  const { data: owned, error: ownerError } = await supabase
    .from("fee_items")
    .select("id, fee_structures!inner(school_id)")
    .eq("id", id)
    .eq("fee_structures.school_id", schoolId)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!owned) throw new Error("Fee item not found for this school");

  const patch = {};
  if (name !== undefined) patch.name = name;
  if (amount !== undefined) patch.amount = amount;
  if (isOptional !== undefined) patch.is_optional = isOptional;
  const { error } = await supabase.from("fee_items").update(patch).eq("id", id);
  if (error) throw error;
};

export const deleteFeeItem = async (id, schoolId) => {
  const { data: item, error: lookupError } = await supabase
    .from("fee_items")
    .select("id, fee_structures!inner ( school_id )")
    .eq("id", id)
    .eq("fee_structures.school_id", schoolId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!item) throw new Error("Fee item not found for this school");

  const { error } = await supabase.from("fee_items").delete().eq("id", id);
  if (error) throw error;
};

// Raises one invoice per student in the class, skipping anyone who already
// has one for that term. Returns how many were made.
export const raiseInvoicesForClass = async (structureId) => {
  const { data, error } = await supabase.rpc("raise_invoices_for_class", {
    target_structure: structureId,
  });
  if (error) throw error;
  return data ?? 0;
};

export const raiseInvoice = async ({ structureId, studentId, includeOptional, discount, discountReason }) => {
  const { data, error } = await supabase.rpc("raise_invoice", {
    target_structure: structureId,
    target_student: studentId,
    include_optional: includeOptional || [],
    discount: discount || 0,
    discount_reason: discountReason || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const issueInvoice = async (invoiceId) => {
  const { error } = await supabase.rpc("issue_invoice", { target_invoice: invoiceId });
  if (error) throw error;
};

export const cancelInvoice = async ({ invoiceId, reason }) => {
  const { error } = await supabase.rpc("cancel_invoice", {
    target_invoice: invoiceId,
    reason,
  });
  if (error) throw error;
};

// Every invoice in the school, with its balance. RLS returns nothing here
// unless the caller is owner, admin or bursar.
export const fetchSchoolInvoices = async ({ schoolId, termId }) => {
  let query = supabase
    .from("invoice_balances")
    .select("*")
    .eq("school_id", schoolId)
    .order("balance", { ascending: false });
  if (termId) query = query.eq("term_id", termId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

// Everything a bursar has to decide on, oldest first — a parent waiting on a
// receipt is waiting on this queue.
export const fetchPaymentQueue = async (schoolId) => {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, invoice_id, amount, method, status, reference, paid_on, note, proof_path, submitted_at, submitted_by"
    )
    .eq("school_id", schoolId)
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });
  if (error) throw error;
  return data;
};

// Reference/purpose/applicant-name for exactly the invoices behind the
// current queue — fetched independently of whatever term filter the
// Invoices tab has selected. fetchSchoolInvoices is .eq("term_id", ...)
// filtered when a term is picked, and an admissions invoice always has
// term_id = null, so reusing that already-loaded list here would silently
// show "—" for a queued admissions payment whenever a term is selected.
export const fetchPaymentQueueContext = async (invoiceIds) => {
  if (!invoiceIds || invoiceIds.length === 0) return {};
  const { data, error } = await supabase
    .from("invoice_balances")
    .select("invoice_id, reference, purpose, applicant_name")
    .in("invoice_id", invoiceIds);
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.invoice_id, r]));
};

export const fetchRecentPayments = async ({ schoolId, limit = 50 }) => {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, invoice_id, amount, method, status, reference, paid_on, decided_at, decision_note"
    )
    .eq("school_id", schoolId)
    .neq("status", "submitted")
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
};

export const approvePayment = async ({ id, note }) => {
  const { error } = await supabase.rpc("approve_payment", {
    target_payment: id,
    decision: note || null,
  });
  if (error) throw error;
};

export const rejectPayment = async ({ id, note }) => {
  const { error } = await supabase.rpc("reject_payment", {
    target_payment: id,
    decision: note,
  });
  if (error) throw error;
};

// Money taken at the desk: recorded and approved in one movement, because the
// bursar counting the notes is the approval.
export const takePayment = async ({ invoiceId, amount, method, reference, paidOn, note }) => {
  const { data, error } = await supabase.rpc("take_payment", {
    target_invoice: invoiceId,
    amount,
    method: method || "cash",
    reference: reference || null,
    paid_on: paidOn || new Date().toISOString().slice(0, 10),
    note: note || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const fetchDebtors = async ({ schoolId, termId }) => {
  const { data, error } = await supabase.rpc("debtors", {
    target_school: schoolId,
    target_term: termId || null,
  });
  if (error) throw error;
  return data || [];
};

export const fetchCollectionSummary = async ({ schoolId, termId }) => {
  const { data, error } = await supabase.rpc("collection_summary", {
    target_school: schoolId,
    target_term: termId || null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
};

/* -------------------------------------------------------------------------- */
/* paying online                                                              */
/* -------------------------------------------------------------------------- */

// Asks the server to start a Paystack transaction. Note what is NOT sent: an
// amount. The Edge Function reads the outstanding balance from the database
// as this user and charges that, so the figure cannot be argued with from
// here. What comes back is a URL to send the family to.
export const startOnlinePayment = async ({ invoiceId }) => {
  // Attach the session's access token explicitly. supabase.functions.invoke
  // is supposed to do this automatically, but a stale or lazily-initialised
  // client has been seen to send only the anon key — which the pay-init
  // function reads as no user at all and returns "Sign in first". Pulling
  // the token here means the header is always present when we know it.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in first.");
  }

  const { data, error } = await supabase.functions.invoke("pay-init", {
    body: {
      invoiceId,
      // Where Paystack returns them afterwards. This page only reports the
      // outcome — the webhook is what actually credits the invoice.
      callbackUrl: `${window.location.origin}/Fees/Paid`,
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  // A function that returns 4xx/5xx arrives here as an error whose useful
  // message is in the response body rather than error.message.
  if (error) {
    let detail = "";
    try {
      detail = (await error.context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Could not start that payment.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

// Did the webhook land? A family may read payments on their own invoices, so
// finding the row by its gateway reference is the honest way to tell — rather
// than trusting a status in the URL, which anybody can type.
export const fetchPaymentByReference = async (reference, schoolId) => {
  if (!reference || !schoolId) return null;
  const { data, error } = await supabase
    .from("payments")
    .select("id, invoice_id, amount, status, gateway, gateway_ref, decided_at")
    .eq("gateway_ref", reference)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// A reply can be corrected by whoever wrote it. edited_at is stamped so the
// thread shows it was changed rather than quietly rewriting history.
export const updateNoticeReply = async ({ id, body }) => {
  const { data, error } = await supabase
    .from("notice_replies")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", id)
    .select(REPLY_FIELDS)
    .single();
  if (error) throw error;
  return data;
};

/* -------------------------------------------------------------------------- */
/* reactions                                                                  */
/* -------------------------------------------------------------------------- */

// The palette, fixed to match the CHECK constraint in the database. Adding
// one here without adding it there produces a constraint violation, so the
// two lists have to move together.
export const REACTIONS = ["👍", "❤️", "🎉", "👏", "😂", "😮", "🤔", "✅"];

const groupReactions = (rows, key, userId) => {
  const byTarget = {};
  for (const row of rows) {
    const target = (byTarget[row[key]] = byTarget[row[key]] || {});
    const tally = (target[row.emoji] = target[row.emoji] || { count: 0, mine: false });
    tally.count += 1;
    if (row.user_id === userId) tally.mine = true;
  }
  return byTarget;
};

export const fetchMessageReactions = async (messageIds, courseId, userId) => {
  if (!messageIds || messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, emoji, user_id, messages!inner(course_id)")
    .eq("messages.course_id", courseId)
    .in("message_id", messageIds);
  if (error) throw error;
  return groupReactions(data, "message_id", userId);
};

export const fetchNoticeReactions = async (noticeIds, userId, schoolId) => {
  if (!noticeIds || noticeIds.length === 0) return {};
  const { data, error } = await supabase
    .from("notice_reactions")
    .select("notice_id, emoji, user_id, notices!inner(school_id)")
    .in("notice_id", noticeIds)
    .eq("notices.school_id", schoolId);
  if (error) throw error;
  return groupReactions(data, "notice_id", userId);
};

// Tapping a reaction you already gave takes it back, which is a delete rather
// than a second row — the unique constraint would refuse one anyway.
export const toggleMessageReaction = async ({ messageId, userId, emoji, mine }) => {
  if (mine) {
    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase
    .from("message_reactions")
    .insert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
  return true;
};

export const toggleNoticeReaction = async ({ noticeId, userId, emoji, mine }) => {
  if (mine) {
    const { error } = await supabase
      .from("notice_reactions")
      .delete()
      .eq("notice_id", noticeId)
      .eq("user_id", userId)
      .eq("emoji", emoji);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase
    .from("notice_reactions")
    .insert({ notice_id: noticeId, user_id: userId, emoji });
  if (error) throw error;
  return true;
};

/* -------------------------------------------------------------------------- */
/* audit log — owner/admin only, enforced by RLS, not by anything client-side */
/* -------------------------------------------------------------------------- */

const AUDIT_PAGE_SIZE = 50;

// filters: { tableName, action, actorSearch, from, to }. Every filter is
// optional; omitting all of them just pages through everything, newest
// first. actorSearch matches the label snapshotted at write time (a name
// change afterwards doesn't rewrite history — this searches what was true
// when the action happened).
export const fetchAuditLog = async ({ schoolId, filters = {}, page = 0 } = {}) => {
  let query = supabase
    .from("audit_log")
    .select("id, school_id, table_name, record_id, action, actor_id, actor_label, actor_role, old_data, new_data, changed_fields, ip_address, country, user_agent, created_at", { count: "exact" })
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .range(page * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE - 1);

  if (filters.tableName) query = query.eq("table_name", filters.tableName);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorSearch) query = query.ilike("actor_label", `%${filters.actorSearch}%`);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], count: count || 0, pageSize: AUDIT_PAGE_SIZE };
};

// The distinct table names actually present, for the filter dropdown — reads
// straight off the data rather than a hard-coded list, so it's never stale
// against whatever's really been logged.
export const fetchAuditLogTables = async (schoolId) => {
  const { data, error } = await supabase
    .from("audit_log")
    .select("table_name")
    .eq("school_id", schoolId)
    .limit(5000);
  if (error) throw error;
  return [...new Set((data || []).map((r) => r.table_name))].sort();
};

/* -------------------------------------------------------------------------- */
/* tickets                                                                    */
/* -------------------------------------------------------------------------- */

const TICKET_SELECT = `
  id, school_id, number, subject, description, status, priority, tags,
  first_response_at, resolved_at, closed_at, created_at, updated_at,
  group_id, assigned_to, requester_id, channel, mailbox_id, requester_email, requester_name, description_format,
  group:ticket_groups ( id, name ),
  assignee:profiles!tickets_assigned_to_fkey ( id, first_name, surname, username, email ),
  requester:profiles!tickets_requester_id_fkey ( id, first_name, surname, username, email )
`;

// Shared by two very different pages: /Tickets (staff managing everything
// they have access to) and /Support's "Help Desk" (a person's own raised
// requests, staff or not). RLS alone can't tell those apart — it answers
// "can this row be read by this user AT ALL", and a staff member's own
// personal Help Desk query would otherwise come back with every ticket
// they're staff-permitted to see, not just the ones they themselves raised.
// `requesterId` is the explicit, application-level narrowing the self-service
// view passes to make sure of that regardless of the caller's role — staff
// callers (the /Tickets page) simply omit it and get what RLS already scopes
// them to.
export const fetchTickets = async ({ schoolId, status = "unresolved", groupId, assignedTo, priority, query, requesterId }) => {
  let q = supabase.from("tickets").select(TICKET_SELECT).eq("school_id", schoolId);
  if (requesterId) q = q.eq("requester_id", requesterId);
  if (status === "unresolved") q = q.in("status", ["open", "pending"]);
  else if (status && status !== "all") q = q.eq("status", status);
  if (groupId) q = q.eq("group_id", groupId);
  if (assignedTo) q = q.eq("assigned_to", assignedTo);
  if (priority) q = q.eq("priority", priority);
  if (query) q = q.or(`subject.ilike.%${query}%,description.ilike.%${query}%`);
  q = q.order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

export const fetchTicket = async (id, schoolId) => {
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .eq("id", id)
    .eq("school_id", schoolId)
    .single();
  if (error) throw error;
  return data;
};

export const createTicket = async ({
  schoolId, subject, description, priority = "low", groupId, requesterName, requesterEmail,
}) => {
  const { data, error } = await supabase.rpc("create_ticket", {
    target_school: schoolId,
    subject_in: subject,
    description_in: description,
    priority_in: priority,
    group_id_in: groupId || null,
    requester_name_in: requesterName || null,
    requester_email_in: requesterEmail || null,
  });
  if (error) throw error;
  return data;
};

export const updateTicket = async ({
  id, schoolId, status, priority, groupId, assignedTo, tags, clearGroup, clearAssignee,
}) => {
  const { data, error } = await supabase.rpc("update_ticket", {
    target_ticket: id,
    target_school: schoolId,
    status_in: status ?? null,
    priority_in: priority ?? null,
    group_id_in: groupId ?? null,
    assigned_to_in: assignedTo ?? null,
    tags_in: tags ?? null,
    clear_group: Boolean(clearGroup),
    clear_assignee: Boolean(clearAssignee),
  });
  if (error) throw error;
  return data;
};

// includeNotes must default to true for the staff TicketDetail view — the
// self-service /Support view passes false explicitly. RLS alone isn't
// enough to guarantee a requester never sees a note: a requester who also
// holds a ticket-staff role (owner/admin/principal/bursar/admissions) gets
// notes through their staff policy regardless of which page is asking, so
// the self-service surface has to filter at the query itself rather than
// trust the row never arrives.
const TICKET_MESSAGE_SELECT = `
  id, ticket_id, kind, body, body_format, created_at, direction,
  to_addresses, cc_addresses, bcc_addresses, external_from, send_status, send_error,
  author:profiles ( id, first_name, surname, username, email )
`;

export const fetchTicketMessages = async (ticketId, { schoolId, includeNotes = true } = {}) => {
  let q = supabase
    .from("ticket_messages")
    .select(`${TICKET_MESSAGE_SELECT}, tickets!inner ( school_id )`)
    .eq("ticket_id", ticketId)
    .eq("tickets.school_id", schoolId);
  if (!includeNotes) q = q.eq("kind", "reply");
  q = q.order("created_at", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(({ tickets, ...m }) => m);
};

export const addTicketMessage = async ({ ticketId, kind, body, schoolId }) => {
  const { data, error } = await supabase.rpc("add_ticket_message", {
    target_ticket: ticketId,
    kind_in: kind,
    body_in: body,
    target_school: schoolId,
  });
  if (error) throw error;
  return data;
};

export const fetchTicketGroups = async (schoolId) => {
  const { data, error } = await supabase
    .from("ticket_groups")
    .select("id, name, role, position, is_active")
    .eq("school_id", schoolId)
    .order("position");
  if (error) throw error;
  return data || [];
};

export const createTicketGroup = async ({ schoolId, name }) => {
  const { data, error } = await supabase
    .from("ticket_groups")
    .insert({ school_id: schoolId, name: name.trim() })
    .select("id, name, role")
    .single();
  if (error) throw error;
  return data;
};

// Who moved this ticket between departments, and when — a narrow read
// scoped by the same can_access_ticket() check as everything else on a
// ticket, not a grant onto the (owner/admin-only) audit log itself.
export const fetchTicketGroupHistory = async (ticketId, schoolId) => {
  const { data, error } = await supabase.rpc("ticket_group_history", { target_ticket: ticketId, target_school: schoolId });
  if (error) throw error;
  return data || [];
};

/* -------------------------------------------------------------------------- */
/* ticket mailboxes — connecting a school's own mailbox for email tickets    */
/* -------------------------------------------------------------------------- */

export const fetchTicketMailboxes = async (schoolId) => {
  const { data, error } = await supabase
    .from("ticket_mailboxes")
    .select("id, label, address, display_name, provider, is_active, last_poll_at, last_poll_status, last_poll_error, created_at")
    .eq("school_id", schoolId)
    .order("created_at");
  if (error) throw error;
  return data || [];
};

export const setMailboxActive = async ({ id, isActive, schoolId }) => {
  const { error } = await supabase
    .from("ticket_mailboxes")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("school_id", schoolId);
  if (error) throw error;
};

// Cleans up the mailbox's vault secret(s) too — see
// classroom.delete_ticket_mailbox in 080_ticket_mailboxes.sql.
export const deleteTicketMailbox = async (id, schoolId) => {
  const { error } = await supabase.rpc("delete_ticket_mailbox", { target_mailbox: id, target_school: schoolId });
  if (error) throw error;
};

// The app password is sent once, straight to the Edge Function, which mints
// a Supabase Vault secret and never returns it — connectTicketMailbox's
// caller never gets it back either.
export const connectTicketMailbox = async (payload) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");

  const { data, error } = await supabase.functions.invoke("mailbox-connect", {
    body: payload,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let detail = "";
    try {
      detail = (await error.context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Could not connect that mailbox.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

/* -------------------------------------------------------------------------- */
/* payment gateways                                                           */
/* -------------------------------------------------------------------------- */

// The school's one gateway row — RLS-gated read, no RPC needed.
export const fetchPaymentGateway = async (schoolId) => {
  const { data, error } = await supabase
    .from("payment_gateways")
    .select("*")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// The confirmation toggle alone — a direct update under the narrow RLS
// policy that lets owner/admin flip it without a service-role round trip.
export const updatePaymentGatewaySetting = async ({ schoolId, requireConfirmation, isActive }) => {
  const patch = {};
  if (requireConfirmation !== undefined) patch.require_confirmation = requireConfirmation;
  if (isActive !== undefined) patch.is_active = isActive;
  const { data, error } = await supabase
    .from("payment_gateways")
    .update(patch)
    .eq("school_id", schoolId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Choosing/switching provider or mode, or connecting BYO credentials —
// always through the Edge Function, never a raw table write, exactly like
// connectTicketMailbox above.
export const connectPaymentGateway = async (payload) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");

  const { data, error } = await supabase.functions.invoke("payment-gateway-connect", {
    body: payload,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let detail = "";
    try {
      detail = (await error.context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Could not save that gateway.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

// Sends a real outbound email from an email-channel ticket, then records
// the attempt (sent or failed) as a ticket_messages row.
export const sendTicketEmailReply = async ({ ticketId, schoolId, body, to, cc, bcc }) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");

  const { data, error } = await supabase.functions.invoke("ticket-mail-send", {
    body: { ticketId, schoolId, body, to, cc, bcc },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let detail = "";
    try {
      detail = (await error.context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Could not send that reply.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
};
