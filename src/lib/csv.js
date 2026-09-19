// One "spool to a file" primitive for every list in the platform console —
// tenants, team, audit log, trials, gateways, mailboxes, billing, a school's
// own admins — so each page wires up a couple of column definitions rather
// than reimplementing escaping and the download dance seven times over.

// RFC 4180: a field touching a comma, quote or newline is wrapped in quotes,
// and any quote inside it is doubled. Everything else passes through as-is.
const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// `columns` is [{ key, label }] — `key` either reads straight off each row,
// or is a function(row) for anything computed (a joined name, a formatted
// date) rather than forcing the caller to pre-shape their data first.
export const toCsv = (rows, columns) => {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((c) => csvCell(typeof c.key === "function" ? c.key(row) : row[c.key]))
      .join(",")
  );
  return [header, ...lines].join("\r\n");
};

export const downloadCsv = (filename, rows, columns) => {
  const csv = toCsv(rows, columns);
  // A leading BOM so Excel (still the most likely opener) reads UTF-8
  // correctly instead of mangling anything outside plain ASCII.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
