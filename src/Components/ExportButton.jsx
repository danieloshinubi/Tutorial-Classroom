import React, { useState } from "react";
import { useSchool } from "../context/SchoolContext";
import { downloadCsv } from "../lib/csvExport";
import { Button } from "./UI";

// Spooling records out of the app — a member list, an attendance sheet,
// whatever a page hands it — is restricted to the tenant admin alone (the
// product owner's explicit call): renders nothing for anyone else, rather
// than trusting every call site to remember its own role check.
//
// columns: [{ key, label }], rows: the already-loaded data a page is
// showing on screen — this never fetches on its own, it only ever exports
// what the caller can already see.
export const ExportButton = ({ columns, rows, filename, label = "Export CSV", disabled }) => {
  const { isAdmin } = useSchool();
  const [busy, setBusy] = useState(false);

  if (!isAdmin) return null;

  const handleClick = () => {
    setBusy(true);
    try {
      downloadCsv(filename, columns, rows);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleClick}
      disabled={disabled || busy || rows.length === 0}
    >
      {busy ? "Exporting..." : label}
    </Button>
  );
};

export default ExportButton;
