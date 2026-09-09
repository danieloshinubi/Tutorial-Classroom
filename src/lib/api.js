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

export const fetchAllCourses = async () => {
  const { data, error } = await supabase
    .from("courses")
    .select(`id, code, title, level_year, archived, owner_id, owner:profiles!courses_owner_id_fkey ( ${PROFILE_FIELDS} )`)
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

export const fetchCoursesOwnedBy = async (userId) => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, code, title, level_year, archived, session_id, sessions ( id, name, is_current )")
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

export const updateCourse = async (id, changes) => {
  const { data, error } = await supabase
    .from("courses")
    .update(changes)
    .eq("id", id)
    .select("id, code, title, description, level_year, archived, owner_id")
    .single();
  if (error) throw error;
  return data;
};

export const deleteCourse = async (id) => {
  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* enrollments                                                                */
/* -------------------------------------------------------------------------- */

// Only approved places count as "your courses" — a pending request is not
// membership yet, and is surfaced separately.
export const fetchMyCourses = async (userId) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id, status, courses ( id, code, title, level_year, archived, sessions ( name ) )")
    .eq("user_id", userId)
    .eq("status", "approved");
  if (error) throw error;
  return data.map((row) => row.courses).filter(Boolean);
};

export const fetchMyPendingRequests = async (userId) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id, requested_at, courses ( id, code, title, level_year )")
    .eq("user_id", userId)
    .eq("status", "pending");
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

export const unenroll = async ({ userId, courseId }) => {
  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("user_id", userId)
    .eq("course_id", courseId);
  if (error) throw error;
};

export const fetchRoster = async (courseId) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select(`created_at, profiles!enrollments_user_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("course_id", courseId);
  if (error) throw error;
  return data.map((row) => row.profiles).filter(Boolean);
};

/* -------------------------------------------------------------------------- */
/* materials                                                                  */
/* -------------------------------------------------------------------------- */

export const fetchMaterials = async (courseId) => {
  const { data, error } = await supabase
    .from("materials")
    .select(
      "id, title, description, url, created_at, file_path, file_name, file_size, mime_type"
    )
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const createMaterial = async (material) => {
  const { data, error } = await supabase
    .from("materials")
    .insert(material)
    .select("id, title, description, url, created_at")
    .single();
  if (error) throw error;
  return data;
};

export const deleteMaterial = async (id) => {
  const { error } = await supabase.from("materials").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* assignments                                                                */
/* -------------------------------------------------------------------------- */

export const fetchAssignments = async (courseId) => {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, description, points, due_at, created_at")
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

export const fetchAssignment = async (id) => {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, course_id, title, description, points, due_at, courses ( id, code, title, level_year, owner_id )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const createAssignment = async (assignment) => {
  const { data, error } = await supabase
    .from("assignments")
    .insert(assignment)
    .select("id, title, description, points, due_at, created_at")
    .single();
  if (error) throw error;
  return data;
};

export const deleteAssignment = async (id) => {
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) throw error;
};

/* -------------------------------------------------------------------------- */
/* submissions                                                                */
/* -------------------------------------------------------------------------- */

export const fetchMySubmission = async ({ assignmentId, userId }) => {
  const { data, error } = await supabase
    .from("submissions")
    .select("id, body, url, submitted_at, grade, feedback, graded_at")
    .eq("assignment_id", assignmentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// One row per student per assignment, so a resubmission updates in place and
// clears any previous grade rather than stacking up duplicates.
export const submitWork = async ({ assignmentId, userId, body, url }) => {
  const { data, error } = await supabase
    .from("submissions")
    .upsert(
      {
        assignment_id: assignmentId,
        user_id: userId,
        body,
        url,
        submitted_at: new Date().toISOString(),
        grade: null,
        feedback: null,
        graded_by: null,
        graded_at: null,
      },
      { onConflict: "assignment_id,user_id" }
    )
    .select("id, body, url, submitted_at, grade, feedback, graded_at")
    .single();
  if (error) throw error;
  return data;
};

export const fetchSubmissionsForAssignment = async (assignmentId) => {
  const { data, error } = await supabase
    .from("submissions")
    .select(`id, body, url, submitted_at, grade, feedback, graded_at, profiles!submissions_user_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("assignment_id", assignmentId)
    .order("submitted_at");
  if (error) throw error;
  return data;
};

export const gradeSubmission = async ({ id, grade, feedback, graderId }) => {
  const { data, error } = await supabase
    .from("submissions")
    .update({
      grade,
      feedback,
      graded_by: graderId,
      graded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(`id, body, url, submitted_at, grade, feedback, graded_at, profiles!submissions_user_id_fkey ( ${PROFILE_FIELDS} )`)
    .single();
  if (error) throw error;
  return data;
};

/* -------------------------------------------------------------------------- */
/* people                                                                     */
/* -------------------------------------------------------------------------- */

export const fetchTutors = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select(`${PROFILE_FIELDS}, bio`)
    .in("role", ["tutor", "admin"])
    .order("first_name");
  if (error) throw error;
  return data;
};

export const fetchAllProfiles = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select(`${PROFILE_FIELDS}, level_year, created_at`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
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
export const fetchMessageById = async (id) => {
  const { data, error } = await supabase
    .from("messages")
    .select(`id, body, created_at, edited_at, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .eq("id", id)
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

export const fetchExams = async (courseId) => {
  const { data, error } = await supabase
    .from("exams")
    .select("id, title, instructions, duration_mins, opens_at, closes_at, published, show_results, created_at, require_fullscreen, block_copy_paste, shuffle_questions, shuffle_options, max_violations")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const fetchExam = async (id) => {
  const { data, error } = await supabase
    .from("exams")
    .select("id, course_id, title, instructions, duration_mins, opens_at, closes_at, published, show_results, require_fullscreen, block_copy_paste, shuffle_questions, shuffle_options, max_violations, grace_seconds, courses ( id, code, title, level_year, owner_id )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const createExam = async (exam) => {
  const { data, error } = await supabase.from("exams").insert(exam).select("id").single();
  if (error) throw error;
  return data;
};

export const updateExam = async (id, changes) => {
  const { data, error } = await supabase
    .from("exams")
    .update(changes)
    .eq("id", id)
    .select("id, title, published")
    .single();
  if (error) throw error;
  return data;
};

export const deleteExam = async (id) => {
  const { error } = await supabase.from("exams").delete().eq("id", id);
  if (error) throw error;
};

// Deliberately omits exam_options.is_correct — students must never receive the
// answer key. Marking happens server-side in submit_exam_attempt().
export const fetchQuestionsForSitting = async (examId) => {
  const { data, error } = await supabase
    .from("exam_questions")
    .select("id, kind, prompt, points, position, exam_options ( id, body, position )")
    .eq("exam_id", examId)
    .order("position");
  if (error) throw error;
  return data;
};

// The authoring view, which does include the answer key. RLS restricts this to
// staff who manage the course.
export const fetchQuestionsForEditing = async (examId) => {
  const { data, error } = await supabase
    .from("exam_questions")
    .select("id, kind, prompt, points, position, answer_key, exam_options ( id, body, position, is_correct )")
    .eq("exam_id", examId)
    .order("position");
  if (error) throw error;
  return data;
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

export const deleteQuestion = async (id) => {
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

export const fetchExamEvents = async (attemptId) => {
  const { data, error } = await supabase
    .from("exam_events")
    .select("id, kind, detail, created_at")
    .eq("attempt_id", attemptId)
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

export const fetchAnswers = async (attemptId) => {
  const { data, error } = await supabase
    .from("exam_answers")
    .select("question_id, selected_option_id, answer_text, awarded_points")
    .eq("attempt_id", attemptId);
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

export const fetchAttemptsForExam = async (examId) => {
  const { data, error } = await supabase
    .from("exam_attempts")
    .select(`id, started_at, submitted_at, auto_score, total_score, max_score, graded_at, violations, disqualified, disqualified_reason, auto_submitted, submitted_late, profiles ( ${PROFILE_FIELDS} )`)
    .eq("exam_id", examId)
    .order("submitted_at", { nullsFirst: false });
  if (error) throw error;
  return data;
};

export const markAnswer = async ({ id, points }) => {
  const { error } = await supabase
    .from("exam_answers")
    .update({ awarded_points: points })
    .eq("id", id);
  if (error) throw error;
};

export const recalculateAttempt = async (attemptId) => {
  const { data, error } = await supabase.rpc("recalculate_attempt", {
    target_attempt: attemptId,
  });
  if (error) throw error;
  return data;
};

export const fetchAttemptDetail = async (attemptId) => {
  const { data, error } = await supabase
    .from("exam_answers")
    .select("id, question_id, selected_option_id, answer_text, awarded_points, exam_questions ( id, kind, prompt, points, answer_key, position )")
    .eq("attempt_id", attemptId);
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

export const fetchParticipants = async (courseId) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select(`status, requested_at, decided_at, message, profiles!enrollments_user_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("course_id", courseId)
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

export const fetchNotifications = async ({ courseId } = {}) => {
  let query = supabase
    .from("notifications")
    .select("id, course_id, kind, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (courseId) query = query.eq("course_id", courseId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const markNotificationRead = async (id) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
};

export const markAllNotificationsRead = async (userId) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
};

export const subscribeToNotifications = (userId, onInsert) =>
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
      (payload) => onInsert(payload.new)
    )
    .subscribe();

/* -------------------------------------------------------------------------- */
/* material files                                                             */
/* -------------------------------------------------------------------------- */

const MATERIALS_BUCKET = "course-materials";

// Path convention <course_id>/<random>-<name> — the first segment is what the
// storage policy checks to decide who may write here.
export const uploadMaterialFile = async ({ courseId, file, onProgress }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `${courseId}/${crypto.randomUUID()}-${safeName}`;

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
/* exam editing                                                               */
/* -------------------------------------------------------------------------- */

export const updateQuestion = async (id, changes) => {
  const { error } = await supabase
    .from("exam_questions")
    .update(changes)
    .eq("id", id);
  if (error) throw error;
};

export const deleteOptionsForQuestion = async (questionId) => {
  const { error } = await supabase
    .from("exam_options")
    .delete()
    .eq("question_id", questionId);
  if (error) throw error;
};

// How many students have already sat this paper. Restructuring questions
// after that point would discard their answers, so the editor asks first.
export const countAttempts = async (examId) => {
  const { count, error } = await supabase
    .from("exam_attempts")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);
  if (error) throw error;
  return count || 0;
};

/* -------------------------------------------------------------------------- */
/* tenancy — schools and membership                                           */
/* -------------------------------------------------------------------------- */

export const fetchSchool = async (slug) => {
  const { data, error } = await supabase
    .from("schools")
    .select("id, name, slug, logo_url, address, phone, email, timezone, currency, plan, is_active")
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
    .select("id, name, slug, logo_url, address, phone, email, timezone, currency")
    .single();
  if (error) throw error;
  return data;
};

// The school's people. profiles is embedded through the membership's own
// foreign key so the join is unambiguous.
export const fetchSchoolMembers = async (schoolId) => {
  const { data, error } = await supabase
    .from("school_members")
    .select(`id, role, is_active, created_at, profiles!school_members_user_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.filter((row) => row.profiles);
};

export const updateMemberRole = async ({ memberId, role }) => {
  const { error } = await supabase
    .from("school_members")
    .update({ role })
    .eq("id", memberId);
  if (error) throw error;
};

export const setMemberActive = async ({ memberId, isActive }) => {
  const { error } = await supabase
    .from("school_members")
    .update({ is_active: isActive })
    .eq("id", memberId);
  if (error) throw error;
};

export const removeMember = async (memberId) => {
  const { error } = await supabase.from("school_members").delete().eq("id", memberId);
  if (error) throw error;
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
      await invitePasswordSetup(address);
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
export const fetchStudentReport = async (studentId) => {
  const { data, error } = await supabase.rpc("student_report", {
    target_student: studentId,
  });
  if (error) throw error;
  return data || [];
};

export const fetchStudentMarks = async (studentId) => {
  const { data, error } = await supabase.rpc("student_marks", {
    target_student: studentId,
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

export const fetchChildren = async (guardianId) => {
  const { data, error } = await supabase
    .from("guardian_students")
    .select(`id, relationship, is_primary, student:profiles!guardian_students_student_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("guardian_id", guardianId);
  if (error) throw error;
  return data.filter((row) => row.student);
};

export const fetchGuardiansOf = async (studentId) => {
  const { data, error } = await supabase
    .from("guardian_students")
    .select(`id, relationship, guardian:profiles!guardian_students_guardian_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("student_id", studentId);
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

export const unlinkGuardian = async (linkId) => {
  const { error } = await supabase.from("guardian_students").delete().eq("id", linkId);
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
    .select("id, name, starts_on, ends_on, is_current")
    .eq("school_id", schoolId)
    .order("name", { ascending: false });
  if (error) throw error;
  return data;
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

export const deleteSession = async (id) => {
  const { error } = await supabase.from("sessions").delete().eq("id", id);
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

export const deleteTerm = async (id) => {
  const { error } = await supabase.from("terms").delete().eq("id", id);
  if (error) throw error;
};

// One statement, so the school is never left with two current terms or none.
export const setCurrentTerm = async (termId) => {
  const { data, error } = await supabase.rpc("set_current_term", { target_term: termId });
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

export const updateClass = async (id, changes) => {
  const { error } = await supabase.from("classes").update(changes).eq("id", id);
  if (error) throw error;
};

export const deleteClass = async (id) => {
  const { error } = await supabase.from("classes").delete().eq("id", id);
  if (error) throw error;
};

export const fetchClassRoster = async (classId) => {
  const { data, error } = await supabase
    .from("class_students")
    .select(`id, added_at, student:profiles!class_students_student_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("class_id", classId);
  if (error) throw error;
  return data.filter((row) => row.student);
};

export const addStudentToClass = async ({ classId, studentId }) => {
  const { error } = await supabase
    .from("class_students")
    .insert({ class_id: classId, student_id: studentId });
  if (error) throw error;
};

export const removeStudentFromClass = async (rowId) => {
  const { error } = await supabase.from("class_students").delete().eq("id", rowId);
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

export const deleteSubject = async (id) => {
  const { error } = await supabase.from("subjects").delete().eq("id", id);
  if (error) throw error;
};

export const fetchClassSubjects = async (classId) => {
  const { data, error } = await supabase
    .from("class_subjects")
    .select(`id, subject_id, teacher_id,
             subjects ( id, code, name ),
             teacher:profiles!class_subjects_teacher_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("class_id", classId);
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

export const updateClassSubject = async (id, changes) => {
  const { error } = await supabase.from("class_subjects").update(changes).eq("id", id);
  if (error) throw error;
};

export const removeClassSubject = async (id) => {
  const { error } = await supabase.from("class_subjects").delete().eq("id", id);
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

export const updateMaterial = async (id, changes) => {
  const { data, error } = await supabase
    .from("materials")
    .update(changes)
    .eq("id", id)
    .select("id, title, description, url, created_at, file_path, file_name, file_size")
    .single();
  if (error) throw error;
  return data;
};

export const updateAssignment = async (id, changes) => {
  const { data, error } = await supabase
    .from("assignments")
    .update(changes)
    .eq("id", id)
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

export const deleteMessage = async (id) => {
  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) throw error;
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

export const deleteComment = async (id) => {
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
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
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

export const fetchApplication = async (id) => {
  const { data, error } = await supabase
    .from("applications")
    .select(
      `id, school_id, reference, first_name, surname, middle_name, date_of_birth,
       gender, applying_for_level, previous_school, guardian_name, guardian_email,
       guardian_phone, guardian_relation, address, notes, document_links, status,
       offer_expires_at, decided_at, created_at, student_id, class_id,
       sessions ( id, name ), classes ( id, name ),
       schools ( id, name, slug, logo_url, address, phone, email )`
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchApplicationEvents = async (applicationId) => {
  const { data, error } = await supabase
    .from("application_events")
    .select("id, status_from, status_to, actor_label, note, created_at")
    .eq("application_id", applicationId)
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
export const decideApplication = async ({ id, status, note, offerExpires }) => {
  const { data, error } = await supabase.rpc("decide_application", {
    target_application: id,
    new_status: status,
    note: note || null,
    offer_expires: offerExpires || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const enrolApplicant = async ({ id, studentId, classId }) => {
  const { data, error } = await supabase.rpc("enrol_applicant", {
    target_application: id,
    target_student: studentId,
    target_class: classId || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

/* documents ---------------------------------------------------------------- */

const MATERIALS_BUCKET_NAME = "course-materials";

export const fetchApplicationDocuments = async (applicationId) => {
  const { data, error } = await supabase
    .from("application_documents")
    .select("id, kind, file_path, file_name, file_size, mime_type, uploaded_at")
    .eq("application_id", applicationId)
    .order("uploaded_at");
  if (error) throw error;
  return data;
};

// Path is admissions/<school_id>/<application_id>/... — the storage policy
// reads the school out of the second segment to decide who may write here.
export const uploadApplicationDocument = async ({
  schoolId,
  applicationId,
  file,
  kind,
  userId,
}) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `admissions/${schoolId}/${applicationId}/${crypto.randomUUID()}-${safeName}`;

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

export const deleteApplicationDocument = async ({ id, filePath }) => {
  await supabase.storage.from(MATERIALS_BUCKET_NAME).remove([filePath]).catch(() => {});
  const { error } = await supabase.from("application_documents").delete().eq("id", id);
  if (error) throw error;
};

export const setSessionApplicationsOpen = async ({ sessionId, open }) => {
  const { error } = await supabase
    .from("sessions")
    .update({ applications_open: open })
    .eq("id", sessionId);
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

export const updateNotice = async ({ id, ...fields }) => {
  const patch = { updated_at: new Date().toISOString(), edited_at: new Date().toISOString() };
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.body !== undefined) patch.body = fields.body;
  if (fields.audience !== undefined) patch.audience = fields.audience;
  if (fields.pinned !== undefined) patch.pinned = fields.pinned;
  if (fields.isEvent !== undefined) patch.is_event = fields.isEvent;
  if (fields.eventAt !== undefined) patch.event_at = fields.eventAt || null;
  if (fields.eventPlace !== undefined) patch.event_place = fields.eventPlace || null;

  const { error } = await supabase.from("notices").update(patch).eq("id", id);
  if (error) throw error;
};

// Publishing is what sends it. Separate from the insert so a draft written on
// Sunday is not announced until Monday.
export const publishNotice = async (id) => {
  const { error } = await supabase.rpc("publish_notice", { target_notice: id });
  if (error) throw error;
};

export const deleteNotice = async (id) => {
  const { error } = await supabase.from("notices").delete().eq("id", id);
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

export const replyToNotice = async ({ noticeId, userId, body }) => {
  const { data, error } = await supabase
    .from("notice_replies")
    .insert({ notice_id: noticeId, user_id: userId, body })
    .select(REPLY_FIELDS)
    .single();
  if (error) throw error;
  return data;
};

export const deleteNoticeReply = async (id) => {
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
export const fetchMyInvoices = async () => {
  const { data, error } = await supabase
    .from("invoice_balances")
    .select("*")
    .order("due_on", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data;
};

export const fetchInvoiceItems = async (invoiceIds) => {
  if (!invoiceIds || invoiceIds.length === 0) return {};
  const { data, error } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, name, amount, position")
    .in("invoice_id", invoiceIds)
    .order("position");
  if (error) throw error;

  const byInvoice = {};
  for (const row of data) {
    (byInvoice[row.invoice_id] = byInvoice[row.invoice_id] || []).push(row);
  }
  return byInvoice;
};

export const fetchPaymentsFor = async (invoiceIds) => {
  if (!invoiceIds || invoiceIds.length === 0) return {};
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, invoice_id, amount, method, status, reference, paid_on, note, proof_path, submitted_at, decided_at, decision_note"
    )
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
export const uploadPaymentProof = async ({ schoolId, invoiceId, file }) => {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `payments/${schoolId}/${invoiceId}/${crypto.randomUUID()}-${safeName}`;

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
export const fetchChildCourses = async (studentId) => {
  const { data, error } = await supabase.rpc("child_courses", {
    target_student: studentId,
  });
  if (error) throw error;
  return data || [];
};

export const fetchChildTeachers = async (studentId) => {
  const { data, error } = await supabase.rpc("child_teachers", {
    target_student: studentId,
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

export const deleteFeeStructure = async (id) => {
  const { error } = await supabase.from("fee_structures").delete().eq("id", id);
  if (error) throw error;
};

export const addFeeItem = async ({ structureId, name, amount, isOptional, position }) => {
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

export const updateFeeItem = async ({ id, name, amount, isOptional }) => {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (amount !== undefined) patch.amount = amount;
  if (isOptional !== undefined) patch.is_optional = isOptional;
  const { error } = await supabase.from("fee_items").update(patch).eq("id", id);
  if (error) throw error;
};

export const deleteFeeItem = async (id) => {
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
  const { data, error } = await supabase.functions.invoke("pay-init", {
    body: {
      invoiceId,
      // Where Paystack returns them afterwards. This page only reports the
      // outcome — the webhook is what actually credits the invoice.
      callbackUrl: `${window.location.origin}/Fees/Paid`,
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
export const fetchPaymentByReference = async (reference) => {
  if (!reference) return null;
  const { data, error } = await supabase
    .from("payments")
    .select("id, invoice_id, amount, status, gateway, gateway_ref, decided_at")
    .eq("gateway_ref", reference)
    .maybeSingle();
  if (error) throw error;
  return data;
};
