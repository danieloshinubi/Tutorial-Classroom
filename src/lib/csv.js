// One "spool to a file" primitive for every list in the platform console —
// tenants, team, audit log, trials, gateways, mailboxes, billing, a school's
// own admins — so each page wires up a couple of column definitions rather
// than reimplementing the download dance seven times over.
//
// It spools a real Excel workbook now (lib/xlsx.js), not CSV: numbers and
// dates arrive as numbers and dates, the header is bold and frozen, columns
// are sized to fit. The name is kept so every existing caller keeps working.
import { downloadXlsx } from "./xlsx";

// `columns` is [{ key, label, type? }] — `key` either reads straight off each
// row, or is a function(row) for anything computed (a joined name, a
// formatted date) rather than forcing the caller to pre-shape their data.
export const downloadCsv = (filename, rows, columns, sheetName) =>
  downloadXlsx(filename, [{ name: sheetName || prettySheetName(filename), columns, rows }]);

export const prettySheetName = (filename) =>
  String(filename || "Sheet1")
    .replace(/\.(csv|xlsx)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
