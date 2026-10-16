import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../../Components/Toast";
import TakeExam from "./TakeExam";

// The exam page is the most critical screen a pupil uses, so its behaviour
// is pinned down here: starting, answering, losing the connection, the
// timer running out, cheating rules and submitting. The page and its
// offline answer store are real; only the server, the signed-in person,
// the school, the lockdown (proctoring) and the calculator are stand-ins.

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockApi: Record<string, jest.Mock> = {
  fetchExam: jest.fn(),
  fetchQuestionsForSitting: jest.fn(),
  fetchExamQuestionCount: jest.fn(),
  fetchClockOffset: jest.fn(),
  fetchMyAttempt: jest.fn(),
  startAttempt: jest.fn(),
  saveAnswer: jest.fn(),
  submitAttempt: jest.fn(),
  fetchAnswers: jest.fn(),
  reportViolation: jest.fn(),
  signedMaterialUrl: jest.fn(),
};

jest.mock("../../lib/api", () => ({
  fetchExam: (...a: unknown[]) => mockApi.fetchExam(...a),
  fetchQuestionsForSitting: (...a: unknown[]) => mockApi.fetchQuestionsForSitting(...a),
  fetchExamQuestionCount: (...a: unknown[]) => mockApi.fetchExamQuestionCount(...a),
  fetchClockOffset: (...a: unknown[]) => mockApi.fetchClockOffset(...a),
  fetchMyAttempt: (...a: unknown[]) => mockApi.fetchMyAttempt(...a),
  startAttempt: (...a: unknown[]) => mockApi.startAttempt(...a),
  saveAnswer: (...a: unknown[]) => mockApi.saveAnswer(...a),
  submitAttempt: (...a: unknown[]) => mockApi.submitAttempt(...a),
  fetchAnswers: (...a: unknown[]) => mockApi.fetchAnswers(...a),
  reportViolation: (...a: unknown[]) => mockApi.reportViolation(...a),
  signedMaterialUrl: (...a: unknown[]) => mockApi.signedMaterialUrl(...a),
}));

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "pupil-1" } }) }));
jest.mock("../../context/SchoolContext", () => ({
  useSchool: () => ({ schoolId: "school-1", school: { id: "school-1", name: "Test School", slug: "test" } }),
}));
jest.mock("../../Components/calculator/ExamCalculator", () => () => null);

// The lockdown hands the page its "rule broken" callback; tests call it.
let mockOnViolation: ((kind: string, detail?: string) => Promise<void>) | null = null;
jest.mock("../../lib/proctor", () => ({
  ...jest.requireActual("../../lib/proctor"),
  startProctoring: (opts: { onViolation: (kind: string, detail?: string) => Promise<void> }) => {
    mockOnViolation = opts.onViolation;
    return () => {
      mockOnViolation = null;
    };
  },
  requestFullscreen: () => Promise.resolve(),
  exitFullscreen: () => undefined,
}));

/* ------------------------------------------------------------------ data */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

const baseExam = {
  id: "exam-1",
  title: "Maths test",
  instructions: "Answer every question.",
  courses: { code: "MTH-JS2" },
  duration_mins: 30,
  closes_at: null as string | null,
  shuffle_questions: false,
  shuffle_options: false,
  block_copy_paste: false,
  require_fullscreen: false,
  max_violations: 3,
  show_results: true,
  allow_calculator: false,
};

const questions = [
  {
    id: "q1",
    kind: "multiple_choice",
    prompt: "2 + 2 = ?",
    points: 1,
    position: 1,
    image_path: null,
    exam_options: [
      { id: "o1", body: "Three", position: 1 },
      { id: "o2", body: "Four", position: 2 },
    ],
  },
  { id: "q2", kind: "short_answer", prompt: "The capital of Nigeria?", points: 2, position: 2, image_path: null, exam_options: [] },
];

const openAttempt = (over: Record<string, unknown> = {}) => ({
  id: "attempt-1",
  started_at: minutesAgo(1),
  submitted_at: null,
  disqualified: false,
  violations: 0,
  ...over,
});

const submitted = (over: Record<string, unknown> = {}) =>
  openAttempt({ submitted_at: new Date().toISOString(), total_score: 1, max_score: 3, auto_submitted: false, ...over });

const store = () => JSON.parse(localStorage.getItem("exam-answers:attempt-1") || "{}");

// Every server call answers normally unless a test says otherwise.
const setup = ({ exam = baseExam, attempt = null as any, paper = [] as any[] } = {}) => {
  mockApi.fetchExam.mockResolvedValue(exam);
  mockApi.fetchQuestionsForSitting.mockResolvedValue(paper);
  mockApi.fetchExamQuestionCount.mockResolvedValue(questions.length);
  mockApi.fetchClockOffset.mockResolvedValue(0);
  mockApi.fetchMyAttempt.mockResolvedValue(attempt);
  mockApi.startAttempt.mockResolvedValue(openAttempt());
  mockApi.saveAnswer.mockResolvedValue(undefined);
  mockApi.submitAttempt.mockResolvedValue(submitted());
  mockApi.fetchAnswers.mockResolvedValue([]);
  mockApi.reportViolation.mockResolvedValue(openAttempt());
  mockApi.signedMaterialUrl.mockResolvedValue(null);
};

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/Exams/exam-1"]}>
        <Routes>
          <Route path="/Exams/:examId" element={<TakeExam />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );

// A paper already in progress, on screen.
const sitting = async (attemptOver: Record<string, unknown> = {}, examOver: Record<string, unknown> = {}) => {
  setup({ exam: { ...baseExam, ...examOver }, attempt: openAttempt(attemptOver), paper: questions });
  renderPage();
  await screen.findByText("2 + 2 = ?");
};

// An option's radio button, by the option's text (its label reads "B" + "Four").
const optionInput = (label: string) => screen.getByLabelText(new RegExp(`${label}$`)) as HTMLInputElement;
const finishButton = () => screen.getAllByText("Finish exam")[0];

beforeAll(() => {
  // jsdom has no ResizeObserver; the page layout only uses it to measure.
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  localStorage.clear();
  mockOnViolation = null;
});

/* ----------------------------------------------------------------- tests */

test("before starting: shows how many questions, never the questions themselves", async () => {
  setup();
  mockApi.fetchQuestionsForSitting.mockResolvedValueOnce([]).mockResolvedValueOnce(questions);
  renderPage();

  expect(await screen.findByText("2 questions")).toBeInTheDocument();
  expect(screen.getByText("30 minutes")).toBeInTheDocument();
  expect(screen.queryByText("2 + 2 = ?")).not.toBeInTheDocument();

  fireEvent.click(screen.getByText("I understand — start exam"));

  expect(await screen.findByText("2 + 2 = ?")).toBeInTheDocument();
  expect(mockApi.startAttempt).toHaveBeenCalledWith({ examId: "exam-1" });
  // The paper is fetched again once the attempt exists.
  expect(mockApi.fetchQuestionsForSitting).toHaveBeenCalledTimes(2);
});

test("a closed exam cannot be started", async () => {
  setup({ exam: { ...baseExam, closes_at: minutesAgo(60) } });
  renderPage();

  expect(await screen.findByText(/This exam closed on/)).toBeInTheDocument();
  expect(screen.getByText("I understand — start exam")).toBeDisabled();
});

test("an exam that does not exist says so", async () => {
  setup();
  mockApi.fetchExam.mockResolvedValue(null);
  renderPage();

  expect(await screen.findByText("That exam is not available.")).toBeInTheDocument();
});

test("choosing an option saves it, and counts it as answered", async () => {
  await sitting();

  fireEvent.click(optionInput("Four"));

  await waitFor(() =>
    expect(mockApi.saveAnswer).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-1", questionId: "q1", optionId: "o2" }))
  );
  expect(optionInput("Four").checked).toBe(true);
  // The "Answered" row of the summary (the "Question" row also reads 1 / 2).
  // "Question 1 / 2" and now "Answered 1 / 2" (it read 0 / 2 before).
  expect(screen.getAllByText("1 / 2")).toHaveLength(2);
  await waitFor(() => expect(store().q1.synced).toBe(true));
});

test("moving between questions, and a written answer is saved", async () => {
  await sitting();

  fireEvent.click(screen.getByText("Next question"));
  expect(await screen.findByText("The capital of Nigeria?")).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText("Your answer"), { target: { value: "Abuja" } });
  await waitFor(() =>
    expect(mockApi.saveAnswer).toHaveBeenCalledWith(expect.objectContaining({ questionId: "q2", text: "Abuja" }))
  );

  fireEvent.click(screen.getByLabelText(/Go to question 1/));
  expect(await screen.findByText("2 + 2 = ?")).toBeInTheDocument();
});

test("submitting sends the paper, shows the score and clears the device copy", async () => {
  await sitting();
  fireEvent.click(optionInput("Four"));
  await waitFor(() => expect(store().q1?.synced).toBe(true));

  fireEvent.click(finishButton());

  expect(await screen.findByText("Paper submitted")).toBeInTheDocument();
  expect(screen.getByText("1/3")).toBeInTheDocument();
  expect(mockApi.submitAttempt).toHaveBeenCalledWith("attempt-1");
  expect(localStorage.getItem("exam-answers:attempt-1")).toBeNull();
});

test("pressing Finish twice submits once", async () => {
  await sitting();
  let release: (v: unknown) => void = () => undefined;
  mockApi.submitAttempt.mockImplementation(() => new Promise((r) => (release = r)));

  // The same button pressed twice in quick succession.
  const button = finishButton();
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(mockApi.submitAttempt).toHaveBeenCalledTimes(1));
  await act(async () => release(submitted()));
  expect(await screen.findByText("Paper submitted")).toBeInTheDocument();
  expect(mockApi.submitAttempt).toHaveBeenCalledTimes(1);
});

test("offline with answers unsent: the paper is NOT closed and nothing is lost", async () => {
  await sitting();
  mockApi.saveAnswer.mockRejectedValue(new Error("Failed to fetch"));

  fireEvent.click(optionInput("Four"));
  await waitFor(() => expect(store().q1?.optionId).toBe("o2"));

  fireEvent.click(finishButton());

  expect(await screen.findByText(/Some answers have not reached the school yet/)).toBeInTheDocument();
  expect(mockApi.submitAttempt).not.toHaveBeenCalled();
  expect(store().q1).toEqual(expect.objectContaining({ optionId: "o2", synced: false }));
  expect(screen.queryByText("Paper submitted")).not.toBeInTheDocument();
});

test("an answer the server refuses (time up) still lets the paper be submitted, and stays on the device", async () => {
  await sitting();
  mockApi.saveAnswer.mockRejectedValue(new Error("Your time is up"));

  fireEvent.click(optionInput("Four"));
  await waitFor(() => expect(store().q1?.optionId).toBe("o2"));
  fireEvent.click(finishButton());

  expect(await screen.findByText("Paper submitted")).toBeInTheDocument();
  expect(mockApi.submitAttempt).toHaveBeenCalledTimes(1);
  // Not cleared: the refused answer is still on this device.
  expect(store().q1).toEqual(expect.objectContaining({ optionId: "o2", synced: false }));
});

test("when time runs out the paper submits by itself", async () => {
  mockApi.submitAttempt.mockResolvedValue(submitted({ auto_submitted: true }));
  setup({ attempt: openAttempt({ started_at: minutesAgo(31) }), paper: questions });
  mockApi.submitAttempt.mockResolvedValue(submitted({ auto_submitted: true }));
  renderPage();

  expect(await screen.findByText("Submitted automatically when time ran out.")).toBeInTheDocument();
  expect(mockApi.submitAttempt).toHaveBeenCalledTimes(1);
});

test("breaking a rule is recorded and warned; too many ends the exam", async () => {
  await sitting();
  // The lockdown starts just after the paper appears.
  await waitFor(() => expect(mockOnViolation).not.toBeNull());

  mockApi.reportViolation.mockResolvedValueOnce(openAttempt({ violations: 1 }));
  await act(async () => {
    await mockOnViolation!("tab_hidden");
  });
  expect(await screen.findByText(/Switched away from the exam\. This has been recorded \(warning 1\)/)).toBeInTheDocument();
  expect(screen.getByText("2 more and your paper is taken away.")).toBeInTheDocument();

  mockApi.reportViolation.mockResolvedValueOnce(
    openAttempt({ violations: 3, disqualified: true, disqualified_reason: "Too many violations", submitted_at: new Date().toISOString() })
  );
  await act(async () => {
    await mockOnViolation!("tab_hidden");
  });
  expect(await screen.findByText("Exam ended")).toBeInTheDocument();
  expect(screen.getByText("Too many violations")).toBeInTheDocument();
});

test("coming back to a paper: an answer saved on this device but not yet sent wins over the server's", async () => {
  localStorage.setItem(
    "exam-answers:attempt-1",
    JSON.stringify({ q1: { optionId: "o1", synced: false, updatedAt: Date.now() } })
  );
  setup({ attempt: openAttempt(), paper: questions });
  mockApi.fetchAnswers.mockResolvedValue([{ question_id: "q1", selected_option_id: "o2", answer_text: null }]);
  renderPage();

  await screen.findByText("2 + 2 = ?");
  await waitFor(() => expect(optionInput("Three").checked).toBe(true));
  expect(optionInput("Four").checked).toBe(false);
});

test("the server's clock, not the device's, decides whether the exam has closed", async () => {
  // Closes in 5 minutes by this device's clock, but the server is 10 minutes ahead.
  setup({ exam: { ...baseExam, closes_at: new Date(Date.now() + 5 * 60000).toISOString() } });
  mockApi.fetchClockOffset.mockResolvedValue(10 * 60000);
  renderPage();

  expect(await screen.findByText(/This exam closed on/)).toBeInTheDocument();
});
