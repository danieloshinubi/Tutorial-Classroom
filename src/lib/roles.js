// The school_members role vocabulary, shared by SchoolAdmin's People panel
// and its org chart panel so both render the exact same labels and badge
// colours for the exact same roles.
export const ROLES = [
  ["owner", "Proprietor"],
  ["admin", "Administrator"],
  // Approves and releases results. Kept separate from Administrator on
  // purpose: whoever enters marks must not be the one who signs them off, so
  // the database refuses an approval from the person who submitted it.
  ["principal", "Principal"],
  ["bursar", "Bursar"],
  ["admissions", "Admissions"],
  ["teacher", "Teacher"],
  ["student", "Student"],
  ["parent", "Parent"],
];

export const ROLE_LABEL = Object.fromEntries(ROLES);

export const toneFor = (role) => {
  if (role === "owner" || role === "admin" || role === "principal") return "danger";
  if (role === "teacher") return "brand";
  if (role === "bursar" || role === "admissions") return "warn";
  return undefined;
};

// Same grouping as toneFor, as a CSS colour instead of a badge tone — used
// to give the role picker itself a coloured edge, so a row's seniority
// reads at a glance without having to read the word.
export const roleAccent = (role) => {
  if (role === "owner" || role === "admin" || role === "principal") return "var(--danger)";
  if (role === "teacher") return "var(--brand)";
  if (role === "bursar" || role === "admissions") return "var(--warn-ink)";
  return "var(--line)";
};
