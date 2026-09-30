// Spools a list the school is looking at to a real Excel workbook
// (lib/xlsx.js). It used to write CSV, which opened in Excel with numbers as
// text, dates as strings and every column the same width. The name is kept
// so existing callers keep working.
//
// columns: [{ key, label, type? }] — key reads the row (dot paths allowed,
// e.g. "profiles.email") or is a function(row); label is the header cell;
// type is "text" | "number" | "money" | "date" | "datetime". rows: objects.
import { downloadXlsx } from "./xlsx";
import { prettySheetName } from "./csv";

export const downloadCsv = (filename, columns, rows, sheetName) =>
  downloadXlsx(filename, [{ name: sheetName || prettySheetName(filename), columns, rows }]);

// Several lists in one workbook, one sheet each: [{ name, columns, rows }].
export const downloadWorkbook = (filename, sheets) => downloadXlsx(filename, sheets);
