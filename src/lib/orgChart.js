// Who counts as "staff" for reporting-line purposes — students and parents
// never report to anyone here, by design (the user's own instruction).
export const STAFF_ROLES = ["owner", "admin", "principal", "bursar", "admissions", "teacher"];

const ROLE_RANK = Object.fromEntries(STAFF_ROLES.map((r, i) => [r, i]));
const byRank = (a, b) =>
  (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99) ||
  (a.profiles?.first_name || "").localeCompare(b.profiles?.first_name || "");

// Builds the reporting tree from a flat list of school_members rows (as
// fetchSchoolMembers returns them). "Root" is derived, never assumed: a
// node is a root only once walking up the chain finds nobody left to
// attach it to — never by role, so whoever the data actually shows at the
// top is who shows up there, even if that turns out to be a teacher and
// not the proprietor.
//
// Multiple roots are expected, not an error case — two independent senior
// staff with nobody above either of them (e.g. a proprietor and a
// separately-managed bursar) is realistic and renders as two trees.
//
// A manager who leaves doesn't strand their reports as false roots: if
// Emmanuel (a sysadmin reporting to Gift) is SUSPENDED, his row survives
// with is_active=false, so his own manager_id is still on record — his
// reports (e.g. an intern who reported to Emmanuel) automatically bubble
// up to Gift with no admin action. If Emmanuel is REMOVED instead, his
// row (and the "reports to Gift" fact it carried) is gone entirely — there
// is nothing left to bubble through, so his reports become roots until an
// admin manually re-points them. Removed is for revoking access; Suspend
// is what preserves the reporting history this bubble-up relies on.
// Walks up from one person's OWN manager_id, following the literal chain
// as an admin has actually entered it — not the active-staff-filtered tree
// buildOrgTree renders — to find whoever sits at the very top. This is the
// "who's the top gun" answer PersonModal surfaces: nobody has to already
// know the org chart exists, the chain itself already encodes the answer.
// Returns the starting person unchanged if they have no manager (they
// already are the top), or the same defensive hop cap as buildOrgTree.
export const findTopOfChain = (startUserId, members) => {
  const byUserId = new Map(members.map((m) => [m.user_id, m]));
  let current = byUserId.get(startUserId);
  if (!current) return null;
  let hops = 0;
  while (current.manager_id && byUserId.has(current.manager_id) && hops < members.length) {
    current = byUserId.get(current.manager_id);
    hops += 1;
  }
  return current;
};

export const buildOrgTree = (members) => {
  // Every membership row, staff or not, active or not — needed only to
  // walk PAST a departed manager to whoever they themselves reported to;
  // never rendered directly unless it also passes the active-staff filter.
  const managerOf = new Map(members.map((m) => [m.user_id, m.manager_id || null]));

  const staff = members.filter((m) => m.is_active && STAFF_ROLES.includes(m.role));
  const activeStaffIds = new Set(staff.map((m) => m.user_id));
  const byUserId = new Map(staff.map((m) => [m.user_id, { ...m, children: [] }]));

  // The nearest active-staff ancestor of a person — their own manager if
  // still active staff, otherwise that manager's manager, and so on.
  // Capped at members.length hops as a defensive backstop; the DB's own
  // cycle guard (supabase/165_org_chart_cycle_guard.sql) already makes a
  // live cycle impossible to save, so this never actually loops.
  const resolveManager = (userId) => {
    let current = managerOf.get(userId) || null;
    let hops = 0;
    while (current && !activeStaffIds.has(current) && hops < members.length) {
      current = managerOf.get(current) || null;
      hops += 1;
    }
    return current;
  };

  const roots = [];
  for (const node of byUserId.values()) {
    const managerId = resolveManager(node.user_id);
    const manager = managerId ? byUserId.get(managerId) : null;
    if (manager) manager.children.push(node);
    else roots.push(node);
  }

  const sortTree = (nodes) => {
    nodes.sort(byRank);
    nodes.forEach((n) => sortTree(n.children));
    return nodes;
  };
  return sortTree(roots);
};
