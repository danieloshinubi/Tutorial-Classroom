import { supabase } from "./supabaseClient";

// Fields selected wherever a row carries its author/owner, so names render
// consistently across the app.
const PROFILE_FIELDS = "id, first_name, surname, username, email, role, avatar_url";

/* -------------------------------------------------------------------------- */
/* levels & courses                                                           */
/* -------------------------------------------------------------------------- */

export const fetchLevels = async () => {
  const { data, error } = await supabase
    .from("levels")
    .select("year, label")
    .order("year");
  if (error) throw error;
  return data;
};

export const fetchCoursesForLevel = async (year) => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, code, title, level_year, archived")
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

export const fetchCourseByCode = async (code) => {
  const { data, error } = await supabase
    .from("courses")
    .select(`id, code, title, description, level_year, archived, owner_id, owner:profiles!courses_owner_id_fkey ( ${PROFILE_FIELDS} )`)
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

export const fetchMyCourses = async (userId) => {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id, courses ( id, code, title, level_year, archived )")
    .eq("user_id", userId);
  if (error) throw error;
  return data.map((row) => row.courses).filter(Boolean);
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
    .select(`created_at, profiles ( ${PROFILE_FIELDS} )`)
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
    .select("id, title, description, url, created_at")
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
    .select(`id, body, url, submitted_at, grade, feedback, graded_at, profiles ( ${PROFILE_FIELDS} )`)
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
    .select(`id, body, url, submitted_at, grade, feedback, graded_at, profiles ( ${PROFILE_FIELDS} )`)
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
    .select("id, title, instructions, duration_mins, opens_at, closes_at, published, show_results, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const fetchExam = async (id) => {
  const { data, error } = await supabase
    .from("exams")
    .select("id, course_id, title, instructions, duration_mins, opens_at, closes_at, published, show_results, courses ( id, code, title, level_year, owner_id )")
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
    .select("id, started_at, submitted_at, auto_score, total_score, max_score, graded_at")
    .eq("exam_id", examId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const startAttempt = async ({ examId, userId }) => {
  const { data, error } = await supabase
    .from("exam_attempts")
    .insert({ exam_id: examId, user_id: userId })
    .select("id, started_at, submitted_at, auto_score, total_score, max_score")
    .single();
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
    .select(`id, started_at, submitted_at, auto_score, total_score, max_score, graded_at, profiles ( ${PROFILE_FIELDS} )`)
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
