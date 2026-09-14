// A CSV cell is only ever unsafe when it contains a comma, quote, or
// newline — everything else is written bare so a plain spreadsheet of names
// and numbers stays readable if someone opens the raw file. RFC 4180's
// escape is doubling internal quotes and wrapping the whole cell in quotes.
const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// columns: [{ key, label }] — key reads the row (dot paths allowed, e.g.
// "profiles.email"), label is the header cell. rows: plain objects.
export const rowsToCsv = (columns, rows) => {
  const read = (row, key) => key.split(".").reduce((v, k) => (v == null ? v : v[k]), row);
  const lines = [
    columns.map((c) => csvCell(c.label)).join(","),
    ...rows.map((row) => columns.map((c) => csvCell(read(row, c.key))).join(",")),
  ];
  // A leading BOM so Excel opens the file as UTF-8 instead of guessing the
  // system codepage and mangling names with accents.
  return `﻿${lines.join("\r\n")}`;
};

// Triggers a real browser download of a CSV built from columns/rows. Plain
// Blob + object URL + a throwaway <a download> — no library earns its
// weight for a comma-separated file for one export button.
export const downloadCsv = (filename, columns, rows) => {
  const blob = new Blob([rowsToCsv(columns, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
