import { analyse, summariseCourse, bandFor } from "./analysis";

const course = (over = {}) => ({
  course_id: over.course_id || Math.random().toString(36).slice(2),
  course_code: "TEST101",
  course_title: "A course",
  level_year: 1,
  assignments_set: 0,
  assignments_done: 0,
  assignments_ontime: 0,
  assignments_graded: 0,
  points_earned: 0,
  points_possible: 0,
  exams_sat: 0,
  exam_score: 0,
  exam_max: 0,
  messages_sent: 0,
  last_activity: null,
  ...over,
});

describe("summariseCourse", () => {
  test("a course with nothing marked has no score, not zero", () => {
    const row = summariseCourse(course({ assignments_set: 4 }));
    expect(row.score).toBeNull();
    expect(row.assignmentPct).toBeNull();
    expect(row.examPct).toBeNull();
    expect(row.missing).toBe(4);
  });

  test("weights exams 60 and assignments 40", () => {
    const row = summariseCourse(
      course({
        assignments_graded: 1,
        points_earned: 50,
        points_possible: 100, // 50%
        exams_sat: 1,
        exam_score: 100,
        exam_max: 100, // 100%
      })
    );
    // 50*0.4 + 100*0.6 = 80
    expect(row.score).toBe(80);
  });

  test("falls back to whichever measure exists", () => {
    const examOnly = summariseCourse(
      course({ exams_sat: 1, exam_score: 70, exam_max: 100 })
    );
    expect(examOnly.score).toBe(70);

    const workOnly = summariseCourse(
      course({ assignments_graded: 1, points_earned: 30, points_possible: 100 })
    );
    expect(workOnly.score).toBe(30);
  });

  test("unmarked work does not drag the score down", () => {
    // Five set, one marked at full marks. The other four are not yet graded,
    // so the score is 100% — the turn-in rate is what carries that story.
    const row = summariseCourse(
      course({
        assignments_set: 5,
        assignments_done: 1,
        assignments_graded: 1,
        points_earned: 20,
        points_possible: 20,
      })
    );
    expect(row.score).toBe(100);
    expect(row.turnInPct).toBe(20);
  });
});

describe("analyse", () => {
  test("no courses means no data, and no invented averages", () => {
    const report = analyse([]);
    expect(report.hasData).toBe(false);
    expect(report.average).toBeNull();
    expect(report.turnIn).toBeNull();
  });

  test("averages only over courses that have a score", () => {
    const report = analyse([
      course({ course_code: "A", exams_sat: 1, exam_score: 80, exam_max: 100 }),
      course({ course_code: "B", exams_sat: 1, exam_score: 40, exam_max: 100 }),
      course({ course_code: "C", assignments_set: 3 }), // nothing marked
    ]);
    expect(report.average).toBe(60);
  });

  test("flags missing work with the real count", () => {
    const report = analyse([
      course({ course_code: "A", assignments_set: 10, assignments_done: 4 }),
    ]);
    const finding = report.findings.find((f) => f.title.includes("not turned in"));
    expect(finding).toBeTruthy();
    expect(finding.title).toBe("6 assignments not turned in");
    expect(report.turnIn).toBe(40);
  });

  test("a strong student's least-best subject is not called a weakness", () => {
    const report = analyse([
      course({ course_code: "A", exams_sat: 1, exam_score: 90, exam_max: 100 }),
      course({ course_code: "B", exams_sat: 1, exam_score: 85, exam_max: 100 }),
      course({ course_code: "C", exams_sat: 1, exam_score: 80, exam_max: 100 }),
    ]);
    expect(report.weaknesses).toHaveLength(0);
    expect(report.best.course_code).toBe("A");
  });

  test("catches a subject well below the student's own average", () => {
    const report = analyse([
      course({ course_code: "A", exams_sat: 1, exam_score: 90, exam_max: 100 }),
      course({ course_code: "B", exams_sat: 1, exam_score: 88, exam_max: 100 }),
      course({ course_code: "C", exams_sat: 1, exam_score: 45, exam_max: 100 }),
    ]);
    expect(report.weaknesses.map((c) => c.course_code)).toEqual(["C"]);
  });

  test("reports an upward trend only with enough marks", () => {
    const rising = [40, 45, 70, 75].map((v, i) => ({
      scored: v,
      out_of: 100,
      happened_at: `2026-01-0${i + 1}`,
      title: `t${i}`,
      course_code: "A",
      kind: "assignment",
    }));
    const report = analyse([course({ course_code: "A" })], rising);
    expect(report.findings.some((f) => f.title === "Improving")).toBe(true);

    // Three marks is not enough to claim a direction.
    const tooFew = analyse([course({ course_code: "A" })], rising.slice(0, 3));
    expect(tooFew.findings.some((f) => f.title === "Improving")).toBe(false);
  });

  test("notices silence in the class stream", () => {
    const report = analyse([course({ course_code: "A", messages_sent: 0 })]);
    expect(
      report.findings.some((f) => f.title === "No class participation recorded")
    ).toBe(true);
  });
});

describe("bandFor", () => {
  test("names the band, and says so when nothing is marked", () => {
    expect(bandFor(80).label).toBe("Excellent");
    expect(bandFor(46).label).toBe("Fair");
    expect(bandFor(20).label).toBe("Needs attention");
    expect(bandFor(null).label).toBe("Not yet marked");
  });
});
