// Spooling a list to a file, in the format the person chooses:
//
//   xlsx  a real Excel workbook, one sheet per list (lib/xlsx.js)
//   csv   plain comma-separated text, for other systems; one file per list
//   pdf   a real PDF file, downloaded straight away like the others: the
//         school's name, the list's title and the date at the top, a table
//         with its header repeated on every page, page numbers at the foot.
//         The PDF engine (jsPDF) loads only when someone exports a PDF.
//
// sheets: [{ name, columns: [{ key, label, type? }], rows }]. Every format
// reads the same columns, so a page defines its export once.
import { downloadXlsx } from "./xlsx";

export const EXPORT_FORMATS = [
  { id: "xlsx", label: "XLSX", hint: "Excel workbook" },
  { id: "csv", label: "CSV", hint: "Plain text for other systems" },
  { id: "pdf", label: "PDF", hint: "To print or send" },
];

// The format each person last used, remembered on their device.
const FORMAT_KEY = "schoolivio.exportFormat";
export const preferredFormat = () => {
  try {
    const saved = window.localStorage.getItem(FORMAT_KEY);
    return EXPORT_FORMATS.some((f) => f.id === saved) ? saved : "xlsx";
  } catch {
    return "xlsx";
  }
};
export const rememberFormat = (id) => {
  try {
    window.localStorage.setItem(FORMAT_KEY, id);
  } catch {
    // Not remembered; Excel next time.
  }
};

const read = (row, key) => {
  if (typeof key === "function") return key(row);
  return String(key).split(".").reduce((v, k) => (v == null ? v : v[k]), row);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

// What a person reads in a CSV or PDF cell: money with separators, dates as
// dates. (Excel gets the raw value and formats it itself.)
const shown = (value, type) => {
  if (value === null || value === undefined || value === "") return "";
  if (type === "money") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
  }
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-NG", { maximumFractionDigits: 2 }) : String(value);
  }
  const s = String(value);
  if (type === "date" || (!type && ISO_DATE.test(s))) {
    const d = new Date(ISO_DATE.test(s) ? `${s}T12:00:00` : s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  if (type === "datetime" || (!type && ISO_DATETIME.test(s))) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return s;
};

const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const baseName = (filename) => String(filename || "export").replace(/\.(xlsx|csv|pdf)$/i, "");
const dated = (base) => (/\d{4}-\d{2}-\d{2}/.test(base) ? base : `${base}-${stamp()}`);

const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

// --------------------------------------------------------------------- csv

const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = ({ columns, rows }) => {
  // Raw numbers, so a spreadsheet can add them up; dates as ISO days.
  const value = (row, c) => {
    const v = read(row, c.key);
    if (c.type === "money" || c.type === "number") return v == null || v === "" ? "" : Number(v);
    if (c.type === "date" && v) return String(v).slice(0, 10);
    return v;
  };
  const lines = [
    columns.map((c) => csvCell(c.label)).join(","),
    ...rows.map((row) => columns.map((c) => csvCell(value(row, c))).join(",")),
  ];
  // A BOM so Excel reads the file as UTF-8 (names with accents, the ₦ sign).
  return `﻿${lines.join("\r\n")}`;
};

const exportCsv = (filename, sheets) => {
  const base = dated(baseName(filename));
  sheets.forEach((sheet, i) => {
    const suffix = sheets.length > 1 ? `-${String(sheet.name || i + 1).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    const blob = new Blob([toCsv(sheet)], { type: "text/csv;charset=utf-8" });
    // Several files at once: a small gap stops browsers dropping the later ones.
    setTimeout(() => saveBlob(blob, `${base}${suffix}.csv`), i * 350);
  });
};

// --------------------------------------------------------------------- pdf

// The PDF's built-in fonts cover Western European text. The naira sign and
// anything beyond (emoji, other scripts) are not in them, so they are spelt
// out rather than printed as boxes.
const pdfText = (value) =>
  String(value)
    .replace(/₦/g, "NGN ")
    // Other currency signs the fonts lack (supabase/226: any currency) are
    // spelt as their codes. $, £, € and ¥ print as they are.
    .replace(/GH₵|₵/g, "GHS ")
    .replace(/₹/g, "INR ")
    .replace(/₱/g, "PHP ")
    .replace(/₩/g, "KRW ")
    .replace(/₺/g, "TRY ")
    .replace(/₽/g, "RUB ")
    .replace(/₴/g, "UAH ")
    .replace(/₪/g, "ILS ")
    .replace(/₫/g, "VND ")
    .replace(/฿/g, "THB ")
    .replace(/৳/g, "BDT ")
    .replace(/₸/g, "KZT ")
    .replace(/₼/g, "AZN ")
    .replace(/₾/g, "GEL ")
    .replace(/₡/g, "CRC ")
    .replace(/₲/g, "PYG ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // A letter the fonts lack keeps its base letter instead of vanishing:
    // Yoruba "ọ́", "ẹ" and "ṣ" print as "o", "e" and "s", so "Dàmilọ́lá
    // Ṣàngó" reads "Dàmilola Sàngó" rather than "Dàmillá àngó".
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, (ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, ""))
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

// The school's colour, from the page's own theme, for the table header.
const brandRgb = () => {
  try {
    const hex = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  } catch {
    // No page theme: fall through to a neutral dark.
  }
  return [40, 44, 52];
};

const exportPdf = async (filename, sheets, { title, subtitle } = {}) => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const wide = sheets.some((s) => s.columns.length > 6);
  const doc = new jsPDF({ orientation: wide ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;
  const brand = brandRgb();
  const heading = pdfText(title || baseName(filename).replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()));
  const when = new Date().toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

  // Header block on the first page.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(28, 31, 38);
  doc.text(heading, margin, margin + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(91, 98, 112);
  if (subtitle) doc.text(pdfText(subtitle), margin, margin + 24);
  doc.text(`Exported ${pdfText(when)}`, pageWidth - margin, margin + 8, { align: "right" });
  doc.setDrawColor(...brand);
  doc.setLineWidth(1.5);
  doc.line(margin, margin + 32, pageWidth - margin, margin + 32);

  let y = margin + 46;
  sheets.forEach((sheet, index) => {
    if (sheets.length > 1) {
      if (index > 0) y += 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(28, 31, 38);
      doc.text(pdfText(sheet.name || `List ${index + 1}`), margin, y);
      y += 8;
    }
    const numeric = sheet.columns.map((c) => c.type === "money" || c.type === "number");
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, top: margin, bottom: margin + 10 },
      head: [sheet.columns.map((c) => pdfText(c.label))],
      body: sheet.rows.length
        ? sheet.rows.map((row) => sheet.columns.map((c) => pdfText(shown(read(row, c.key), c.type))))
        : [[{ content: "Nothing to show.", colSpan: Math.max(1, sheet.columns.length), styles: { halign: "center", textColor: [138, 144, 156] } }]],
      styles: { font: "helvetica", fontSize: sheet.columns.length > 8 ? 7.5 : 9, cellPadding: 4, overflow: "linebreak", textColor: [28, 31, 38], lineColor: [227, 230, 235], lineWidth: 0.5 },
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 247, 249] },
      columnStyles: Object.fromEntries(numeric.map((n, i) => [i, n ? { halign: "right" } : {}])),
      didParseCell: (data) => {
        if (data.section === "head" && numeric[data.column.index]) data.cell.styles.halign = "right";
      },
    });
    y = doc.lastAutoTable.finalY + 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(138, 144, 156);
    doc.text(`${sheet.rows.length} ${sheet.rows.length === 1 ? "row" : "rows"}`, margin, y - 4);
    y += 6;
  });

  // Page numbers on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(138, 144, 156);
    const footY = doc.internal.pageSize.getHeight() - margin / 2;
    if (subtitle) doc.text(pdfText(subtitle), margin, footY);
    doc.text(`Page ${i} of ${pages}`, pageWidth - margin, footY, { align: "right" });
  }

  saveBlob(doc.output("blob"), `${dated(baseName(filename))}.pdf`);
};

// ------------------------------------------------------------------ public

export const exportRows = async (format, filename, sheets, options = {}) => {
  const list = (Array.isArray(sheets) ? sheets : [sheets]).map((s) => ({ ...s, rows: s.rows || [], columns: s.columns || [] }));
  if (format === "csv") return exportCsv(filename, list);
  if (format === "pdf") return exportPdf(filename, list, options);
  return downloadXlsx(filename, list);
};
