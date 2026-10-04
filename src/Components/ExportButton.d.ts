// Types for ExportButton.jsx, so TypeScript screens get real checking while it is
// still JavaScript. Keep in step with it; delete this file when it becomes
// .tsx.
import type { ReactNode } from "react";

export interface ExportColumn<Row = Record<string, unknown>> {
  key: string | ((row: Row) => unknown);
  label: string;
  type?: unknown;
}
export interface ExportProps {
  columns?: ExportColumn<any>[];
  rows?: Record<string, unknown>[] | unknown[];
  sheets?: { name: string; rows: unknown[]; columns: ExportColumn<any>[] }[];
  filename: string;
  sheetName?: string;
  title?: string;
  label?: string;
  disabled?: boolean;
  size?: string;
}
export declare const ExportMenu: (p: ExportProps) => JSX.Element;
export declare const ExportButton: (p: ExportProps & { roles?: string[]; module?: string }) => JSX.Element | null;
declare const Default: typeof ExportButton;
export default Default;
