// Turns the raw per-course figures from classroom.student_report() into a
// judgement a parent or tutor can act on.
//
// Two principles run through this file:
//   - Never invent a number. A course with nothing marked has no score, and
//     says so, rather than showing 0% and looking like failure.
//   - Say what to do about it. "Weak in CHEM101" is not useful on its own;
//     "3 of 7 assignments not turned in" is.

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// Assignments and exams are blended into one figure per course. Exams weigh
// more because they are sat under supervision.
const ASSIGNMENT_WEIGHT = 0.4;
const EXAM_WEIGHT = 0.6;

// What a reaction is worth next to a written comment.
//
// Not zero: a student who reads a post and taps 👍 has taken part, and plenty
// of them have nothing to add in words. Not one either — writing something
// costs more and is worth more, and if a tap scored the same the quickest way
// to look engaged would be to tap everything. A quarter is deliberately
// modest: four reactions to match one comment.
export const REACTION_WEIGHT = 0.25;

// Participation on one course, in comment-equivalents.
export const contributionOf = (row) =>
  (row.messages_sent || 0) + (row.reactions_given || 0) * REACTION_WEIGHT;

export const summariseCourse = (row) => {
  const assignmentPct = pct(row.points_earned, row.points_possible);
  const examPct = pct(row.exam_score, row.exam_max);
  const turnInPct = pct(row.assignments_done, row.assignments_set);
  const contribution = contributionOf(row);
  const punctualityPct = pct(row.assignments_ontime, row.assignments_done);

  // Weighted where both exist, otherwise whichever we actually have.
  let score = null;
  if (assignmentPct !== null && examPct !== null) {
    score = Math.round(assignmentPct * ASSIGNMENT_WEIGHT + examPct * EXAM_WEIGHT);
  } else if (examPct !== null) {
    score = examPct;
  } else if (assignmentPct !== null) {
    score = assignmentPct;
  }

  return {
    ...row,
    contribution,
    reactions_given: row.reactions_given || 0,
    assignmentPct,
    examPct,
    turnInPct,
    punctualityPct,
    score,
    missing: Math.max(0, row.assignments_set - row.assignments_done),
    graded: row.assignments_graded > 0 || row.exams_sat > 0,
  };
};

export const GRADE_BANDS = [
  { min: 75, label: "Excellent", tone: "success" },
  { min: 65, label: "Very good", tone: "success" },
  { min: 55, label: "Good", tone: "brand" },
  { min: 45, label: "Fair", tone: "warn" },
  { min: 0, label: "Needs attention", tone: "danger" },
];

export const bandFor = (score) =>
  score === null || score === undefined
    ? { label: "Not yet marked", tone: undefined }
    : GRADE_BANDS.find((band) => score >= band.min);

/**
 * The whole picture for one student.
 * Returns overall figures, per-course rows, and plain-language findings.
 */
export const analyse = (rows, marks = []) => {
  const courses = rows.map(summariseCourse);
  const scored = courses.filter((c) => c.score !== null);

  const totalSet = courses.reduce((n, c) => n + c.assignments_set, 0);
  const totalDone = courses.reduce((n, c) => n + c.assignments_done, 0);
  const totalOntime = courses.reduce((n, c) => n + c.assignments_ontime, 0);
  const totalMessages = courses.reduce((n, c) => n + c.messages_sent, 0);
  const totalReactions = courses.reduce((n, c) => n + (c.reactions_given || 0), 0);
  // Comments and reactions together, the latter discounted. This is what
  // "class contributions" now means.
  const totalContribution = courses.reduce((n, c) => n + c.contribution, 0);

  const average =
    scored.length > 0
      ? Math.round(scored.reduce((n, c) => n + c.score, 0) / scored.length)
      : null;

  const turnIn = pct(totalDone, totalSet);
  const punctuality = pct(totalOntime, totalDone);

  // A course counts as a strength when it is both good in absolute terms and
  // better than this student's own average — otherwise a strong student has
  // "weaknesses" that are merely their least-best subject.
  const strengths = scored
    .filter((c) => c.score >= 60 && (average === null || c.score >= average))
    .sort((a, b) => b.score - a.score);

  const weaknesses = scored
    .filter((c) => c.score < 50 || (average !== null && c.score <= average - 15))
    .sort((a, b) => a.score - b.score);

  const best = scored.length ? scored.reduce((a, b) => (b.score > a.score ? b : a)) : null;

  // Where they talk most, which is not the same as where they score best.
  const mostActive = courses.reduce(
    (a, b) => (b.contribution > (a?.contribution ?? -1) ? b : a),
    null
  );

  const findings = [];

  if (weaknesses.length) {
    findings.push({
      kind: "concern",
      title: `Struggling in ${weaknesses.map((c) => c.course_code).join(", ")}`,
      detail:
        weaknesses.length === 1
          ? `${weaknesses[0].course_code} is at ${weaknesses[0].score}%, against an average of ${average}%.`
          : `These sit well below an average of ${average}%.`,
    });
  }

  if (turnIn !== null && turnIn < 70) {
    const missing = totalSet - totalDone;
    findings.push({
      kind: "concern",
      title: `${missing} assignment${missing === 1 ? "" : "s"} not turned in`,
      detail: `Only ${turnIn}% of work set has been submitted. Marks cannot reflect ability while work is missing.`,
    });
  }

  if (punctuality !== null && punctuality < 60 && totalDone >= 3) {
    findings.push({
      kind: "watch",
      title: "Often submits late",
      detail: `${punctuality}% of submitted work arrived on time.`,
    });
  }

  if (totalMessages === 0 && courses.length > 0) {
    findings.push({
      kind: "watch",
      title: "No class participation recorded",
      detail: "Has not posted in any class stream. Worth checking they are engaged.",
    });
  }

  if (best && best.score >= 70) {
    findings.push({
      kind: "strength",
      title: `Strongest in ${best.course_code}`,
      detail: `${best.score}% — ${best.course_title || best.course_code}.`,
    });
  }

  if (turnIn === 100 && totalSet >= 3) {
    findings.push({
      kind: "strength",
      title: "Turns in everything",
      detail: `All ${totalSet} assignments submitted.`,
    });
  }

  if (mostActive && mostActive.contribution >= 5) {
    // Say which kind of taking part it was, so a parent reading "most
    // involved" is not left thinking their child has been talking all term
    // when they have mostly been reacting — or the other way round.
    const parts = [];
    if (mostActive.messages_sent) {
      parts.push(
        `${mostActive.messages_sent} post${mostActive.messages_sent === 1 ? "" : "s"}`
      );
    }
    if (mostActive.reactions_given) {
      parts.push(
        `${mostActive.reactions_given} reaction${mostActive.reactions_given === 1 ? "" : "s"}`
      );
    }
    findings.push({
      kind: "strength",
      title: `Most involved in ${mostActive.course_code}`,
      detail: `${parts.join(" and ")} on the class stream.`,
    });
  }

  // Improving or slipping, judged on marks in order rather than a single point.
  const trend = trendOf(marks);
  if (trend) findings.push(trend);

  return {
    courses,
    average,
    turnIn,
    punctuality,
    totalSet,
    totalDone,
    totalMessages,
    totalReactions,
    // Comments plus discounted reactions — what the report calls contributions.
    totalContribution: Math.round(totalContribution * 10) / 10,
    strengths,
    weaknesses,
    best,
    mostActive,
    findings,
    hasData: courses.length > 0,
    hasMarks: scored.length > 0,
  };
};

// Compares the first half of the marks to the second. Needs at least four
// results before it will claim a direction.
const trendOf = (marks) => {
  const usable = marks
    .filter((m) => m.out_of > 0 && m.scored !== null)
    .map((m) => Math.round((m.scored / m.out_of) * 100));

  if (usable.length < 4) return null;

  const half = Math.floor(usable.length / 2);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const change = Math.round(mean(usable.slice(half)) - mean(usable.slice(0, half)));

  if (change >= 8) {
    return {
      kind: "strength",
      title: "Improving",
      detail: `Recent marks average ${change} points higher than earlier ones.`,
    };
  }
  if (change <= -8) {
    return {
      kind: "concern",
      title: "Slipping",
      detail: `Recent marks average ${Math.abs(change)} points lower than earlier ones.`,
    };
  }
  return null;
};

// Red/yellow/green thresholds for an attendance rate — deliberately
// stricter than the academic grade bands above: missing a fifth of class
// sessions is a real concern in a way a 79% exam average is not.
const rateBand = (rate) => {
  if (rate === null) return { label: "No data", tone: undefined };
  if (rate >= 90) return { label: "Good", tone: "success" };
  if (rate >= 75) return { label: "Watch", tone: "warn" };
  return { label: "Needs attention", tone: "danger" };
};

const dateKey = (iso) => iso.slice(0, 10);

const averageTimeOfDay = (isoTimestamps) => {
  if (isoTimestamps.length === 0) return null;
  // Averaging minutes-since-midnight, not the timestamps themselves — two
  // resumptions at 7:00 and 7:20 should average to 7:10, which only works
  // if the calendar date is discarded first.
  const minutes = isoTimestamps.map((iso) => {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  });
  const meanMinutes = Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length);
  const h24 = Math.floor(meanMinutes / 60) % 24;
  const m = meanMinutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

/**
 * Attendance, scored the same "never invent a number" way the academic
 * side is: a student with no class-attendance rows yet has no class rate,
 * not a misleading 0%.
 *
 * classRecords: [{ session_at, status: 'present'|'absent' }] — this
 * student's own class-attendance marks, any class, any teacher.
 * schoolRecords: [{ resumed_at }] — this student's biometric/card/manual
 * resumption scans, any number of scans a day (only the earliest counts).
 *
 * schoolAttendanceRate has no independent school calendar to measure
 * against, so it is expressed against the days THIS student has ANY
 * attendance signal at all (a class mark or a resumption scan) — "of the
 * days we know school was on for them, how many did they actually walk
 * in." That is a real, defensible number; inventing a school-wide working
 * day count here would not be.
 */
export const analyseAttendance = (classRecords = [], schoolRecords = []) => {
  const marked = classRecords.filter((r) => r.status === "present" || r.status === "absent");
  const presentCount = marked.filter((r) => r.status === "present").length;
  const classAttendanceRate = marked.length > 0 ? Math.round((presentCount / marked.length) * 100) : null;

  const classDays = new Set(marked.map((r) => dateKey(r.session_at)));
  const resumptionDays = new Set(schoolRecords.map((r) => dateKey(r.resumed_at)));
  const knownDays = new Set([...classDays, ...resumptionDays]);
  const schoolAttendanceRate =
    knownDays.size > 0 ? Math.round((resumptionDays.size / knownDays.size) * 100) : null;

  // Earliest scan per day — a second tap re-entering a building later
  // should not drag the "what time do they normally arrive" figure around.
  const earliestPerDay = new Map();
  schoolRecords.forEach((r) => {
    const key = dateKey(r.resumed_at);
    const existing = earliestPerDay.get(key);
    if (!existing || new Date(r.resumed_at) < new Date(existing)) earliestPerDay.set(key, r.resumed_at);
  });
  const averageResumptionTime = averageTimeOfDay([...earliestPerDay.values()]);

  const classBand = rateBand(classAttendanceRate);
  const schoolBand = rateBand(schoolAttendanceRate);

  const findings = [];
  if (classAttendanceRate !== null && classAttendanceRate < 75) {
    const missed = marked.length - presentCount;
    findings.push({
      kind: "concern",
      title: "Frequently absent from class",
      detail: `Marked absent ${missed} of ${marked.length} recorded session${marked.length === 1 ? "" : "s"} (${classAttendanceRate}% present).`,
    });
  }
  if (schoolAttendanceRate !== null && schoolAttendanceRate < 75) {
    findings.push({
      kind: "concern",
      title: "Often does not resume at school",
      detail: `Only resumed on ${resumptionDays.size} of ${knownDays.size} days this covers (${schoolAttendanceRate}%).`,
    });
  }
  if (
    classAttendanceRate !== null &&
    schoolAttendanceRate !== null &&
    classAttendanceRate >= 95 &&
    schoolAttendanceRate >= 95
  ) {
    findings.push({
      kind: "strength",
      title: "Excellent attendance",
      detail: `${classAttendanceRate}% present in class, ${schoolAttendanceRate}% school resumption.`,
    });
  }

  return {
    classAttendanceRate,
    schoolAttendanceRate,
    classBand,
    schoolBand,
    averageResumptionTime,
    presentCount,
    sessionsRecorded: marked.length,
    daysWithResumption: resumptionDays.size,
    daysKnown: knownDays.size,
    findings,
    hasData: marked.length > 0 || schoolRecords.length > 0,
  };
};

export const marksAsSeries = (marks) =>
  marks
    .filter((m) => m.out_of > 0 && m.scored !== null)
    .map((m) => ({
      label: m.title,
      course: m.course_code,
      kind: m.kind,
      value: Math.round((m.scored / m.out_of) * 100),
      at: m.happened_at,
      late: m.late,
    }));
