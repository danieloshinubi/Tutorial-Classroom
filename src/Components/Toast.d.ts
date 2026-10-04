// Types for Toast.jsx, so TypeScript screens get real checking while it is
// still JavaScript. Keep in step with it; delete this file when it becomes
// .tsx.
import type { ReactNode } from "react";

export declare const ToastProvider: (p: { children?: ReactNode }) => JSX.Element;
export declare const useToast: () => { notify: (message: string, options?: { tone?: "error" | "success" | "info" }) => void };
export declare const useActionFeedback: () => {
  error: string;
  notice: string;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};
