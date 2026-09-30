// Real Excel workbooks (.xlsx), built in the browser with no library.
//
// Every list in Schoolivio "spools" to a spreadsheet. CSV opened in Excel but
// lost everything that makes a sheet usable: numbers came in as text, dates
// as strings, no bold header, every column the same narrow width. An .xlsx is
// a zip of a few small XML files, so this writes those files and zips them
// (stored, uncompressed: school lists are small, and it keeps this short).
//
//   downloadXlsx("fees-first-term", [
//     { name: "Invoices", columns: [{ key: "reference", label: "Reference" },
//                                   { key: "balance", label: "Balance", type: "money" }],
//       rows },
//   ]);
//
// A column's key reads the row (dot paths allowed, e.g. "profiles.email") or
// is a function(row). type: "text" | "number" | "money" | "date" | "datetime";
// left out, JavaScript numbers become number cells, ISO dates become date
// cells, and everything else is text. Text that looks like a number stays
// text unless the column says otherwise, so account numbers, phone numbers
// and admission numbers keep their leading zeros.

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
// Characters XML 1.0 does not allow at all (control codes pasted from Word).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const esc = (s) => String(s).replace(INVALID_XML, "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

const read = (row, key) => {
  if (typeof key === "function") return key(row);
  return String(key).split(".").reduce((v, k) => (v == null ? v : v[k]), row);
};

// Excel counts days from 30 Dec 1899. Local calendar parts, so a date is the
// day it says, not the UTC moment it was stored as.
const excelSerial = (date) => {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  return utc / 86400000 + 25569;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

// Column letters: 0 -> A, 25 -> Z, 26 -> AA.
const colName = (i) => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// Style ids, matching styles.xml below.
const STYLE = { text: 0, header: 1, number: 2, money: 3, date: 4, datetime: 5 };

const cellXml = (ref, value, type) => {
  if (value === null || value === undefined || value === "") return "";
  let kind = type;
  if (!kind) {
    if (typeof value === "number" && Number.isFinite(value)) kind = "number";
    else if (value instanceof Date) kind = "datetime";
    else if (typeof value === "string" && ISO_DATE.test(value)) kind = "date";
    else if (typeof value === "string" && ISO_DATETIME.test(value)) kind = "datetime";
    else if (typeof value === "boolean") kind = "bool";
    else kind = "text";
  }
  if (kind === "number" || kind === "money") {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s₦$£]/g, ""));
    if (Number.isFinite(n)) return `<c r="${ref}" s="${STYLE[kind]}"><v>${n}</v></c>`;
    kind = "text";
  }
  if (kind === "date" || kind === "datetime") {
    const d = value instanceof Date ? value : new Date(ISO_DATE.test(String(value)) ? `${value}T00:00:00` : value);
    if (!Number.isNaN(d.getTime())) {
      const serial = kind === "date" ? Math.floor(excelSerial(d)) : excelSerial(d);
      return `<c r="${ref}" s="${STYLE[kind]}"><v>${serial}</v></c>`;
    }
    kind = "text";
  }
  if (kind === "bool") return `<c r="${ref}" t="inlineStr"><is><t>${value ? "Yes" : "No"}</t></is></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
};

const displayLength = (value, type) => {
  if (value === null || value === undefined) return 0;
  if (type === "money" || type === "number" || typeof value === "number") return String(Math.round(Number(value) * 100) / 100).length + 4;
  if (type === "date" || ISO_DATE.test(String(value))) return 12;
  if (type === "datetime" || ISO_DATETIME.test(String(value))) return 17;
  return String(value).split("\n").reduce((m, l) => Math.max(m, l.length), 0);
};

const sheetXml = ({ columns, rows }) => {
  const widths = columns.map((c) => Math.max(8, Math.min(60, String(c.label).length + 2)));
  const body = rows.map((row, r) => {
    const cells = columns.map((c, i) => {
      const value = read(row, c.key);
      widths[i] = Math.max(widths[i], Math.min(60, displayLength(value, c.type) + 2));
      return cellXml(`${colName(i)}${r + 2}`, value, c.type);
    });
    return `<row r="${r + 2}">${cells.join("")}</row>`;
  });
  const header = `<row r="1">${columns
    .map((c, i) => `<c r="${colName(i)}1" s="${STYLE.header}" t="inlineStr"><is><t>${esc(c.label)}</t></is></c>`)
    .join("")}</row>`;
  const last = `${colName(Math.max(0, columns.length - 1))}${rows.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${header}${body.join("")}</sheetData>` +
    (columns.length ? `<autoFilter ref="A1:${last}"/>` : "") +
    `</worksheet>`
  );
};

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="d mmm yyyy"/><numFmt numFmtId="166" formatCode="d mmm yyyy h:mm"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEDEFF3"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="thin"><color rgb="FFB8BDC7"/></bottom><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="6">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs></styleSheet>`;

// Sheet names: 31 characters, none of : \ / ? * [ ], unique.
const sheetNames = (sheets) => {
  const used = new Set();
  return sheets.map((s, i) => {
    let base = String(s.name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${n++})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
};

// ------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const zip = (files) => {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, dosTime, true);
    dir.setUint16(14, dosDate, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((t, c) => t + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

// ------------------------------------------------------------------ public

export const buildXlsx = (sheets) => {
  const list = (Array.isArray(sheets) ? sheets : [sheets]).map((s) => ({ ...s, rows: s.rows || [], columns: s.columns || [] }));
  const names = sheetNames(list);
  const files = [
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        (list.some((s) => s.columns.length)
          ? `<definedNames>${list
              .map((s, i) => (s.columns.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : ""))
              .join("")}</definedNames>`
          : "") +
        `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES_XML },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(files);
};

const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Builds the workbook and hands it to the browser as a download. The date
// goes in the name so a week of exports do not overwrite each other.
export const downloadXlsx = (filename, sheets) => {
  const blob = buildXlsx(sheets);
  const base = String(filename || "export").replace(/\.(xlsx|csv)$/i, "");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  // Dated unless the name already carries a date ("attendance-2026-09-01-to-...").
  link.download = /\d{4}-\d{2}-\d{2}/.test(base) ? `${base}.xlsx` : `${base}-${stamp()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};
