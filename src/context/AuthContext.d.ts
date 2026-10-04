// Types for AuthContext.jsx, so TypeScript screens get real checking while it is
// still JavaScript. Keep in step with it; delete this file when it becomes
// .tsx.
import type { ReactNode } from "react";

export interface AuthValue {
  session: unknown;
  user: ({ id: string; email?: string } & Record<string, unknown>) | null;
  profile: Record<string, unknown> | null;
  loading: boolean;
  sessionReady: boolean;
  signOut: () => Promise<void>;
  [key: string]: unknown;
}
export declare const useAuth: () => AuthValue;
export declare const AuthProvider: (p: { children?: ReactNode }) => JSX.Element;
