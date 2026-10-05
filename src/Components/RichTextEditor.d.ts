// Types for RichTextEditor.jsx, so TypeScript screens get real checking while
// it is still JavaScript. Keep in step with it.
import type { ForwardRefExoticComponent, RefAttributes } from "react";

export interface RichTextEditorHandle {
  focus: () => void;
  insertContent: (html: string) => void;
  /** A picture inside the text (full toolbar only), e.g. a data: URI. */
  insertImage: (src: string, alt?: string) => void;
  [key: string]: unknown;
}
export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onSubmitEditor?: () => void;
  showToolbar?: boolean;
  autoFocus?: boolean;
  toolbar?: "basic" | "full";
  onPasteFiles?: (files: File[]) => void;
}
export declare const RichTextEditor: ForwardRefExoticComponent<RichTextEditorProps & RefAttributes<RichTextEditorHandle>>;
export default RichTextEditor;
