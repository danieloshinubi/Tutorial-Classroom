// What the AI assistant can do for someone, once they confirm it.
//
// The assistant only ever PROPOSES an action (supabase/functions/ai-assistant,
// propose_action). The person sees a card saying exactly what will happen and
// taps Confirm; only then does the matching `run` below execute, in the
// browser, as that person, through the same api.js function the app's own
// buttons use. So the assistant can never do more than the person could do
// themselves: row level security and each function's own checks apply as
// usual. An action name the list below does not know is simply refused.
//
// Files the person attached in the assistant chat are held in memory for
// this visit (ctx.files, by ref: "file-1"...) and uploaded only when an
// action that uses one is confirmed.
//
// run(params, ctx) returns:
//   text    what the assistant is told happened (never secrets)
//   detail  optional, shown only to the person on the card (e.g. a new
//           account's temporary password, which never goes back to the AI)
//   link    optional { path, label } to open what was made
import { supabase } from "./supabaseClient";
import {
  addSchoolUser,
  updateMemberRole,
  setMemberActive,
  linkGuardian,
  addStudentToClass,
  createNotice,
  publishNotice,
  sendNoticeEmail,
  openDirectMessage,
  sendChatMessage,
  createGroupChannel,
  createCourse,
  createExam,
  createQuestion,
  createOptions,
  createAssignment,
  saveAttendance,
  createLevel,
  createClass,
  createTerm,
  setCurrentTerm,
  decideApplication,
  scheduleInterview,
  recordInterviewOutcome,
  verifyDocument,
  rejectDocument,
  requestApplicationCorrection,
  recordReview,
  notifyApplicant,
  setSessionApplicationsOpen,
  raiseInvoicesForClass,
  issueInvoice,
  takePayment,
  approvePayment,
  rejectPayment,
  applyDiscountRule,
  carryForwardBalances,
  restockStoreProduct,
  saveStoreProduct,
  uploadExamQuestionImage,
  updateQuestion,
  uploadApplicationDocument,
  uploadChatAttachment,
  uploadMaterialFile,
  createMaterial,
  uploadSchoolLogo,
  updateSchool,
  uploadAvatar,
  updateProfile,
  adjustStoreStock,
  createTicket,
  preparePayroll,
} from "./api";

const str = (v) => (v == null ? "" : String(v).trim());
const num = (v) => (v === "" || v == null ? null : Number(v));
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// News is stored as rich text; the assistant writes plain paragraphs.
const toParagraphs = (text) =>
  str(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

const fileFor = (ctx, ref) => {
  const file = ref ? ctx.files?.get(String(ref)) : null;
  if (!file) throw new Error(`The attached file ${ref || ""} is no longer in this chat. Attach it again and ask once more.`);
  return file;
};

// Questions for create_exam / add_exam_questions, saved the way the exam
// builder saves them (ExamBuilder.jsx), with a picture where one is attached.
const saveQuestions = async (examId, questions, startAt = 0, { ctx, courseId } = {}) => {
  const list = Array.isArray(questions) ? questions : [];
  let saved = 0;
  for (let i = 0; i < list.length; i += 1) {
    const q = list[i] || {};
    const kind = ["multiple_choice", "true_false", "short_answer"].includes(q.kind) ? q.kind : "multiple_choice";
    const prompt = str(q.prompt);
    if (!prompt) continue;
    const row = await createQuestion({
      exam_id: examId,
      kind,
      prompt,
      image_path: null,
      points: Number(q.points) || 1,
      position: startAt + i,
      answer_key: kind === "short_answer" ? str(q.answer) || null : null,
    });
    if (q.image_ref && ctx && courseId) {
      const path = await uploadExamQuestionImage({ courseId, file: fileFor(ctx, q.image_ref) });
      await updateQuestion(row.id, { image_path: path }, ctx.schoolId);
    }
    if (kind !== "short_answer") {
      let options = Array.isArray(q.options) ? q.options : [];
      if (kind === "true_false" && !options.length) {
        const truth = String(q.answer ?? "").toLowerCase() !== "false";
        options = [{ text: "True", correct: truth }, { text: "False", correct: !truth }];
      }
      await createOptions(
        options
          .filter((o) => str(o?.text ?? o?.body))
          .map((o, j) => ({ question_id: row.id, body: str(o.text ?? o.body), is_correct: Boolean(o.correct ?? o.is_correct), position: j }))
      );
    }
    saved += 1;
  }
  return saved;
};

// A readable name for a table ("store_products" -> "store products").
const tableLabel = (t) => String(t || "record").replace(/_/g, " ");

export const ACTIONS = {
  add_person: {
    title: "Add a person",
    run: async (p, { schoolId }) => {
      const r = await addSchoolUser({ schoolId, email: str(p.email), firstName: str(p.first_name), surname: str(p.surname), role: str(p.role) });
      const who = `${str(p.first_name)} ${str(p.surname)} (${r.email}, ${r.role})`;
      if (r.invited && r.emailed) return { text: `Added ${who}; they were emailed a link to set their password.` };
      return {
        text: `Added ${who}. A temporary password was shown to the person on screen.`,
        detail: r.password ? `Temporary password: ${r.password} — give it to them privately; they will choose their own when they first sign in.` : undefined,
      };
    },
  },
  set_role: {
    title: "Change a role",
    run: async (p, { schoolId }) => {
      await updateMemberRole({ schoolId, memberId: p.member_id, role: str(p.role) });
      return { text: `Role changed to ${str(p.role)}.` };
    },
  },
  set_active: {
    title: "Switch an account on or off",
    run: async (p, { schoolId }) => {
      const on = p.active === true || String(p.active) === "true";
      await setMemberActive({ schoolId, memberId: p.member_id, isActive: on });
      return { text: on ? "Account switched on." : "Account switched off." };
    },
  },
  link_parent: {
    title: "Link a parent to a child",
    run: async (p, { schoolId }) => {
      await linkGuardian({ schoolId, guardianId: p.parent_user_id, studentId: p.student_user_id, relationship: str(p.relationship) || null });
      return { text: "Parent linked to the child." };
    },
  },
  place_in_class: {
    title: "Place a pupil in a class",
    run: async (p, { schoolId }) => {
      await addStudentToClass({ schoolId, classId: p.class_id, studentId: p.student_user_id });
      return { text: "Pupil placed in the class." };
    },
  },
  post_news: {
    title: "Post news",
    run: async (p, { schoolId, userId }) => {
      const audience = ["everyone", "parents", "students", "staff"].includes(p.audience) ? p.audience : "everyone";
      const notice = await createNotice({ schoolId, title: str(p.title), body: toParagraphs(p.body), audience, pinned: Boolean(p.pinned), authorId: userId });
      await publishNotice(notice.id, schoolId);
      let emailed = "";
      if (p.email === true || String(p.email) === "true") {
        const res = await sendNoticeEmail({ noticeId: notice.id, schoolId }).catch((e) => ({ error: e.message }));
        emailed = res?.sent ? ` It was also emailed to ${res.sent} ${res.sent === 1 ? "person" : "people"}.` : res?.error ? ` The email could not be sent: ${res.error}` : " No email was sent (no school mailbox connected).";
      }
      return { text: `Posted "${str(p.title)}" to ${audience}.${emailed}`, link: { path: "/News", label: "Open News" } };
    },
  },
  send_message: {
    title: "Send a message",
    run: async (p, { schoolId, userId }) => {
      const channel = await openDirectMessage({ schoolId, otherUserId: p.to_user_id });
      const channelId = typeof channel === "string" ? channel : channel?.id || channel?.channel_id;
      await sendChatMessage({ channelId, authorId: userId, body: toParagraphs(p.text) });
      return { text: "Message sent.", link: channelId ? { path: `/Chat/${channelId}`, label: "Open the chat" } : undefined };
    },
  },
  create_group_chat: {
    title: "Start a group chat",
    run: async (p, { schoolId }) => {
      const channel = await createGroupChannel({ schoolId, name: str(p.name), memberIds: Array.isArray(p.member_user_ids) ? p.member_user_ids : [] });
      const channelId = typeof channel === "string" ? channel : channel?.id;
      return { text: `Group "${str(p.name)}" created.`, link: channelId ? { path: `/Chat/${channelId}`, label: "Open the group" } : undefined };
    },
  },
  create_course: {
    title: "Create a course",
    run: async (p, { schoolId, userId }) => {
      const course = await createCourse({ code: str(p.code).toUpperCase(), title: str(p.title), description: str(p.description) || null, level_year: num(p.level_year), session_id: null, school_id: schoolId, owner_id: userId });
      return { text: `Course ${course.code} created.`, link: { path: `/Courses/${course.code}`, label: "Open the course" } };
    },
  },
  create_exam: {
    title: "Set an exam",
    run: async (p, ctx) => {
      const exam = await createExam({
        course_id: p.course_id,
        created_by: ctx.userId,
        title: str(p.title),
        kind: p.kind === "midterm" ? "midterm" : "exam",
        instructions: str(p.instructions) || null,
        duration_mins: num(p.duration_mins),
        closes_at: p.closes_at ? new Date(p.closes_at).toISOString() : null,
        show_results: false,
        block_copy_paste: true,
        require_fullscreen: false,
        shuffle_questions: false,
        shuffle_options: false,
        max_violations: 0,
        allow_calculator: false,
        published: p.publish === true || String(p.publish) === "true",
      });
      const n = await saveQuestions(exam.id, p.questions, 0, { ctx, courseId: p.course_id });
      return {
        text: `Exam "${str(p.title)}" created with ${n} question${n === 1 ? "" : "s"}${p.publish ? " and published" : " as a draft"}.`,
        link: { path: `/Exams/${exam.id}/Edit`, label: "Review the exam" },
      };
    },
  },
  add_exam_questions: {
    title: "Add exam questions",
    run: async (p, ctx) => {
      const { count } = await supabase.from("exam_questions").select("id", { count: "exact", head: true }).eq("exam_id", p.exam_id);
      const { data: exam } = await supabase.from("exams").select("course_id").eq("id", p.exam_id).maybeSingle();
      const n = await saveQuestions(p.exam_id, p.questions, count || 0, { ctx, courseId: exam?.course_id });
      return { text: `${n} question${n === 1 ? "" : "s"} added.`, link: { path: `/Exams/${p.exam_id}/Edit`, label: "Review the exam" } };
    },
  },
  create_assignment: {
    title: "Set an assignment",
    run: async (p, { schoolId }) => {
      await createAssignment({ schoolId, course_id: p.course_id, title: str(p.title), description: str(p.description) || null, points: num(p.points), due_at: p.due_at ? new Date(p.due_at).toISOString() : null });
      return { text: `Assignment "${str(p.title)}" set.` };
    },
  },
  mark_attendance: {
    title: "Mark attendance",
    run: async (p, { schoolId }) => {
      const { data: roster, error } = await supabase.from("class_students").select("student_id").eq("class_id", p.class_id);
      if (error) throw error;
      if (!roster?.length) throw new Error("That class has no pupils in it yet.");
      const absent = new Set(Array.isArray(p.absent_student_ids) ? p.absent_student_ids : []);
      const time = /^\d{2}:\d{2}$/.test(str(p.time)) ? str(p.time) : "08:00";
      await saveAttendance({
        schoolId,
        classId: p.class_id,
        sessionAt: `${str(p.date)}T${time}`,
        records: roster.map((r) => ({ student_id: r.student_id, status: absent.has(r.student_id) ? "absent" : "present" })),
      });
      return { text: `Attendance saved: ${roster.length - absent.size} present, ${absent.size} absent.` };
    },
  },
  create_level: {
    title: "Add a level",
    run: async (p, { schoolId }) => {
      await createLevel({ schoolId, year: Number(p.year), label: str(p.label) });
      return { text: `Level ${str(p.label)} added.` };
    },
  },
  create_class: {
    title: "Add a class",
    run: async (p, { schoolId }) => {
      await createClass({ schoolId, sessionId: p.session_id, levelYear: Number(p.level_year), name: str(p.name), formTeacherId: p.form_teacher_user_id || null });
      return { text: `Class ${str(p.name)} added.` };
    },
  },
  create_term: {
    title: "Add a term",
    run: async (p, { schoolId }) => {
      await createTerm({ schoolId, sessionId: p.session_id, name: str(p.name), position: Number(p.position), startsOn: p.starts_on, endsOn: p.ends_on });
      return { text: `${str(p.name)} added.` };
    },
  },
  set_current_term: {
    title: "Set the current term",
    run: async (p, { schoolId }) => {
      await setCurrentTerm(p.term_id, schoolId);
      return { text: "Current term set." };
    },
  },
  decide_application: {
    title: "Move an application on",
    run: async (p, { schoolId }) => {
      await decideApplication({ id: p.application_id, schoolId, status: str(p.status), note: str(p.note) || null, offerExpires: p.offer_expires || null, conditions: str(p.conditions) || null });
      return { text: `Application moved to ${str(p.status).replace(/_/g, " ")}.`, link: { path: `/AdmissionsWorkspace/${p.application_id}`, label: "Open the application" } };
    },
  },
  schedule_interview: {
    title: "Schedule an interview",
    run: async (p, { schoolId }) => {
      await scheduleInterview({ applicationId: p.application_id, schoolId, when: new Date(p.when).toISOString(), location: str(p.location) || null, meetingLink: str(p.meeting_link) || null, interviewerId: p.interviewer_user_id || null });
      return { text: "Interview scheduled.", link: { path: `/AdmissionsWorkspace/${p.application_id}`, label: "Open the application" } };
    },
  },
  record_interview_outcome: {
    title: "Record an interview outcome",
    run: async (p, { schoolId }) => {
      await recordInterviewOutcome({ interviewId: p.interview_id, schoolId, status: str(p.status), outcome: str(p.outcome) || null, notes: str(p.notes) || null });
      return { text: "Interview outcome recorded." };
    },
  },
  verify_document: {
    title: "Verify a document",
    run: async (p, { schoolId }) => {
      await verifyDocument({ docId: p.document_id, note: str(p.note) || null, schoolId });
      return { text: "Document verified." };
    },
  },
  reject_document: {
    title: "Reject a document",
    run: async (p, { schoolId }) => {
      await rejectDocument({ docId: p.document_id, reason: str(p.reason), schoolId });
      return { text: "Document rejected; the applicant is told why." };
    },
  },
  request_correction: {
    title: "Ask for corrections",
    run: async (p, { schoolId }) => {
      await requestApplicationCorrection({ applicationId: p.application_id, sections: Array.isArray(p.sections) ? p.sections : [String(p.sections)], reason: str(p.reason), schoolId });
      return { text: "Correction requested from the applicant." };
    },
  },
  record_review: {
    title: "Record a review",
    run: async (p) => {
      await recordReview({ applicationId: p.application_id, recommendation: str(p.recommendation), notes: str(p.notes) || null, academicScore: num(p.academic_score), interviewScore: num(p.interview_score) });
      return { text: "Review recorded." };
    },
  },
  message_applicant: {
    title: "Email an applicant",
    run: async (p, { schoolId }) => {
      await notifyApplicant({ applicationId: p.application_id, schoolId, kind: "message", message: str(p.message) });
      return { text: "Message emailed to the applicant." };
    },
  },
  open_applications: {
    title: "Open or close applications",
    run: async (p, { schoolId }) => {
      const open = p.open === true || String(p.open) === "true";
      await setSessionApplicationsOpen({ sessionId: p.session_id, schoolId, open });
      return { text: open ? "Applications are open." : "Applications are closed." };
    },
  },
  raise_invoices: {
    title: "Raise bills",
    run: async (p) => {
      const r = await raiseInvoicesForClass(p.structure_id);
      const n = typeof r === "number" ? r : r?.raised ?? r?.count ?? (Array.isArray(r) ? r.length : null);
      return { text: n != null ? `${n} draft bill${n === 1 ? "" : "s"} raised.` : "Draft bills raised.", link: { path: "/Bursary", label: "Open Bursary" } };
    },
  },
  issue_invoice: {
    title: "Issue a bill",
    run: async (p) => {
      await issueInvoice(p.invoice_id);
      return { text: "Bill issued; the family has been notified." };
    },
  },
  record_payment: {
    title: "Record a payment",
    run: async (p) => {
      await takePayment({ invoiceId: p.invoice_id, amount: Number(p.amount), method: str(p.method), reference: str(p.reference) || null, paidOn: p.paid_on || null, note: null });
      return { text: `Payment of ${Number(p.amount).toLocaleString("en-NG")} recorded.` };
    },
  },
  approve_payment: {
    title: "Approve a payment",
    run: async (p) => {
      await approvePayment({ id: p.payment_id, note: str(p.note) || null });
      return { text: "Payment approved." };
    },
  },
  reject_payment: {
    title: "Reject a payment",
    run: async (p) => {
      await rejectPayment({ id: p.payment_id, note: str(p.note) });
      return { text: "Payment rejected; the family is told why." };
    },
  },
  apply_discount: {
    title: "Apply a discount",
    run: async (p) => {
      await applyDiscountRule({ invoiceId: p.invoice_id, ruleId: p.rule_id });
      return { text: "Discount applied to the draft bill." };
    },
  },
  bring_forward_balances: {
    title: "Bring unpaid balances forward",
    run: async (p) => {
      const r = await carryForwardBalances(p.term_id);
      return { text: `${r.moved} balance${r.moved === 1 ? "" : "s"} brought forward (${Number(r.amount).toLocaleString("en-NG")}); ${r.no_draft_bill?.length || 0} without a draft bill yet.` };
    },
  },
  restock: {
    title: "Restock an item",
    run: async (p) => {
      await restockStoreProduct({ productId: p.product_id, qty: Number(p.qty), unitCost: Number(p.unit_cost), unitDiscount: 0, note: "Restocked through the assistant" });
      return { text: `${Number(p.qty)} added to stock.` };
    },
  },
  create_ticket: {
    title: "Open a help desk ticket",
    run: async (p, { schoolId }) => {
      const priority = ["low", "medium", "high", "urgent"].includes(p.priority) ? p.priority : "low";
      await createTicket({ schoolId, subject: str(p.subject), description: str(p.description), priority });
      return { text: "Ticket opened.", link: { path: "/Support", label: "Open the help desk" } };
    },
  },
  add_store_item: {
    title: "Add a store item",
    run: async (p, { schoolId }) => {
      const item = await saveStoreProduct({
        schoolId,
        name: str(p.name),
        size: str(p.size) || null,
        category: str(p.category),
        supplier: str(p.supplier) || null,
        costPrice: Number(p.cost_price) || 0,
        tradeDiscount: Number(p.trade_discount) || 0,
        sellPrice: Number(p.sell_price) || 0,
        reorderLevel: Number(p.reorder_level) || 0,
      });
      const opening = Number(p.opening_stock) || 0;
      if (opening > 0) {
        await restockStoreProduct({ productId: item.id, qty: opening, unitCost: Number(p.cost_price) || 0, unitDiscount: Number(p.trade_discount) || 0, note: "Opening stock" });
      }
      return { text: `${item.name}${item.size ? ` (${item.size})` : ""} added to the store${opening ? ` with ${opening} in stock` : ""}.`, link: { path: "/Store?tab=items", label: "Open the store" } };
    },
  },
  count_stock: {
    title: "Correct a stock count",
    run: async (p) => {
      await adjustStoreStock({ productId: p.product_id, qtyChange: Number(p.qty_change), reason: str(p.reason) });
      return { text: `Stock changed by ${Number(p.qty_change)}.` };
    },
  },
  set_question_image: {
    title: "Add a picture to a question",
    run: async (p, ctx) => {
      const { data: q, error } = await supabase.from("exam_questions").select("id, exam_id, exams!inner(course_id)").eq("id", p.question_id).maybeSingle();
      if (error) throw error;
      if (!q) throw new Error("That question was not found, or you cannot edit it.");
      const path = await uploadExamQuestionImage({ courseId: q.exams.course_id, file: fileFor(ctx, p.file_ref) });
      await updateQuestion(q.id, { image_path: path }, ctx.schoolId);
      return { text: "Picture added to the question.", link: { path: `/Exams/${q.exam_id}/Edit`, label: "Review the exam" } };
    },
  },
  add_application_document: {
    title: "Add a document to an application",
    run: async (p, ctx) => {
      const file = fileFor(ctx, p.file_ref);
      await uploadApplicationDocument({ schoolId: ctx.schoolId, applicationId: p.application_id, file, kind: str(p.kind) || "other", userId: ctx.userId });
      return { text: `${file.name} added to the application.`, link: { path: `/AdmissionsWorkspace/${p.application_id}`, label: "Open the application" } };
    },
  },
  send_file: {
    title: "Send a file",
    run: async (p, ctx) => {
      const file = fileFor(ctx, p.file_ref);
      const channel = await openDirectMessage({ schoolId: ctx.schoolId, otherUserId: p.to_user_id });
      const channelId = typeof channel === "string" ? channel : channel?.id || channel?.channel_id;
      const attachment = await uploadChatAttachment({ channelId, file });
      await sendChatMessage({ channelId, authorId: ctx.userId, body: str(p.text) ? toParagraphs(p.text) : "", attachment });
      return { text: `${file.name} sent.`, link: channelId ? { path: `/Chat/${channelId}`, label: "Open the chat" } : undefined };
    },
  },
  add_course_material: {
    title: "Add course material",
    run: async (p, ctx) => {
      const fileFields = p.file_ref ? await uploadMaterialFile({ courseId: p.course_id, file: fileFor(ctx, p.file_ref) }) : {};
      await createMaterial({ course_id: p.course_id, title: str(p.title), description: str(p.description) || null, url: str(p.url) || null, created_by: ctx.userId, ...fileFields }, ctx.schoolId);
      return { text: `"${str(p.title)}" added to the course materials.` };
    },
  },
  set_school_logo: {
    title: "Change the school logo",
    run: async (p, ctx) => {
      const url = await uploadSchoolLogo({ schoolId: ctx.schoolId, file: fileFor(ctx, p.file_ref) });
      await updateSchool(ctx.schoolId, { logo_url: url });
      return { text: "School logo updated. Refresh to see it everywhere." };
    },
  },
  set_profile_photo: {
    title: "Change your profile photo",
    run: async (p, ctx) => {
      const url = await uploadAvatar({ userId: ctx.userId, file: fileFor(ctx, p.file_ref) });
      await updateProfile(ctx.userId, { avatar_url: url });
      return { text: "Profile photo updated." };
    },
  },
  call_function: {
    title: "Run a school function",
    run: async (p) => {
      const { data, error } = await supabase.rpc(str(p.function), p.args || {});
      if (error) throw error;
      const shown = data == null ? "" : JSON.stringify(data);
      return { text: `${str(p.function).replace(/_/g, " ")} ran successfully.${shown && shown.length < 400 ? ` Result: ${shown}` : ""}` };
    },
  },
  create_record: {
    title: "Add a record",
    run: async (p) => {
      const { data, error } = await supabase.from(str(p.table)).insert(p.values || {}).select("id").maybeSingle();
      if (error) throw error;
      return { text: `Added to ${tableLabel(p.table)}${data?.id ? ` (id ${data.id})` : ""}.` };
    },
  },
  update_record: {
    title: "Change a record",
    run: async (p, { schoolId }) => {
      let q = supabase.from(str(p.table)).update(p.changes || {}).eq("id", p.id);
      if (p.scope_school) q = q.eq("school_id", schoolId);
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Nothing was changed: the record was not found, or you are not allowed to change it.");
      return { text: `Updated in ${tableLabel(p.table)}.` };
    },
  },
  delete_record: {
    title: "Delete a record",
    danger: true,
    run: async (p, { schoolId }) => {
      let q = supabase.from(str(p.table)).delete().eq("id", p.id);
      if (p.scope_school) q = q.eq("school_id", schoolId);
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Nothing was deleted: the record was not found, or you are not allowed to delete it.");
      return { text: `Deleted ${str(p.what) || `from ${tableLabel(p.table)}`}.` };
    },
  },
  prepare_payroll: {
    title: "Prepare payroll",
    run: async (p, { schoolId }) => {
      await preparePayroll(schoolId, `${str(p.month).slice(0, 7)}-01`);
      return { text: `Payroll for ${str(p.month)} prepared as a draft.`, link: { path: "/Payroll", label: "Open Payroll" } };
    },
  },
};

// Readable labels for a card's details: which fields the action will use.
const HIDDEN_KEYS = /(_id|_ids|^id|^scope_school|_ref)$/;
export const describeParams = (params) =>
  Object.entries(params || {})
    .filter(([k, v]) => !HIDDEN_KEYS.test(k) && v !== null && v !== undefined && v !== "" && k !== "questions")
    .map(([k, v]) => [k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)]);

export const runAction = async (name, params, ctx) => {
  const action = ACTIONS[name];
  if (!action) throw new Error("The assistant asked for something it is not allowed to do.");
  return action.run(params || {}, ctx);
};
