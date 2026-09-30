import React, { useState } from "react";
import { Icon } from "react-icons-kit";
import { download } from "react-icons-kit/feather/download";
import { useSchool, useSchoolIfAny } from "../context/SchoolContext";
import { exportRows, EXPORT_FORMATS, preferredFormat, rememberFormat } from "../lib/exporters";
import { prettySheetName } from "../lib/csv";
import { Button, Select } from "./UI";
import { useActionFeedback } from "./Toast";

// Spooling a list out of the app: an Export button with a format picker
// beside it (XLSX, CSV or PDF). Every file downloads straight away
// (lib/exporters.js); the picker remembers each person's last choice.
//
// ExportMenu does the work and checks nothing. ExportButton wraps it with the
// rule for who may spool: the school's owner and admins (the product owner's
// call), plus any extra roles a page names in `roles` when the list is theirs
// to run (the bursar on the money pages). It renders nothing for anyone else,
// rather than trusting every call site to remember its own role check.
//
// columns: [{ key, label, type? }], rows: the already-loaded data a page is
// showing on screen — it never fetches on its own, it only ever exports what
// the caller can already see. `sheets` instead of columns/rows spools several
// lists together: [{ name, columns, rows }].

const FORMAT_OPTIONS = EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label }));

export const ExportMenu = ({
  columns,
  rows = [],
  sheets,
  filename,
  sheetName,
  title,
  label = "Export",
  disabled,
  size = "sm",
}) => {
  const school = useSchoolIfAny()?.school;
  const { setError } = useActionFeedback();
  const [format, setFormat] = useState(preferredFormat);
  const [busy, setBusy] = useState(false);

  const list = sheets || [{ name: sheetName || prettySheetName(filename), columns, rows }];
  const empty = list.every((s) => !s.rows || s.rows.length === 0);
  const chosen = EXPORT_FORMATS.find((f) => f.id === format) || EXPORT_FORMATS[0];

  const choose = (id) => {
    setFormat(id);
    rememberFormat(id);
  };

  const run = async () => {
    setBusy(true);
    try {
      await exportRows(format, filename, list, {
        title: title || sheetName || prettySheetName(filename),
        subtitle: school?.name,
      });
    } catch (err) {
      setError(err.message || "Could not create the file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`exp-group${size === "sm" ? " sm" : ""}`}>
      <Button
        type="button"
        variant="secondary"
        size={size}
        onClick={run}
        disabled={disabled || empty || busy}
        title={empty ? "Nothing to export yet" : `Download as ${chosen.label} (${chosen.hint})`}
      >
        <Icon icon={download} size={14} />
        <span>{busy ? "Exporting..." : label}</span>
      </Button>
      <Select
        className="select exp-format"
        value={format}
        onChange={choose}
        options={FORMAT_OPTIONS}
        aria-label="File type"
        disabled={disabled || busy}
      />
    </span>
  );
};

export const ExportButton = ({ roles = [], ...props }) => {
  const { isAdmin, roles: mine = [] } = useSchool();
  const allowed = isAdmin || roles.some((r) => mine.includes(r));
  if (!allowed) return null;
  return <ExportMenu {...props} />;
};

export default ExportButton;
