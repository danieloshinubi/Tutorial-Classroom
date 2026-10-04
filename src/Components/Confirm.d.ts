// Types for Confirm.jsx, so TypeScript screens get real checking while it is
// still JavaScript. Keep in step with it; delete this file when it becomes
// .tsx.
import type { ReactNode } from "react";

export interface ConfirmInput {
  title?: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: string;
}
export interface PromptInput extends ConfirmInput {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
}
export declare const ConfirmProvider: (p: { children?: ReactNode }) => JSX.Element;
export declare const useConfirm: () => (input: ConfirmInput | string) => Promise<boolean>;
export declare const usePrompt: () => (input: PromptInput) => Promise<string | null>;
export declare const confirmDialog: (input: ConfirmInput | string) => Promise<boolean>;
export declare const promptDialog: (input: PromptInput) => Promise<string | null>;
