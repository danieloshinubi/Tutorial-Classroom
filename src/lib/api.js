import { supabase } from "./supabaseClient";
import { createAuthUser, invitePasswordSetup } from "./provisioning";

// Fields selected wherever a row carries its author/owner, so names render
// consistently across the app.
const PROFILE_FIELDS = "id, first_name, surname, username, email, role, avatar_url";

/* -------------------------------------------------------------------------- */
/* levels & courses                                                           */
/* -------------------------------------------------------------------------- */

// Scoped by school as well as level: two schools may both use level 1, and
// someone who belongs to both would otherwise see the two mixed together.
export const fetchCoursesForLevel = async ({ schoolId, year }) => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, code, title, level_year, archived")
    .eq("school_id", schoolId)
    .eq("level_year", year)
    .eq("archived", false)
    .order("code");
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

// Course codes are unique per school, not globally.
export const fetchCourseByCode = async ({ schoolId, code }) => {
  const { data, error } = await supabase
    .from("courses")
    .select(`id, code, title, description, level_year, archived, owner_id, school_id, owner:profiles!courses_owner_id_fkey ( ${PROFILE_FIELDS} )`)
    .eq("school_id", schoolId)
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const fetchCoursesOwnedBy = async (userId) => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, code, title, level_year, archived")
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
    .select("course_id, status, courses ( id, code, title, level_year, archived )")
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
    .select(`id, body, created_at, user_id, profiles ( ${PROFILE_FIELDS} )`)
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
    .select(`id, body, created_at, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .single();
  if (error) throw error;
  return data;
};

// Realtime inserts arrive without the joined profile, so the caller refetches
// the single row to get the author's name alongside the message.
export const fetchMessageById = async (id) => {
  const { data, error } = await supabase
    .from("messages")
    .select(`id, body, created_at, user_id, profiles ( ${PROFILE_FIELDS} )`)
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

// Adds someone to this school, creating their login if they do not have one.
//
// Tries the Edge Function first — that is the better route, because it can
// send a real invitation and reuse an existing account by email. When it is
// not deployed, falls back to creating the account from the browser: see
// lib/provisioning.js for why that is safe.
export const inviteSchoolUser = async ({ schoolId, email, firstName, surname, role }) => {
  const address = email.trim().toLowerCase();

  const { data, error } = await supabase.functions.invoke("create-school-user", {
    body: {
      school_id: schoolId,
      email: address,
      first_name: firstName.trim(),
      surname: surname.trim(),
      role,
    },
  });

  if (!error) return data;

  // A refusal from the function itself is a real answer — surface it.
  const detail = await error.context?.json?.().catch(() => null);
  if (detail?.error) throw new Error(detail.error);

  const missing =
    error.context?.status === 404 ||
    /failed to send|fetch|not found/i.test(error.message || "");
  if (!missing) throw new Error(error.message || "Could not create that user.");

  return addSchoolUserDirect({ schoolId, email: address, firstName, surname, role });
};

// The no-Edge-Function path.
export const addSchoolUserDirect = async ({ schoolId, email, firstName, surname, role }) => {
  let userId = null;
  let existed = false;

  try {
    const created = await createAuthUser({ email, firstName, surname });
    userId = created.userId;
    existed = created.existed;
  } catch (err) {
    throw new Error(err.message || "Could not create that account.");
  }

  // Either the address was already registered, or email confirmation is on and
  // signUp withheld the id. Look the profile up by address instead.
  if (!userId) {
    const { data: found } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    userId = found?.id ?? null;
  }

  if (!userId) {
    throw new Error(
      existed
        ? `${email} already has an account elsewhere. Supabase will not reveal its id to the browser, so ask them to sign in here once — then adding them will work. Deploying the create-school-user function removes this step.`
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

  // Lets them choose their own password. Not fatal if the mail fails — the
  // account exists and Forgot Password reaches the same place.
  let emailed = true;
  try {
    await invitePasswordSetup(email);
  } catch {
    emailed = false;
  }

  return { user_id: userId, email, role, existed, emailed, viaFallback: true };
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
