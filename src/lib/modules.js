// What each role is here to do.
//
// One list, read by both the navigation and the route guards, so the two can
// never disagree — a link that is not in somebody's navbar is also a route
// they cannot open by typing the address. This is a usability boundary, not a
// security one: row level security decides what the database will hand over,
// and it does so again regardless of anything here.
//
// A tenant administrator sees everything, because running the school is the
// job. Everyone else sees the modules their work actually needs: a bursar has
// no reason to look at a class stream, and a parent has no reason to see a
// staff directory.

export const ROLES = [
  "owner",
  "admin",
  "principal",
  "bursar",
  "admissions",
  "teacher",
  "student",
  "parent",
];

// Whoever runs the school. Distinct from `principal`, who approves results but
// does not necessarily administer accounts.
const RUNS_THE_SCHOOL = ["owner", "admin"];

export const MODULES = [
  {
    id: "dashboard",
    path: "/Dashboard",
    label: "Dashboard",
    roles: ROLES,
  },
  {
    id: "courses",
    path: "/Courses",
    label: "Courses",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher", "student"],
  },
  {
    id: "teach",
    path: "/Teach",
    label: "Teach",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher"],
  },
  {
    id: "results",
    path: "/Results",
    label: "Results",
    // A teacher enters marks; a principal or administrator approves and
    // releases them. Two different screens behind one module.
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher"],
  },
  {
    id: "bursary",
    path: "/Bursary",
    label: "Bursary",
    roles: [...RUNS_THE_SCHOOL, "bursar"],
  },
  {
    id: "fees",
    path: "/Fees",
    label: "Fees",
    // The same subject from the other side: what a family owes and has paid.
    roles: ["parent", "student"],
  },
  {
    id: "admissions",
    path: "/Admissions",
    label: "Admissions",
    roles: [...RUNS_THE_SCHOOL, "principal", "admissions"],
  },
  {
    id: "reports",
    path: "/Reports",
    label: "Reports",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher", "parent", "student"],
  },
  {
    id: "tutors",
    path: "/Tutors",
    label: "Tutors",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher", "student"],
  },
  {
    id: "school",
    path: "/School",
    label: "School",
    roles: RUNS_THE_SCHOOL,
  },
];

const BY_ID = new Map(MODULES.map((m) => [m.id, m]));

// The modules this person may use. `roles` is every active membership role
// they hold at this school — usually one, but a proprietor who also teaches
// holds two and should see the union.
export const modulesFor = (roles = []) => {
  const held = roles.filter(Boolean);
  if (held.length === 0) return [];
  return MODULES.filter((m) => m.roles.some((r) => held.includes(r)));
};

export const canUseModule = (moduleId, roles = []) => {
  const module = BY_ID.get(moduleId);
  if (!module) return false;
  return module.roles.some((r) => roles.filter(Boolean).includes(r));
};

export const moduleById = (moduleId) => BY_ID.get(moduleId) || null;

// Where to send someone who lands somewhere they may not be. Their first
// module beats a hard-coded /Dashboard, which a role might not even have.
export const homeFor = (roles = []) => {
  const mine = modulesFor(roles);
  return mine.length ? mine[0].path : "/Profile";
};
