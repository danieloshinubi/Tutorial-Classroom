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
    priority: 10,
    group: "Overview",
    path: "/Dashboard",
    label: "Dashboard",
    roles: ROLES,
  },
  {
    id: "news",
    priority: 20,
    group: "Overview",
    path: "/News",
    label: "News",
    // The school's own noticeboard. Everyone gets it — a parent who sees
    // nothing else on the platform should still hear about a closure.
    roles: ROLES,
  },
  {
    id: "support",
    priority: 25,
    group: "Overview",
    path: "/Support",
    // Not "Support" — the sidebar footer already has a fixed mailto link by
    // that name (support@schoolivio.com, Schoolivio's own platform contact).
    // This is a different thing: the school's own internal request queue.
    label: "Help Desk",
    // Raise your own request and follow it — every role, same as News. The
    // staff-side queue at /Tickets (module "tickets") is a separate, much
    // narrower module for managing everyone's requests.
    roles: ROLES,
  },
  {
    id: "courses",
    priority: 30,
    group: "Teaching",
    path: "/Courses",
    label: "Courses",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher", "student"],
  },
  {
    id: "teach",
    priority: 55,
    group: "Teaching",
    path: "/Teach",
    label: "Teach",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher"],
  },
  {
    id: "bursary",
    priority: 35,
    group: "Money",
    path: "/Bursary",
    label: "Bursary",
    roles: [...RUNS_THE_SCHOOL, "bursar"],
  },
  {
    id: "fees",
    priority: 30,
    group: "Money",
    path: "/Fees",
    label: "Fees",
    // The same subject from the other side: what a family owes and has paid.
    roles: ["parent", "student"],
  },
  {
    id: "admissions",
    priority: 40,
    group: "School",
    path: "/AdmissionsWorkspace",
    label: "Admissions",
    roles: [...RUNS_THE_SCHOOL, "principal", "admissions"],
  },
  {
    id: "reports",
    priority: 45,
    group: "School",
    path: "/Reports",
    label: "Reports",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher", "parent", "student"],
  },
  {
    id: "tutors",
    priority: 70,
    group: "School",
    path: "/Tutors",
    label: "Tutors",
    roles: [...RUNS_THE_SCHOOL, "principal", "teacher", "student"],
  },
  {
    id: "school",
    priority: 80,
    group: "Admin",
    path: "/School",
    label: "School",
    roles: RUNS_THE_SCHOOL,
  },
  {
    id: "auditlog",
    priority: 90,
    group: "Admin",
    path: "/AuditLog",
    label: "Audit Log",
    // Deliberately narrower than most modules — not even principal. Every
    // recorded action, across every family and every member of staff, is a
    // security/compliance surface for whoever actually runs the school.
    roles: RUNS_THE_SCHOOL,
  },
  {
    id: "tickets",
    priority: 85,
    group: "Admin",
    path: "/Tickets",
    label: "Tickets",
    // Staff filing and tracking their own operational issues with each
    // other — a broken projector, a network outage, an access request.
    // Every staff role now, teacher included — each sees only their own
    // department's queue (classroom.can_access_ticket), owner/admin see
    // every department's.
    roles: [...RUNS_THE_SCHOOL, "principal", "bursar", "admissions", "teacher"],
  },
];

const BY_ID = new Map(MODULES.map((m) => [m.id, m]));

// How many fit across the header before it starts eating itself. A proprietor
// holds ten modules, and a horizontal strip cannot show ten without shrinking
// the labels until "School" reads "Sch...".
const ACROSS_THE_TOP = 6;

// The modules this person may use. `roles` is every active membership role
// they hold at this school — usually one, but a proprietor who also teaches
// holds two and should see the union.
export const modulesFor = (roles = []) => {
  const held = roles.filter(Boolean);
  if (held.length === 0) return [];
  return MODULES.filter((m) => m.roles.some((r) => held.includes(r))).sort(
    (a, b) => a.priority - b.priority
  );
};

// Split into what sits in the header and what goes behind "More".
//
// The cut is by priority and it is per person: a bursar's six are not a
// teacher's six. Anyone holding six or fewer sees no More at all, which is
// most people — it only appears for those who really do run everything.
export const navFor = (roles = []) => {
  const mine = modulesFor(roles);
  if (mine.length <= ACROSS_THE_TOP) return { primary: mine, more: [] };
  return { primary: mine.slice(0, ACROSS_THE_TOP), more: mine.slice(ACROSS_THE_TOP) };
};

// The overflow, gathered under headings so it reads as a menu rather than a
// leftovers pile.
export const groupModules = (modules) => {
  const order = ["Overview", "Teaching", "Money", "School", "Admin"];
  const groups = new Map();
  for (const module of modules) {
    if (!groups.has(module.group)) groups.set(module.group, []);
    groups.get(module.group).push(module);
  }
  return order
    .filter((name) => groups.has(name))
    .map((name) => ({ name, modules: groups.get(name) }));
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
